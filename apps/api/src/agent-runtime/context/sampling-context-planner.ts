import type { ModelInputItem } from '../../llm/model-input.types.js'
import type { ModelToolSpec } from '../../llm/model-tool-spec.types.js'
import type { NormalizedToolObservation } from '../../tools/core/tool-observation.js'
import type {
  ModelContext,
  ModelContextPlanningState,
  ModelContextToolExchange,
} from './model-context.js'
import { Inject, Injectable } from '@nestjs/common'

import { ContextBudgetExceededError } from '../agent-runtime.errors.js'
import { TokenEstimator } from './deepseek-v4-token-estimator.js'
import { flattenPlanningState } from './model-context.js'

export interface SamplingContextObservationSummary {
  exchangeIndex: number
  originalChars: number
  toolCeilingChars: number
  finalChars: number
  toolCeilingTruncated: boolean
  contextBudgetTruncated: boolean
}

export interface SamplingContextPlanSummary {
  samplingIndex: number
  resolvedInputBudgetTokens: number
  estimatedInputTokens: number
  historyCandidateCount: number
  historyIncludedCount: number
  historyExcludedCount: number
  toolExchangeCount: number
  observations: SamplingContextObservationSummary[]
  overflowReason: 'minimum_context' | null
  estimatorStrategyId: string
}

export interface SamplingContextPlan {
  items: ModelInputItem[]
  summary: SamplingContextPlanSummary
}

export class SamplingContextBudgetExceededError
  extends ContextBudgetExceededError {
  constructor(readonly summary: SamplingContextPlanSummary) {
    super('sampling_context')
    this.name = 'SamplingContextBudgetExceededError'
  }
}

interface PlanSamplingContextInput {
  samplingIndex: number
  context: ModelContext
  tools: ModelToolSpec[]
  resolvedInputBudgetTokens: number
}

@Injectable()
export class SamplingContextPlanner {
  constructor(
    @Inject(TokenEstimator)
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
    // 核心执行状态：本轮 Planner 决定从最旧处删除多少条 initialHistory；
    // 只有整份计划通过预算后，commitPlan() 才会把该数量正式应用回 ModelContext。
    let excludedOldestHistoryCount = 0
    // 第一次真正计算当前工作副本的完整输入 Token；
    // 后续每次删除历史或缩短 Tool Result 后都会重新赋值。
    let estimatedInputTokens = estimate()

    // 第一层降级：初次估算超预算时，先从最旧历史开始删减，
    // 并用修改后的 state 重新计算 Token；未超预算则保持 0 条删除。
    if (estimatedInputTokens > input.resolvedInputBudgetTokens) {
      excludedOldestHistoryCount = excludeOldestHistory(
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
        this.tokenEstimator.strategyId,
      ))
    }

    const items = flattenPlanningState(state)

    // 到这里为止，删历史和缩 Tool Result 都只发生在工作副本 state 上。
    // 预算已确认通过，现在才把有效缩减正式同步回当前 Run 的原内存
    // ModelContext，供后续 Sampling 继续使用；不会删除或修改数据库 Message。
    input.context.commitPlan({
      // 从原 ModelContext.initialHistory 开头永久移除的最旧历史条数。
      excludedOldestHistoryCount,
      // 按 exchangeIndex 把工作副本中最终的 Tool Result 文本与预览长度同步回去。
      observations: state.toolExchanges.map(exchange => ({
        exchangeIndex: exchange.exchangeIndex,
        content: exchange.toolResult.content,
        contextBudgetPreviewChars: exchange.contextBudgetPreviewChars,
      })),
    })

    return {
      // 核心返回值：已通过 Token 预算检查，本轮真正准备传给模型的输入项。
      items,
      // 纯后台观测：记录本轮预算、最终 Token、历史排除和 Tool Observation
      // 截断结果，供 model_sampling Step / Admin Inspector 展示；不参与模型输入。
      summary: toPlanSummary(
        // 提供本轮 samplingIndex 和 resolvedInputBudgetTokens。
        input,
        // 已完成历史删减与 Tool Result 缩短的最终工作副本。
        state,
        // 最后一次重新估算得到的完整输入 Token。
        estimatedInputTokens,
        // null 表示本次规划成功，没有 minimum_context 溢出。
        null,
        // 记录本轮使用的 Tokenizer / 请求编码策略版本。
        this.tokenEstimator.strategyId,
      ),
    }
  }
}

