import type { MessageGroundingV1 } from '@agent/contracts'
import type { AgentRuntimeEvent } from '../agent-runtime.types.js'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { OpenAICompatibleClient } from '../../llm/clients/openai-compatible.client.js'
import { LLMRuntimeConfigService } from '../../llm/llm-runtime-config.js'
import { LLMService } from '../../llm/llm.service.js'
import { PrismaService } from '../../prisma/prisma.service.js'
import { createHybridArticleRetrievalRuntime } from '../../retrieval/hybrid-article-retrieval.runtime.js'
import { PrismaArticleRetriever } from '../../retrieval/prisma-article-retriever.js'
import { buildSeoAgentChatMessages } from '../../seo/prompts/seo-agent.prompt.js'
import {
  getArticleDetailDefinition,
  GetArticleDetailTool,
} from '../../tools/articles/get-article-detail.tool.js'
import {
  searchArticlesDefinition,
  SearchArticlesTool,
} from '../../tools/articles/search-articles.tool.js'
import { ToolInvocationService } from '../../tools/core/tool-invocation.service.js'
import { ToolRegistryService } from '../../tools/core/tool-registry.service.js'
import {
  retrieveArticleContextDefinition,
  RetrieveArticleContextTool,
} from '../../tools/retrieval/retrieve-article-context.tool.js'
import { AgentRunRecorderService } from '../agent-run-recorder.service.js'
import { AgentRuntimeService } from '../agent-runtime.service.js'
import { DeepSeekV4TokenEstimator } from '../deepseek-v4-token-estimator.js'
import { InitialContextSelectionService } from '../initial-context-selection.js'
import { SamplingContextPlanner } from '../sampling-context-planner.js'

/**
 * Grounded Answer 端到端 smoke。
 *
 * 使用真实 DeepSeek + 真实 Gemini Embedding + 隔离 pgvector 数据，覆盖
 * answered 与 insufficient 两条路径。
 *
 * 输出边界：只允许打印脱敏状态、计数、source / chunk 引用和耗时。
 * 绝不打印 API Key、Prompt、reasoning、raw Observation、完整正文、
 * embedding、distance 或 Provider payload。
 */

/**
 * 默认 query 必须指向站内知识库真实覆盖 / 真实不覆盖的内容。
 *
 * 两点约束来自真实模型行为，不是为了让 smoke 好看：
 * 1. 通用 SEO 方法论问题会被 Agent 直接回答（不调用 evidence-eligible Tool），
 *    那是正确的普通回答路径，但验证不到 Grounded finalization；
 * 2. 当前 Agent Loop 只接受同轮单个 Tool Call（Phase 6 既有协议约束），而
 *    DeepSeek 对开放式检索问题经常并行返回多个 Tool Call，因此 query 需要
 *    明确要求「只做一次语义检索」。
 */
const DEFAULT_ANSWERABLE_QUERY = '只用语义检索一次站内文章，回答 Wuthering Waves 的 soft pity 是什么'
const DEFAULT_UNANSWERABLE_QUERY = '只用语义检索一次站内文章，回答《原神》2019 年封闭内测的服务器维护公告写了什么'

/** 只包含可以安全打印的字段。 */
interface GroundedAnswerSmokeCase {
  scenario: 'answerable' | 'unanswerable'
  queryChars: number
  runOutcome: AgentRuntimeEvent['type']
  /** Runtime 已经脱敏的失败文案；不含 Provider payload、Prompt 或 stack。 */
  failureMessage?: string
  /** 本轮是否真的调用了 evidence-eligible Tool 并建立 Grounding Session。 */
  groundingSessionEstablished: boolean
  answerChars: number
  grounding: {
    present: boolean
    schemaVersion?: number
    evidenceAvailability?: MessageGroundingV1['evidenceAvailability']
    outcome?: MessageGroundingV1['outcome']
    citationIntegrity?: MessageGroundingV1['citationIntegrity']
    faithfulnessStatus?: MessageGroundingV1['faithfulnessStatus']
    citationCount?: number
    sourceIds?: number[]
    chunkIds?: (string | null)[]
    granularities?: MessageGroundingV1['citations'][number]['granularity'][]
  }
  deltaCount: number
  replayMatchesFinalContent: boolean
  elapsedMs: number
}

export interface GroundedAnswerSmokeSummary {
  tool: 'submit_grounded_answer@1'
  cases: GroundedAnswerSmokeCase[]
}

export async function executeGroundedAnswerSmoke(
  signal: AbortSignal,
  env: NodeJS.ProcessEnv = process.env,
): Promise<GroundedAnswerSmokeSummary> {
  signal.throwIfAborted()

  const retrievalRuntime = createHybridArticleRetrievalRuntime(env)
  const prisma = new PrismaService(env.DATABASE_URL)
  const registry = new ToolRegistryService()

  registry.register({
    definition: searchArticlesDefinition,
    executor: new SearchArticlesTool(new PrismaArticleRetriever(prisma)),
  })
  registry.register({
    definition: getArticleDetailDefinition,
    executor: new GetArticleDetailTool(prisma),
  })
  registry.register({
    definition: retrieveArticleContextDefinition,
    executor: new RetrieveArticleContextTool(retrievalRuntime.retriever),
  })

  const tokenEstimator = new DeepSeekV4TokenEstimator()
  const runtimeConfigService = new LLMRuntimeConfigService()
  const runtime = new AgentRuntimeService(
    new LLMService(
      new OpenAICompatibleClient(runtimeConfigService),
      runtimeConfigService,
    ),
    prisma,
    new AgentRunRecorderService(prisma),
    registry,
    new ToolInvocationService(registry),
    {
      value: {
        historyCandidateBatchSize: 50,
        historyCandidateHardLimit: 1_000,
        maxSamplingRounds: 4,
        maxToolCalls: 2,
        runDeadlineMs: 300_000,
      },
    },
    new InitialContextSelectionService(tokenEstimator),
    new SamplingContextPlanner(tokenEstimator),
  )

  try {
    await prisma.$connect()

    const cases: GroundedAnswerSmokeCase[] = []

    for (const scenario of ['answerable', 'unanswerable'] as const) {
      signal.throwIfAborted()
      cases.push(await runSmokeCase(runtime, prisma, signal, scenario, env))
    }

    return { tool: 'submit_grounded_answer@1', cases }
  }
  finally {
    await retrievalRuntime.close()
    await prisma.$disconnect()
  }
}

