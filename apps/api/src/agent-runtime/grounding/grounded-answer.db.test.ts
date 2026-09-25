import type {
  ChatStreamOptions,
  ModelInputItem,
  ModelStreamEvent,
} from '@agent/ai'
import type { MessageGroundingV1 } from '@agent/contracts'
import type {
  EmbeddingProvider,
  EmbeddingResult,
} from '../../embeddings/embedding-provider.js'
import type { LLMService } from '../../llm/llm.service.js'
import type { ArticleRetrievalPool } from '../../retrieval/persistence/postgres-article-retrieval.repository.js'
import type { AgentRuntimeEvent } from '../agent-runtime.types.js'
import type { AgentRuntimePolicyService } from '../configuration/agent-runtime.policy.js'
import type {
  TokenEstimator,
  TokenEstimatorInput,
} from '../context/deepseek-v4-token-estimator.js'
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
import { createResolvedLlmModel } from '../../llm/__fixtures__.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import {
  createArticleRetrievalPool,
  PostgresArticleRetrievalRepository,
} from '../../retrieval/persistence/postgres-article-retrieval.repository.js'
import { HybridArticleRetriever } from '../../retrieval/retrievers/hybrid-article-retriever.js'
import { LexicalArticleRetriever } from '../../retrieval/retrievers/lexical-article-retriever.js'
import { VectorArticleRetriever } from '../../retrieval/retrievers/vector-article-retriever.js'
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
import { AgentRuntimeService } from '../agent-runtime.service.js'
import { SamplingContextPlanner } from '../context/sampling-context-planner.js'
import { AgentRunRecorderService } from '../lifecycle/agent-run-recorder.service.js'
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
  '20260920160000_llm_model_config',
  '20260920200000_llm_model_drop_reasoning',
  '20260920210000_llm_model_reasoning_effort',
  '20260923120000_agent_run_error_code',
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
    assert.ok(testDatabaseUrl, 'testDatabaseUrl')
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

    assert.ok(streamedGrounding, 'streamedGrounding')
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

    assert.ok(finalizationStep, 'finalizationStep')
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

    assert.ok(grounding, 'grounding')
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

    assert.ok(grounding, 'grounding')
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

    assert.ok(grounding, 'grounding')
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
    assert.ok(replayed.length > 0, 'replayed.length > 0')

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
    assert.ok(finalizationStep, 'finalizationStep')
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

      assert.ok(finalizationStep, 'finalizationStep')
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

  it('Admin Run Detail 从真实 Step 与 MessageGrounding relation 构建 Retrieval Inspector', async () => {
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

    assert.equal(inspector.retrievalCalls.length, 1)

    const call = inspector.retrievalCalls[0]!
    const toolItem = detail.timeline.find(item => item.id === call.stepId)

    assert.equal(
      toolItem?.kind === 'known' && toolItem.type === 'tool_execution'
        ? [toolItem.toolName, toolItem.ok].join(':')
        : null,
      'retrieve_article_context:true',
    )
    assert.ok(call.sourceCount !== null && call.sourceCount > 0, 'call.sourceCount !== null && call.sourceCount > 0')
    assert.deepEqual(call.strategy?.name !== undefined, true)
    assert.ok(call.refs.some(ref => ref.sourceId === 301), 'call.refs.some(ref => ref.sourceId === 301)')

    // typed timeline item 必须来自真实 finalization Step，而不是 Generic fallback。
    const finalizationItem = detail.timeline.find(
      item => item.type === 'grounded_finalization',
    )

    assert.ok(finalizationItem?.kind === 'known' && finalizationItem.type === 'grounded_finalization', 'finalizationItem?.kind === \'known\' && finalizationItem.type === \'grounded_finalization\'')
    assert.equal(finalizationItem.evidenceAvailability, 'available')
    assert.equal(finalizationItem.outcome, 'answered')
    assert.equal(finalizationItem.attemptCount, 1)
    assert.equal(finalizationItem.failureReason, null)

    assert.equal(inspector.citations?.length, 1)
    assert.equal(inspector.citations![0]!.sourceId, 301)
    assert.deepEqual(inspector.citations![0]!.matchedCallIds, ['call-1'])

    // 真实 Postgres 往返后：参数与 observation 在 tool Step 收口时写入，Admin 原样投影，查询取自参数。
    assert.ok(toolItem?.kind === 'known' && toolItem.type === 'tool_execution', 'toolItem?.kind === \'known\' && toolItem.type === \'tool_execution\'')
    assert.equal(toolItem.arguments, '{"query":"SEO 是什么","limit":2}')
    assert.match(toolItem.observation ?? '', /Sitemap 帮助搜索引擎发现页面。/)
    assert.equal(call.query, 'SEO 是什么')

    // 回喂给模型的正文只出现在 tool Step 的 observation；草稿、citationKey 等仍不进 Admin 响应。
    const serialized = JSON.stringify({
      ...detail,
      timeline: detail.timeline.map(item => item.id === toolItem.id ? { ...item, observation: null } : item),
    })

    assert.doesNotMatch(serialized, /内部草稿|evk_|SELECT|embedding|excerpt/)
    assert.doesNotMatch(serialized, /Sitemap 帮助搜索引擎发现页面。/)
  })

  it('Admin Run Detail 对普通未检索 Run 返回空的 Retrieval Inspector', async () => {
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

    assert.deepEqual(detail.retrievalInspector, {
      retrievalCalls: [],
      citations: null,
    })
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
    // Run Detail 仍然可加载，且不透传原始 JSON。
    assert.ok(detail.timeline.length > 0, 'detail.timeline.length > 0')
    assert.doesNotMatch(JSON.stringify(detail), /SELECT|leaked/)
  })

  it('Admin Run Detail 对 article detail 证据不关联任何 call', async () => {
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

    // get_article_detail 不提交 Step Summary：call 没有可投影的引用身份，
    // Citation 只能没有关联到的 call。
    assert.equal(inspector.retrievalCalls.length, 1)
    assert.deepEqual(inspector.retrievalCalls[0]?.refs, [])
    assert.equal(inspector.citations?.length, 1)
    assert.equal(inspector.citations![0]!.chunkId, null)
    assert.deepEqual(inspector.citations![0]!.matchedCallIds, [])
    assert.doesNotMatch(JSON.stringify(detail), /evk_|excerpt/)
  })

  it('Admin Run Detail 对旧库多出的 finalization 字段照常投影 known Step', async () => {
    const conversationId = await createConversation()

    await collectEvents(createAnsweredHarness(conversationId).run())

    const run = await requireRun(conversationId)
    const steps = await listSteps(run.id)
    const finalizationStep = steps.find(
      step => step.type === 'grounded_finalization',
    )!

    // #126 之前落库的 finalization output 带有已停写字段：registryTruncated / eligible* 与 #152 起
    // 写入的是同一组提示词标量，照读；其余停写字段忽略。
    await prisma.agentStep.update({
      where: { id: finalizationStep.id },
      data: {
        output: {
          ...(finalizationStep.output as Record<string, unknown>),
          registryTruncated: false,
          eligibleToolCallCount: 99,
          eligibleToolFailureCount: 0,
          schemaVersion: 1,
          citationIntegrity: 'validated',
          faithfulnessStatus: 'not_evaluated',
        },
      },
    })

    const detail = await createAdminRunsService().getDetail(run.id)
    const finalizationItem = detail.timeline.find(
      item => item.type === 'grounded_finalization',
    )

    assert.ok(finalizationItem?.kind === 'known' && finalizationItem.type === 'grounded_finalization', 'finalizationItem?.kind === \'known\' && finalizationItem.type === \'grounded_finalization\'')
    assert.equal(finalizationItem.outcome, 'answered')
    assert.equal(finalizationItem.eligibleToolCallCount, 99)
    assert.doesNotMatch(JSON.stringify(detail), /citationIntegrity|faithfulnessStatus|schemaVersion/)
  })

  it('Admin Run Detail 把失败 Tool Step 上的 toolSummary 原样投影，但 Citation 关联只看引用身份', async () => {
    const conversationId = await createConversation()

    await collectEvents(createAnsweredHarness(conversationId).run())

    const run = await requireRun(conversationId)
    const steps = await listSteps(run.id)
    const toolStep = steps.find(step => step.type === 'tool_execution')!
    const message = await requireAssistantMessage(conversationId)
    const grounding = toMessageGroundingV1(await requireGrounding(message.id))
    const citation = grounding!.citations[0]!

    await prisma.agentStep.update({
      where: { id: toolStep.id },
      data: {
        status: AgentStepStatus.FAILED,
        output: {
          ok: false,
          code: 'timeout',
          originalChars: 0,
          observationChars: 60,
          truncated: false,
          toolSummary: {
            status: 'candidates_returned',
            answerStatus: 'unverified',
            strategy: { name: 'hybrid_rrf', version: '1' },
            sourceCount: 2,
            chunkEvidenceCount: 2,
            sources: [{
              sourceId: citation.sourceId,
              chunkId: citation.chunkId,
            }],
            leakedObservation: 'SELECT * FROM "ArticleChunk"',
          },
        },
      },
    })

    const detail = await createAdminRunsService().getDetail(run.id)
    const inspector = detail.retrievalInspector
    const call = inspector.retrievalCalls[0]!
    const toolItem = detail.timeline.find(item => item.id === call.stepId)

    assert.equal(
      toolItem?.kind === 'known' && toolItem.type === 'tool_execution'
        ? toolItem.ok
        : undefined,
      false,
    )
    assert.equal(call.sourceCount, 2)
    assert.deepEqual(call.strategy, { name: 'hybrid_rrf', version: '1' })
    assert.equal(inspector.citations?.length, 1)
    assert.deepEqual(inspector.citations![0]!.matchedCallIds, ['call-1'])
    // summary 之外的注入内容不进入响应。
    assert.doesNotMatch(JSON.stringify(detail), /SELECT|leakedObservation/)
  })

  // ── #167 U+0000：PostgreSQL text / jsonb 都拒收，写进落库副本前必须换掉 ──

  it('#167 AC-01 非 Grounding 可见文本含 U+0000：Run COMPLETED，delta 拼接、done 与 Message.content 逐字相等', async () => {
    const conversationId = await createConversation()
    const harness = createHarness(conversationId, [
      () => toModelStream([
        { type: 'text_delta', delta: '先说\u0000结论' },
        { type: 'text_delta', delta: '，再补一句\u0000。' },
        { type: 'response_completed', finishReason: 'stop' },
      ]),
    ])

    const events = await collectEvents(harness.run())
    const completed = events.at(-1)

    assert.ok(completed?.type === 'run_completed', 'completed?.type === \'run_completed\'')
    const streamed = joinDeltas(events)

    assert.equal(streamed, '先说\uFFFD结论，再补一句\uFFFD。')
    assert.equal(completed.content, streamed)

    const message = await requireAssistantMessage(conversationId)

    assert.equal(message.status, MessageStatus.COMPLETED)
    assert.equal(message.content, streamed)
    assert.equal((await requireRun(conversationId)).status, AgentRunStatus.COMPLETED)
  })

  it('#167 AC-02 Grounding 已校验回答含 U+0000：Run COMPLETED，重放、done 与 Message.content 一致且写入 Grounding', async () => {
    const conversationId = await createConversation()
    const harness = createHarness(conversationId, [
      () => toModelStream([
        toolCallEvent('call-1', 'retrieve_article_context', '{"query":"SEO 是什么","limit":2}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]),
      () => toModelStream([
        { type: 'text_delta', delta: '草稿' },
        { type: 'response_completed', finishReason: 'stop' },
      ]),
      keys => toModelStream([
        submitGroundedAnswerEvent({
          answer: 'SEO 的核心\u0000是让搜索引擎理解页面结构。',
          outcome: 'answered',
          citationKeys: [keys[0]!],
        }),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]),
    ])

    const events = await collectEvents(harness.run())
    const completed = events.at(-1)

    assert.ok(completed?.type === 'run_completed', 'completed?.type === \'run_completed\'')
    const replayed = joinDeltas(events)

    assert.equal(replayed, 'SEO 的核心\uFFFD是让搜索引擎理解页面结构。')
    assert.equal(completed.content, replayed)

    const message = await requireAssistantMessage(conversationId)

    assert.equal(message.status, MessageStatus.COMPLETED)
    assert.equal(message.content, replayed)
    assert.ok(await findGrounding(message.id), 'await findGrounding(message.id)')
    assert.equal((await requireRun(conversationId)).status, AgentRunStatus.COMPLETED)
  })

  it('#167 AC-03 模型给的工具名 / callId 含 U+0000 与孤立代理项：按 unknown_tool 回喂并继续，tool Step 正常收口', async () => {
    const conversationId = await createConversation()
    const harness = createHarness(conversationId, [
      () => toModelStream([
        toolCallEvent('call\u0000-1', 'lookup\u0000\uD83D', '{}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]),
      () => toModelStream([
        { type: 'text_delta', delta: '没有这个工具，直接回答。' },
        { type: 'response_completed', finishReason: 'stop' },
      ]),
    ])

    const events = await collectEvents(harness.run())

    assert.equal(events.at(-1)?.type, 'run_completed')
    // 模型看到的 observation 仍是原文工具名。
    assert.equal(
      harness.llmCalls[1]?.some(item => item.type === 'tool_result' && item.content.includes('lookup\u0000\uD83D')),
      true,
    )

    const run = await requireRun(conversationId)

    assert.equal(run.status, AgentRunStatus.COMPLETED)

    const steps = await listSteps(run.id)
    const toolStep = steps.find(step => step.type === 'tool_execution')

    assert.ok(toolStep, 'toolStep')
    assert.equal(toolStep.status, AgentStepStatus.FAILED)
    assert.deepEqual(
      [(toolStep.input as Record<string, unknown>).callId, (toolStep.input as Record<string, unknown>).toolName],
      ['call\uFFFD-1', 'lookup\uFFFD\uFFFD'],
    )
    assert.equal(toolStep.errorMessage, '工具 lookup\uFFFD\uFFFD 返回 unknown_tool。')
    assert.equal(steps.some(step => step.status === AgentStepStatus.RUNNING), false)
  })

  it('#167 AC-04 用户消息含 U+0000：落库与模型收到的都是替换后的文本，Run COMPLETED', async () => {
    const conversationId = await createConversation()
    const harness = createHarness(
      conversationId,
      [
        () => toModelStream([
          { type: 'text_delta', delta: '收到。' },
          { type: 'response_completed', finishReason: 'stop' },
        ]),
      ],
      undefined,
      { userContent: 'SEO\u0000 是什么' },
    )

    const events = await collectEvents(harness.run())

    assert.equal(events.at(-1)?.type, 'run_completed')

    const userMessage = await prisma.message.findFirst({
      where: { conversationId, role: MessageRole.USER },
    })

    assert.equal(userMessage?.content, 'SEO\uFFFD 是什么')
    assert.equal(
      harness.llmCalls[0]?.some(item => item.type === 'message' && item.role === 'user' && item.content === 'SEO\uFFFD 是什么'),
      true,
    )
    assert.doesNotMatch(JSON.stringify(harness.llmCalls), /\\u0000/)
    assert.equal((await requireRun(conversationId)).status, AgentRunStatus.COMPLETED)
  })

  it('#167 AC-05 已推出含 U+0000 的文本后用户停止：Run / Message 以 ABORTED 收口，不停在 RUNNING', async () => {
    const conversationId = await createConversation()
    const abortController = new AbortController()
    const harness = createHarness(
      conversationId,
      [
        () => toModelStream([
          { type: 'text_delta', delta: '前半段\u0000' },
          { type: 'text_delta', delta: '后半段' },
          { type: 'response_completed', finishReason: 'stop' },
        ]),
      ],
      abortController.signal,
    )

    const events = await collectEvents(harness.run(), (_delta, index) => {
      if (index === 0)
        abortController.abort()
    })

    assert.equal(events.at(-1)?.type, 'run_aborted')

    const message = await requireAssistantMessage(conversationId)

    assert.equal(message.status, MessageStatus.ABORTED)
    assert.equal(joinDeltas(events), '前半段\uFFFD')
    assert.equal(message.content, '前半段\uFFFD')

    const run = await requireRun(conversationId)

    assert.equal(run.status, AgentRunStatus.ABORTED)
    assert.equal((await listSteps(run.id)).some(step => step.status === AgentStepStatus.RUNNING), false)
  })

  it('#167 AC-05 已推出含 U+0000 的文本后 deadline 到期：Run / Message 以 FAILED 收口，不停在 RUNNING', async () => {
    const conversationId = await createConversation()
    const harness = createHarness(
      conversationId,
      [
        // 推出第一段后挂住，直到 deadline 中止 Run 信号；之后的 yield 由 runtime 的取消检查接管。
        (_keys, runSignal) => (async function* (): AsyncGenerator<ModelStreamEvent> {
          yield { type: 'text_delta', delta: '先说\u0000一半' }
          await new Promise(resolve => runSignal?.addEventListener('abort', resolve, { once: true }))
          yield { type: 'text_delta', delta: '不会进正文' }
          yield { type: 'response_completed', finishReason: 'stop' }
        })(),
      ],
      undefined,
      // deadline 从 Run 创建时计时，前面还有几次真实 DB 写，留足余量。
      { runDeadlineMs: 2_000 },
    )

    const events = await collectEvents(harness.run())

    assert.equal(events.at(-1)?.type, 'run_failed')

    const message = await requireAssistantMessage(conversationId)

    assert.equal(message.status, MessageStatus.FAILED)
    assert.equal(message.content, '先说\uFFFD一半')

    const run = await requireRun(conversationId)

    assert.equal(run.status, AgentRunStatus.FAILED)
    assert.equal(run.errorCode, 'deadline')
    assert.equal((await listSteps(run.id)).some(step => step.status === AgentStepStatus.RUNNING), false)
  })

  it('#167 AC-05b 开启 debug 抓取时模型文本含 U+0000：Run COMPLETED，两轮采样 Step 的请求与响应信封都已替换', async () => {
    const conversationId = await createConversation()
    const harness = createHarness(
      conversationId,
      [
        // 第一轮的中间文本原样回填给模型（模型可见保持原文），所以第二轮的请求体里也带着 U+0000。
        () => toModelStream([
          { type: 'text_delta', delta: '先查\u0000一下' },
          toolCallEvent('call-1', 'noop', '{}'),
          { type: 'response_completed', finishReason: 'tool_calls' },
        ]),
        () => toModelStream([
          { type: 'text_delta', delta: '查完了\u0000。' },
          { type: 'response_completed', finishReason: 'stop' },
        ]),
      ],
      undefined,
      { captureModelIO: true },
    )

    const events = await collectEvents(harness.run())

    assert.equal(events.at(-1)?.type, 'run_completed')
    assert.equal(
      harness.llmCalls[1]?.some(item => item.type === 'assistant_tool_call' && item.content === '先查\u0000一下'),
      true,
    )

    const run = await requireRun(conversationId)

    assert.equal(run.status, AgentRunStatus.COMPLETED)

    const samplingSteps = (await listSteps(run.id)).filter(step => step.type === 'model_sampling')
    const outputs = samplingSteps.map(step => step.output as {
      debugRequestBody?: { value?: unknown }
      debugRawResponse?: { value?: { choices?: Array<{ message?: { content?: string } }> } }
    })

    assert.deepEqual(samplingSteps.map(step => step.status), [AgentStepStatus.COMPLETED, AgentStepStatus.COMPLETED])
    assert.equal(outputs[0]?.debugRawResponse?.value?.choices?.[0]?.message?.content, '先查\uFFFD一下')
    assert.equal(outputs[1]?.debugRawResponse?.value?.choices?.[0]?.message?.content, '查完了\uFFFD。')
    assert.match(JSON.stringify(outputs[1]?.debugRequestBody), /先查\uFFFD一下/)
  })

  // ── 脚手架 ──────────────────────────────────────────────

  function createAdminRunsService(): AdminRunsService {
    return new AdminRunsService(prisma)
  }

  /** 一次真实的 retrieval → grounded finalization → answered Run。 */
  function createAnsweredHarness(conversationId: string) {
    return createHarness(conversationId, [
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
  }

  function createHarness(
    conversationId: string,
    modelStreams: Array<(citationKeys: string[], runSignal?: AbortSignal) => AsyncGenerator<ModelStreamEvent>>,
    signal?: AbortSignal,
    options: {
      userContent?: string
      runDeadlineMs?: number
      /** 模拟开启 AGENT_DEBUG_CAPTURE_MODEL_IO：把请求与拼好的正文交给 debugCapture 回调。 */
      captureModelIO?: boolean
    } = {},
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
    const llmCalls: ModelInputItem[][] = []
    const llmService = {
      chatStream: (_provider: unknown, messages: ModelInputItem[], chatOptions?: ChatStreamOptions) => {
        const createStream = modelStreams[callIndex]

        callIndex += 1
        llmCalls.push(structuredClone(messages))

        if (!createStream)
          throw new Error(`测试未提供第 ${callIndex} 次模型流`)

        const text = messages
          .map(item => item.type === 'message' ? item.content : '')
          .join('\n')
        const stream = createStream(
          [...text.matchAll(/evk_[a-f\d]{32}/g)].map(match => match[0]),
          chatOptions?.signal,
        )

        return options.captureModelIO && chatOptions?.debugCapture
          ? withDebugCapture(stream, messages, chatOptions.debugCapture)
          : stream
      },
    } as unknown as LLMService
    const tokenEstimator = new TestTokenEstimator()
    const service = new AgentRuntimeService(
      llmService,
      prisma,
      new AgentRunRecorderService(prisma),
      new ToolInvocationService(registry),
      {
        value: {
          historyCandidateHardLimit: 1_000,
          maxSamplingRounds: 3,
          maxToolCalls: 1,
          runDeadlineMs: options.runDeadlineMs ?? 60_000,
        },
      } as AgentRuntimePolicyService,
      registry,
      tokenEstimator,
      new SamplingContextPlanner(tokenEstimator),
    )

    return {
      llmCalls,
      run: () => service.runTurnStream({
        conversationId,
        userContent: options.userContent ?? 'SEO 是什么',
        model: createResolvedLlmModel(),
        reasoningEffort: 'high',
        ...(signal ? { signal } : {}),
        instructions: [],
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

    assert.ok(message, 'message')
    return message
  }

  async function findGrounding(messageId: string) {
    return await prisma.messageGrounding.findUnique({ where: { messageId } })
  }

  async function requireGrounding(messageId: string) {
    const grounding = await findGrounding(messageId)

    assert.ok(grounding, 'grounding')
    return grounding
  }

  async function requireRun(conversationId: string) {
    const run = await prisma.agentRun.findFirst({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
    })

    assert.ok(run, 'run')
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

function joinDeltas(events: AgentRuntimeEvent[]): string {
  return events
    .map(event => event.type === 'assistant_delta' ? event.contentDelta : '')
    .join('')
}

/** 与真实 client 相同的时机：请求发出前交出请求体，流结束后交出拼好的响应。 */
async function* withDebugCapture(
  events: AsyncGenerator<ModelStreamEvent>,
  messages: ModelInputItem[],
  capture: NonNullable<ChatStreamOptions['debugCapture']>,
): AsyncGenerator<ModelStreamEvent> {
  capture.onRequest({ messages })

  let text = ''

  for await (const event of events) {
    if (event.type === 'text_delta')
      text += event.delta
    yield event
  }

  capture.onResponse({
    state: 'complete',
    lastEvent: 'text_delta',
    textChars: text.length,
    toolCallCount: 0,
    rawResponse: { choices: [{ message: { content: text }, finish_reason: 'stop' }] },
  })
}

class TestTokenEstimator implements TokenEstimator {
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
