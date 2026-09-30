import type {
  ModelInputItem,
  ModelToolSpec,
} from '@agent/ai'
import type { NormalizedToolObservation } from '../../tools/core/tool-observation.js'
import type {
  ModelContext,
  ModelContextPlanningState,
  ModelContextToolResult,
} from './model-context.js'
import type { TokenEstimator } from './token-estimate.js'

import { Inject, Injectable } from '@nestjs/common'
import { ContextBudgetExceededError } from '../agent-runtime.errors.js'
import { countHistoryMessages, flattenPlanningState } from './model-context.js'
import { RoughTokenEstimator } from './token-estimate.js'

export interface SamplingContextObservationSummary {
  exchangeIndex: number
  /** 该轮 assistant 消息里第几个 call 的结果，与 calls[] / tool_result 顺序一致。 */
  resultIndex: number
  originalChars: number
  toolCeilingChars: number
  finalChars: number
  toolCeilingTruncated: boolean
  contextBudgetTruncated: boolean
}

export interface SamplingContextPlanSummary {
  resolvedInputBudgetTokens: number
  estimatedInputTokens: number
  historyCandidateCount: number
  historyIncludedCount: number
  historyExcludedCount: number
  observations: SamplingContextObservationSummary[]
  overflowReason: 'minimum_context' | null
}

export interface SamplingContextPlan {
  items: ModelInputItem[]
  summary: SamplingContextPlanSummary
}

export class SamplingContextBudgetExceededError
  extends ContextBudgetExceededError {
  constructor(readonly summary: SamplingContextPlanSummary) {
    super()
    this.name = 'SamplingContextBudgetExceededError'
  }
}

interface PlanSamplingContextInput {
  context: ModelContext
  tools: ModelToolSpec[]
  resolvedInputBudgetTokens: number
}

@Injectable()
export class SamplingContextPlanner {
  constructor(
    @Inject(RoughTokenEstimator)
    private readonly tokenEstimator: TokenEstimator,
  ) {}

