import type {
  AdminContextInspector,
  AdminContextObservationSummary,
  AdminInitialHistoryExcludedReason,
  AdminModelSamplingStep,
  AdminRunTimelineItem,
  AgentStepStatus,
} from '@agent/contracts'

import { AGENT_STEP_TYPES } from '../../agent-runtime/lifecycle/agent-run-recorder.service.js'
import {
  isRequiredString,
  readAllowedString,
  readBoolean,
  readNonNegativeInteger,
  readObject,
  readPositiveInteger,
  readString,
} from './safe-readers.js'

const INITIAL_HISTORY_EXCLUDED_REASONS: AdminInitialHistoryExcludedReason[] = [
  'budget',
  'candidate_cap',
]
const CONTEXT_FAILURE_REASONS = ['estimator_failure'] as const

interface InitialContextMetadata {
  resolvedModel: string
  contextWindowTokens: number
  applicationInputCapTokens: number
  resolvedInputBudgetTokens: number
  resolvedMaxOutputTokens: number
  safetyMarginTokens: number
  historyCandidateCount: number
  historyIncludedCount: number
  historyExcludedCount: number
  excludedReason: AdminInitialHistoryExcludedReason | null
  estimatorStrategyId: string
}

interface SamplingContextPlanMetadata {
  samplingIndex: number
  resolvedInputBudgetTokens: number
  estimatedInputTokens: number
  historyCandidateCount: number
  historyIncludedCount: number
  historyExcludedCount: number
  toolExchangeCount: number
  observations: AdminContextObservationSummary[]
  overflowReason: 'minimum_context' | null
  estimatorStrategyId: string
}

export function projectContextInspector(
  input: Record<string, unknown> | null,
  output: Record<string, unknown> | null,
  status: AgentStepStatus,
): AdminContextInspector {
  const hasInitialContext = input !== null
    && Object.hasOwn(input, 'initialContext')
  const hasContextPlan = output !== null
    && Object.hasOwn(output, 'contextPlan')
  const hasContextFailureReason = output !== null
    && Object.hasOwn(output, 'contextFailureReason')
  const initialContext = readInitialContextMetadata(input?.initialContext)
  const samplingIndex = readPositiveInteger(input, 'samplingIndex')
  const parsedContextPlan = readSamplingContextPlanMetadata(output?.contextPlan)
  const compatibleContextPlan = isCompatibleContextPlan(
    initialContext,
    parsedContextPlan,
    samplingIndex,
  )
    ? parsedContextPlan
    : null
  const contextFailureReason = readAllowedString(
    output,
    'contextFailureReason',
    [...CONTEXT_FAILURE_REASONS],
  )
  const prePlanItemCount = readNonNegativeInteger(
    input,
    'candidateMessageCount',
  )
  const providerItemCount = readNonNegativeInteger(output, 'messageCount')
  const contradictoryMetadata = (
    (hasInitialContext && initialContext === null)
    || (hasContextPlan && compatibleContextPlan === null)
    || (hasContextFailureReason && contextFailureReason === null)
    || (contextFailureReason !== null && hasContextPlan)
    || !isCompatibleContextOutcome({
      contextFailureReason,
      contextPlan: compatibleContextPlan,
      hasContextPlan,
      initialContext,
      prePlanItemCount,
      providerItemCount,
      status,
    })
  )
  const usableContextPlan = contradictoryMetadata
    ? null
    : compatibleContextPlan
  const usableContextFailureReason = contradictoryMetadata
    ? null
    : contextFailureReason
  const hasContextMetadata = (
    hasInitialContext
    || hasContextPlan
    || hasContextFailureReason
  )
  const samplingHistoryExcludedCount
    = initialContext && usableContextPlan
      ? initialContext.historyIncludedCount
      - usableContextPlan.historyIncludedCount
      : null
  const resolvedInputBudgetTokens
    = usableContextPlan?.resolvedInputBudgetTokens
      ?? initialContext?.resolvedInputBudgetTokens
      ?? null
  const estimatedInputTokens = usableContextPlan?.estimatedInputTokens ?? null

  return {
    availability: initialContext && usableContextPlan
      ? 'available'
      : hasContextMetadata
        ? 'partial'
        : 'unavailable',
    outcome: usableContextFailureReason === 'estimator_failure'
      ? 'estimator_failure'
      : usableContextPlan?.overflowReason === 'minimum_context'
        ? 'minimum_context_overflow'
        : usableContextPlan
          ? 'success'
          : 'unavailable',
    resolvedModel: initialContext?.resolvedModel ?? null,
    requestedModel: readString(input, 'requestedModel'),
    estimatorStrategyId: usableContextPlan?.estimatorStrategyId
      ?? initialContext?.estimatorStrategyId
      ?? null,
    contextWindowTokens: initialContext?.contextWindowTokens ?? null,
    applicationInputCapTokens:
      initialContext?.applicationInputCapTokens ?? null,
    outputReserveTokens: initialContext?.resolvedMaxOutputTokens ?? null,
    safetyMarginTokens: initialContext?.safetyMarginTokens ?? null,
    resolvedInputBudgetTokens,
    estimatedInputTokens,
    budgetUsageRatio: resolvedInputBudgetTokens !== null
      && resolvedInputBudgetTokens > 0
      && estimatedInputTokens !== null
      ? estimatedInputTokens / resolvedInputBudgetTokens
      : null,
    prePlanItemCount,
    providerItemCount,
    historyCandidateCount: usableContextPlan?.historyCandidateCount ?? null,
    historyIncludedCount: usableContextPlan?.historyIncludedCount ?? null,
    historyExcludedCount: usableContextPlan?.historyExcludedCount ?? null,
    initialHistoryExcludedReason: initialContext?.excludedReason ?? null,
    samplingHistoryExcludedCount,
    toolExchangeCount: usableContextPlan?.toolExchangeCount ?? null,
    observations: usableContextPlan?.observations ?? null,
  }
}

