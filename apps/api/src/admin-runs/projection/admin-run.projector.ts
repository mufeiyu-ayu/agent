import type {
  AdminAssistantOutputStep,
  AdminDebugModelIOCapture,
  AdminDebugModelResponseCapture,
  AdminGenericStep,
  AdminLoadConversationHistoryStep,
  AdminModelFinishReason,
  AdminModelSamplingStep,
  AdminRunDetail,
  AdminRunListItem,
  AdminRunMessage,
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
import { projectContextInspector } from './context-inspector.projector.js'
import {
  projectAdminRetrievalInspector,
  projectGroundedFinalizationStep,
} from './retrieval-inspector.projector.js'
import {
  elapsedMs,
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
const TOOL_RESULT_CODES: AdminToolResultCode[] = [
  'execution_failed',
  'invalid_arguments',
  'timeout',
  'truncated_arguments',
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
    samplingCount: sampling.count,
    toolCallCount: run.steps.filter(
      step => step.type === AGENT_STEP_TYPES.toolExecution,
    ).length,
    usage: sampling.usage,
    durationMs: elapsedMs(run.startedAt, run.endedAt),
    startedAt: run.startedAt.toISOString(),
    endedAt: toIsoString(run.endedAt),
    createdAt: run.createdAt.toISOString(),
  }
}

/**
 * 采样次数与 Token：action sampling 与 grounded finalization attempt 都是真实模型调用。
 * 每个 Usage 指标独立求和，任一调用该指标缺失则该指标为 null。
 */
function aggregateRunSampling(
  steps: AdminRunProjectionStepRecord[],
): { count: number, usage: AdminRunTokenUsage } {
  const samplingSteps = steps.filter(
    step => step.type === AGENT_STEP_TYPES.modelSampling,
  )
  const finalization = aggregateGroundedFinalization(steps)

  return {
    count: samplingSteps.length + finalization.attemptCount,
    usage: aggregateSamplingUsage([
      ...samplingSteps.map(step => projectTokenUsage(readObject(step.output))),
      ...finalization.usages,
    ]),
  }
}

export function projectAdminRunDetail(
  run: AdminRunDetailProjectionRecord,
): AdminRunDetail {
  return {
    ...projectAdminRunListItem(run),
    assistantMessageId: run.assistantMessageId,
    updatedAt: run.updatedAt.toISOString(),
    messages: [run.userMessage, run.assistantMessage]
      .filter((message): message is AdminRunDetailMessageRecord => message !== null)
      .map(projectMessage),
    timeline: [...run.steps].sort(compareSteps).map(projectTimelineItem),
    retrievalInspector: projectAdminRetrievalInspector({
      steps: run.steps,
      assistantMessage: run.assistantMessage,
    }),
  }
}

/** 已知 `type` 逐字段投影；只有未知 `type` 才是 Generic。 */
function projectTimelineItem(
  step: AdminRunDetailProjectionStepRecord,
): AdminRunTimelineItem {
  const input = readObject(step.input)
  const output = readObject(step.output)

  switch (step.type) {
    case AGENT_STEP_TYPES.loadConversationHistory:
      return projectLoadConversationHistory(step, output)
    case AGENT_STEP_TYPES.modelSampling:
      return projectModelSampling(step, input, output)
    case AGENT_STEP_TYPES.toolExecution:
      return projectToolExecution(step, input, output)
    case AGENT_STEP_TYPES.groundedFinalization:
      return projectGroundedFinalizationStep(step, knownStepBase(step))
    case AGENT_STEP_TYPES.assistantOutput:
      return projectAssistantOutput(step, input)
    default:
      return projectGenericStep(step)
  }
}

function projectLoadConversationHistory(
  step: AdminRunDetailProjectionStepRecord,
  output: Record<string, unknown> | null,
): AdminLoadConversationHistoryStep {
  return {
    ...knownStepBase(step),
    type: AGENT_STEP_TYPES.loadConversationHistory,
    messageCount: readNonNegativeInteger(output, 'messageCount'),
  }
}

function projectModelSampling(
  step: AdminRunDetailProjectionStepRecord,
  input: Record<string, unknown> | null,
  output: Record<string, unknown> | null,
): AdminModelSamplingStep {
  return {
    ...knownStepBase(step),
    type: AGENT_STEP_TYPES.modelSampling,
    samplingIndex: readPositiveInteger(input, 'samplingIndex'),
    samplingAttemptId: readString(input, 'samplingAttemptId'),
    providerItemCount: readNonNegativeInteger(output, 'messageCount'),
    finishReason: readAllowedString(output, 'finishReason', MODEL_FINISH_REASONS),
    usage: projectTokenUsage(output),
    toolCallCount: readNonNegativeInteger(output, 'toolCallCount'),
    contextInspector: projectContextInspector(input, output),
    debugRequestBody: readDebugModelIOCaptureEnvelope(output?.debugRequestBody),
    debugRawResponse: readDebugModelResponseCapture(output),
  }
}

function projectToolExecution(
  step: AdminRunDetailProjectionStepRecord,
  input: Record<string, unknown> | null,
  output: Record<string, unknown> | null,
): AdminToolExecutionStep {
  return {
    ...knownStepBase(step),
    type: AGENT_STEP_TYPES.toolExecution,
    callId: readString(input, 'callId'),
    toolName: readString(input, 'toolName'),
    samplingAttemptId: readString(input, 'samplingAttemptId'),
    ok: readBoolean(output, 'ok'),
    code: readAllowedString(output, 'code', TOOL_RESULT_CODES),
    originalChars: readNonNegativeInteger(output, 'originalChars'),
    observationChars: readNonNegativeInteger(output, 'observationChars'),
    truncated: readBoolean(output, 'truncated'),
  }
}

function projectAssistantOutput(
  step: AdminRunDetailProjectionStepRecord,
  input: Record<string, unknown> | null,
): AdminAssistantOutputStep {
  return {
    ...knownStepBase(step),
    type: AGENT_STEP_TYPES.assistantOutput,
    assistantMessageId: readString(input, 'assistantMessageId'),
  }
}

function projectGenericStep(
  step: AdminRunDetailProjectionStepRecord,
): AdminGenericStep {
  return {
    ...stepBase(step),
    kind: 'generic',
    type: toPreview(step.type, SAFE_TEXT_MAX_CHARS),
  }
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

/**
 * 读取落库的 debug 捕获信封；结构不符合预期时按未捕获处理（null），不报错。
 */
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

function compareSteps(
  left: AdminRunProjectionStepRecord,
  right: AdminRunProjectionStepRecord,
): number {
  return left.sequence - right.sequence || (left.id ?? '').localeCompare(right.id ?? '')
}
