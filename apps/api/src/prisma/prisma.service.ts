import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import type { Prisma } from '../generated/prisma/client.js'
import process from 'node:process'
import { Injectable } from '@nestjs/common'
import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '../generated/prisma/client.js'

const PG_POOL_ACQUISITION_TIMEOUT_MS = 2_000
const PG_STATEMENT_TIMEOUT_LEAD_MS = 50
const PG_LOCK_TIMEOUT_LEAD_MS = 25
const PRISMA_TRANSACTION_START_TIMEOUT_MS = 8_000
const DATABASE_COMMIT_OUTCOME_TIMEOUT_MS = 5_000

export interface DatabaseOperationDeadline {
  deadlineAt: number
  signal?: AbortSignal
  createTimeoutError: () => Error
}

export interface DeadlineTransaction {
  execute: <T>(operation: (prisma: Prisma.TransactionClient) => Promise<T>) => Promise<T>
}

export class DatabaseOperationDeadlineExceededError extends Error {
  constructor(message = '数据库操作超过可用 deadline budget') {
    super(message)
    this.name = 'DatabaseOperationDeadlineExceededError'
  }
}

export class DatabaseCommitOutcomeUnknownError extends Error {
  constructor(
    message = '数据库事务 COMMIT 在内部等待上界内未返回，结果未知',
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'DatabaseCommitOutcomeUnknownError'
  }
}

type PgAdapter = Awaited<ReturnType<PrismaPg['connect']>>
type PgTransaction = Awaited<ReturnType<PgAdapter['startTransaction']>>

export class RollbackSafePrismaPg extends PrismaPg {
  override async connect(): Promise<PgAdapter> {
    return withRollbackSafeTransactions(await super.connect())
  }

  override async connectToShadowDb(): Promise<PgAdapter> {
    return withRollbackSafeTransactions(await super.connectToShadowDb())
  }
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL?.trim()

    if (!connectionString) {
      throw new Error('请在项目根目录 .env 中设置 DATABASE_URL')
    }

    const adapter = new RollbackSafePrismaPg({
      connectionString,
      connectionTimeoutMillis: PG_POOL_ACQUISITION_TIMEOUT_MS,
    })

    super({ adapter })
  }

  async withDeadlineTransaction<T>(
    deadline: DatabaseOperationDeadline,
    callback: (transaction: DeadlineTransaction) => Promise<T>,
    onCommitOwned?: () => void,
    commitOutcomeTimeoutMs = DATABASE_COMMIT_OUTCOME_TIMEOUT_MS,
  ): Promise<T> {
    const transactionTimeoutMs = remainingTimeoutMs(deadline)
    const commitState: CommitState = { started: false }
    const transactionPromise = this.$transaction(async (prisma) => {
      assertDeadlineAvailable(deadline)

      const transaction: DeadlineTransaction = {
        execute: async <TResult>(
          operation: (prisma: Prisma.TransactionClient) => Promise<TResult>,
        ): Promise<TResult> => {
          const remainingBudgetMs = remainingTimeoutMs(deadline)
          const statementTimeoutMs = Math.max(
            1,
            remainingBudgetMs - PG_STATEMENT_TIMEOUT_LEAD_MS,
          )
          const statementTimeout = `${statementTimeoutMs}ms`
          const lockTimeout = `${Math.max(
            1,
            statementTimeoutMs - PG_LOCK_TIMEOUT_LEAD_MS,
          )}ms`

          // 这条 timeout setup 属于 transaction bootstrap/control-plane；不宣称
          // 它本身获得 dynamic cancellation。成功返回并复核 ownership 后，
          // 后续 business statement 才具有 dynamic remaining-budget 上界。
          await prisma.$queryRaw`
            SELECT
              set_config('statement_timeout', ${statementTimeout}, true),
              set_config('lock_timeout', ${lockTimeout}, true)
          `
          assertDeadlineAvailable(deadline)

          try {
            const result = await operation(prisma)
            assertDeadlineAvailable(deadline)
            return result
          }
          catch (error) {
            if (deadline.signal?.aborted)
              deadline.signal.throwIfAborted()
            if (isScopedPostgresTimeout(error))
              throw createTimeoutError(deadline, error)
            throw error
          }
        },
      }

      const result = await callback(transaction)
      assertDeadlineAvailable(deadline)
      onCommitOwned?.()
      // callback 已全部完成且 ownership 复核通过；completion transaction 从这一
      // 同步点起等待 COMMIT / ROLLBACK 真实结果，不能再用 Run deadline 伪装结果。
      commitState.started = true
      commitState.startedAt = Date.now()
      commitState.onStarted?.()
      return result
    }, {
      // pg acquisition 与 Prisma transaction start 都有固定等待上界；极端迟到
      // 仍由 RollbackSafePrismaPg 在 Prisma discard 路径真实发出 ROLLBACK。
      maxWait: PRISMA_TRANSACTION_START_TIMEOUT_MS,
      timeout: transactionTimeoutMs,
    })

    // 这里只限制调用方等待并隔离迟到结果，不代表底层 acquisition 已取消。
    // 背景 transaction 仍保留 rejection handler；迟到 callback 会在首行失去 ownership
    // 并抛错，由 Prisma 的正常路径 ROLLBACK / release。
    return await waitForDeadline(
      transactionPromise,
      deadline,
      commitState,
      onCommitOwned !== undefined,
      commitOutcomeTimeoutMs,
    )
  }

  async onModuleInit(): Promise<void> {
    await this.$connect()
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect()
  }
}

