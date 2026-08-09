import type {
  AdminAssistantOutputStep,
  AdminGenericStep,
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

export function projectAdminRunListItem(
  run: AdminRunProjectionRecord,
): AdminRunListItem {
  const samplingSteps = run.steps
    .filter(step => step.type === AGENT_STEP_TYPES.modelSampling)
    .sort(compareSteps)
  const validSamplingSteps = samplingSteps.filter(step => (
    isValidModelSampling(readObject(step.input), step.output, step.status)
  ))
  const trustedSamplingSteps = validSamplingSteps.length === samplingSteps.length
    ? validSamplingSteps
    : []

  return {
    id: run.id,
    conversationId: run.conversationId,
    status: run.status,
    questionPreview: toPreview(run.userMessage.content, QUESTION_PREVIEW_MAX_CHARS),
    requestedModel: readRequestedModel(trustedSamplingSteps),
    samplingCount: samplingSteps.length,
    toolCallCount: run.steps.filter(
      step => step.type === AGENT_STEP_TYPES.toolExecution,
    ).length,
    ...aggregateSamplingUsage(trustedSamplingSteps),
    durationMs: elapsedMs(run.startedAt, run.endedAt),
    startedAt: run.startedAt.toISOString(),
    endedAt: toIsoString(run.endedAt),
    createdAt: run.createdAt.toISOString(),
  }
}

export function projectAdminRunDetail(
  run: AdminRunDetailProjectionRecord,
): AdminRunDetail {
  const timeline = [...run.steps]
    .sort(compareSteps)
    .map(projectTimelineItem)

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
  const messageCount = readNonNegativeInteger(input, 'messageCount')
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
    messageCount,
    toolCount,
    finishReason,
    usage,
    toolCallCount,
    textChars,
    intermediateTextChars,
    recordedDurationMs,
    inputSummary: summarize([
      ['samplingIndex', samplingIndex],
      ['samplingAttemptId', samplingAttemptId],
      ['requestedModel', requestedModel],
      ['messageCount', messageCount],
      ['toolCount', toolCount],
    ]),
    outputSummary: summarize([
      ['finishReason', finishReason],
      ['toolCallCount', toolCallCount],
      ['textChars', textChars],
      ['intermediateTextChars', intermediateTextChars],
      ['durationMs', recordedDurationMs],
    ]),
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
    || !isRequiredNonNegativeInteger(input, 'messageCount')
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

  if (Object.keys(object).every(key => key === 'durationMs'))
    return isRequiredNonNegativeInteger(object, 'durationMs')

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
    && isAllowedFinishReason
    && Object.hasOwn(object, 'usage')
    && isOptionalUsage(object, 'usage')
    && isRequiredNonNegativeInteger(object, 'toolCallCount')
    && isRequiredNonNegativeInteger(object, 'textChars')
    && isRequiredNonNegativeInteger(object, 'intermediateTextChars')
    && isRequiredNonNegativeInteger(object, 'durationMs')
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
  steps: AdminRunProjectionStepRecord[],
): AdminRunTokenUsage {
  const usages = steps.map(step => projectTokenUsage(readObject(step.output)))

  return {
    inputTokens: sumCompleteUsage(usages, 'inputTokens'),
    outputTokens: sumCompleteUsage(usages, 'outputTokens'),
    totalTokens: sumCompleteUsage(usages, 'totalTokens'),
  }
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
