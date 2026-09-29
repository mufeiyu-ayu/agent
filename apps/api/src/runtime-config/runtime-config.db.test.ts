import type { ModelStreamEvent } from '@agent/ai'
import type { ConversationsService } from '../conversations/conversations.service.js'
import type { LLMRuntimeConfigService } from '../llm/llm-runtime-config.service.js'
import type { LLMService } from '../llm/llm.service.js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import process from 'node:process'
import { Logger, ServiceUnavailableException } from '@nestjs/common'
import { afterAll, beforeAll, describe, it, onTestFinished, vi } from 'vitest'

import { AgentRuntimeService } from '../agent-runtime/agent-runtime.service.js'
import { DeepSeekV4TokenEstimator } from '../agent-runtime/context/deepseek-v4-token-estimator.js'
import { SamplingContextPlanner } from '../agent-runtime/context/sampling-context-planner.js'
import { AgentRunRecorderService } from '../agent-runtime/lifecycle/agent-run-recorder.service.js'
import { ChatService } from '../chat/chat.service.js'
import { createResolvedLlmModel } from '../llm/__fixtures__.js'
import { LlmModelConfigService } from '../llm/llm-model-config.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { ToolInvocationService } from '../tools/core/tool-invocation.service.js'
import { ToolRegistryService } from '../tools/core/tool-registry.service.js'
import { RuntimeConfigService } from './runtime-config.service.js'

// 本入口不允许 skip：缺少隔离数据库时必须显式失败，而不是假装通过。
const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim()

if (!testDatabaseUrl)
  throw new Error('缺少 TEST_DATABASE_URL：先 docker compose --profile integration up -d postgres-test，再按 .env.example 在根目录 .env 配置')
if (testDatabaseUrl === process.env.DATABASE_URL?.trim())
  throw new Error('TEST_DATABASE_URL 不得与 DATABASE_URL 相同，禁止在开发库上运行真实库测试')

const MIGRATIONS_DIR = new URL('../../../../prisma/migrations/', import.meta.url)
const THIS_MIGRATION = '20260929120000_runtime_config'
const SECRET_KEY = 'a'.repeat(64)
const { Pool: PgPool } = createRequire(import.meta.url)('pg') as {
  Pool: new (options: { connectionString: string, max: number }) => {
    query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>
    end: () => Promise<void>
  }
}

