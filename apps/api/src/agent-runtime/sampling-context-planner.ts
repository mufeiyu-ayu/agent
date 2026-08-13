import type { ModelInputItem } from '../llm/model-input.types.js'
import type { ModelToolSpec } from '../llm/model-tool-spec.types.js'
import type { NormalizedToolObservation } from '../tools/core/tool-observation.js'
import type {
  ModelContext,
  ModelContextPlanningState,
  ModelContextToolExchange,
} from './model-context.js'
import { Inject, Injectable } from '@nestjs/common'

import { ContextBudgetExceededError } from './agent-runtime.errors.js'
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
    const estimate = (): number => this.tokenEstimator.estimateRequest({
      items: flattenPlanningState(state),
      tools: input.tools,
    })
    let excludedOldestHistoryCount = 0
    let estimatedInputTokens = estimate()

    if (estimatedInputTokens > input.resolvedInputBudgetTokens) {
      excludedOldestHistoryCount = excludeOldestHistory(
        state,
        estimate,
        input.resolvedInputBudgetTokens,
      )
      estimatedInputTokens = estimate()
    }

    if (estimatedInputTokens > input.resolvedInputBudgetTokens) {
      shrinkObservations(
        state,
        estimate,
        input.resolvedInputBudgetTokens,
      )
      estimatedInputTokens = estimate()
    }

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

    input.context.commitPlan({
      excludedOldestHistoryCount,
      observations: state.toolExchanges.map(exchange => ({
        exchangeIndex: exchange.exchangeIndex,
        content: exchange.toolResult.content,
        contextBudgetPreviewChars: exchange.contextBudgetPreviewChars,
      })),
    })

    return {
      items,
      summary: toPlanSummary(
        input,
        state,
        estimatedInputTokens,
        null,
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