function withRollbackSafeTransactions(adapter: PgAdapter): PgAdapter {
  const startTransaction = adapter.startTransaction.bind(adapter)

  adapter.startTransaction = async (...args): Promise<PgTransaction> => (
    withRollbackSafeRelease(await startTransaction(...args))
  )

  return adapter
}

function withRollbackSafeRelease(transaction: PgTransaction): PgTransaction {
  const executeRaw = transaction.executeRaw.bind(transaction)
  const releaseAfterRollback = transaction.rollback.bind(transaction)
  let terminalStatementCompleted = false

  transaction.executeRaw = async (query) => {
    const result = await executeRaw(query)
    if (isTerminalTransactionSql(query.sql))
      terminalStatementCompleted = true
    return result
  }
  transaction.rollback = async () => {
    try {
      if (!terminalStatementCompleted) {
        await transaction.executeRaw({
          sql: 'ROLLBACK',
          args: [],
          argTypes: [],
        })
      }
    }
    finally {
      await releaseAfterRollback()
    }
  }

  return transaction
}

function isTerminalTransactionSql(sql: string): boolean {
  const normalized = sql.trim().replace(/;$/, '').toUpperCase()
  return normalized === 'COMMIT' || normalized === 'ROLLBACK'
}

function remainingTimeoutMs(deadline: DatabaseOperationDeadline): number {
  assertDeadlineAvailable(deadline)
  return Math.max(1, Math.floor(deadline.deadlineAt - Date.now()))
}

function assertDeadlineAvailable(deadline: DatabaseOperationDeadline): void {
  deadline.signal?.throwIfAborted()
  if (deadline.deadlineAt <= Date.now())
    throw createTimeoutError(deadline)
}

function createTimeoutError(
  deadline: DatabaseOperationDeadline,
  cause?: unknown,
): Error {
  const error = deadline.createTimeoutError()

  if (cause !== undefined && !('cause' in error)) {
    Object.defineProperty(error, 'cause', {
      value: cause,
      configurable: true,
    })
  }

  return error
}

function isScopedPostgresTimeout(error: unknown): boolean {
  const candidate = error as { message?: unknown, meta?: unknown }
  const detail = `${
    typeof candidate?.message === 'string' ? candidate.message : ''
  } ${safeJson(candidate?.meta)}`

  return (
    detail.includes('57014')
    && detail.includes('canceling statement due to statement timeout')
  ) || (
    detail.includes('55P03')
    && detail.includes('canceling statement due to lock timeout')
  )
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value)
  }
  catch {
    return ''
  }
}