function readInitialContextMetadata(value: unknown): InitialContextMetadata | null {
  const object = readObject(value)
  if (!object)
    return null

  const resolvedModel = readString(object, 'resolvedModel')
  const contextWindowTokens = readPositiveInteger(object, 'contextWindowTokens')
  const applicationInputCapTokens = readPositiveInteger(
    object,
    'applicationInputCapTokens',
  )
  const resolvedInputBudgetTokens = readPositiveInteger(
    object,
    'resolvedInputBudgetTokens',
  )
  const resolvedMaxOutputTokens = readPositiveInteger(
    object,
    'resolvedMaxOutputTokens',
  )
  const safetyMarginTokens = readNonNegativeInteger(object, 'safetyMarginTokens')
  const historyCandidateCount = readNonNegativeInteger(
    object,
    'historyCandidateCount',
  )
  const historyIncludedCount = readNonNegativeInteger(
    object,
    'historyIncludedCount',
  )
  const historyExcludedCount = readNonNegativeInteger(
    object,
    'historyExcludedCount',
  )
  const excludedReason = object.excludedReason === null
    ? null
    : readAllowedString(
        object,
        'excludedReason',
        INITIAL_HISTORY_EXCLUDED_REASONS,
      )
  const estimatorStrategyId = readString(object, 'estimatorStrategyId')
  const modelInputCapacity = contextWindowTokens !== null
    && resolvedMaxOutputTokens !== null
    && safetyMarginTokens !== null
    ? contextWindowTokens - resolvedMaxOutputTokens - safetyMarginTokens
    : null

  if (
    resolvedModel === null
    || !isRequiredString(object, 'resolvedModel')
    || contextWindowTokens === null
    || applicationInputCapTokens === null
    || resolvedInputBudgetTokens === null
    || resolvedMaxOutputTokens === null
    || safetyMarginTokens === null
    || historyCandidateCount === null
    || historyIncludedCount === null
    || historyExcludedCount === null
    || !Object.hasOwn(object, 'excludedReason')
    || (object.excludedReason !== null && excludedReason === null)
    || estimatorStrategyId === null
    || !isRequiredString(object, 'estimatorStrategyId')
    || modelInputCapacity === null
    || !Number.isSafeInteger(modelInputCapacity)
    || modelInputCapacity <= 0
    || resolvedInputBudgetTokens !== Math.min(
      applicationInputCapTokens,
      modelInputCapacity,
    )
    || historyCandidateCount
    !== historyIncludedCount + historyExcludedCount
  ) {
    return null
  }

  return {
    resolvedModel,
    contextWindowTokens,
    applicationInputCapTokens,
    resolvedInputBudgetTokens,
    resolvedMaxOutputTokens,
    safetyMarginTokens,
    historyCandidateCount,
    historyIncludedCount,
    historyExcludedCount,
    excludedReason,
    estimatorStrategyId,
  }
}

