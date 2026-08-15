import type {
  AdminAssistantOutputStep,
  AdminContextInspector,
  AdminContextObservationSummary,
  AdminGenericStep,
  AdminInitialHistoryExcludedReason,
  AdminLoadConversationHistoryStep,
  AdminModelFinishReason,
  AdminModelSamplingStep,
  AdminReceiveUserMessageStep,
  AdminRunDetail,
  AdminRunListItem,
  AdminRunMessage,
  AdminRunSafeStepProjection,
  AdminRunTimelineItem,
  AdminRunTokenUsage,
  AdminToolExecutionStep,
  AdminToolResultCode,
  AgentRunStatus,
  AgentStepStatus,
  MessageRole,
  MessageStatus,
} from '@agent/contracts'

import { AGENT_STEP_TYPES } from '../agent-runtime/agent-run-recorder.service.js'
import { GROUNDED_FINALIZATION_MAX_ATTEMPTS } from '../agent-runtime/grounding/grounded-answer.finalizer.js'

const QUESTION_PREVIEW_MAX_CHARS = 200
const MESSAGE_PREVIEW_MAX_CHARS = 500
const SAFE_TEXT_MAX_CHARS = 128
const MODEL_FINISH_REASONS: AdminModelFinishReason[] = [
  'stop',
  'tool_calls',
  'length',
  'content_filter',
  'unknown',
]
const COMPLETED_MODEL_FINISH_REASONS: AdminModelFinishReason[] = [
  'stop',
  'tool_calls',
]
const TOOL_RESULT_CODES: AdminToolResultCode[] = [
  'execution_failed',
  'invalid_arguments',
  'timeout',
  'unknown_tool',
]
const INITIAL_HISTORY_EXCLUDED_REASONS: AdminInitialHistoryExcludedReason[] = [
  'budget',
  'candidate_cap',
]
const CONTEXT_FAILURE_REASONS = ['estimator_failure'] as const

interface AdminRunProjectionStepRecord {
  id?: string
  sequence: number
  type: string
  title?: string
  status?: AgentStepStatus
  input: unknown
  output: unknown
  errorMessage?: string | null
  startedAt?: Date | null
  endedAt?: Date | null
}

interface AdminRunProjectionRecord {
  id: string
  conversationId: string
  status: AgentRunStatus
  startedAt: Date
  endedAt: Date | null
  createdAt: Date
  updatedAt?: Date
  userMessage: {
    content: string
  }
  steps: AdminRunProjectionStepRecord[]
}

interface AdminRunDetailProjectionStepRecord extends AdminRunProjectionStepRecord {
  id: string
  title: string
  status: AgentStepStatus
  errorMessage: string | null
  startedAt: Date | null
  endedAt: Date | null
}

interface AdminRunDetailMessageRecord {
  id: string
  role: MessageRole
  status: MessageStatus
  content: string
  createdAt: Date
  updatedAt: Date
}

interface AdminRunDetailProjectionRecord extends AdminRunProjectionRecord {
  userMessageId: string
  assistantMessageId: string | null
  updatedAt: Date
  userMessage: AdminRunDetailMessageRecord
  assistantMessage: AdminRunDetailMessageRecord | null
  steps: AdminRunDetailProjectionStepRecord[]
}

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