  plan(input: PlanSamplingContextInput): SamplingContextPlan {
    const state = input.context.forPlanning()
    // 每次调用都从当前工作副本 state 重新组装完整模型输入，因此删除历史
    // 或缩短 Tool Result 后再调用，会得到调整后的 Token 数。计算范围包含：
    // instructions + initialHistory + currentUser + 已发生的 Tool Call / Tool Result
    // + 工具定义 + DeepSeek 请求格式标记；不包含纯后台观测字段。
    const estimate = (): number => this.tokenEstimator.estimateRequest({
      items: flattenPlanningState(state),
      tools: input.tools,
    })
    // 核心执行状态：本轮 Planner 决定从最旧处删除几次问答（整组删，调用与结果不会被拆开）；
    // 只有整份计划通过预算后，commitPlan() 才会把该数量正式应用回 ModelContext。
    let excludedOldestHistoryGroups = 0
    // 同一次问答内有上一次采样的真实用量时，估算 = 用量 + 之后新增的工具结果粗估；否则整份粗估。
    // 后续每次删除历史或缩短 Tool Result 后都按整份重新估算。
    let estimatedInputTokens = input.context.estimateFromUsageAnchor() ?? estimate()

    // 第一层降级：初次估算超预算时，先从最旧历史开始删减，
    // 并用修改后的 state 重新计算 Token；未超预算则保持 0 条删除。
    if (estimatedInputTokens > input.resolvedInputBudgetTokens) {
      excludedOldestHistoryGroups = excludeOldestHistory(
        state,
        estimate,
        input.resolvedInputBudgetTokens,
      )
      estimatedInputTokens = estimate()
    }

    // 第二层降级：能走到这个条件，表示初始历史本来就是空的，
    // 或 excludeOldestHistory() 已经删完全部 initialHistory，但完整输入仍超预算。
    // 此时已没有历史可继续删除，只能缩短 Tool Observation 后再次重算 Token走下面的 if 逻辑
    if (estimatedInputTokens > input.resolvedInputBudgetTokens) {
      shrinkObservations(
        state,
        estimate,
        input.resolvedInputBudgetTokens,
      )
      estimatedInputTokens = estimate()
    }

    // 两层降级后仍超预算，说明最小安全 Context 也放不下，禁止调用模型。
    if (estimatedInputTokens > input.resolvedInputBudgetTokens) {
      throw new SamplingContextBudgetExceededError(toPlanSummary(
        input,
        state,
        estimatedInputTokens,
        'minimum_context',
      ))
    }

    const items = flattenPlanningState(state)

    // 到这里为止，删历史和缩 Tool Result 都只发生在工作副本 state 上。
    // 预算已确认通过，现在才把有效缩减正式同步回当前 Run 的原内存
    // ModelContext，供后续 Sampling 继续使用；不会删除或修改数据库 Message。
    input.context.commitPlan({
      // 从原 ModelContext.initialHistory 开头永久移除的最旧问答组数。
      excludedOldestHistoryGroups,
      // 按 exchangeIndex / resultIndex 把工作副本中最终的 Tool Result 文本与预览长度同步回去。
      observations: state.toolExchanges.flatMap(exchange =>
        exchange.results.map((result, resultIndex) => ({
          exchangeIndex: exchange.exchangeIndex,
          resultIndex,
          content: result.toolResult.content,
          contextBudgetPreviewChars: result.contextBudgetPreviewChars,
        }))),
    })

    return {
      // 核心返回值：已通过 Token 预算检查，本轮真正准备传给模型的输入项。
      items,
      // 规划结果统计，不参与模型输入：runtime 只把其中一部分写入 model_sampling Step，
      // 落哪些字段以 agent-runtime.service.ts 的 toPersistedContextPlan 为准，其余只在内存。
      summary: toPlanSummary(
        // 提供本轮 resolvedInputBudgetTokens。
        input,
        // 已完成历史删减与 Tool Result 缩短的最终工作副本。
        state,
        // 最后一次重新估算得到的完整输入 Token。
        estimatedInputTokens,
        // null 表示本次规划成功，没有 minimum_context 溢出。
        null,
      ),
    }
  }
}

function toPlanSummary(
  input: PlanSamplingContextInput,
  state: ModelContextPlanningState,
  estimatedInputTokens: number,
  overflowReason: SamplingContextPlanSummary['overflowReason'],
): SamplingContextPlanSummary {
  // 按 Message 条数记：保留的是最新的若干次完整问答，按条数与 tool Step 即可还原当时的历史。
  const historyIncludedCount = countHistoryMessages(state.initialHistory)

  return {
    resolvedInputBudgetTokens: input.resolvedInputBudgetTokens,
    estimatedInputTokens,
    historyCandidateCount: state.initialHistoryCandidateCount,
    historyIncludedCount,
    historyExcludedCount:
      state.initialHistoryCandidateCount - historyIncludedCount,
    observations: state.toolExchanges.flatMap(exchange =>
      exchange.results.map((result, resultIndex) =>
        toObservationSummary(exchange.exchangeIndex, resultIndex, result))),
    overflowReason,
  }
}

/** 二分出最少要从最旧处删掉几次问答：单位是组，保留部分总从一次完整问答开始，不会只剩结果或只剩调用。 */
function excludeOldestHistory(
  state: ModelContextPlanningState,
  estimate: () => number,
  budget: number,
): number {
  const history = state.initialHistory

  if (history.length === 0)
    return 0

  state.initialHistory = []

  if (estimate() > budget)
    return history.length

  let lower = 1
  let upper = history.length

  while (lower < upper) {
    const excludedGroups = Math.floor((lower + upper) / 2)

    state.initialHistory = history.slice(excludedGroups)

    if (estimate() <= budget)
      upper = excludedGroups
    else
      lower = excludedGroups + 1
  }

  state.initialHistory = history.slice(lower)

  return lower
}