function readSamplingContextPlanMetadata(
  value: unknown,
): SamplingContextPlanMetadata | null {
  const object = readObject(value)
  if (!object)
    return null

  const samplingIndex = readPositiveInteger(object, 'samplingIndex')
  const resolvedInputBudgetTokens = readPositiveInteger(
    object,
    'resolvedInputBudgetTokens',
  )
  const estimatedInputTokens = readNonNegativeInteger(
    object,
    'estimatedInputTokens',
  )
  const historyCandidateCount = readNonNegativeInteger(
    object,
    'historyCandidateCount',
  )
  const historyIncludedCount = readNonNegativeInteger(
    object,
    'historyIncludedCount',
  )
  const historyExcludedCount = readNonNegativeInteger(
    object,
    'historyExcludedCount',
  )
  const toolExchangeCount = readNonNegativeInteger(object, 'toolExchangeCount')
  const observations = readContextObservationSummaries(object.observations)
  const overflowReason = object.overflowReason === null
    ? null
    : object.overflowReason === 'minimum_context'
      ? 'minimum_context'
      : undefined
  const estimatorStrategyId = readString(object, 'estimatorStrategyId')

  if (
    samplingIndex === null
    || resolvedInputBudgetTokens === null
    || estimatedInputTokens === null
    || historyCandidateCount === null
    || historyIncludedCount === null
    || historyExcludedCount === null
    || toolExchangeCount === null
    || observations === null
    || overflowReason === undefined
    || estimatorStrategyId === null
    || !isRequiredString(object, 'estimatorStrategyId')
    || (estimatedInputTokens > resolvedInputBudgetTokens)
    !== (overflowReason === 'minimum_context')
    || historyCandidateCount
    !== historyIncludedCount + historyExcludedCount
    || observations.length !== toolExchangeCount
    || toolExchangeCount !== samplingIndex - 1
    || observations.some((observation, index) => (
      observation.exchangeIndex !== index
    ))
  ) {
    return null
  }

  return {
    samplingIndex,
    resolvedInputBudgetTokens,
    estimatedInputTokens,
    historyCandidateCount,
    historyIncludedCount,
    historyExcludedCount,
    toolExchangeCount,
    observations,
    overflowReason,
    estimatorStrategyId,
  }
}

function readContextObservationSummaries(
  value: unknown,
): AdminContextObservationSummary[] | null {
  if (!Array.isArray(value))
    return null

  const summaries: AdminContextObservationSummary[] = []

  for (const candidate of value) {
    const object = readObject(candidate)
    const exchangeIndex = readNonNegativeInteger(object, 'exchangeIndex')
    const originalChars = readNonNegativeInteger(object, 'originalChars')
    const toolCeilingChars = readNonNegativeInteger(object, 'toolCeilingChars')
    const finalChars = readNonNegativeInteger(object, 'finalChars')
    const toolCeilingTruncated = readBoolean(object, 'toolCeilingTruncated')
    const contextBudgetTruncated = readBoolean(object, 'contextBudgetTruncated')

    if (
      exchangeIndex === null
      || originalChars === null
      || toolCeilingChars === null
      || finalChars === null
      || toolCeilingTruncated === null
      || contextBudgetTruncated === null
      || toolCeilingChars > originalChars
      || toolCeilingTruncated !== (toolCeilingChars < originalChars)
      || (!contextBudgetTruncated && finalChars !== toolCeilingChars)
    ) {
      return null
    }

    summaries.push({
      exchangeIndex,
      originalChars,
      toolCeilingChars,
      finalChars,
      toolCeilingTruncated,
      contextBudgetTruncated,
    })
  }

  return summaries
}