export function projectAdminRunListItem(
  run: AdminRunProjectionRecord,
): AdminRunListItem {
  const samplingSteps = run.steps
    .filter(step => step.type === AGENT_STEP_TYPES.modelSampling)
    .sort(compareSteps)
  const validSamplingSteps = samplingSteps.filter(step => (
    isValidModelSampling(readObject(step.input), step.output, step.status)
  ))
  const samplingTrusted = validSamplingSteps.length === samplingSteps.length
  const trustedSamplingSteps = samplingTrusted ? validSamplingSteps : []
  // Grounded finalization 也是真实模型调用，必须计入本 Run 的采样次数与 Token；
  // 否则使用 Grounded Answer 的 Run 会系统性少算 1～2 次调用及其 Token。
  const finalization = aggregateGroundedFinalization(run.steps)
  // Token 汇总是 all-or-nothing：只要 action sampling 或 finalization 任一侧的
  // metadata 不可信，就整体返回 null，绝不给出「只统计了一部分」的总数。
  const usages: Array<AdminRunTokenUsage | null> = samplingTrusted
    ? [
        ...trustedSamplingSteps.map(step => projectTokenUsage(readObject(step.output))),
        ...finalization.usages,
      ]
    : [null]

  return {
    id: run.id,
    conversationId: run.conversationId,
    status: run.status,
    questionPreview: toPreview(run.userMessage.content, QUESTION_PREVIEW_MAX_CHARS),
    requestedModel: readRequestedModel(trustedSamplingSteps),
    samplingCount: samplingSteps.length + finalization.attemptCount,
    toolCallCount: run.steps.filter(
      step => step.type === AGENT_STEP_TYPES.toolExecution,
    ).length,
    ...aggregateSamplingUsage(usages),
    durationMs: elapsedMs(run.startedAt, run.endedAt),
    startedAt: run.startedAt.toISOString(),
    endedAt: toIsoString(run.endedAt),
    createdAt: run.createdAt.toISOString(),
  }
}

export function projectAdminRunDetail(
  run: AdminRunDetailProjectionRecord,
): AdminRunDetail {
  const timeline = enforceContextSequenceInvariants(
    [...run.steps]
      .sort(compareSteps)
      .map(projectTimelineItem),
  )

  return {
    ...projectAdminRunListItem(run),
    userMessageId: run.userMessageId,
    assistantMessageId: run.assistantMessageId,
    updatedAt: run.updatedAt.toISOString(),
    messages: [run.userMessage, run.assistantMessage]
      .filter((message): message is AdminRunDetailMessageRecord => message !== null)
      .map(projectMessage),
    timeline,
    safeRawData: {
      agentRun: {
        id: run.id,
        conversationId: run.conversationId,
        userMessageId: run.userMessageId,
        assistantMessageId: run.assistantMessageId,
        status: run.status,
        startedAt: run.startedAt.toISOString(),
        endedAt: toIsoString(run.endedAt),
        createdAt: run.createdAt.toISOString(),
        updatedAt: run.updatedAt.toISOString(),
      },
      agentSteps: timeline.map(toSafeStepProjection),
    },
  }
}

function projectTimelineItem(
  step: AdminRunDetailProjectionStepRecord,
): AdminRunTimelineItem {
  const input = readObject(step.input)
  const output = readObject(step.output)

  switch (step.type) {
    case AGENT_STEP_TYPES.receiveUserMessage:
      return isValidReceiveUserMessage(input, step.output, step.status)
        ? projectReceiveUserMessage(step, input)
        : projectGenericStep(step)
    case AGENT_STEP_TYPES.loadConversationHistory:
      return isValidLoadConversationHistory(input, step.output, step.status)
        ? projectLoadConversationHistory(step, input, output)
        : projectGenericStep(step)
    case AGENT_STEP_TYPES.modelSampling:
      return isValidModelSampling(input, step.output, step.status)
        ? projectModelSampling(step, input, output)
        : projectGenericStep(step)
    case AGENT_STEP_TYPES.toolExecution:
      return isValidToolExecution(input, step.output, step.status)
        ? projectToolExecution(step, input, output)
        : projectGenericStep(step)
    case AGENT_STEP_TYPES.assistantOutput:
      return isValidAssistantOutput(input, step.output, step.status)
        ? projectAssistantOutput(step, input, output)
        : projectGenericStep(step)
    default:
      return projectGenericStep(step)
  }
}

function projectReceiveUserMessage(
  step: AdminRunDetailProjectionStepRecord,
  input: Record<string, unknown> | null,
): AdminReceiveUserMessageStep {
  const messageId = readString(input, 'messageId')
  const messageLength = readNonNegativeInteger(input, 'messageLength')

  return {
    ...knownStepBase(step),
    type: AGENT_STEP_TYPES.receiveUserMessage,
    messageId,
    messageLength,
    inputSummary: summarize([
      ['messageId', messageId],
      ['messageLength', messageLength],
    ]),
    outputSummary: null,
  }
}