describe('运行配置（真实库）', { timeout: 60_000 }, () => {
  const schema = `runtime_config_test_${randomUUID().replaceAll('-', '')}`
  const adminPool = new PgPool({ connectionString: testDatabaseUrl, max: 1 })
  let prisma: PrismaService
  let service: RuntimeConfigService

  beforeAll(async () => {
    await applyMigrations(schema, () => true)
    prisma = new PrismaService(withSearchPath(testDatabaseUrl, schema))
    await prisma.$connect()
    service = new RuntimeConfigService(prisma, createModelConfigService(prisma, SECRET_KEY))
  })

  afterAll(async () => {
    await prisma?.$disconnect()
    await dropSchema(schema)
    await adminPool.end()
  })

  it('AC-05 migration 插入唯一一行，取值等于原环境变量默认值；CHECK 约束拒绝第二行', async () => {
    assert.deepEqual(await service.getForAdmin().then(({ updatedAt: _, ...rest }) => rest), {
      maxSamplingRounds: 10,
      maxToolCalls: 8,
      runDeadlineMs: 600_000,
      historyCandidateHardLimit: 1_000,
      debugCaptureModelIo: false,
      serperApiKeyLast4: null,
    })
    await assert.rejects(
      adminPool.query(`INSERT INTO "${schema}"."RuntimeConfig" ("id", "maxSamplingRounds", "maxToolCalls", "runDeadlineMs", "historyCandidateHardLimit", "debugCaptureModelIo", "updatedAt") VALUES (2, 1, 1, 1, 50, false, now())`),
      /RuntimeConfig_single_row/,
    )
    // 绕过管理台直接写库也写不进范围外的值。
    for (const assignment of ['"runDeadlineMs" = 0', '"maxSamplingRounds" = 0', '"maxToolCalls" = -1', '"historyCandidateHardLimit" = 49'])
      await assert.rejects(adminPool.query(`UPDATE "${schema}"."RuntimeConfig" SET ${assignment}`), /RuntimeConfig_limits/, assignment)
    assert.equal(await prisma.runtimeConfig.count(), 1)
  })

  it('AC-05 已有模型行的单次输入上限等于迁移前运行时算出的输入预算', async () => {
    const legacySchema = `runtime_config_legacy_${randomUUID().replaceAll('-', '')}`

    onTestFinished(() => dropSchema(legacySchema))
    await applyMigrations(legacySchema, name => name < THIS_MIGRATION)
    await adminPool.query(`INSERT INTO "${legacySchema}"."LlmProvider" ("id", "family", "note", "baseUrl", "apiKeyEncrypted", "apiKeyLast4", "updatedAt") VALUES ('p', 'other', '', 'https://relay.example/v1', 'x', 'x', now())`)

    // [窗口, 输出上限]：大窗口、窗口容量小于 262,144、窗口放不下（运行时本来就会失败）。
    const rows = [[1_000_000, 384_000], [200_000, 64_000], [32_768, 16_384]] as const

    for (const [index, [window, output]] of rows.entries())
      await adminPool.query(`INSERT INTO "${legacySchema}"."LlmModel" ("id", "providerId", "wireName", "displayName", "contextWindowTokens", "maxOutputTokens", "updatedAt") VALUES ($1, 'p', $1, $1, $2, $3, now())`, [`m${index}`, window, output])
    await applyMigrations(legacySchema, name => name === THIS_MIGRATION, false)

    const { rows: migrated } = await adminPool.query(`SELECT "id", "maxInputTokens" FROM "${legacySchema}"."LlmModel" ORDER BY "id"`)
    // 迁移前的公式：min(262,144, 窗口 − 输出上限 − 16,384)。
    const legacyBudget = (window: number, output: number) => Math.min(262_144, window - output - 16_384)

    assert.deepEqual(migrated.map(row => row.maxInputTokens), [262_144, 119_616, 1])
    assert.equal(migrated[0]?.maxInputTokens, legacyBudget(...rows[0]))
    assert.equal(migrated[1]?.maxInputTokens, legacyBudget(...rows[1]))
    const { rows: [column] } = await adminPool.query(`SELECT "column_default" FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'LlmModel' AND column_name = 'maxInputTokens'`, [legacySchema])
    assert.equal(column?.column_default, null, '新行必须显式写入，不留默认值')
  })

  it('AC-01 Key 加密保存、只回显尾四位；留空不改；快照里是解密后的明文', async () => {
    const plain = 'serper-secret-key-9f3a'
    const saved = await service.update({ serperApiKey: plain, maxToolCalls: 5 })

    assert.equal(saved.serperApiKeyLast4, '9f3a')
    assert.equal(saved.maxToolCalls, 5)
    assert.doesNotMatch(JSON.stringify(saved), new RegExp(plain))

    const row = await prisma.runtimeConfig.findUniqueOrThrow({ where: { id: 1 } })

    assert.ok(row.serperApiKeyEncrypted?.startsWith('v1:'), 'serperApiKeyEncrypted')
    assert.doesNotMatch(row.serperApiKeyEncrypted ?? '', new RegExp(plain))
    assert.doesNotMatch(JSON.stringify(await service.getForAdmin()), new RegExp(plain))

    await service.update({ serperApiKey: '', maxToolCalls: 6 })
    assert.equal((await prisma.runtimeConfig.findUniqueOrThrow({ where: { id: 1 } })).serperApiKeyEncrypted, row.serperApiKeyEncrypted)
    assert.deepEqual((await service.loadSnapshot()).serperApiKey, { status: 'set', value: plain })
    assert.equal((await service.loadSnapshot()).limits.maxToolCalls, 6)
  })

  it('AC-08(c) 更换主密钥后 Key 解不开：快照标记为 undecryptable，不抛错', async () => {
    await service.update({ serperApiKey: 'serper-secret-key-9f3a' })

    const rotated = new RuntimeConfigService(prisma, createModelConfigService(prisma, 'b'.repeat(64)))

    assert.deepEqual((await rotated.loadSnapshot()).serperApiKey, { status: 'undecryptable' })
  })

  it('AC-08(d) 并发保存两次：只 UPDATE 同一行，结果整行等于其中一次，不产生多行', async () => {
    const first = { maxSamplingRounds: 4, maxToolCalls: 1, runDeadlineMs: 30_000, historyCandidateHardLimit: 100, debugCaptureModelIo: true }
    const second = { maxSamplingRounds: 7, maxToolCalls: 3, runDeadlineMs: 90_000, historyCandidateHardLimit: 200, debugCaptureModelIo: false }

    for (let round = 0; round < 5; round++) {
      await Promise.all([service.update(first), service.update(second)])

      const { updatedAt: _, serperApiKeyLast4: __, ...current } = await service.getForAdmin()

      assert.ok(
        [JSON.stringify(first), JSON.stringify(second)].includes(JSON.stringify(current)),
        JSON.stringify(current),
      )
      assert.equal(await prisma.runtimeConfig.count(), 1)
    }

    // 串行时后一次为准。
    await service.update(first)
    await service.update(second)
    assert.equal((await service.getForAdmin()).maxSamplingRounds, 7)
  })

  it('AC-08(a)(b) 读库失败或配置行缺失：问答在写入任何消息前返回 503，不留下 Run，不回退默认值', async () => {
    const logs: string[] = []

    vi.spyOn(Logger.prototype, 'error').mockImplementation((...args: unknown[]) => void logs.push(args.join(' ')))
    onTestFinished(() => void vi.restoreAllMocks())

    const conversation = await prisma.conversation.create({ data: { title: 'runtime config failure' } })
    const chat = createChatService(prisma, service)
    const ask = () => chat.chatStream('unused', { conversationId: conversation.id, message: '你好' })
    const assertNothingWritten = async () => {
      assert.equal(await prisma.message.count({ where: { conversationId: conversation.id } }), 0)
      assert.equal(await prisma.agentRun.count({ where: { conversationId: conversation.id } }), 0)
    }

    // (a) 读库失败：把表临时改名，查询报错。
    await adminPool.query(`ALTER TABLE "${schema}"."RuntimeConfig" RENAME TO "RuntimeConfig_off"`)
    try {
      await assert.rejects(ask(), (error: unknown) => error instanceof ServiceUnavailableException && error.message === '读取运行配置失败，请稍后重试')
    }
    finally {
      await adminPool.query(`ALTER TABLE "${schema}"."RuntimeConfig_off" RENAME TO "RuntimeConfig"`)
    }
    assert.ok(logs.some(log => log.includes('读取运行配置失败')), '日志写明原因')
    await assertNothingWritten()

    // (b) 行缺失：明确报错，不静默回退到默认值。
    const { rows: [saved] } = await adminPool.query(`DELETE FROM "${schema}"."RuntimeConfig" RETURNING *`)
    try {
      await assert.rejects(ask(), (error: unknown) => error instanceof ServiceUnavailableException && /运行配置缺失/.test(error.message))
      await assert.rejects(service.update({ maxToolCalls: 1 }), /运行配置缺失/)
      assert.ok(logs.some(log => log.includes('没有 RuntimeConfig 行')), '运维细节只进日志')
      assert.equal(await prisma.runtimeConfig.count(), 0, 'PATCH 不补建行')
    }
    finally {
      await adminPool.query(`INSERT INTO "${schema}"."RuntimeConfig" SELECT * FROM json_populate_record(NULL::"${schema}"."RuntimeConfig", $1)`, [JSON.stringify(saved)])
    }
    await assertNothingWritten()

    // 恢复后同一会话能正常开始问答（Run 由真实 runtime 创建）。
    const events = []

    for await (const event of await ask())
      events.push(event)
    assert.equal(events.at(-1)?.type, 'done')
    assert.equal(await prisma.agentRun.count({ where: { conversationId: conversation.id, status: 'COMPLETED' } }), 1)
  })

  async function applyMigrations(target: string, include: (name: string) => boolean, createSchema = true) {
    assert.match(target, /^runtime_config_(?:test|legacy)_[a-f\d]+$/)
    if (createSchema)
      await adminPool.query(`CREATE SCHEMA "${target}"`)
    // 早期迁移建的 pgvector 扩展装在先建的主 schema 里（同库只能装一份），后建的 schema 要能看见它的类型。
    await adminPool.query(`SET search_path TO "${target}", "${schema}", public`)

    const migrations = (await readdir(MIGRATIONS_DIR, { withFileTypes: true }))
      .filter(entry => entry.isDirectory() && include(entry.name))
      .map(entry => entry.name)
      .sort()

    for (const migration of migrations)
      await adminPool.query(await readFile(new URL(`${migration}/migration.sql`, MIGRATIONS_DIR), 'utf8'))
  }

  async function dropSchema(target: string) {
    assert.match(target, /^runtime_config_(?:test|legacy)_[a-f\d]+$/)
    await adminPool.query(`DROP SCHEMA IF EXISTS "${target}" CASCADE`)
  }
})