function shrinkObservations(
  state: ModelContextPlanningState,
  estimate: () => number,
  budget: number,
): void {
  // 从最旧一轮的第一个 call 开始，逐个 Tool Result 尝试缩短。
  for (const result of state.toolExchanges.flatMap(exchange => exchange.results)) {
    // 已缩到 0 的再缩也不会更短，结果与不跳过相同：省掉两次整份输入的估算。工具调用不限次数（#218）后结果可能很多，
    // 不跳过的话每轮 plan() 的估算次数随结果数增长。
    if (result.contextBudgetPreviewChars === 0)
      continue

    const sourceCodePoints = Array.from(
      result.observation.previewContent ?? result.observation.content,
    )
    const currentPreviewChars = Math.min(
      result.contextBudgetPreviewChars ?? sourceCodePoints.length,
      maxContextBudgetPreviewChars(result.observation),
    )
    const previousContent = result.toolResult.content
    const previousPreviewChars = result.contextBudgetPreviewChars
    const previousTokens = estimate()

    setContextBudgetPreview(result, sourceCodePoints, 0)
    const minimumTokens = estimate()

    if (minimumTokens >= previousTokens) {
      result.toolResult.content = previousContent
      result.contextBudgetPreviewChars = previousPreviewChars
      continue
    }

    if (minimumTokens > budget)
      continue

    const previewChars = findLargestFittingPreview(
      result,
      sourceCodePoints,
      currentPreviewChars,
      estimate,
      budget,
    )

    setContextBudgetPreview(result, sourceCodePoints, previewChars)
    return
  }
}

function findLargestFittingPreview(
  result: ModelContextToolResult,
  sourceCodePoints: string[],
  currentPreviewChars: number,
  estimate: () => number,
  budget: number,
): number {
  let lower = 0
  let upper = Math.max(0, currentPreviewChars - 1)

  while (lower < upper) {
    const previewChars = Math.ceil((lower + upper) / 2)

    setContextBudgetPreview(result, sourceCodePoints, previewChars)

    if (estimate() <= budget)
      lower = previewChars
    else
      upper = previewChars - 1
  }

  return lower
}

function setContextBudgetPreview(
  result: ModelContextToolResult,
  sourceCodePoints: string[],
  previewChars: number,
): void {
  const boundedPreviewChars = Math.min(
    previewChars,
    maxContextBudgetPreviewChars(result.observation),
  )

  result.contextBudgetPreviewChars = boundedPreviewChars
  result.toolResult.content = renderContextBudgetObservation(
    result.observation,
    sourceCodePoints.slice(0, boundedPreviewChars).join(''),
  )
}

function renderContextBudgetObservation(
  observation: NormalizedToolObservation,
  preview: string,
): string {
  const { prefix, suffix } = contextBudgetEnvelope(observation)

  return `${prefix}${preview}${suffix}`
}

function maxContextBudgetPreviewChars(
  observation: NormalizedToolObservation,
): number {
  const { prefix, suffix } = contextBudgetEnvelope(observation)

  return Math.max(
    0,
    observation.observationChars - Array.from(prefix + suffix).length,
  )
}

function contextBudgetEnvelope(observation: NormalizedToolObservation): {
  prefix: string
  suffix: string
} {
  const prefix = '[工具 Observation 已因 context_budget 缩减；'
    + `tool_ceiling=${observation.truncated}; `
    + `source_chars=${observation.observationChars}]\n`

  return { prefix, suffix: '\n[context_budget 预览结束]' }
}

function toObservationSummary(
  exchangeIndex: number,
  resultIndex: number,
  result: ModelContextToolResult,
): SamplingContextObservationSummary {
  return {
    exchangeIndex,
    resultIndex,
    originalChars: result.observation.originalChars,
    toolCeilingChars: result.observation.observationChars,
    finalChars: Array.from(result.toolResult.content).length,
    toolCeilingTruncated: result.observation.truncated,
    contextBudgetTruncated: result.contextBudgetPreviewChars !== null,
  }
}