function waitForDeadline<T>(
  operation: Promise<T>,
  deadline: DatabaseOperationDeadline,
  commitState: CommitState,
  commitResultOwnsCompletion: boolean,
  commitOutcomeTimeoutMs: number,
): Promise<T> {
  let callerTimeoutMs: number

  try {
    callerTimeoutMs = remainingTimeoutMs(deadline)
  }
  catch (error) {
    // transaction 已经创建；即使调用方此刻失去 ownership，也必须消费其迟到 rejection。
    void operation.catch(() => {})
    return Promise.reject(error)
  }

  return new Promise<T>((resolve, reject) => {
    let settled = false
    let timer: NodeJS.Timeout
    let commitOutcomeTimer: NodeJS.Timeout | undefined
    let handleAbort: () => void
    const signal = deadline.signal
    const finish = (callback: () => void): void => {
      if (settled)
        return
      settled = true
      clearTimeout(timer)
      clearTimeout(commitOutcomeTimer)
      delete commitState.onStarted
      signal?.removeEventListener('abort', handleAbort)
      callback()
    }
    const waitForCommitOutcome = (): void => {
      if (
        settled
        || !commitResultOwnsCompletion
        || commitOutcomeTimer !== undefined
      ) {
        return
      }

      const timeoutMs = Math.max(
        0,
        (commitState.startedAt ?? Date.now())
        + Math.max(1, Math.floor(commitOutcomeTimeoutMs))
        - Date.now(),
      )
      commitOutcomeTimer = setTimeout(
        () => finish(() => reject(new DatabaseCommitOutcomeUnknownError())),
        timeoutMs,
      )
      commitOutcomeTimer.unref?.()
    }
    handleAbort = (): void => {
      if (commitResultOwnsCompletion && commitState.started)
        return
      finish(() => {
        try {
          signal?.throwIfAborted()
        }
        catch (error) {
          reject(error)
        }
      })
    }
    timer = setTimeout(
      () => {
        if (commitResultOwnsCompletion && commitState.started)
          return
        finish(() => reject(createTimeoutError(deadline)))
      },
      callerTimeoutMs,
    )
    timer.unref?.()

    commitState.onStarted = waitForCommitOutcome
    if (commitState.started)
      waitForCommitOutcome()

    if (signal?.aborted)
      handleAbort()
    else
      signal?.addEventListener('abort', handleAbort, { once: true })
    operation.then(
      result => finish(() => {
        try {
          if (!commitResultOwnsCompletion)
            assertDeadlineAvailable(deadline)
          resolve(result)
        }
        catch (error) {
          reject(error)
        }
      }),
      error => finish(() => reject(
        commitResultOwnsCompletion
        && commitState.started
        && isCommitTransportFailure(error)
          ? new DatabaseCommitOutcomeUnknownError(
              '数据库事务 COMMIT 的连接响应不确定，结果未知',
              { cause: error },
            )
          : error,
      )),
    )
  })
}

function isCommitTransportFailure(error: unknown): boolean {
  return hasCommitTransportFailure(error, new Set())
}

function hasCommitTransportFailure(
  value: unknown,
  seen: Set<object>,
): boolean {
  if (typeof value !== 'object' || value === null || seen.has(value))
    return false

  seen.add(value)
  const candidate = value as {
    cause?: unknown
    code?: unknown
    kind?: unknown
    meta?: { driverAdapterError?: unknown }
    originalCode?: unknown
  }
  const transportCodes = new Set([
    'P1001',
    'P1002',
    'P1008',
    'P1017',
    'CONNECTIONCLOSED',
    'SOCKETTIMEOUT',
    'ECONNRESET',
    'ECONNABORTED',
    'ETIMEDOUT',
    'EPIPE',
    'ERR_STREAM_PREMATURE_CLOSE',
  ])
  const hasTransportCode = [candidate.code, candidate.originalCode].some(code => (
    typeof code === 'string'
    && (
      transportCodes.has(code.toUpperCase())
      || /^08[A-Z0-9]{3}$/i.test(code)
    )
  ))

  if (hasTransportCode)
    return true

  if (
    candidate.kind === 'ConnectionClosed'
    || candidate.kind === 'SocketTimeout'
    || candidate.kind === 'DatabaseNotReachable'
  ) {
    return true
  }

  return hasCommitTransportFailure(candidate.cause, seen)
    || hasCommitTransportFailure(candidate.meta?.driverAdapterError, seen)
}

interface CommitState {
  started: boolean
  startedAt?: number
  onStarted?: () => void
}