function createModelConfigService(prisma: PrismaService, secretKey: string): LlmModelConfigService {
  return new LlmModelConfigService(prisma, { value: { secretKey, outboundProxy: null } } as LLMRuntimeConfigService)
}

/** 真实 ChatService + 真实 runtime 与会话服务；模型解析与模型流是假的，一问一答直接完成。 */
function createChatService(prisma: PrismaService, runtimeConfigService: RuntimeConfigService): ChatService {
  const llmService = {
    async* chatStream(): AsyncGenerator<ModelStreamEvent> {
      yield { type: 'text_delta', delta: '你好' }
      yield { type: 'response_completed', finishReason: 'stop' }
    },
  } as unknown as LLMService
  const estimator = new DeepSeekV4TokenEstimator()
  const runtime = new AgentRuntimeService(
    llmService,
    prisma,
    new AgentRunRecorderService(prisma),
    new ToolInvocationService(new ToolRegistryService()),
    estimator,
    new SamplingContextPlanner(estimator),
  )
  const modelConfig = { resolveModel: async () => createResolvedLlmModel() } as unknown as LlmModelConfigService
  const conversations = { assertOwnConversation: async () => {} } as unknown as ConversationsService

  return new ChatService(runtime, modelConfig, conversations, runtimeConfigService)
}

function withSearchPath(connectionString: string, schema: string): string {
  const url = new URL(connectionString)

  url.searchParams.set('schema', schema)
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return url.toString()
}
