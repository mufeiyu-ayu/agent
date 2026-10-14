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
import { GoogleDataClient } from '../google-data/google-data-client.js'
import { GoogleDataService } from '../google-data/google-data.service.js'
import { GoogleQueryService } from '../google-data/google-query.service.js'
import { GscInspectionService } from '../google-data/gsc-inspection.service.js'
import { LlmModelConfigService } from '../llm/llm-model-config.service.js'
import { LLMRuntimeConfigService } from '../llm/llm-runtime-config.service.js'
import { LLMService } from '../llm/llm.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { RuntimeConfigService } from '../runtime-config/runtime-config.service.js'
import { articlesQueryDefinition, ArticlesQueryTool } from '../tools/articles-query.tool.js'
import { ToolInvocationService } from '../tools/core/tool-invocation.service.js'

import { ToolRegistryService } from '../tools/core/tool-registry.service.js'
import { ga4MetadataDefinition, Ga4MetadataTool, ga4QueryDefinition, Ga4QueryTool, gscInspectDefinition, GscInspectTool, gscQueryDefinition, GscQueryTool } from '../tools/google/google-query-tools.js'
import { ArticleService } from './article.service.js'
// 显式验收只消耗一个URL检查；缓存和聊天轨迹写隔离测试schema，Google凭据沿用本地服务。
describe('文章分析真实服务验收', () => {
  it.skipIf(process.env.ARTICLE_ANALYSIS_LIVE_VALIDATION !== '1')('真实文章清单、搜索表现、收录与模型轨迹', { timeout: 180_000 }, async () => {
    const testUrl = process.env.TEST_DATABASE_URL
    const sourceUrl = process.env.DATABASE_URL
    assert.ok(testUrl && sourceUrl && testUrl !== sourceUrl)
    assert.ok(['localhost', '127.0.0.1'].includes(new URL(sourceUrl).hostname))
    const source = new PrismaService(sourceUrl)
    const { Pool } = createRequire(import.meta.url)('pg') as { Pool: new (options: { connectionString: string, max: number }) => { query: (sql: string) => Promise<unknown>, end: () => Promise<void> } }
    const pool = new Pool({ connectionString: testUrl, max: 1 })
    const schema = `article_analysis_live_${randomUUID().replaceAll('-', '')}`
    let prisma: PrismaService | undefined
    const records: Record<string, unknown> = { checkedAt: new Date().toISOString(), status: 'running' }
    const outputPath = '/tmp/issue263-article-analysis-live.json'
    try {
      const owners = await source.googleDataConnection.findMany({ where: { credentials: { not: null }, needsAuth: false, ...(process.env.GOOGLE_QUERY_LIVE_USER_ID ? { userId: process.env.GOOGLE_QUERY_LIVE_USER_ID } : {}) }, take: 2, select: { userId: true } })
      assert.equal(owners.length, 1, '需要唯一获准的本地连接；多连接时显式设置 GOOGLE_QUERY_LIVE_USER_ID')
      const userId = owners[0]!.userId
      const google = new GoogleDataService(source, new GoogleDataClient())
      const queries = new GoogleQueryService(google)
      const articles = new ArticleService()
      const signal = AbortSignal.timeout(150_000)
      const filter = { publishedFrom: '2026-10-01', publishedTo: '2026-10-07', locale: 'en', limit: 1 }
      const catalog = await articles.query(filter, signal)
      assert.ok(catalog.articles.length > 0)
      const articleUrl = catalog.articles[0]!.urls[0]!.url
      records.catalog = catalog
      await pool.query(`CREATE SCHEMA "${schema}"`)
      await pool.query(`SET search_path TO "${schema}", public`)
      const directory = new URL('../../../../prisma/migrations/', import.meta.url)
      for (const entry of (await readdir(directory)).filter(name => name !== 'migration_lock.toml').sort()) await pool.query(await readFile(new URL(`${entry}/migration.sql`, directory), 'utf8'))
      const connection = new URL(testUrl)
      connection.searchParams.set('schema', schema)
      connection.searchParams.set('options', `-c search_path=${schema},public`)
      prisma = new PrismaService(connection.toString())
      await prisma.user.create({ data: { id: userId, email: `${schema}@example.test`, mustChangePassword: false } })
      const conversation = await prisma.conversation.create({ data: { userId, title: 'Article analysis live validation' } })
      const row = await source.llmModel.findFirstOrThrow({ where: { visible: true, provider: { enabled: true } }, orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }] })
      const env = new LLMRuntimeConfigService()
      const config = new LlmModelConfigService(source, env)
      const resolved = await config.resolveModel(row.id)
      const llm = new LLMService(env)
      const registry = new ToolRegistryService()
      registry.register({ definition: gscQueryDefinition, executor: new GscQueryTool(queries) })
      registry.register({ definition: ga4MetadataDefinition, executor: new Ga4MetadataTool(queries) })
      registry.register({ definition: ga4QueryDefinition, executor: new Ga4QueryTool(queries) })
      const inspections = new GscInspectionService(google, prisma)
      registry.register({ definition: articlesQueryDefinition, executor: new ArticlesQueryTool(articles) })
      registry.register({ definition: gscInspectDefinition, executor: new GscInspectTool(inspections) })
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
        const prompt = '请完成一次真实文章分析：先且只调用一次articles_query，publishedFrom=2026-10-01、publishedTo=2026-10-07、locale=en、limit=1；报告summary的文章总篇数，并选择返回第一篇的英文URL。然后只调用一次gsc_query，startDate=2026-10-01、endDate=2026-10-13、dimensions=[]，以page equals精确筛选该URL。最后只调用一次gsc_inspect检查该URL，refresh=false。只使用这三个工具，各一次，不分页、不抓网页、不用沙箱。回答文章总篇数、所选URL、点击与曝光、收录状态和检查时间，缺数据或失败如实说明，未检查的其他文章不推断。'
        for await (const event of await chat.chatStream(userId, { conversationId: conversation.id, message: prompt }, { signal })) events.push(event)
        assert.ok(events.some(event => event.type === 'done'), JSON.stringify(events.filter(event => event.type === 'error')))
        const run = await prisma.agentRun.findFirstOrThrow({ where: { conversationId: conversation.id } })
        const steps = await prisma.agentStep.findMany({ where: { runId: run.id, type: 'tool_execution' } })
        for (const name of ['articles_query', 'gsc_query', 'gsc_inspect']) {
          const matching = steps.filter(step => (step.input as { toolName?: string }).toolName === name)
          assert.equal(matching.length, 1, `真实模型必须且只调用一次${name}`)
          const output = matching[0]!.output as { ok: boolean, observation: string }
          assert.equal(output.ok, true, output.observation)
          assert.ok(wire.some(items => items.some(item => item.type === 'tool_result' && item.content === output.observation)))
          const data = JSON.parse(output.observation)
          records[name] = data
          if (name === 'articles_query')
            assert.deepEqual(data.summary, catalog.summary)
          if (name === 'gsc_query')
            assert.ok(data.query.dimensionFilterGroups.some((group: { filters: Array<{ dimension: string, expression: string }> }) => group.filters.some(filter => filter.dimension === 'page' && filter.expression === articleUrl)))
          if (name === 'gsc_inspect') {
            assert.equal(data.rows[0].url, articleUrl)
            assert.equal(data.summary.failedCount, 0, output.observation)
            assert.equal(data.summary.checkedCount, 1, output.observation)
          }
        }
        const cached = await inspections.inspect({ urls: [articleUrl] }, { userId }, signal)
        assert.equal(cached.rows[0]!.cached, true)
        const checked = records.gsc_inspect as { rows: Array<{ checkedAt: string }> }
        assert.equal(cached.rows[0]!.checkedAt, checked.rows[0]!.checkedAt)
        const budget = await prisma.googleInspectionBudget.findMany()
        assert.equal(budget.reduce((sum, item) => sum + item.used, 0), 1)
        records.cachedCheck = cached
        records.model = row.wireName
        records.answer = (await prisma.message.findUniqueOrThrow({ where: { id: run.assistantMessageId! } })).content
        records.status = 'passed'
        console.log(JSON.stringify({ articleAnalysisLive: 'passed', model: row.wireName, count: catalog.summary.articleCount, inspections: 1, outputPath }))
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