function isCompatibleContextPlan(
  initialContext: InitialContextMetadata | null,
  contextPlan: SamplingContextPlanMetadata | null,
  samplingIndex: number | null,
): contextPlan is SamplingContextPlanMetadata {
  if (!contextPlan || samplingIndex === null || contextPlan.samplingIndex !== samplingIndex)
    return false
  if (!initialContext)
    return true

  return contextPlan.resolvedInputBudgetTokens
    === initialContext.resolvedInputBudgetTokens
    && contextPlan.estimatorStrategyId === initialContext.estimatorStrategyId
    && contextPlan.historyCandidateCount
    === initialContext.historyCandidateCount
    && contextPlan.historyIncludedCount <= initialContext.historyIncludedCount
}

function isCompatibleContextOutcome(input: {
  contextFailureReason: (typeof CONTEXT_FAILURE_REASONS)[number] | null
  contextPlan: SamplingContextPlanMetadata | null
  hasContextPlan: boolean
  initialContext: InitialContextMetadata | null
  prePlanItemCount: number | null
  providerItemCount: number | null
  status: AgentStepStatus
}): boolean {
  if (input.contextFailureReason === 'estimator_failure') {
    return input.status === 'FAILED'
      && !input.hasContextPlan
      && input.initialContext !== null
      && input.providerItemCount === 0
  }

  if (!input.contextPlan)
    return true

  if (input.contextPlan.overflowReason === 'minimum_context') {
    return input.status === 'FAILED'
      && input.providerItemCount === 0
  }

  return input.prePlanItemCount !== null
    && input.prePlanItemCount > 0
    && input.providerItemCount !== null
    && input.providerItemCount > 0
    && input.providerItemCount <= input.prePlanItemCount
}

export function enforceContextSequenceInvariants(
  timeline: AdminRunTimelineItem[],
): AdminRunTimelineItem[] {
  let previousSampling: AdminModelSamplingStep | undefined

  return timeline.map((item) => {
    if (item.type !== AGENT_STEP_TYPES.modelSampling)
      return item

    if (
      item.kind !== 'known'
      || item.contextInspector.availability !== 'available'
      || item.contextInspector.outcome === 'unavailable'
    ) {
      previousSampling = undefined
      return item
    }

    if (!isCompatibleContextSequence(previousSampling, item)) {
      previousSampling = undefined
      return {
        ...item,
        contextInspector: downgradeContextInspector(item.contextInspector),
      }
    }

    previousSampling = item
    return item
  })
}

function isCompatibleContextSequence(
  previous: AdminModelSamplingStep | undefined,
  current: AdminModelSamplingStep,
): boolean {
  const inspector = current.contextInspector
  const samplingIndex = current.samplingIndex
  const samplingHistoryExcludedCount = inspector.samplingHistoryExcludedCount

  if (
    samplingIndex === null
    || inspector.prePlanItemCount === null
    || inspector.providerItemCount === null
    || inspector.historyCandidateCount === null
    || inspector.historyIncludedCount === null
    || inspector.historyExcludedCount === null
    || samplingHistoryExcludedCount === null
    || inspector.toolExchangeCount !== samplingIndex - 1
    || inspector.observations === null
  ) {
    return false
  }

  if (samplingIndex === 1) {
    return previous === undefined
      && inspector.prePlanItemCount
      > inspector.historyIncludedCount + samplingHistoryExcludedCount
      && isCompatibleProviderCount(
        inspector,
        samplingHistoryExcludedCount,
      )
  }

  const previousInspector = previous?.contextInspector
  const previousSamplingIndex = previous?.samplingIndex
  const previousProviderItemCount = previous?.providerItemCount
  const previousHistoryCandidateCount
    = previousInspector?.historyCandidateCount
  const previousHistoryIncludedCount = previousInspector?.historyIncludedCount
  const previousHistoryExcludedCount = previousInspector?.historyExcludedCount
  const previousSamplingHistoryExcludedCount
    = previousInspector?.samplingHistoryExcludedCount
  const previousToolExchangeCount = previousInspector?.toolExchangeCount
  const previousObservations = previousInspector?.observations

  if (
    !previous
    || !previousInspector
    || previousSamplingIndex === null
    || previousSamplingIndex === undefined
    || previousProviderItemCount === null
    || previousProviderItemCount === undefined
    || previous.finishReason !== 'tool_calls'
    || previousInspector.outcome !== 'success'
    || previousHistoryCandidateCount === null
    || previousHistoryCandidateCount === undefined
    || previousHistoryIncludedCount === null
    || previousHistoryIncludedCount === undefined
    || previousHistoryExcludedCount === null
    || previousHistoryExcludedCount === undefined
    || previousSamplingHistoryExcludedCount === null
    || previousSamplingHistoryExcludedCount === undefined
    || previousToolExchangeCount === null
    || previousToolExchangeCount === undefined
    || previousObservations === null
    || previousObservations === undefined
  ) {
    return false
  }

  const newlyExcludedHistoryCount = samplingHistoryExcludedCount
    - previousSamplingHistoryExcludedCount

  return samplingIndex === previousSamplingIndex + 1
    && inspector.toolExchangeCount === previousToolExchangeCount + 1
    && inspector.prePlanItemCount === previousProviderItemCount + 2
    && inspector.historyCandidateCount
    === previousHistoryCandidateCount
    && inspector.historyIncludedCount
    <= previousHistoryIncludedCount
    && inspector.historyExcludedCount
    >= previousHistoryExcludedCount
    && newlyExcludedHistoryCount >= 0
    && sameInitialContext(inspector, previousInspector)
    && areCommittedObservationsCompatible(
      previousObservations,
      inspector.observations,
    )
    && isCompatibleProviderCount(inspector, newlyExcludedHistoryCount)
}

