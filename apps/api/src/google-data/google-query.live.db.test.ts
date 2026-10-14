import type { ModelInputItem } from '@agent/ai'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import process from 'node:process'
import { describe, it, vi } from 'vitest'
import { AgentRuntimeService } from '../agent-runtime/agent-runtime.service.js'
import { ContextCompactionService } from '../agent-runtime/context/context-compaction.service.js'
import { AgentRunRecorderService } from '../agent-runtime/lifecycle/agent-run-recorder.service.js'
import { ChatService } from '../chat/chat.service.js'
import { ConversationsService } from '../conversations/conversations.service.js'
import { LlmModelConfigService } from '../llm/llm-model-config.service.js'
import { LLMRuntimeConfigService } from '../llm/llm-runtime-config.service.js'
import { LLMService } from '../llm/llm.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { RuntimeConfigService } from '../runtime-config/runtime-config.service.js'
import { ToolInvocationService } from '../tools/core/tool-invocation.service.js'
import { ToolRegistryService } from '../tools/core/tool-registry.service.js'
import { ga4MetadataDefinition, Ga4MetadataTool, ga4QueryDefinition, Ga4QueryTool, gscQueryDefinition, GscQueryTool } from '../tools/google/google-query-tools.js'
import { GoogleDataClient } from './google-data-client.js'
import { GoogleDataService } from './google-data.service.js'
import { GoogleQueryService, queryObservation } from './google-query.service.js'

// 显式运行才使用本地已授权连接和模型；聊天轨迹仅写隔离测试 schema，不复制个人令牌。
describe('Google查询真实服务验收', () => {
  it.skipIf(process.env.GOOGLE_QUERY_LIVE_VALIDATION !== '1')('真实GSC/GA4与真实模型工具轨迹', { timeout: 180_000 }, async () => {
    const testUrl = process.env.TEST_DATABASE_URL
    const sourceUrl = process.env.DATABASE_URL
    assert.ok(testUrl && sourceUrl && testUrl !== sourceUrl)
    assert.ok(['localhost', '127.0.0.1'].includes(new URL(sourceUrl).hostname))
    const source = new PrismaService(sourceUrl)
    const { Pool } = createRequire(import.meta.url)('pg') as { Pool: new (options: { connectionString: string, max: number }) => { query: (sql: string) => Promise<unknown>, end: () => Promise<void> } }
    const pool = new Pool({ connectionString: testUrl, max: 1 })
    const schema = `google_query_live_${randomUUID().replaceAll('-', '')}`
    let prisma: PrismaService | undefined
    const records: Record<string, unknown> = { checkedAt: new Date().toISOString(), status: 'running' }
    const outputPath = '/tmp/issue259-google-query-live.json'
    try {
      const owners = await source.googleDataConnection.findMany({ where: { credentials: { not: null }, needsAuth: false, ...(process.env.GOOGLE_QUERY_LIVE_USER_ID ? { userId: process.env.GOOGLE_QUERY_LIVE_USER_ID } : {}) }, take: 2, select: { userId: true } })
      assert.equal(owners.length, 1, '需要唯一获准的本地连接；多连接时显式设置 GOOGLE_QUERY_LIVE_USER_ID')
      const userId = owners[0]!.userId
      const queries = new GoogleQueryService(new GoogleDataService(source, new GoogleDataClient()))
      const signal = AbortSignal.timeout(120_000)
      const range = { startDate: '2026-10-01', endDate: '2026-10-07' }
      const binding = { userId }
      const gsc = await queries.gsc(range, binding, signal)
      const ga4 = await queries.ga4({ dateRanges: [range], metrics: ['sessions'] }, binding, signal)
      records.gsc = JSON.parse(queryObservation(gsc))
      records.ga4 = JSON.parse(queryObservation(ga4))
      const fields = await queries.fields({ customOnly: false, search: 'sessions' }, binding, signal)
      assert.ok(fields.fields.some(field => field.apiName === 'sessions'))
      records.metadata = { matchedCount: fields.matchedCount, sessionsFound: true }
      await pool.query(`CREATE SCHEMA "${schema}"`)
      await pool.query(`SET search_path TO "${schema}", public`)
      const directory = new URL('../../../../prisma/migrations/', import.meta.url)
      for (const entry of (await readdir(directory)).filter(name => name !== 'migration_lock.toml').sort()) await pool.query(await readFile(new URL(`${entry}/migration.sql`, directory), 'utf8'))
      const connection = new URL(testUrl)
      connection.searchParams.set('schema', schema)
      connection.searchParams.set('options', `-c search_path=${schema},public`)
      prisma = new PrismaService(connection.toString())
      await prisma.user.create({ data: { id: userId, email: `${schema}@example.test`, mustChangePassword: false } })
      const conversation = await prisma.conversation.create({ data: { userId, title: 'Google query live validation' } })
      const row = await source.llmModel.findFirstOrThrow({ where: { visible: true, provider: { enabled: true } }, orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }] })
      const env = new LLMRuntimeConfigService()
      const config = new LlmModelConfigService(source, env)
      const resolved = await config.resolveModel(row.id)
      const llm = new LLMService(env)
      const registry = new ToolRegistryService()
      registry.register({ definition: gscQueryDefinition, executor: new GscQueryTool(queries) })
      registry.register({ definition: ga4MetadataDefinition, executor: new Ga4MetadataTool(queries) })
      registry.register({ definition: ga4QueryDefinition, executor: new Ga4QueryTool(queries) })
      const recorder = new AgentRunRecorderService(prisma)
      const runtime = new AgentRuntimeService(llm, prisma, recorder, new ToolInvocationService(registry), new ContextCompactionService(llm, prisma, recorder))
      const chat = new ChatService(runtime, { resolveModel: async () => resolved } as unknown as LlmModelConfigService, new ConversationsService(prisma), new RuntimeConfigService(prisma, config))
      const wire: ModelInputItem[][] = []
      const original = llm.chatStream.bind(llm)
      const spy = vi.spyOn(llm, 'chatStream').mockImplementation(async function* (provider, items, options) {
        wire.push(structuredClone(items))
        yield* original(provider, items, options)
      })
      try {
        const events = []
        for await (const event of await chat.chatStream(userId, { conversationId: conversation.id, message: '请只用 ga4_query 查询我已连接资源在 2026-10-01 至 2026-10-07 的 sessions 总计，dimensions=[]，metrics=["sessions"]，只查一次，不用其他工具。最后用一句话报告实际会话数、日期范围及GA4资源。没有返回行就明确说明没有数据。' }, { signal })) events.push(event)
        assert.ok(events.some(event => event.type === 'done'), JSON.stringify(events.filter(event => event.type === 'error')))
        const run = await prisma.agentRun.findFirstOrThrow({ where: { conversationId: conversation.id } })
        const steps = await prisma.agentStep.findMany({ where: { runId: run.id, type: 'tool_execution' } })
        const tool = steps.find(step => (step.input as { toolName?: string }).toolName === 'ga4_query' && (step.output as { ok?: boolean }).ok)
        assert.ok(tool, '必须存在真实成功的 ga4_query Step')
        const observation = (tool.output as { observation: string }).observation
        const response = JSON.parse(observation)
        assert.deepEqual(response.source, ga4.source)
        assert.deepEqual(response.query.dateRanges, [range])
        assert.deepEqual(response.rows, ga4.rows)
        assert.ok(wire.some(items => items.some(item => item.type === 'tool_result' && item.content === observation)))
        const answer = await prisma.message.findUniqueOrThrow({ where: { id: run.assistantMessageId! } })
        records.model = row.wireName
        records.answer = answer.content
        records.runId = run.id
        records.toolStepId = tool.id
        records.status = 'passed'
        console.log(JSON.stringify({ googleQueryLive: 'passed', model: row.wireName, gscRows: gsc.rows.length, ga4Rows: ga4.rows.length, outputPath }))
      }
      finally { spy.mockRestore() }
    }
    catch (error) {
      records.status = 'failed'
      throw error
    }
    finally {
      await writeFile(outputPath, JSON.stringify(records, null, 2), { mode: 0o600 })
      await prisma?.$disconnect()
      await source.$disconnect()
      await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await pool.end()
    }
  })
})