async function runSmokeCase(
  runtime: AgentRuntimeService,
  prisma: PrismaService,
  signal: AbortSignal,
  scenario: 'answerable' | 'unanswerable',
  env: NodeJS.ProcessEnv,
): Promise<GroundedAnswerSmokeCase> {
  const query = scenario === 'answerable'
    ? env.GROUNDED_ANSWER_SMOKE_ANSWERABLE_QUERY?.trim() || DEFAULT_ANSWERABLE_QUERY
    : env.GROUNDED_ANSWER_SMOKE_UNANSWERABLE_QUERY?.trim() || DEFAULT_UNANSWERABLE_QUERY
  const conversation = await prisma.conversation.create({
    data: { title: `grounded answer smoke ${scenario}` },
  })
  const startedAt = performance.now()
  const deltas: string[] = []
  let terminal: AgentRuntimeEvent | undefined
  let runId: string | undefined
  let groundingSessionEstablished = false

  try {
    for await (const event of runtime.runTurnStream({
      conversationId: conversation.id,
      userContent: query,
      temperature: 0.2,
      signal,
      buildModelMessages: buildSeoAgentChatMessages,
    })) {
      if (event.type === 'assistant_delta') {
        deltas.push(event.contentDelta)
        continue
      }

      if (event.type === 'run_started') {
        runId = event.runId
        continue
      }

      terminal = event
    }

    if (runId) {
      // 只读 Step type 判断是否走过 finalization，不读取任何 Step 输出内容。
      groundingSessionEstablished = await prisma.agentStep.count({
        where: { runId, type: 'grounded_finalization' },
      }) > 0
    }
  }
  finally {
    // smoke 只验证行为，不在隔离库里留下会话数据。
    await prisma.conversation.delete({ where: { id: conversation.id } })
  }

  const elapsedMs = Math.max(0, Math.round(performance.now() - startedAt))
  const grounding = terminal?.type === 'run_completed'
    ? terminal.grounding
    : undefined
  const finalContent = terminal?.type === 'run_completed' ? terminal.content : ''

  return {
    scenario,
    queryChars: [...query].length,
    runOutcome: terminal?.type ?? 'run_failed',
    // Runtime 的失败文案本身已经是固定安全文案，不含 Provider 细节。
    ...(terminal?.type === 'run_failed'
      ? { failureMessage: terminal.message }
      : {}),
    groundingSessionEstablished,
    answerChars: [...finalContent].length,
    grounding: grounding
      ? {
          present: true,
          schemaVersion: grounding.schemaVersion,
          evidenceAvailability: grounding.evidenceAvailability,
          outcome: grounding.outcome,
          citationIntegrity: grounding.citationIntegrity,
          faithfulnessStatus: grounding.faithfulnessStatus,
          citationCount: grounding.citations.length,
          sourceIds: grounding.citations.map(citation => citation.sourceId),
          chunkIds: grounding.citations.map(citation => citation.chunkId),
          granularities: grounding.citations.map(citation => citation.granularity),
        }
      : { present: false },
    deltaCount: deltas.length,
    replayMatchesFinalContent: deltas.join('') === finalContent,
    elapsedMs,
  }
}

export function safeSmokeFailure(error: unknown): {
  error: string
  message: string
} {
  return {
    error: error instanceof Error && error.name === 'AbortError'
      ? 'grounded_answer_smoke_aborted'
      : 'grounded_answer_smoke_failed',
    message: 'grounded answer smoke 失败',
  }
}

async function main(): Promise<void> {
  const abortController = new AbortController()
  const abort = (): void => abortController.abort(
    new DOMException('grounded answer smoke aborted', 'AbortError'),
  )

  process.once('SIGINT', abort)
  process.once('SIGTERM', abort)

  try {
    // smoke 会真实写入会话与 Run，只允许连隔离数据库。
    const connectionString = process.env.ARTICLE_INDEX_TEST_DATABASE_URL?.trim()

    if (!connectionString) {
      throw new Error(
        'ARTICLE_INDEX_TEST_DATABASE_URL 未配置，grounded answer smoke 只允许使用隔离数据库',
      )
    }

    if (connectionString === process.env.DATABASE_URL?.trim()) {
      throw new Error(
        'ARTICLE_INDEX_TEST_DATABASE_URL 不得与 DATABASE_URL 相同',
      )
    }

    const summary = await executeGroundedAnswerSmoke(
      abortController.signal,
      { ...process.env, DATABASE_URL: connectionString },
    )

    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  }
  catch (error) {
    process.stderr.write(`${JSON.stringify(safeSmokeFailure(error))}\n`)
    process.exitCode = 1
  }
  finally {
    process.removeListener('SIGINT', abort)
    process.removeListener('SIGTERM', abort)
  }
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href)
  void main()
