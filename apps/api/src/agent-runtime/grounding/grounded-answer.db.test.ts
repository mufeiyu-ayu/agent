import type { MessageGroundingV1 } from '@agent/contracts'
import type {
  EmbeddingProvider,
  EmbeddingResult,
} from '../../embeddings/embedding-provider.js'
import type { LLMService } from '../../llm/llm.service.js'
import type { ChatStreamOptions } from '../../llm/llm.types.js'
import type { ModelInputItem } from '../../llm/model-input.types.js'
import type { ModelStreamEvent } from '../../llm/model-stream.types.js'
import type { ArticleRetrievalPool } from '../../retrieval/postgres-article-retrieval.repository.js'
import type { AgentRuntimeEvent } from '../agent-runtime.types.js'
import type { TokenEstimatorInput } from '../deepseek-v4-token-estimator.js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import process from 'node:process'
// 项目使用 Node 原生测试运行器，不为 DB integration 引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { after, before, describe, it } from 'node:test'

import { AdminRunsService } from '../../admin-runs/admin-runs.service.js'
import { ARTICLE_CHUNKER_PROFILE } from '../../article-indexing/article-chunking.js'
import { ACTIVE_EMBEDDING_PROFILE } from '../../embeddings/embedding-provider.js'
import {
  AgentRunStatus,
  AgentStepStatus,
  MessageRole,
  MessageStatus,
} from '../../generated/prisma/client.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { HybridArticleRetriever } from '../../retrieval/hybrid-article-retriever.js'
import { LexicalArticleRetriever } from '../../retrieval/lexical-article-retriever.js'
import {
  createArticleRetrievalPool,
  PostgresArticleRetrievalRepository,
} from '../../retrieval/postgres-article-retrieval.repository.js'
import { VectorArticleRetriever } from '../../retrieval/vector-article-retriever.js'
import {
  getArticleDetailDefinition,
  GetArticleDetailTool,
} from '../../tools/articles/get-article-detail.tool.js'
import { ToolInvocationService } from '../../tools/core/tool-invocation.service.js'
import { ToolRegistryService } from '../../tools/core/tool-registry.service.js'
import {
  retrieveArticleContextDefinition,
  RetrieveArticleContextTool,
} from '../../tools/retrieval/retrieve-article-context.tool.js'
import { AgentRunRecorderService } from '../agent-run-recorder.service.js'
import { AgentRuntimeService } from '../agent-runtime.service.js'
import { TokenEstimator } from '../deepseek-v4-token-estimator.js'
import { InitialContextSelectionService } from '../initial-context-selection.js'
import { SamplingContextPlanner } from '../sampling-context-planner.js'
import { toMessageGroundingV1 } from './message-grounding.projector.js'

// 本入口不允许 skip：缺少隔离数据库时必须显式失败，而不是假装通过。
const testDatabaseUrl = process.env.ARTICLE_INDEX_TEST_DATABASE_URL?.trim()

if (!testDatabaseUrl) {
  throw new Error(
    'grounded answer DB integration 需要 ARTICLE_INDEX_TEST_DATABASE_URL 指向隔离数据库',
  )
}

if (testDatabaseUrl === process.env.DATABASE_URL?.trim()) {
  throw new Error(
    'ARTICLE_INDEX_TEST_DATABASE_URL 不得与 DATABASE_URL 相同，禁止在开发库上运行 DB integration',
  )
}

const MIGRATIONS = [
  '20260622145235_init_conversation_message',
  '20260627000000_add_aborted_message_status',
  '20260704082435_add_agent_run_step',
  '20260711115000_add_article_demo_data',
  '20260711122500_add_article_language_code',
  '20260717160000_add_agent_step_sequence',
  '20260814090000_add_article_embedding_index',
  '20260815160000_add_message_grounding',
]

const require = createRequire(import.meta.url)
const { Pool: PgPool } = require('pg') as {
  Pool: new (options: {
    connectionString: string
    max: number
    connectionTimeoutMillis: number
  }) => AdminPool
}

interface AdminPool {
  connect: () => Promise<AdminClient>
  query: <Row = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: Row[] }>
  end: () => Promise<void>
}

interface AdminClient {
  query: <Row = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: Row[] }>
  release: (error?: Error) => void
}