it.skipIf(process.env.GOOGLE_QUERY_LIVE_VALIDATION !== '1')('真实 GA4 两段日期列与 GSC 小时协议', { timeout: 60_000 }, async () => {
  assert.ok(process.env.DATABASE_URL && ['localhost', '127.0.0.1'].includes(new URL(process.env.DATABASE_URL).hostname))
  const source = new PrismaService(process.env.DATABASE_URL)
  try {
    const owners = await source.googleDataConnection.findMany({ where: { credentials: { not: null }, needsAuth: false, ...(process.env.GOOGLE_QUERY_LIVE_USER_ID ? { userId: process.env.GOOGLE_QUERY_LIVE_USER_ID } : {}) }, take: 2, select: { userId: true } })
    assert.equal(owners.length, 1)
    const queries = new GoogleQueryService(new GoogleDataService(source, new GoogleDataClient()))
    const run = { userId: owners[0]!.userId }
    const signal = AbortSignal.timeout(45_000)
    const report = await queries.ga4({ dateRanges: [{ startDate: '2026-10-01', endDate: '2026-10-07', name: 'current' }, { startDate: '2026-09-24', endDate: '2026-09-30', name: 'previous' }], dimensions: ['date'], metrics: ['sessions'], limit: 1 }, run, signal)
    const page = JSON.parse(queryObservation(report))
    assert.equal(page.returnedGroups, 1)
    assert.equal(page.nextOffset, 1)
    const second = await queries.ga4({ ...report.query, offset: page.nextOffset }, run, signal)
    assert.notDeepEqual(second.rows, report.rows)
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(part => [part.type, part.value]))
    const day = `${parts.year}-${parts.month}-${parts.day}`
    const hourly = await queries.gsc({ startDate: day, endDate: day, dimensions: ['hour'], dataState: 'hourly_all' }, run, signal)
    await writeFile('/tmp/issue259-google-query-protocol-live.json', JSON.stringify({ checkedAt: new Date().toISOString(), ga4: JSON.parse(queryObservation(report)), gsc: JSON.parse(queryObservation(hourly)) }, null, 2), { mode: 0o600 })
  }
  finally { await source.$disconnect() }
})