function isCompatibleProviderCount(
  inspector: AdminContextInspector,
  newlyExcludedHistoryCount: number,
): boolean {
  if (inspector.outcome === 'minimum_context_overflow')
    return inspector.providerItemCount === 0

  return inspector.outcome === 'success'
    && inspector.prePlanItemCount !== null
    && inspector.providerItemCount
    === inspector.prePlanItemCount - newlyExcludedHistoryCount
}

function sameInitialContext(
  current: AdminContextInspector,
  previous: AdminContextInspector,
): boolean {
  return current.resolvedModel === previous.resolvedModel
    && current.requestedModel === previous.requestedModel
    && current.contextWindowTokens === previous.contextWindowTokens
    && current.applicationInputCapTokens === previous.applicationInputCapTokens
    && current.outputReserveTokens === previous.outputReserveTokens
    && current.safetyMarginTokens === previous.safetyMarginTokens
    && current.resolvedInputBudgetTokens
    === previous.resolvedInputBudgetTokens
    && current.estimatorStrategyId === previous.estimatorStrategyId
    && current.initialHistoryExcludedReason
    === previous.initialHistoryExcludedReason
    && current.historyIncludedCount !== null
    && current.samplingHistoryExcludedCount !== null
    && previous.historyIncludedCount !== null
    && previous.samplingHistoryExcludedCount !== null
    && current.historyIncludedCount + current.samplingHistoryExcludedCount
    === previous.historyIncludedCount
    + previous.samplingHistoryExcludedCount
}

function areCommittedObservationsCompatible(
  previous: AdminContextObservationSummary[],
  current: AdminContextObservationSummary[],
): boolean {
  if (current.length !== previous.length + 1)
    return false

  return previous.every((observation, index) => {
    const next = current[index]

    return next !== undefined
      && next.exchangeIndex === observation.exchangeIndex
      && next.originalChars === observation.originalChars
      && next.toolCeilingChars === observation.toolCeilingChars
      && next.toolCeilingTruncated === observation.toolCeilingTruncated
      && (!observation.contextBudgetTruncated
        || (
          next.contextBudgetTruncated
          && next.finalChars <= observation.finalChars
        ))
  })
}

function downgradeContextInspector(
  inspector: AdminContextInspector,
): AdminContextInspector {
  return {
    ...inspector,
    availability: 'partial',
    outcome: 'unavailable',
    estimatedInputTokens: null,
    budgetUsageRatio: null,
    historyCandidateCount: null,
    historyIncludedCount: null,
    historyExcludedCount: null,
    samplingHistoryExcludedCount: null,
    toolExchangeCount: null,
    observations: null,
  }
}