function projectLoadConversationHistory(
  step: AdminRunDetailProjectionStepRecord,
  input: Record<string, unknown> | null,
  output: Record<string, unknown> | null,
): AdminLoadConversationHistoryStep {
  const historyLimit = readPositiveInteger(input, 'limit')
  const messageCount = readNonNegativeInteger(output, 'messageCount')

  return {
    ...knownStepBase(step),
    type: AGENT_STEP_TYPES.loadConversationHistory,
    historyLimit,
    messageCount,
    inputSummary: summarize([['limit', historyLimit]]),
    outputSummary: summarize([['messageCount', messageCount]]),
  }
}

function projectModelSampling(
  step: AdminRunDetailProjectionStepRecord,
  input: Record<string, unknown> | null,
  output: Record<string, unknown> | null,
): AdminModelSamplingStep {
  const samplingIndex = readPositiveInteger(input, 'samplingIndex')
  const samplingAttemptId = readString(input, 'samplingAttemptId')
  const requestedModel = readString(input, 'requestedModel')
  const candidateMessageCount = readNonNegativeInteger(
    input,
    'candidateMessageCount',
  ) ?? readNonNegativeInteger(input, 'messageCount')
  const providerItemCount = readNonNegativeInteger(output, 'messageCount')
  const toolCount = readNonNegativeInteger(input, 'toolCount')
  const finishReason = readAllowedString(output, 'finishReason', MODEL_FINISH_REASONS)
  const usage = projectTokenUsage(output)
  const toolCallCount = readNonNegativeInteger(output, 'toolCallCount')
  const textChars = readNonNegativeInteger(output, 'textChars')
  const intermediateTextChars = readNonNegativeInteger(output, 'intermediateTextChars')
  const recordedDurationMs = readNonNegativeInteger(output, 'durationMs')

  return {
    ...knownStepBase(step),
    type: AGENT_STEP_TYPES.modelSampling,
    samplingIndex,
    samplingAttemptId,
    requestedModel,
    providerItemCount,
    toolCount,
    finishReason,
    usage,
    toolCallCount,
    textChars,
    intermediateTextChars,
    recordedDurationMs,
    contextInspector: projectContextInspector(input, output, step.status),
    inputSummary: summarize([
      ['samplingIndex', samplingIndex],
      ['samplingAttemptId', samplingAttemptId],
      ['requestedModel', requestedModel],
      ['candidateMessageCount', candidateMessageCount],
      ['toolCount', toolCount],
    ]),
    outputSummary: summarize([
      ['providerItemCount', providerItemCount],
      ['finishReason', finishReason],
      ['toolCallCount', toolCallCount],
      ['textChars', textChars],
      ['intermediateTextChars', intermediateTextChars],
      ['durationMs', recordedDurationMs],
    ]),
  }
}

