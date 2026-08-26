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
import { PrismaArticleRetriever } from '../../retrieval/retrievers/prisma-article-retriever.js'
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
import { AgentRuntimeService } from '../agent-runtime.service.js'
import { AgentRunConfigurationService } from '../configuration/agent-run-configuration.service.js'
import { DeepSeekV4TokenEstimator } from '../context/deepseek-v4-token-estimator.js'
import { InitialContextSelectionService } from '../context/initial-context-selection.js'
import { SamplingContextPlanner } from '../context/sampling-context-planner.js'
import { AgentRunRecorderService } from '../lifecycle/agent-run-recorder.service.js'

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
  const llmService = new LLMService(
    new OpenAICompatibleClient(runtimeConfigService),
    runtimeConfigService,
  )
  const runtime = new AgentRuntimeService(
    llmService,
    prisma,
    new AgentRunRecorderService(prisma),
    new ToolInvocationService(registry),
    new AgentRunConfigurationService(
      {
        value: {
          historyCandidateBatchSize: 50,
          historyCandidateHardLimit: 1_000,
          maxSamplingRounds: 4,
          maxToolCalls: 2,
          runDeadlineMs: 300_000,
        },
      },
      llmService,
      registry,
    ),
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
      reasoningEffort: 'high',
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

/**
 * 输出里绝不允许出现的内容。
 *
 * 这是最后一道防线：即便上游投影出错，也不能把 Key、Prompt、reasoning、
 * 向量、距离或 SQL 打到标准输出上。
 */
const FORBIDDEN_OUTPUT_PATTERNS: ReadonlyArray<[string, RegExp]> = [
  ['apiKey', /\bsk-[A-Z0-9]/i],
  ['citationKey', /evk_/],
  ['prompt', /untrusted_data:|submit_grounded_answer@1 提交/],
  ['reasoning', /reasoning/i],
  ['embedding', /embedding|cosineDistance/i],
  ['sql', /\bSELECT\b|\bINSERT\b/],
  ['connectionString', /postgresql:\/\//],
]

/** smoke 未达到预期结果；用于让命令 exit 1，而不是打印一份好看的失败摘要。 */
export class GroundedAnswerSmokeAssertionError extends Error {
  constructor(readonly violations: string[]) {
    super('grounded answer smoke 未达到预期结果')
    this.name = 'GroundedAnswerSmokeAssertionError'
  }
}

/**
 * 对脱敏 summary 执行结构断言。
 *
 * 只依赖状态、枚举和计数，不依赖任何回答正文，因此既能当门禁，又不会因为
 * 模型措辞变化而误报。
 *
 * @throws GroundedAnswerSmokeAssertionError 任一预期不满足。
 */
export function assertGroundedAnswerSmoke(
  summary: GroundedAnswerSmokeSummary,
): void {
  const violations: string[] = []
  const scenarios = summary.cases.map(item => item.scenario)

  for (const scenario of ['answerable', 'unanswerable'] as const) {
    if (!scenarios.includes(scenario))
      violations.push(`缺少 ${scenario} 场景`)
  }

  for (const item of summary.cases) {
    const at = `[${item.scenario}]`

    if (item.runOutcome !== 'run_completed') {
      violations.push(`${at} runOutcome=${item.runOutcome}，期望 run_completed`)
      continue
    }

    if (!item.groundingSessionEstablished)
      violations.push(`${at} 未建立 Grounding Session`)

    if (!item.replayMatchesFinalContent)
      violations.push(`${at} delta 重放结果与最终内容不一致`)

    if (!item.grounding.present) {
      violations.push(`${at} 缺少 Grounding`)
      continue
    }

    if (item.grounding.schemaVersion !== 1)
      violations.push(`${at} schemaVersion=${item.grounding.schemaVersion}`)

    if (item.grounding.citationIntegrity !== 'validated')
      violations.push(`${at} citationIntegrity=${item.grounding.citationIntegrity}`)

    if (item.grounding.faithfulnessStatus !== 'not_evaluated')
      violations.push(`${at} faithfulnessStatus=${item.grounding.faithfulnessStatus}`)

    const citationCount = item.grounding.citationCount ?? 0

    if (item.scenario === 'answerable') {
      if (item.grounding.outcome !== 'answered')
        violations.push(`${at} outcome=${item.grounding.outcome}，期望 answered`)
      if (citationCount < 1)
        violations.push(`${at} answered 但没有有效 Citation`)
      if (item.grounding.sourceIds?.some(sourceId => !Number.isSafeInteger(sourceId) || sourceId <= 0))
        violations.push(`${at} Citation 的 sourceId 非法`)
    }

    if (item.scenario === 'unanswerable') {
      if (item.grounding.outcome !== 'insufficient_evidence') {
        violations.push(
          `${at} outcome=${item.grounding.outcome}，期望 insufficient_evidence`,
        )
      }
    }
  }

  const serialized = JSON.stringify(summary)

  for (const [name, pattern] of FORBIDDEN_OUTPUT_PATTERNS) {
    if (pattern.test(serialized))
      violations.push(`输出包含不允许的敏感内容：${name}`)
  }

  if (violations.length > 0)
    throw new GroundedAnswerSmokeAssertionError(violations)
}

export function safeSmokeFailure(error: unknown): {
  error: string
  message: string
  violations?: string[]
} {
  if (error instanceof GroundedAnswerSmokeAssertionError) {
    return {
      error: 'grounded_answer_smoke_assertion_failed',
      message: 'grounded answer smoke 未达到预期结果',
      // violations 只包含场景名、枚举值和计数，本身已经是脱敏文本。
      violations: error.violations,
    }
  }

  return {
    error: error instanceof Error && error.name === 'AbortError'
      ? 'grounded_answer_smoke_aborted'
      : 'grounded_answer_smoke_failed',
    message: 'grounded answer smoke 失败',
  }
}

/** 与真实进程解耦的输出面，便于直接断言「什么被写到了哪个流」。 */
export interface SmokeOutputSink {
  stdout: (line: string) => void
  stderr: (line: string) => void
}

/**
 * 断言并输出 smoke 结果。
 *
 * 顺序是安全要求而不是风格问题：**必须先断言、后输出**。
 * summary 一旦被判定不安全（例如混入 citationKey、API Key、连接串、SQL、
 * Prompt 标记或 reasoning），就绝不能先写进 stdout / 日志，只允许输出
 * `safeSmokeFailure()` 的脱敏结果。
 *
 * @returns 进程退出码：0 表示全部达标，1 表示未达标。
 */
export function emitGroundedAnswerSmokeResult(
  summary: GroundedAnswerSmokeSummary,
  output: SmokeOutputSink,
): number {
  try {
    // 断言在前：不安全或不达标的 summary 一个字节都不会进入 stdout。
    assertGroundedAnswerSmoke(summary)
  }
  catch (error) {
    output.stderr(`${JSON.stringify(safeSmokeFailure(error))}\n`)

    return 1
  }

  output.stdout(`${JSON.stringify(summary, null, 2)}\n`)

  return 0
}

/**
 * 运行 smoke 并输出结果。
 *
 * @returns 进程退出码：0 表示全部达标，1 表示未达标或执行失败。
 */
export async function runGroundedAnswerSmokeCli(
  signal: AbortSignal,
  output: SmokeOutputSink,
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  try {
    // smoke 会真实写入会话与 Run，只允许连隔离数据库。
    const connectionString = env.ARTICLE_INDEX_TEST_DATABASE_URL?.trim()

    if (!connectionString) {
      throw new Error(
        'ARTICLE_INDEX_TEST_DATABASE_URL 未配置，grounded answer smoke 只允许使用隔离数据库',
      )
    }

    if (connectionString === env.DATABASE_URL?.trim()) {
      throw new Error(
        'ARTICLE_INDEX_TEST_DATABASE_URL 不得与 DATABASE_URL 相同',
      )
    }

    const summary = await executeGroundedAnswerSmoke(
      signal,
      { ...env, DATABASE_URL: connectionString },
    )

    return emitGroundedAnswerSmokeResult(summary, output)
  }
  catch (error) {
    output.stderr(`${JSON.stringify(safeSmokeFailure(error))}\n`)

    return 1
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
    process.exitCode = await runGroundedAnswerSmokeCli(
      abortController.signal,
      {
        stdout: line => process.stdout.write(line),
        stderr: line => process.stderr.write(line),
      },
    )
  }
  finally {
    process.removeListener('SIGINT', abort)
    process.removeListener('SIGTERM', abort)
  }
}

const entrypoint = process.argv[1]
if (entrypoint && import.meta.url === pathToFileURL(entrypoint).href)
  void main()
