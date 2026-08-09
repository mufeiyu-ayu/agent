import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import process from 'node:process'
// 项目使用 Node 原生测试运行器，不为真实数据库验证引入额外框架。
// eslint-disable-next-line test/no-import-node-test
import { after, before, describe, it } from 'node:test'

import { PrismaClient } from '../generated/prisma/client.js'
import {
  DatabaseCommitOutcomeUnknownError,
  DatabaseOperationDeadlineExceededError,
  PrismaService,
  RollbackSafePrismaPg,
} from './prisma.service.js'

interface PgQueryResult<Row> {
  rows: Row[]
}

interface PgQueryable {
  query: <Row = Record<string, unknown>>(text: string, values?: unknown[]) => Promise<PgQueryResult<Row>>
}

interface PgClient extends PgQueryable {
  readonly processID: number
  release: () => void
}

interface PgPool extends PgQueryable {
  readonly waitingCount: number
  connect: () => Promise<PgClient>
  end: () => Promise<void>
}

interface PgPoolConstructor {
  readonly prototype: Pick<PgPool, 'connect'>
  new (config: {
    connectionString: string
    max: number
    connectionTimeoutMillis?: number
  }): PgPool
}

const { Pool } = createRequire(import.meta.url)('pg') as { Pool: PgPoolConstructor }

const connectionString = process.env.DATABASE_URL?.trim()

if (!connectionString)
  throw new Error('运行真实数据库验证前请在项目根目录 .env 中设置 DATABASE_URL')