function projectContextInspector(
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

function enforceContextSequenceInvariants(
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

function projectToolExecution(
  step: AdminRunDetailProjectionStepRecord,
  input: Record<string, unknown> | null,
  output: Record<string, unknown> | null,
): AdminToolExecutionStep {
  const callId = readString(input, 'callId')
  const toolName = readString(input, 'toolName')
  const toolVersion = readString(input, 'toolVersion')
  const samplingAttemptId = readString(input, 'samplingAttemptId')
  const executionAttempt = readPositiveInteger(input, 'executionAttempt')
  const rawArgumentsChars = readNonNegativeInteger(input, 'rawArgumentsChars')
  const ok = readBoolean(output, 'ok')
  const code = readAllowedString(output, 'code', TOOL_RESULT_CODES)
  const retryable = readBoolean(output, 'retryable')
  const originalChars = readNonNegativeInteger(output, 'originalChars')
  const observationChars = readNonNegativeInteger(output, 'observationChars')
  const truncated = readBoolean(output, 'truncated')
  const recordedDurationMs = readNonNegativeInteger(output, 'durationMs')

  return {
    ...knownStepBase(step),
    type: AGENT_STEP_TYPES.toolExecution,
    callId,
    toolName,
    toolVersion,
    samplingAttemptId,
    executionAttempt,
    rawArgumentsChars,
    ok,
    code,
    retryable,
    originalChars,
    observationChars,
    truncated,
    recordedDurationMs,
    inputSummary: summarize([
      ['callId', callId],
      ['toolName', toolName],
      ['toolVersion', toolVersion],
      ['samplingAttemptId', samplingAttemptId],
      ['executionAttempt', executionAttempt],
      ['rawArgumentsChars', rawArgumentsChars],
    ]),
    outputSummary: summarize([
      ['ok', ok],
      ['code', code],
      ['retryable', retryable],
      ['originalChars', originalChars],
      ['observationChars', observationChars],
      ['truncated', truncated],
      ['durationMs', recordedDurationMs],
    ]),
  }
}

function projectAssistantOutput(
  step: AdminRunDetailProjectionStepRecord,
  input: Record<string, unknown> | null,
  output: Record<string, unknown> | null,
): AdminAssistantOutputStep {
  const assistantMessageId = readString(input, 'assistantMessageId')
  const contentLength = readNonNegativeInteger(output, 'contentLength')

  return {
    ...knownStepBase(step),
    type: AGENT_STEP_TYPES.assistantOutput,
    assistantMessageId,
    contentLength,
    inputSummary: summarize([['assistantMessageId', assistantMessageId]]),
    outputSummary: summarize([['contentLength', contentLength]]),
  }
}

function projectGenericStep(
  step: AdminRunDetailProjectionStepRecord,
): AdminGenericStep {
  return {
    ...stepBase(step),
    kind: 'generic',
    type: toPreview(step.type, SAFE_TEXT_MAX_CHARS),
    inputSummary: step.input === null
      ? null
      : '未识别 Step 的 input 已省略',
    outputSummary: step.output === null
      ? null
      : '未识别 Step 的 output 已省略',
  }
}

function isValidReceiveUserMessage(
  input: Record<string, unknown> | null,
  output: unknown,
  status: AgentStepStatus | undefined,
): boolean {
  return status !== undefined
    && input !== null
    && isRequiredString(input, 'messageId')
    && isRequiredNonNegativeInteger(input, 'messageLength')
    && output === null
}

function isValidLoadConversationHistory(
  input: Record<string, unknown> | null,
  output: unknown,
  status: AgentStepStatus | undefined,
): boolean {
  if (!status || !input || !isRequiredPositiveInteger(input, 'limit'))
    return false
  if (status !== 'COMPLETED')
    return output === null

  const object = readObject(output)
  return object !== null && isRequiredNonNegativeInteger(object, 'messageCount')
}

function isValidModelSampling(
  input: Record<string, unknown> | null,
  output: unknown,
  status: AgentStepStatus | undefined,
): boolean {
  if (
    !status
    || !input
    || !isRequiredPositiveInteger(input, 'samplingIndex')
    || !isRequiredString(input, 'samplingAttemptId')
    || !isRequiredNullableString(input, 'requestedModel')
    || (!isRequiredNonNegativeInteger(input, 'candidateMessageCount')
      && !isRequiredNonNegativeInteger(input, 'messageCount'))
    || !isRequiredNonNegativeInteger(input, 'toolCount')
  ) {
    return false
  }
  if (status === 'COMPLETED') {
    return isValidFullModelOutput(
      input,
      output,
      COMPLETED_MODEL_FINISH_REASONS,
      false,
    )
  }
  if (output === null)
    return true
  if (status !== 'FAILED')
    return false

  return isValidFailedModelOutput(input, output)
}

function isValidFailedModelOutput(
  input: Record<string, unknown>,
  output: unknown,
): boolean {
  const object = readObject(output)
  if (!object)
    return false

  if (Object.keys(object).every(key => [
    'durationMs',
    'messageCount',
    'contextPlan',
    'contextFailureReason',
  ].includes(key))) {
    return isRequiredNonNegativeInteger(object, 'durationMs')
      && (isRequiredNonNegativeInteger(object, 'messageCount')
        || isLegacySamplingInput(input))
  }

  return isValidFullModelOutput(input, object, MODEL_FINISH_REASONS, true)
}

function isValidFullModelOutput(
  input: Record<string, unknown>,
  output: unknown,
  finishReasons: AdminModelFinishReason[],
  allowNullFinishReason: boolean,
): boolean {
  const object = readObject(output)
  const finishReason = object?.finishReason
  const isAllowedFinishReason = (allowNullFinishReason && finishReason === null)
    || (typeof finishReason === 'string'
      && finishReasons.includes(finishReason as AdminModelFinishReason))

  return object !== null
    && isRequiredString(object, 'samplingAttemptId')
    && object.samplingAttemptId === input.samplingAttemptId
    && (isRequiredNonNegativeInteger(object, 'messageCount')
      || isLegacySamplingInput(input))
    && isAllowedFinishReason
    && Object.hasOwn(object, 'usage')
    && isOptionalUsage(object, 'usage')
    && isRequiredNonNegativeInteger(object, 'toolCallCount')
    && isRequiredNonNegativeInteger(object, 'textChars')
    && isRequiredNonNegativeInteger(object, 'intermediateTextChars')
    && isRequiredNonNegativeInteger(object, 'durationMs')
}

function isLegacySamplingInput(input: Record<string, unknown>): boolean {
  return !Object.hasOwn(input, 'candidateMessageCount')
    && isRequiredNonNegativeInteger(input, 'messageCount')
}

function isValidToolExecution(
  input: Record<string, unknown> | null,
  output: unknown,
  status: AgentStepStatus | undefined,
): boolean {
  if (
    !status
    || !input
    || !isRequiredString(input, 'callId')
    || !isRequiredString(input, 'toolName')
    || !isRequiredNullableString(input, 'toolVersion')
    || !isRequiredString(input, 'samplingAttemptId')
    || !isRequiredPositiveInteger(input, 'executionAttempt')
    || !isRequiredNonNegativeInteger(input, 'rawArgumentsChars')
  ) {
    return false
  }
  if (status === 'COMPLETED')
    return isValidCompletedToolOutput(output)
  if (output === null)
    return true
  if (status !== 'FAILED')
    return false

  return isValidFailedToolOutput(output)
}

function isValidCompletedToolOutput(output: unknown): boolean {
  const object = readObject(output)
  return object !== null
    && object.ok === true
    && !Object.hasOwn(object, 'code')
    && !Object.hasOwn(object, 'retryable')
    && isRequiredNonNegativeInteger(object, 'originalChars')
    && isRequiredNonNegativeInteger(object, 'observationChars')
    && typeof object.truncated === 'boolean'
    && isRequiredNonNegativeInteger(object, 'durationMs')
}

function isValidFailedToolOutput(output: unknown): boolean {
  const object = readObject(output)
  if (!object)
    return false

  if (object.ok === false) {
    return isRequiredAllowedString(object, 'code', TOOL_RESULT_CODES)
      && typeof object.retryable === 'boolean'
      && isRequiredNonNegativeInteger(object, 'originalChars')
      && isRequiredNonNegativeInteger(object, 'observationChars')
      && typeof object.truncated === 'boolean'
      && isRequiredNonNegativeInteger(object, 'durationMs')
  }

  return Object.keys(object).every(key => key === 'durationMs')
    && isRequiredNonNegativeInteger(object, 'durationMs')
}

function isValidAssistantOutput(
  input: Record<string, unknown> | null,
  output: unknown,
  status: AgentStepStatus | undefined,
): boolean {
  if (!status || !input || !isRequiredString(input, 'assistantMessageId'))
    return false
  if (status !== 'COMPLETED')
    return output === null

  const object = readObject(output)
  return object !== null && isRequiredNonNegativeInteger(object, 'contentLength')
}

function knownStepBase(step: AdminRunDetailProjectionStepRecord) {
  return {
    ...stepBase(step),
    kind: 'known' as const,
  }
}

function stepBase(step: AdminRunDetailProjectionStepRecord) {
  return {
    id: step.id,
    sequence: step.sequence,
    type: step.type,
    title: toPreview(step.title, SAFE_TEXT_MAX_CHARS),
    status: step.status,
    startedAt: toIsoString(step.startedAt),
    endedAt: toIsoString(step.endedAt),
    durationMs: elapsedMs(step.startedAt, step.endedAt),
    hasError: step.status === 'FAILED' || step.errorMessage !== null,
  }
}

function projectMessage(message: AdminRunDetailMessageRecord): AdminRunMessage {
  return {
    id: message.id,
    role: message.role,
    status: message.status,
    contentPreview: toPreview(message.content, MESSAGE_PREVIEW_MAX_CHARS),
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
  }
}

function toSafeStepProjection(
  item: AdminRunTimelineItem,
): AdminRunSafeStepProjection {
  return {
    id: item.id,
    sequence: item.sequence,
    type: item.type,
    title: item.title,
    status: item.status,
    startedAt: item.startedAt,
    endedAt: item.endedAt,
    inputSummary: item.inputSummary,
    outputSummary: item.outputSummary,
    hasError: item.hasError,
  }
}

function aggregateSamplingUsage(
  usages: Array<AdminRunTokenUsage | null>,
): AdminRunTokenUsage {
  return {
    inputTokens: sumCompleteUsage(usages, 'inputTokens'),
    outputTokens: sumCompleteUsage(usages, 'outputTokens'),
    totalTokens: sumCompleteUsage(usages, 'totalTokens'),
  }
}

interface GroundedFinalizationAggregate {
  attemptCount: number
  usages: Array<AdminRunTokenUsage | null>
}

/**
 * 汇总 grounded finalization Step 的模型调用次数与 Token。
 *
 * fail closed 而不是静默少算：metadata 损坏时无法知道真实 attempt 数，
 * 此时按「至少发生过一次模型调用」计数（Step 存在就说明调用过），并把 usage
 * 记为不可用，让整个 Run 的 Token 汇总变成 null，而不是给出偏低的假数字。
 */
function aggregateGroundedFinalization(
  steps: AdminRunProjectionStepRecord[],
): GroundedFinalizationAggregate {
  const aggregate: GroundedFinalizationAggregate = {
    attemptCount: 0,
    usages: [],
  }

  for (const step of steps) {
    if (step.type !== AGENT_STEP_TYPES.groundedFinalization)
      continue

    const attempts = readFinalizationAttempts(step.output)

    if (!attempts) {
      aggregate.attemptCount += 1
      aggregate.usages.push(null)
      continue
    }

    aggregate.attemptCount += attempts.length
    for (const attempt of attempts)
      aggregate.usages.push(projectTokenUsage(attempt))
  }

  return aggregate
}

/**
 * 读取 finalization Step 的 attempts 元数据。
 *
 * @returns 合法时返回 attempt 对象列表；缺失、类型错误或超出 attempt 上限时返回 null。
 */
function readFinalizationAttempts(
  output: unknown,
): Array<Record<string, unknown>> | null {
  const record = readObject(output)

  if (!record || !Array.isArray(record.attempts))
    return null

  // v1 的 finalization attempt 上限是 2；超出说明 metadata 不可信。
  if (record.attempts.length > GROUNDED_FINALIZATION_MAX_ATTEMPTS)
    return null

  if (
    !isRequiredNonNegativeInteger(record, 'attemptCount')
    || record.attemptCount !== record.attempts.length
  ) {
    return null
  }

  const attempts: Array<Record<string, unknown>> = []

  for (const candidate of record.attempts) {
    const attempt = readObject(candidate)

    if (!attempt || typeof attempt.ok !== 'boolean')
      return null

    attempts.push(attempt)
  }

  return attempts
}

function projectTokenUsage(
  output: Record<string, unknown> | null,
): AdminRunTokenUsage | null {
  const usage = readObject(output?.usage)
  if (!usage)
    return null

  return {
    inputTokens: readNonNegativeInteger(usage, 'inputTokens'),
    outputTokens: readNonNegativeInteger(usage, 'outputTokens'),
    totalTokens: readNonNegativeInteger(usage, 'totalTokens'),
  }
}

function sumCompleteUsage(
  usages: Array<AdminRunTokenUsage | null>,
  key: keyof AdminRunTokenUsage,
): number | null {
  if (usages.length === 0)
    return null

  let total = 0
  for (const usage of usages) {
    const value = usage?.[key]
    if (value === null || value === undefined)
      return null

    total += value
    if (!Number.isSafeInteger(total))
      return null
  }

  return total
}

function readObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function isRequiredString(
  object: Record<string, unknown>,
  key: string,
): boolean {
  return typeof object[key] === 'string' && object[key].trim().length > 0
}

function isRequiredNullableString(
  object: Record<string, unknown>,
  key: string,
): boolean {
  return Object.hasOwn(object, key)
    && (object[key] === null || isRequiredString(object, key))
}

function isRequiredNonNegativeInteger(
  object: Record<string, unknown>,
  key: string,
): boolean {
  return readNonNegativeInteger(object, key) !== null
}

function isRequiredPositiveInteger(
  object: Record<string, unknown>,
  key: string,
): boolean {
  return readPositiveInteger(object, key) !== null
}

function isOptionalNonNegativeInteger(
  object: Record<string, unknown>,
  key: string,
): boolean {
  return !Object.hasOwn(object, key)
    || isRequiredNonNegativeInteger(object, key)
}

function isRequiredAllowedString<T extends string>(
  object: Record<string, unknown>,
  key: string,
  allowed: T[],
): boolean {
  return typeof object[key] === 'string' && allowed.includes(object[key] as T)
}

function isOptionalUsage(
  object: Record<string, unknown>,
  key: string,
): boolean {
  if (!Object.hasOwn(object, key) || object[key] === null)
    return true

  const usage = readObject(object[key])
  return usage !== null
    && isOptionalNonNegativeInteger(usage, 'inputTokens')
    && isOptionalNonNegativeInteger(usage, 'outputTokens')
    && isOptionalNonNegativeInteger(usage, 'totalTokens')
}

function readString(
  object: Record<string, unknown> | null,
  key: string,
): string | null {
  const value = object?.[key]
  return typeof value === 'string'
    ? toPreview(value, SAFE_TEXT_MAX_CHARS)
    : null
}

function readRequestedModel(
  steps: AdminRunProjectionStepRecord[],
): string | null {
  return readString(readObject(steps[0]?.input), 'requestedModel')
}

function readNonNegativeInteger(
  object: Record<string, unknown> | null,
  key: string,
): number | null {
  const value = object?.[key]
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    ? value
    : null
}

function readPositiveInteger(
  object: Record<string, unknown> | null,
  key: string,
): number | null {
  const value = readNonNegativeInteger(object, key)
  return value !== null && value > 0 ? value : null
}

function readAllowedString<T extends string>(
  object: Record<string, unknown> | null,
  key: string,
  allowed: T[],
): T | null {
  const value = object?.[key]
  return typeof value === 'string' && allowed.includes(value as T)
    ? value as T
    : null
}

function readBoolean(
  object: Record<string, unknown> | null,
  key: string,
): boolean | null {
  const value = object?.[key]
  return typeof value === 'boolean' ? value : null
}

function summarize(
  entries: Array<[label: string, value: string | number | boolean | null]>,
): string | null {
  const values = entries
    .filter((entry): entry is [string, string | number | boolean] => entry[1] !== null)
    .map(([label, value]) => `${label}=${value}`)

  return values.length > 0 ? values.join(', ') : null
}

function toPreview(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  const characters = [...normalized]

  return characters.length <= maxChars
    ? normalized
    : `${characters.slice(0, maxChars - 1).join('')}…`
}

function elapsedMs(startedAt: Date | null, endedAt: Date | null): number | null {
  if (!startedAt || !endedAt)
    return null

  const duration = endedAt.getTime() - startedAt.getTime()
  return Number.isFinite(duration) && duration >= 0 ? duration : null
}

function toIsoString(value: Date | null): string | null {
  return value?.toISOString() ?? null
}

function compareSteps(
  left: AdminRunProjectionStepRecord,
  right: AdminRunProjectionStepRecord,
): number {
  return left.sequence - right.sequence || (left.id ?? '').localeCompare(right.id ?? '')
}