function toPlanSummary(
  input: PlanSamplingContextInput,
  state: ModelContextPlanningState,
  estimatedInputTokens: number,
  overflowReason: SamplingContextPlanSummary['overflowReason'],
  estimatorStrategyId: string,
): SamplingContextPlanSummary {
  return {
    samplingIndex: input.samplingIndex,
    resolvedInputBudgetTokens: input.resolvedInputBudgetTokens,
    estimatedInputTokens,
    historyCandidateCount: state.initialHistoryCandidateCount,
    historyIncludedCount: state.initialHistory.length,
    historyExcludedCount:
      state.initialHistoryCandidateCount - state.initialHistory.length,
    toolExchangeCount: state.toolExchanges.length,
    observations: state.toolExchanges.map(toObservationSummary),
    overflowReason,
    estimatorStrategyId,
  }
}

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
    const excludedCount = Math.floor((lower + upper) / 2)

    state.initialHistory = history.slice(excludedCount)

    if (estimate() <= budget)
      upper = excludedCount
    else
      lower = excludedCount + 1
  }

  state.initialHistory = history.slice(lower)

  return lower
}

function shrinkObservations(
  state: ModelContextPlanningState,
  estimate: () => number,
  budget: number,
): void {
  for (const exchange of state.toolExchanges) {
    const sourceCodePoints = Array.from(
      exchange.observation.previewContent ?? exchange.observation.content,
    )
    const currentPreviewChars = Math.min(
      exchange.contextBudgetPreviewChars ?? sourceCodePoints.length,
      maxContextBudgetPreviewChars(exchange.observation),
    )
    const previousContent = exchange.toolResult.content
    const previousPreviewChars = exchange.contextBudgetPreviewChars
    const previousTokens = estimate()

    setContextBudgetPreview(exchange, sourceCodePoints, 0)
    const minimumTokens = estimate()

    if (minimumTokens >= previousTokens) {
      exchange.toolResult.content = previousContent
      exchange.contextBudgetPreviewChars = previousPreviewChars
      continue
    }

    if (minimumTokens > budget)
      continue

    const previewChars = findLargestFittingPreview(
      exchange,
      sourceCodePoints,
      currentPreviewChars,
      estimate,
      budget,
    )

    setContextBudgetPreview(exchange, sourceCodePoints, previewChars)
    return
  }
}

function findLargestFittingPreview(
  exchange: ModelContextToolExchange,
  sourceCodePoints: string[],
  currentPreviewChars: number,
  estimate: () => number,
  budget: number,
): number {
  let lower = 0
  let upper = Math.max(0, currentPreviewChars - 1)

  while (lower < upper) {
    const previewChars = Math.ceil((lower + upper) / 2)

    setContextBudgetPreview(exchange, sourceCodePoints, previewChars)

    if (estimate() <= budget)
      lower = previewChars
    else
      upper = previewChars - 1
  }

  return lower
}

function setContextBudgetPreview(
  exchange: ModelContextToolExchange,
  sourceCodePoints: string[],
  previewChars: number,
): void {
  const boundedPreviewChars = Math.min(
    previewChars,
    maxContextBudgetPreviewChars(exchange.observation),
  )

  exchange.contextBudgetPreviewChars = boundedPreviewChars
  exchange.toolResult.content = renderContextBudgetObservation(
    exchange.observation,
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
  exchange: ModelContextToolExchange,
): SamplingContextObservationSummary {
  return {
    exchangeIndex: exchange.exchangeIndex,
    originalChars: exchange.observation.originalChars,
    toolCeilingChars: exchange.observation.observationChars,
    finalChars: Array.from(exchange.toolResult.content).length,
    toolCeilingTruncated: exchange.observation.truncated,
    contextBudgetTruncated: exchange.contextBudgetPreviewChars !== null,
  }
}