describe('PrismaService database deadline reliability', () => {
  const prisma = new PrismaService()

  before(async () => {
    await prisma.$connect()
  })

  after(async () => {
    await prisma.$disconnect()
  })

  it('transaction setup 使用固定 session bound，SET LOCAL 后恢复 baseline', async () => {
    const localSettings = await prisma.withDeadlineTransaction(
      createDeadline(500),
      transaction => transaction.execute(client => client.$queryRawUnsafe<Array<{
        lock_timeout: string
        pid: number
        statement_timeout: string
      }>>(`
        SELECT
          pg_backend_pid()::int AS pid,
          current_setting('statement_timeout') AS statement_timeout,
          current_setting('lock_timeout') AS lock_timeout
      `)),
    )

    assert.notEqual(localSettings[0]!.statement_timeout, '5s')
    assert.notEqual(localSettings[0]!.lock_timeout, '0')

    const baseline = await prisma.$queryRawUnsafe<Array<{
      lock_timeout: string
      pid: number
      statement_timeout: string
    }>>(`
      SELECT
        pg_backend_pid()::int AS pid,
        current_setting('statement_timeout') AS statement_timeout,
        current_setting('lock_timeout') AS lock_timeout
    `)
    assert.deepEqual(baseline[0], {
      lock_timeout: '0',
      pid: localSettings[0]!.pid,
      statement_timeout: '5s',
    })
  })

  it('statement_timeout 由 PostgreSQL 取消 pg_sleep', async () => {
    const startedAt = Date.now()
    let failure: unknown
    let backendPid: number | undefined

    try {
      await prisma.withDeadlineTransaction(
        createDeadline(80),
        async (transaction) => {
          const rows = await transaction.execute(client => client.$queryRawUnsafe<Array<{
            pid: number
          }>>('SELECT pg_backend_pid()::int AS pid'))
          backendPid = rows[0]!.pid
          await transaction.execute(client => client.$queryRawUnsafe('SELECT pg_sleep(1)'))
        },
      )
    }
    catch (error) {
      failure = error
    }

    assert.ok(failure instanceof DatabaseOperationDeadlineExceededError)
    assert.match(errorDetail(failure.cause), /57014/)
    assert.match(errorDetail(failure.cause), /canceling statement due to statement timeout/)
    assert.ok(Date.now() - startedAt < 750)
    assert.ok(backendPid !== undefined)

    const monitor = new Pool({ connectionString, max: 1 })
    try {
      const activity = await monitor.query<{ state: string, wait_event: string | null }>(
        'SELECT state, wait_event FROM pg_stat_activity WHERE pid = $1',
        [backendPid],
      )
      assert.notEqual(activity.rows[0]?.wait_event, 'PgSleep')
      assert.notEqual(activity.rows[0]?.state, 'active')
    }
    finally {
      await monitor.end()
    }
  })

  it('lock_timeout 由 PostgreSQL 取消受控 advisory lock wait', async () => {
    const lockOwner = new Pool({ connectionString, max: 1 })
    const lockKey = process.pid * 100_000 + Date.now() % 100_000
    const client = await lockOwner.connect()

    try {
      await client.query('SELECT pg_advisory_lock($1::bigint)', [lockKey])
      let failure: unknown

      try {
        await prisma.withDeadlineTransaction(
          createDeadline(120),
          transaction => transaction.execute(database => database.$queryRawUnsafe(
            'SELECT pg_advisory_xact_lock($1::bigint)',
            lockKey,
          )),
        )
      }
      catch (error) {
        failure = error
      }

      assert.ok(failure instanceof DatabaseOperationDeadlineExceededError)
      assert.match(errorDetail(failure.cause), /55P03/)
      assert.match(errorDetail(failure.cause), /canceling statement due to lock timeout/)

      const postgresFailure = await captureFailure(() => prisma.$transaction(async (database) => {
        await database.$executeRawUnsafe('SET LOCAL statement_timeout = \'200ms\'')
        await database.$executeRawUnsafe('SET LOCAL lock_timeout = \'40ms\'')
        await database.$queryRawUnsafe(
          'SELECT pg_advisory_xact_lock($1::bigint)',
          lockKey,
        )
      }, { maxWait: 3_000, timeout: 1_000 }))
      assert.match(errorDetail(postgresFailure), /55P03/)
      assert.match(errorDetail(postgresFailure), /canceling statement due to lock timeout/)
    }
    finally {
      await client.query('SELECT pg_advisory_unlock($1::bigint)', [lockKey])
      client.release()
      await lockOwner.end()
    }
  })

  it('caller acquisition timeout 不伪称已取消 pg Pool waiter', async () => {
    const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 2_000 })
    const heldClient = await pool.connect()
    const pendingClient = pool.connect()
    let heldClientReleased = false

    try {
      await assert.rejects(
        waitAsCaller(pendingClient, 40),
        /caller acquisition timeout/,
      )
      assert.equal(pool.waitingCount, 1)

      heldClient.release()
      heldClientReleased = true
      const lateClient = await pendingClient
      lateClient.release()
    }
    finally {
      if (!heldClientReleased)
        heldClient.release()
      await pool.end()
    }
  })

  it('迟到 BEGIN 被 Prisma 丢弃时 wrapper 真实 ROLLBACK 后释放连接', async () => {
    const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 2_000 })
    const originalConnect = pool.connect.bind(pool)
    const directPrisma = new PrismaClient({
      adapter: new RollbackSafePrismaPg(
        pool as unknown as ConstructorParameters<typeof RollbackSafePrismaPg>[0],
      ),
    })
    let beginDelayed = false
    let rollbackObserved = false
    let callbackInvoked = false
    let backendPid: number | undefined

    pool.connect = async () => {
      const client = await originalConnect()
      const rawClient = client as unknown as {
        query: (...args: unknown[]) => Promise<unknown>
      }
      const originalQuery = rawClient.query.bind(client)

      rawClient.query = async (...args: unknown[]): Promise<unknown> => {
        const sql = queryText(args[0])
        const result = await originalQuery(...args)

        if (normalizedSql(sql) === 'BEGIN' && !beginDelayed) {
          beginDelayed = true
          backendPid = client.processID
          // PostgreSQL 已执行 BEGIN，但 adapter 的 startTransaction 晚于 Prisma maxWait 返回。
          await sleep(80)
        }
        if (normalizedSql(sql) === 'ROLLBACK')
          rollbackObserved = true

        return result
      }

      return client
    }

    try {
      await directPrisma.$connect()
      const failure = await captureFailure(() => directPrisma.$transaction(async (transaction) => {
        callbackInvoked = true
        await transaction.$queryRawUnsafe('SELECT 1')
      }, { maxWait: 40, timeout: 500 }))

      assert.equal((failure as { code?: unknown }).code, 'P2028')
      assert.equal(callbackInvoked, false)
      await waitUntil(() => rollbackObserved)
      assert.equal(beginDelayed, true)
      assert.ok(backendPid !== undefined)

      pool.connect = originalConnect
      const reusableClient = await pool.connect()
      try {
        const reusable = await reusableClient.query<{ value: number, pid: number }>(
          'SELECT 1::int AS value, pg_backend_pid()::int AS pid',
        )
        assert.deepEqual(reusable.rows[0], { value: 1, pid: backendPid })
      }
      finally {
        reusableClient.release()
      }

      const monitor = new Pool({ connectionString, max: 1 })
      try {
        const activity = await monitor.query<{ state: string }>(
          'SELECT state FROM pg_stat_activity WHERE pid = $1',
          [backendPid],
        )
        assert.notEqual(activity.rows[0]?.state, 'idle in transaction')
      }
      finally {
        await monitor.end()
      }
    }
    finally {
      pool.connect = originalConnect
      await directPrisma.$disconnect()
      await pool.end()
    }
  })

  it('deadline 后 late acquisition 不进入业务 callback 且不留 idle transaction', async () => {
    const probe = await createWriteProbe(prisma)
    const releaseHolders = deferred<void>()
    const backendPids: number[] = []
    const holders = Array.from({ length: 10 }, () => prisma.$transaction(async (client) => {
      const rows = await client.$queryRawUnsafe<Array<{ pid: number }>>(
        'SELECT pg_backend_pid()::int AS pid',
      )
      backendPids.push(rows[0]!.pid)
      await releaseHolders.promise
    }))

    await waitUntil(() => backendPids.length === holders.length)

    let callbackInvoked = false
    let businessQueryInvoked = false
    const startedAt = Date.now()
    const operation = prisma.withDeadlineTransaction(
      createDeadline(40),
      async (transaction) => {
        callbackInvoked = true
        businessQueryInvoked = true
        await transaction.execute(client => client.$executeRawUnsafe(
          `INSERT INTO ${probe.table}(value) VALUES (1)`,
        ))
      },
    )

    try {
      await assert.rejects(
        operation,
        DatabaseOperationDeadlineExceededError,
      )
      assert.ok(Date.now() - startedAt < 500)
      assert.equal(callbackInvoked, false)
    }
    finally {
      releaseHolders.resolve()
      await Promise.all(holders)
    }

    await new Promise(resolve => setTimeout(resolve, 100))
    const monitor = new Pool({ connectionString, max: 1 })
    try {
      const activity = await monitor.query<{ count: number }>(
        `SELECT count(*)::int AS count
         FROM pg_stat_activity
         WHERE pid = ANY($1::int[])
           AND state = 'idle in transaction'`,
        [backendPids],
      )
      const writes = await monitor.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM ${probe.table}`,
      )

      assert.equal(activity.rows[0]!.count, 0)
      assert.equal(writes.rows[0]!.count, 0)
      assert.equal(callbackInvoked, false)
      assert.equal(businessQueryInvoked, false)
    }
    finally {
      await monitor.end()
      await dropProbe(prisma, probe.schema)
    }
  })

  it('commit ownership 取得后 caller 等待真实 COMMIT 成功', async () => {
    const probe = await createCommitProbe(prisma, false)

    try {
      let commitOwned = false
      const startedAt = Date.now()
      await prisma.withDeadlineTransaction(
        createDeadline(40),
        transaction => transaction.execute(client => client.$executeRawUnsafe(
          `INSERT INTO ${probe.table}(value) VALUES (1)`,
        )),
        () => {
          commitOwned = true
        },
      )
      const elapsedMs = Date.now() - startedAt
      const result = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT count(*)::int AS count FROM ${probe.table}`,
      )

      assert.equal(commitOwned, true)
      assert.ok(elapsedMs >= 180)
      assert.equal(result[0]!.count, 1)
    }
    finally {
      await dropCommitProbe(prisma, probe.schema)
    }
  })

  it('commit ownership 取得后 caller 等待真实 COMMIT 失败并回滚', async () => {
    const probe = await createCommitProbe(prisma, true)

    try {
      let commitOwned = false
      let transactionPid: number | undefined
      const startedAt = Date.now()
      const failure = await captureFailure(() => prisma.withDeadlineTransaction(
        createDeadline(40),
        async (transaction) => {
          const rows = await transaction.execute(client => client.$queryRawUnsafe<Array<{
            pid: number
          }>>('SELECT pg_backend_pid()::int AS pid'))
          transactionPid = rows[0]!.pid
          await transaction.execute(client => client.$executeRawUnsafe(
            `INSERT INTO ${probe.table}(value) VALUES (1)`,
          ))
        },
        () => {
          commitOwned = true
        },
      ))
      const elapsedMs = Date.now() - startedAt
      const result = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT count(*)::int AS count FROM ${probe.table}`,
      )
      const activity = await prisma.$queryRawUnsafe<Array<{ state: string }>>(
        'SELECT state FROM pg_stat_activity WHERE pid = $1',
        transactionPid!,
      )

      assert.equal(commitOwned, true)
      assert.ok(elapsedMs >= 180)
      assert.ok(!(failure instanceof DatabaseOperationDeadlineExceededError))
      assert.match(errorDetail(failure), /issue31 forced commit failure/)
      assert.equal(result[0]!.count, 0)
      assert.notEqual(activity[0]?.state, 'idle in transaction')
    }
    finally {
      await dropCommitProbe(prisma, probe.schema)
    }
  })

  it('普通 transaction 的 COMMIT in-flight 不绕过 caller deadline', async () => {
    const probe = await createCommitProbe(prisma, true)

    try {
      const startedAt = Date.now()
      const failure = await captureFailure(() => prisma.withDeadlineTransaction(
        createDeadline(40),
        transaction => transaction.execute(client => client.$executeRawUnsafe(
          `INSERT INTO ${probe.table}(value) VALUES (1)`,
        )),
      ))

      assert.ok(failure instanceof DatabaseOperationDeadlineExceededError)
      assert.ok(Date.now() - startedAt < 180)

      await sleep(250)
      const result = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT count(*)::int AS count FROM ${probe.table}`,
      )
      assert.equal(result[0]!.count, 0)
    }
    finally {
      await dropCommitProbe(prisma, probe.schema)
    }
  })

  it('completion COMMIT 超过内部 outcome 上界时返回结果未知并消费迟到 settlement', async () => {
    const probe = await createCommitProbe(prisma, false, 0.4)

    try {
      let commitOwned = false
      const startedAt = Date.now()
      const failure = await captureFailure(() => prisma.withDeadlineTransaction(
        createDeadline(40),
        transaction => transaction.execute(client => client.$executeRawUnsafe(
          `INSERT INTO ${probe.table}(value) VALUES (1)`,
        )),
        () => {
          commitOwned = true
        },
        60,
      ))
      const elapsedMs = Date.now() - startedAt
      const pendingResult = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT count(*)::int AS count FROM ${probe.table}`,
      )

      assert.equal(commitOwned, true)
      assert.ok(failure instanceof DatabaseCommitOutcomeUnknownError)
      assert.ok(elapsedMs >= 50)
      assert.ok(elapsedMs < 300)
      assert.equal(pendingResult[0]!.count, 0)

      await sleep(450)
      const settledResult = await prisma.$queryRawUnsafe<Array<{ count: number }>>(
        `SELECT count(*)::int AS count FROM ${probe.table}`,
      )
      assert.equal(settledResult[0]!.count, 1)
    }
    finally {
      await dropCommitProbe(prisma, probe.schema)
    }
  })
})

function createDeadline(timeoutMs: number) {
  return {
    deadlineAt: Date.now() + timeoutMs,
    createTimeoutError: () => new DatabaseOperationDeadlineExceededError(),
  }
}

let commitProbeSequence = 0

async function createWriteProbe(
  prisma: PrismaService,
): Promise<{ schema: string, table: string }> {
  commitProbeSequence += 1
  const schema = `issue31_reliability_${process.pid}_${commitProbeSequence}`
  const table = `"${schema}"."write_probe"`

  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
  await prisma.$executeRawUnsafe(`CREATE TABLE ${table}(value int)`)

  return { schema, table }
}

async function createCommitProbe(
  prisma: PrismaService,
  failOnCommit: boolean,
  commitDelaySeconds = 0.2,
): Promise<{ schema: string, table: string }> {
  commitProbeSequence += 1
  const schema = `issue31_reliability_${process.pid}_${commitProbeSequence}`
  const table = `"${schema}"."commit_probe"`
  const failure = failOnCommit
    ? 'RAISE EXCEPTION \'issue31 forced commit failure\';'
    : ''

  await prisma.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
  await prisma.$executeRawUnsafe(`CREATE TABLE ${table}(value int)`)
  await prisma.$executeRawUnsafe(`
    CREATE FUNCTION "${schema}".delay_commit()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      PERFORM pg_sleep(${commitDelaySeconds});
      ${failure}
      RETURN NEW;
    END
    $$
  `)
  await prisma.$executeRawUnsafe(`
    CREATE CONSTRAINT TRIGGER issue31_delay_commit
    AFTER INSERT ON ${table}
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW
    EXECUTE FUNCTION "${schema}".delay_commit()
  `)

  return { schema, table }
}

async function dropCommitProbe(
  prisma: PrismaService,
  schema: string,
): Promise<void> {
  await dropProbe(prisma, schema)
}

async function dropProbe(
  prisma: PrismaService,
  schema: string,
): Promise<void> {
  await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
}

function errorDetail(error: unknown): string {
  const candidate = error as { message?: unknown, meta?: unknown }
  return `${
    typeof candidate?.message === 'string' ? candidate.message : ''
  } ${safeJson(candidate?.meta)}`
}

async function captureFailure(operation: () => Promise<unknown>): Promise<unknown> {
  try {
    await operation()
  }
  catch (error) {
    return error
  }

  assert.fail('预期数据库操作失败')
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  }
  catch {
    return ''
  }
}

function waitAsCaller<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('caller acquisition timeout')),
      timeoutMs,
    )

    operation.then(
      (result) => {
        clearTimeout(timer)
        resolve(result)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function queryText(query: unknown): string {
  if (typeof query === 'string')
    return query
  if (
    typeof query === 'object'
    && query !== null
    && 'text' in query
    && typeof query.text === 'string'
  ) {
    return query.text
  }
  return ''
}

function normalizedSql(sql: string): string {
  return sql.trim().replace(/;$/, '').toUpperCase()
}

function sleep(timeoutMs: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, timeoutMs))
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve
  })

  return { promise, resolve }
}

async function waitUntil(predicate: () => boolean): Promise<void> {
  const deadlineAt = Date.now() + 1_500

  while (!predicate()) {
    if (Date.now() >= deadlineAt)
      throw new Error('等待 Prisma Pool 占满超时')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
