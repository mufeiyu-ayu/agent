import type {
  AdminAssistantOutputStep,
  AdminDebugModelIOCapture,
  AdminDebugModelResponseCapture,
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
import type { PersistedMessageGrounding } from '../../agent-runtime/grounding/message-grounding.projector.js'

import { AGENT_STEP_TYPES } from '../../agent-runtime/lifecycle/agent-run-recorder.service.js'
import {
  enforceContextSequenceInvariants,
  projectContextInspector,
} from './context-inspector.projector.js'
import {
  projectAdminRetrievalInspector,
  projectGroundedFinalizationStep,
} from './retrieval-inspector.projector.js'
import {
  elapsedMs,
  isRequiredNonNegativeInteger,
  isRequiredString,
  readAllowedString,
  readBoolean,
  readNonNegativeInteger,
  readObject,
  readPositiveInteger,
  readString,
  toIsoString,
  toPreview,
} from './safe-readers.js'
import {
  aggregateGroundedFinalization,
  aggregateSamplingUsage,
  projectTokenUsage,
} from './sampling-usage.projector.js'

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
  /** 只有助手消息可能带 Grounding；投影前仍由 projector 复核归属与合法性。 */
  grounding?: PersistedMessageGrounding | null
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
  const sampling = aggregateRunSampling(run.steps)

  return {
    id: run.id,
    conversationId: run.conversationId,
    status: run.status,
    questionPreview: toPreview(run.userMessage.content, QUESTION_PREVIEW_MAX_CHARS),
    requestedModel: sampling.requestedModel,
    samplingCount: sampling.count,
    toolCallCount: run.steps.filter(
      step => step.type === AGENT_STEP_TYPES.toolExecution,
    ).length,
    inputTokens: sampling.usage.inputTokens,
    outputTokens: sampling.usage.outputTokens,
    totalTokens: sampling.usage.totalTokens,
    durationMs: elapsedMs(run.startedAt, run.endedAt),
    startedAt: run.startedAt.toISOString(),
    endedAt: toIsoString(run.endedAt),
    createdAt: run.createdAt.toISOString(),
  }
}

function aggregateRunSampling(
  steps: AdminRunProjectionStepRecord[],
): {
  count: number
  requestedModel: string | null
  usage: AdminRunTokenUsage
} {
  const samplingSteps = steps
    .filter(step => step.type === AGENT_STEP_TYPES.modelSampling)
    .sort(compareSteps)
  const validSamplingSteps = samplingSteps.filter(step => (
    isValidModelSampling(readObject(step.input), step.output, step.status)
  ))
  const samplingTrusted = validSamplingSteps.length === samplingSteps.length
  const trustedSamplingSteps = samplingTrusted ? validSamplingSteps : []
  // Grounded finalization 也是真实模型调用，必须计入本 Run 的采样次数与 Token；
  // 否则使用 Grounded Answer 的 Run 会系统性少算 1～2 次调用及其 Token。
  const finalization = aggregateGroundedFinalization(steps)
  // Token 汇总是 all-or-nothing：只要 action sampling 或 finalization 任一侧的
  // metadata 不可信，就整体返回 null，绝不给出「只统计了一部分」的总数。
  const usages: Array<AdminRunTokenUsage | null> = samplingTrusted
    ? [
        ...trustedSamplingSteps.map(step => projectTokenUsage(readObject(step.output))),
        ...finalization.usages,
      ]
    : [null]

  return {
    count: samplingSteps.length + finalization.attemptCount,
    requestedModel: readRequestedModel(trustedSamplingSteps),
    usage: aggregateSamplingUsage(usages),
  }
}