describe('Grounded Answer PostgreSQL integration', { concurrency: 1 }, () => {
  const schema = `grounding_test_${randomUUID().replaceAll('-', '')}`
  let adminPool: AdminPool
  let retrievalPool: ArticleRetrievalPool
  let prisma: PrismaService

  before(async () => {
    assert.ok(testDatabaseUrl)
    assert.match(schema, /^grounding_test_[a-f\d]+$/)
    adminPool = new PgPool({
      connectionString: testDatabaseUrl,
      max: 2,
      connectionTimeoutMillis: 2_000,
    })

    const migrationClient = await adminPool.connect()

    try {
      // identifier 来自上面的 UUID 且经过 regex 复核；PostgreSQL 不支持参数化 identifier。
      await migrationClient.query(`CREATE SCHEMA "${schema}"`)
      await migrationClient.query(
        'SELECT set_config(\'search_path\', $1, false)',
        [`${schema},public`],
      )
      for (const migration of MIGRATIONS) {
        await migrationClient.query(await readFile(
          new URL(
            `../../../../../prisma/migrations/${migration}/migration.sql`,
            import.meta.url,
          ),
          'utf8',
        ))
      }
    }
    finally {
      migrationClient.release()
    }

    retrievalPool = createArticleRetrievalPool(
      withSearchPath(testDatabaseUrl, schema),
    )
    prisma = new PrismaService(withSearchPath(testDatabaseUrl, schema))
    await prisma.$connect()
    await seedArticle({
      sourceId: 301,
      slug: 'seo-basics',
      title: 'SEO 基础',
      chunkContent: 'SEO 的核心是让搜索引擎理解页面结构。',
      vector: basisVector(0),
    })
    await seedArticle({
      sourceId: 302,
      slug: 'sitemap-guide',
      title: 'Sitemap 指南',
      chunkContent: 'Sitemap 帮助搜索引擎发现页面。',
      vector: basisVector(1),
    })
  })

  after(async () => {
    await prisma?.$disconnect()
    await retrievalPool?.end()
    if (adminPool) {
      assert.match(schema, /^grounding_test_[a-f\d]+$/)
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await adminPool.end()
    }
  })

  it('真实检索证据经 finalization 后与 Message、Step、Run 原子提交', async () => {
    const conversationId = await createConversation()
    const harness = createHarness(conversationId, [
      () => toModelStream([
        toolCallEvent('call-1', 'retrieve_article_context', '{"query":"SEO 是什么","limit":2}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]),
      () => toModelStream([
        { type: 'text_delta', delta: '内部草稿-不应落库' },
        { type: 'response_completed', finishReason: 'stop' },
      ]),
      keys => toModelStream([
        submitGroundedAnswerEvent({
          answer: 'SEO 的核心是让搜索引擎理解页面结构。',
          outcome: 'answered',
          citationKeys: [keys[0]!],
        }),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]),
    ])

    const events = await collectEvents(harness.run())
    const completed = events.at(-1)!

    assert.equal(completed.type, 'run_completed')

    const streamedGrounding = (completed as { grounding?: MessageGroundingV1 })
      .grounding

    assert.ok(streamedGrounding)
    assert.equal(streamedGrounding.evidenceAvailability, 'available')
    assert.equal(streamedGrounding.outcome, 'answered')
    assert.equal(streamedGrounding.citations.length, 1)
    assert.equal(streamedGrounding.citations[0]?.sourceId, 301)
    assert.equal(streamedGrounding.citations[0]?.granularity, 'chunk')

    const message = await requireAssistantMessage(conversationId)

    assert.equal(message.status, MessageStatus.COMPLETED)
    assert.equal(message.content, 'SEO 的核心是让搜索引擎理解页面结构。')
    assert.doesNotMatch(message.content, /内部草稿/)

    // 页面重载路径读到的必须是同一份 durable 事实。
    const persistedGrounding = toMessageGroundingV1(await requireGrounding(message.id))

    assert.deepEqual(persistedGrounding, streamedGrounding)

    const run = await requireRun(conversationId)

    assert.equal(run.status, AgentRunStatus.COMPLETED)

    const steps = await listSteps(run.id)

    assert.equal(
      steps.every(step => step.status === AgentStepStatus.COMPLETED),
      true,
    )

    const finalizationStep = steps.find(
      step => step.type === 'grounded_finalization',
    )

    assert.ok(finalizationStep)
    assert.doesNotMatch(
      JSON.stringify(finalizationStep.output),
      /evk_|内部草稿|SEO 的核心是让搜索引擎理解页面结构/,
    )
  })

  it('真实 zero-hit 时进入 none，且没有 Grounding 行以外的伪造引用', async () => {
    const conversationId = await createConversation()
    const harness = createHarness(conversationId, [
      () => toModelStream([
        toolCallEvent('call-1', 'retrieve_article_context', '{"query":"zzz-not-indexed","languageCode":"fr"}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]),
      () => toModelStream([
        { type: 'text_delta', delta: '草稿' },
        { type: 'response_completed', finishReason: 'stop' },
      ]),
      () => toModelStream([
        submitGroundedAnswerEvent({
          answer: '当前站内资料没有可用证据，无法确认。',
          outcome: 'insufficient_evidence',
          citationKeys: [],
        }),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]),
    ])

    await collectEvents(harness.run())

    const message = await requireAssistantMessage(conversationId)
    const grounding = toMessageGroundingV1(await requireGrounding(message.id))

    assert.ok(grounding)
    assert.equal(grounding.evidenceAvailability, 'none')
    assert.equal(grounding.outcome, 'insufficient_evidence')
    assert.deepEqual(grounding.citations, [])
  })

  it('get_article_detail 命中时产出 article 粒度 Citation，不伪造 chunk / excerpt', async () => {
    const conversationId = await createConversation()
    const harness = createHarness(conversationId, [
      () => toModelStream([
        toolCallEvent('call-1', 'get_article_detail', '{"sourceId":302}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]),
      () => toModelStream([
        { type: 'text_delta', delta: '草稿' },
        { type: 'response_completed', finishReason: 'stop' },
      ]),
      keys => toModelStream([
        submitGroundedAnswerEvent({
          answer: 'Sitemap 帮助搜索引擎发现页面。',
          outcome: 'answered',
          citationKeys: [keys[0]!],
        }),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]),
    ])

    await collectEvents(harness.run())

    const message = await requireAssistantMessage(conversationId)
    const grounding = toMessageGroundingV1(await requireGrounding(message.id))

    assert.ok(grounding)
    assert.equal(grounding.citations.length, 1)

    const [citation] = grounding.citations

    assert.equal(citation?.sourceId, 302)
    assert.equal(citation?.granularity, 'article')
    assert.equal(citation?.chunkId, null)
    assert.equal(citation?.sectionPath, null)
    assert.equal(citation?.excerpt, null)
    assert.equal(citation?.rank, null)
    assert.equal(citation?.href, null)
    assert.deepEqual(citation?.strategy, { name: 'article_detail', version: '1' })
  })

  it('detail not found 时进入 none，不写入任何 Citation', async () => {
    const conversationId = await createConversation()
    const harness = createHarness(conversationId, [
      () => toModelStream([
        toolCallEvent('call-1', 'get_article_detail', '{"sourceId":999999}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]),
      () => toModelStream([
        { type: 'text_delta', delta: '草稿' },
        { type: 'response_completed', finishReason: 'stop' },
      ]),
      () => toModelStream([
        submitGroundedAnswerEvent({
          answer: '没有找到这篇文章。',
          outcome: 'insufficient_evidence',
          citationKeys: [],
        }),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]),
    ])

    await collectEvents(harness.run())

    const message = await requireAssistantMessage(conversationId)
    const grounding = toMessageGroundingV1(await requireGrounding(message.id))

    assert.ok(grounding)
    assert.equal(grounding.evidenceAvailability, 'none')
    assert.deepEqual(grounding.citations, [])
  })

  it('correction 后仍失败时数据库里没有任何 Grounding，Message 为 FAILED', async () => {
    const conversationId = await createConversation()
    const invalidSubmission = () => toModelStream([
      submitGroundedAnswerEvent({
        answer: '未通过校验的回答',
        outcome: 'answered',
        citationKeys: ['evk_00000000000000000000000000000000'],
      }),
      { type: 'response_completed', finishReason: 'tool_calls' },
    ])
    const harness = createHarness(conversationId, [
      () => toModelStream([
        toolCallEvent('call-1', 'retrieve_article_context', '{"query":"SEO 是什么"}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]),
      () => toModelStream([
        { type: 'text_delta', delta: '内部草稿-不应落库' },
        { type: 'response_completed', finishReason: 'stop' },
      ]),
      invalidSubmission,
      invalidSubmission,
    ])

    const events = await collectEvents(harness.run())

    assert.equal(events.at(-1)?.type, 'run_failed')

    const message = await requireAssistantMessage(conversationId)

    assert.equal(message.status, MessageStatus.FAILED)
    assert.doesNotMatch(message.content, /内部草稿|未通过校验的回答/)
    assert.equal(await findGrounding(message.id), null)

    const run = await requireRun(conversationId)

    assert.equal(run.status, AgentRunStatus.FAILED)
    assert.equal(
      (await listSteps(run.id)).some(
        step => step.status === AgentStepStatus.RUNNING,
      ),
      false,
    )
  })

  it('重放期间 Abort 时保留 partial content / ABORTED，且没有 completed Grounding', async () => {
    const conversationId = await createConversation()
    const abortController = new AbortController()
    const harness = createHarness(
      conversationId,
      [
        () => toModelStream([
          toolCallEvent('call-1', 'retrieve_article_context', '{"query":"SEO 是什么"}'),
          { type: 'response_completed', finishReason: 'tool_calls' },
        ]),
        () => toModelStream([
          { type: 'text_delta', delta: '草稿' },
          { type: 'response_completed', finishReason: 'stop' },
        ]),
        keys => toModelStream([
          submitGroundedAnswerEvent({
            answer: '这是一段足够长的已验证回答，需要拆成多个 delta 才能重放完毕。'.repeat(4),
            outcome: 'answered',
            citationKeys: [keys[0]!],
          }),
          { type: 'response_completed', finishReason: 'tool_calls' },
        ]),
      ],
      abortController.signal,
    )

    const events = await collectEvents(harness.run(), (_delta, index) => {
      if (index === 0)
        abortController.abort()
    })
    const replayed = events
      .filter(event => event.type === 'assistant_delta')
      .map(event => event.contentDelta)
      .join('')

    assert.equal(events.at(-1)?.type, 'run_aborted')
    assert.ok(replayed.length > 0)

    const message = await requireAssistantMessage(conversationId)

    assert.equal(message.status, MessageStatus.ABORTED)
    assert.equal(message.content, replayed)
    // Grounding 只属于 COMPLETED Message；中断的重放不允许留下已完成的引用事实。
    assert.equal(await findGrounding(message.id), null)

    const run = await requireRun(conversationId)

    assert.equal(run.status, AgentRunStatus.ABORTED)

    const steps = await listSteps(run.id)
    const finalizationStep = steps.find(
      step => step.type === 'grounded_finalization',
    )

    // finalization Step 在 replay 期间保持 RUNNING，中断后由统一收口变成 ABORTED；
    // 绝不能留下一个 COMPLETED 的 finalization Step 配上 ABORTED 的 Run。
    assert.ok(finalizationStep)
    assert.equal(finalizationStep.status, AgentStepStatus.ABORTED)
    assert.equal(
      steps.some(step => step.status === AgentStepStatus.RUNNING),
      false,
    )
  })

  it('终态事务失败时整组终态回滚，不留下 COMPLETED finalization Step', async () => {
    const conversationId = await createConversation()
    // 真实数据库层面的失败注入：加一条必然违反的 CHECK 约束，让终态事务里的
    // Grounding INSERT 真的失败。Message、Grounding、两个 Step 与 Run 必须一起
    // 回滚，任何一项单独生效都说明它们不在同一个事务里。
    assert.match(schema, /^grounding_test_[a-f\d]+$/)
    await adminPool.query(
      // NOT VALID：只拦截新写入，不回头校验前面用例已经写好的合法行。
      `ALTER TABLE "${schema}"."MessageGrounding"
       ADD CONSTRAINT "tmp_reject_grounding_write"
       CHECK ("schemaVersion" < 0) NOT VALID`,
    )

    try {
      const harness = createHarness(conversationId, [
        () => toModelStream([
          toolCallEvent('call-1', 'retrieve_article_context', '{"query":"SEO 是什么"}'),
          { type: 'response_completed', finishReason: 'tool_calls' },
        ]),
        () => toModelStream([
          { type: 'text_delta', delta: '草稿' },
          { type: 'response_completed', finishReason: 'stop' },
        ]),
        keys => toModelStream([
          submitGroundedAnswerEvent({
            answer: '这条回答不应该被提交。',
            outcome: 'answered',
            citationKeys: [keys[0]!],
          }),
          { type: 'response_completed', finishReason: 'tool_calls' },
        ]),
      ])

      const events = await collectEvents(harness.run())

      assert.notEqual(events.at(-1)?.type, 'run_completed')

      const message = await requireAssistantMessage(conversationId)

      assert.notEqual(message.status, MessageStatus.COMPLETED)
      assert.equal(await findGrounding(message.id), null)

      const run = await requireRun(conversationId)

      assert.notEqual(run.status, AgentRunStatus.COMPLETED)

      const steps = await listSteps(run.id)
      const finalizationStep = steps.find(
        step => step.type === 'grounded_finalization',
      )

      assert.ok(finalizationStep)
      assert.notEqual(finalizationStep.status, AgentStepStatus.COMPLETED)
      assert.equal(
        steps.some(step => step.status === AgentStepStatus.RUNNING),
        false,
      )
    }
    finally {
      await adminPool.query(
        `ALTER TABLE "${schema}"."MessageGrounding"
         DROP CONSTRAINT IF EXISTS "tmp_reject_grounding_write"`,
      )
    }
  })

  it('持久化 citations 被改坏时 API 投影 fail closed，不透传原始 JSON', async () => {
    const conversationId = await createConversation()
    const harness = createHarness(conversationId, [
      () => toModelStream([
        toolCallEvent('call-1', 'retrieve_article_context', '{"query":"SEO 是什么"}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]),
      () => toModelStream([
        { type: 'text_delta', delta: '草稿' },
        { type: 'response_completed', finishReason: 'stop' },
      ]),
      keys => toModelStream([
        submitGroundedAnswerEvent({
          answer: '回答',
          outcome: 'answered',
          citationKeys: [keys[0]!],
        }),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]),
    ])

    await collectEvents(harness.run())

    const message = await requireAssistantMessage(conversationId)

    await prisma.messageGrounding.update({
      where: { messageId: message.id },
      data: {
        citations: [{ leaked: 'SELECT * FROM "ArticleChunk"' }],
      },
    })

    const projected = toMessageGroundingV1(await requireGrounding(message.id))

    assert.equal(projected, null)
    assert.doesNotMatch(JSON.stringify(projected), /SELECT|leaked/)
  })

  it('Message 删除时 Grounding 级联删除，不留孤立引用记录', async () => {
    const conversationId = await createConversation()
    const harness = createHarness(conversationId, [
      () => toModelStream([
        toolCallEvent('call-1', 'retrieve_article_context', '{"query":"SEO 是什么"}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]),
      () => toModelStream([
        { type: 'text_delta', delta: '草稿' },
        { type: 'response_completed', finishReason: 'stop' },
      ]),
      keys => toModelStream([
        submitGroundedAnswerEvent({
          answer: '回答',
          outcome: 'answered',
          citationKeys: [keys[0]!],
        }),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]),
    ])

    await collectEvents(harness.run())

    const message = await requireAssistantMessage(conversationId)

    assert.notEqual(await findGrounding(message.id), null)
    await prisma.conversation.delete({ where: { id: conversationId } })
    assert.equal(await findGrounding(message.id), null)
  })

  // ── Admin Retrieval Inspector（Task 3C）────────────────────
  //
  // 这里刻意复用同一套真实 harness：Inspector 必须证明自己能读懂 Runtime 真正
  // 写入的 Step metadata 与 MessageGrounding relation，而不是读懂测试里手写的
  // 纯对象 fixture。

  it('Admin Run Detail 从真实 Step 与 MessageGrounding relation 构建 available Inspector', async () => {
    const conversationId = await createConversation()
    const harness = createHarness(conversationId, [
      () => toModelStream([
        toolCallEvent('call-1', 'retrieve_article_context', '{"query":"SEO 是什么","limit":2}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]),
      () => toModelStream([
        { type: 'text_delta', delta: '内部草稿-不应落库' },
        { type: 'response_completed', finishReason: 'stop' },
      ]),
      keys => toModelStream([
        submitGroundedAnswerEvent({
          answer: 'SEO 的核心是让搜索引擎理解页面结构。',
          outcome: 'answered',
          citationKeys: [keys[0]!],
        }),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]),
    ])

    await collectEvents(harness.run())

    const run = await requireRun(conversationId)
    const detail = await createAdminRunsService().getDetail(run.id)
    const inspector = detail.retrievalInspector

    assert.equal(inspector.availability, 'available')
    assert.equal(inspector.retrievalCalls.length, 1)

    const call = inspector.retrievalCalls[0]!

    assert.equal(call.toolName, 'retrieve_article_context')
    assert.equal(call.toolVersion, '1')
    assert.equal(call.ok, true)
    assert.equal(call.metadataTrusted, true)
    assert.ok(call.sourceCount !== null && call.sourceCount > 0)
    assert.deepEqual(call.strategy?.name !== undefined, true)
    assert.ok(call.refs.some(ref => ref.sourceId === 301))

    const finalization = inspector.finalization!

    assert.equal(finalization.metadataTrusted, true)
    assert.equal(finalization.validation, 'passed')
    assert.equal(finalization.evidenceAvailability, 'available')
    assert.equal(finalization.outcome, 'answered')
    assert.equal(finalization.citationCount, 1)
    assert.equal(finalization.registryRefCount, inspector.evidenceRefCount)

    assert.equal(inspector.citations?.length, 1)
    assert.equal(inspector.citations![0]!.sourceId, 301)
    assert.equal(inspector.citations![0]!.granularity, 'chunk')
    assert.equal(inspector.citations![0]!.correlation, 'matched')
    assert.deepEqual(inspector.citations![0]!.matchedCallIds, ['call-1'])

    // typed timeline item 必须来自真实 finalization Step，而不是 Generic fallback。
    const finalizationItem = detail.timeline.find(
      item => item.type === 'grounded_finalization',
    )

    assert.equal(finalizationItem?.kind, 'known')

    const serialized = JSON.stringify(detail)

    assert.doesNotMatch(serialized, /内部草稿|evk_|SELECT|embedding|excerpt/)
    // Observation 正文与候选摘要都留在 Step output 里，不进入 Admin 响应。
    assert.doesNotMatch(serialized, /Sitemap 帮助搜索引擎发现页面。/)
    assert.doesNotMatch(JSON.stringify(detail.safeRawData), /"(?:input|output)":/)
  })

  it('Admin Run Detail 对普通未检索 Run 返回 not_applicable', async () => {
    const conversationId = await createConversation()
    const harness = createHarness(conversationId, [
      () => toModelStream([
        { type: 'text_delta', delta: '直接回答，不检索。' },
        { type: 'response_completed', finishReason: 'stop' },
      ]),
    ])

    await collectEvents(harness.run())

    const run = await requireRun(conversationId)
    const detail = await createAdminRunsService().getDetail(run.id)

    assert.equal(detail.retrievalInspector.availability, 'not_applicable')
    assert.deepEqual(detail.retrievalInspector.retrievalCalls, [])
    assert.equal(detail.retrievalInspector.finalization, null)
    assert.equal(detail.retrievalInspector.citations, null)
  })

  it('Admin Run Detail 在持久化 Grounding 损坏时不返回半份 Citation', async () => {
    const conversationId = await createConversation()
    const harness = createHarness(conversationId, [
      () => toModelStream([
        toolCallEvent('call-1', 'retrieve_article_context', '{"query":"SEO 是什么"}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]),
      () => toModelStream([
        { type: 'text_delta', delta: '草稿' },
        { type: 'response_completed', finishReason: 'stop' },
      ]),
      keys => toModelStream([
        submitGroundedAnswerEvent({
          answer: '回答',
          outcome: 'answered',
          citationKeys: [keys[0]!],
        }),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]),
    ])

    await collectEvents(harness.run())

    const message = await requireAssistantMessage(conversationId)

    await prisma.messageGrounding.update({
      where: { messageId: message.id },
      data: { citations: [{ leaked: 'SELECT * FROM "ArticleChunk"' }] },
    })

    const run = await requireRun(conversationId)
    const detail = await createAdminRunsService().getDetail(run.id)

    assert.equal(detail.retrievalInspector.citations, null)
    assert.equal(detail.retrievalInspector.availability, 'partial')
    // Run Detail 仍然可加载，且不透传原始 JSON。
    assert.ok(detail.timeline.length > 0)
    assert.doesNotMatch(JSON.stringify(detail), /SELECT|leaked/)
  })

  it('Admin Run Detail 对 article detail 证据标记 unmatched 并降为 partial', async () => {
    const conversationId = await createConversation()
    const harness = createHarness(conversationId, [
      () => toModelStream([
        toolCallEvent('call-1', 'get_article_detail', '{"sourceId":301}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]),
      () => toModelStream([
        { type: 'text_delta', delta: '草稿' },
        { type: 'response_completed', finishReason: 'stop' },
      ]),
      keys => toModelStream([
        submitGroundedAnswerEvent({
          answer: 'SEO 基础文章说明了页面结构的重要性。',
          outcome: 'answered',
          citationKeys: [keys[0]!],
        }),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]),
    ])

    await collectEvents(harness.run())

    const run = await requireRun(conversationId)
    const detail = await createAdminRunsService().getDetail(run.id)
    const inspector = detail.retrievalInspector

    // get_article_detail 不提交 Step Summary：call 本身可信，但没有可投影的
    // 引用身份，因此 Citation 只能是 unmatched，Inspector 必须降级而不是伪装完整。
    assert.equal(inspector.retrievalCalls.length, 1)
    assert.equal(inspector.retrievalCalls[0]?.toolName, 'get_article_detail')
    assert.equal(inspector.retrievalCalls[0]?.metadataTrusted, true)
    assert.deepEqual(inspector.retrievalCalls[0]?.refs, [])
    assert.equal(inspector.citations?.length, 1)
    assert.equal(inspector.citations![0]!.granularity, 'article')
    assert.equal(inspector.citations![0]!.correlation, 'unmatched')
    assert.equal(inspector.availability, 'partial')
    assert.doesNotMatch(JSON.stringify(detail), /evk_|excerpt/)
  })

  // ── 脚手架 ──────────────────────────────────────────────

  function createAdminRunsService(): AdminRunsService {
    return new AdminRunsService(prisma)
  }

  function createHarness(
    conversationId: string,
    modelStreams: Array<(citationKeys: string[]) => AsyncGenerator<ModelStreamEvent>>,
    signal?: AbortSignal,
  ) {
    const repository = new PostgresArticleRetrievalRepository(retrievalPool)
    const registry = new ToolRegistryService()

    registry.register({
      // 直接复用真实定义，确保 DB integration 覆盖的是生产 evidence policy。
      definition: retrieveArticleContextDefinition,
      executor: new RetrieveArticleContextTool(
        new HybridArticleRetriever(
          new LexicalArticleRetriever(repository),
          new VectorArticleRetriever(new StubEmbeddingProvider(basisVector(0)), repository),
        ),
      ),
    })
    registry.register({
      definition: getArticleDetailDefinition,
      executor: new GetArticleDetailTool(prisma),
    })

    let callIndex = 0
    const llmService = {
      resolveChatRequestConfig: () => ({
        model: 'deepseek-v4-flash',
        maxOutputTokens: 65_536,
      }),
      chatStream: (messages: ModelInputItem[], _options?: ChatStreamOptions) => {
        const createStream = modelStreams[callIndex]

        callIndex += 1

        if (!createStream)
          throw new Error(`测试未提供第 ${callIndex} 次模型流`)

        const text = messages
          .map(item => item.type === 'message' ? item.content : '')
          .join('\n')

        return createStream(
          [...text.matchAll(/evk_[a-f\d]{32}/g)].map(match => match[0]),
        )
      },
    } as unknown as LLMService
    const service = new AgentRuntimeService(
      llmService,
      prisma,
      new AgentRunRecorderService(prisma),
      registry,
      new ToolInvocationService(registry),
      {
        value: {
          historyCandidateBatchSize: 50,
          historyCandidateHardLimit: 1_000,
          maxSamplingRounds: 3,
          maxToolCalls: 1,
          runDeadlineMs: 60_000,
        },
      } as never,
      new InitialContextSelectionService(new TestTokenEstimator()),
      new SamplingContextPlanner(new TestTokenEstimator()),
    )

    return {
      run: () => service.runTurnStream({
        conversationId,
        userContent: 'SEO 是什么',
        temperature: 0.4,
        ...(signal ? { signal } : {}),
        buildModelMessages: historyMessages => historyMessages,
      }),
    }
  }

  async function createConversation(): Promise<string> {
    const conversation = await prisma.conversation.create({
      data: { title: 'grounding integration' },
    })

    return conversation.id
  }

  async function requireAssistantMessage(conversationId: string) {
    const message = await prisma.message.findFirst({
      where: { conversationId, role: MessageRole.ASSISTANT },
      orderBy: { createdAt: 'desc' },
    })

    assert.ok(message)
    return message
  }

  async function findGrounding(messageId: string) {
    return await prisma.messageGrounding.findUnique({ where: { messageId } })
  }

  async function requireGrounding(messageId: string) {
    const grounding = await findGrounding(messageId)

    assert.ok(grounding)
    return grounding
  }

  async function requireRun(conversationId: string) {
    const run = await prisma.agentRun.findFirst({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
    })

    assert.ok(run)
    return run
  }

  async function listSteps(runId: string) {
    return await prisma.agentStep.findMany({
      where: { runId },
      orderBy: { sequence: 'asc' },
    })
  }

  async function seedArticle(options: {
    sourceId: number
    slug: string
    title: string
    chunkContent: string
    vector: readonly number[]
  }): Promise<void> {
    const id = `article-${options.sourceId}`
    const updatedAt = new Date('2026-08-15T00:00:00.000Z')

    await retrievalPool.query(`
      INSERT INTO "Article" (
        "id", "sourceId", "slug", "languageCode", "title", "content",
        "seoTitle", "seoDescription", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, 'zh-cn', $4, $5, NULL, NULL, $6, $6)
    `, [id, options.sourceId, options.slug, options.title, `<p>${options.title}</p>`, updatedAt])
    await retrievalPool.query(`
      INSERT INTO "ArticleChunk" (
        "id", "articleId", "ordinal", "languageCode", "sectionPath", "content",
        "tokenCount", "contentHash", "embeddingInputHash", "chunkerVersion",
        "embeddingProvider", "embeddingModel", "embeddingDimensions",
        "embeddingVersion", "embedding", "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, 0, 'zh-cn', 'Section 0', $3,
        1, $4, $5, $6,
        $7, $8, $9,
        $10, $11::vector, $12, $12
      )
    `, [
      `${id}-chunk-0`,
      id,
      options.chunkContent,
      `content-hash-${options.sourceId}`,
      `input-hash-${options.sourceId}`,
      ARTICLE_CHUNKER_PROFILE.version,
      ACTIVE_EMBEDDING_PROFILE.provider,
      ACTIVE_EMBEDDING_PROFILE.model,
      ACTIVE_EMBEDDING_PROFILE.dimensions,
      ACTIVE_EMBEDDING_PROFILE.version,
      `[${options.vector.join(',')}]`,
      updatedAt,
    ])
    await retrievalPool.query(`
      INSERT INTO "ArticleIndexState" (
        "articleId", "sourceHash", "sourceUpdatedAt", "chunkerVersion",
        "embeddingVersion", "chunkCount", "indexedAt", "createdAt", "updatedAt"
      ) VALUES ($1, $2, $3, $4, $5, 1, $3, $3, $3)
    `, [
      id,
      `source-hash-${options.sourceId}`,
      updatedAt,
      ARTICLE_CHUNKER_PROFILE.version,
      ACTIVE_EMBEDDING_PROFILE.version,
    ])
  }
})

async function collectEvents(
  events: AsyncGenerator<AgentRuntimeEvent>,
  onDelta?: (delta: string, index: number) => void,
): Promise<AgentRuntimeEvent[]> {
  const collected: AgentRuntimeEvent[] = []
  let deltaIndex = 0

  for await (const event of events) {
    collected.push(event)

    if (event.type === 'assistant_delta') {
      onDelta?.(event.contentDelta, deltaIndex)
      deltaIndex += 1
    }
  }

  return collected
}

class TestTokenEstimator extends TokenEstimator {
  readonly strategyId = 'grounding-db-estimator'

  estimateRequest(input: TokenEstimatorInput): number {
    return input.items.length + input.tools.length
  }
}

class StubEmbeddingProvider implements EmbeddingProvider {
  readonly profile = ACTIVE_EMBEDDING_PROFILE

  constructor(private readonly vector: readonly number[]) {}

  async embed(inputs: readonly string[]): Promise<EmbeddingResult> {
    return {
      vectors: inputs.map(() => [...this.vector]),
      providerRequests: 1,
      retryCount: 0,
    }
  }
}

function basisVector(index: number): number[] {
  return Array.from(
    { length: ACTIVE_EMBEDDING_PROFILE.dimensions },
    (_, vectorIndex) => vectorIndex === index ? 1 : 0,
  )
}

function withSearchPath(connectionString: string, schema: string): string {
  const url = new URL(connectionString)

  url.searchParams.set('schema', schema)
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return url.toString()
}

async function* toModelStream(
  events: ModelStreamEvent[],
): AsyncGenerator<ModelStreamEvent> {
  for (const event of events)
    yield event
}

function toolCallEvent(
  callId: string,
  name: string,
  argumentsJson: string,
): ModelStreamEvent {
  return {
    type: 'tool_call_completed',
    toolCall: { providerCallId: callId, name, argumentsJson, index: 0 },
    reasoningContent: '需要调用工具。',
  }
}

function submitGroundedAnswerEvent(input: {
  answer: string
  outcome: string
  citationKeys: string[]
}): ModelStreamEvent {
  return {
    type: 'tool_call_completed',
    toolCall: {
      providerCallId: 'finalization-call',
      name: 'submit_grounded_answer',
      argumentsJson: JSON.stringify(input),
      index: 0,
    },
    reasoningContent: '收口最终回答。',
  }
}