export function projectAdminRunDetail(
  run: AdminRunDetailProjectionRecord,
): AdminRunDetail {
  const usage = aggregateRunSampling(run.steps).usage
  const timeline = enforceContextSequenceInvariants(
    [...run.steps]
      .sort(compareSteps)
      .map(step => projectTimelineItem(step, run.assistantMessageId)),
  )

  return {
    ...projectAdminRunListItem(run),
    reasoningTokens: usage.reasoningTokens,
    promptCacheHitTokens: usage.promptCacheHitTokens,
    promptCacheMissTokens: usage.promptCacheMissTokens,
    userMessageId: run.userMessageId,
    assistantMessageId: run.assistantMessageId,
    updatedAt: run.updatedAt.toISOString(),
    messages: [run.userMessage, run.assistantMessage]
      .filter((message): message is AdminRunDetailMessageRecord => message !== null)
      .map(projectMessage),
    timeline,
    retrievalInspector: projectAdminRetrievalInspector({
      runStatus: run.status,
      assistantMessageId: run.assistantMessageId,
      steps: run.steps,
      timeline,
      assistantMessage: run.assistantMessage,
    }),
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
  assistantMessageId: string | null,
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
    case AGENT_STEP_TYPES.groundedFinalization:
      // metadata 不可信时回落到既有 Generic fallback，不给出一份看起来完整的假 Step。
      return projectGroundedFinalizationStep(
        step,
        knownStepBase(step),
        assistantMessageId,
      ) ?? projectGenericStep(step)
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
    debugRequestBody: readDebugModelIOCapture(output, 'debugRequestBody'),
    debugRawResponse: readDebugModelResponseCapture(output),
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
    // debug 捕获属于白名单扩展字段：仅 model_sampling 且捕获存在时出现。
    ...(item.kind === 'known' && item.type === 'model_sampling'
      ? {
          ...(item.debugRequestBody
            ? { debugRequestBody: item.debugRequestBody }
            : {}),
          ...(item.debugRawResponse
            ? { debugRawResponse: item.debugRawResponse }
            : {}),
        }
      : {}),
  }
}

/**
 * 读取落库的 debug 捕获信封；结构不符合预期时按未捕获处理（null），不报错。
 */
function readDebugModelIOCapture(
  output: Record<string, unknown> | null,
  key: 'debugRequestBody',
): AdminDebugModelIOCapture | null {
  return readDebugModelIOCaptureEnvelope(output?.[key])
}

function readDebugModelIOCaptureEnvelope(
  value: unknown,
): AdminDebugModelIOCapture | null {
  const envelope = readObject(value)

  if (envelope === null)
    return null

  if (envelope.truncated === true) {
    return typeof envelope.preview === 'string'
      ? { truncated: true, preview: envelope.preview }
      : null
  }

  if (envelope.truncated === false && 'value' in envelope)
    return { truncated: false, value: envelope.value }

  return null
}

function readDebugModelResponseCapture(
  output: Record<string, unknown> | null,
): AdminDebugModelResponseCapture | null {
  const envelope = readObject(output?.debugRawResponse)

  if (envelope === null)
    return null

  if (envelope.state === 'empty') {
    return Object.keys(envelope).length === 1
      ? { state: 'empty' }
      : null
  }

  const state = envelope.state === undefined
    ? 'complete'
    : envelope.state === 'complete' || envelope.state === 'partial'
      ? envelope.state
      : null
  const capture = readDebugModelIOCaptureEnvelope(envelope)

  return state && capture
    ? { state, ...capture }
    : null
}

function isRequiredNullableString(
  object: Record<string, unknown>,
  key: string,
): boolean {
  return Object.hasOwn(object, key)
    && (object[key] === null || isRequiredString(object, key))
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

function readRequestedModel(
  steps: AdminRunProjectionStepRecord[],
): string | null {
  return readString(readObject(steps[0]?.input), 'requestedModel')
}

function summarize(
  entries: Array<[label: string, value: string | number | boolean | null]>,
): string | null {
  const values = entries
    .filter((entry): entry is [string, string | number | boolean] => entry[1] !== null)
    .map(([label, value]) => `${label}=${value}`)

  return values.length > 0 ? values.join(', ') : null
}

function compareSteps(
  left: AdminRunProjectionStepRecord,
  right: AdminRunProjectionStepRecord,
): number {
  return left.sequence - right.sequence || (left.id ?? '').localeCompare(right.id ?? '')
}
