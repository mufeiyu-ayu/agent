import type {
  AdminAssistantOutputStep,
  AdminContextInspector,
  AdminDebugModelIOCapture,
  AdminDebugModelResponseCapture,
  AdminGenericStep,
  AdminLoadConversationHistoryStep,
  AdminModelSamplingStep,
  AdminRunDetail,
  AdminRunListItem,
  AdminRunMessage,
  AdminRunTimelineItem,
  AdminRunTokenUsage,
  AdminToolExecutionStep,
} from '@agent/contracts'
import type { Prisma } from '../../generated/prisma/client.js'
import type {
  ADMIN_RUN_DETAIL_SELECT,
  ADMIN_RUN_LIST_SELECT,
} from '../admin-runs.service.js'
import {
  ADMIN_MODEL_FINISH_REASONS,
  ADMIN_TOOL_RESULT_CODES,
  AGENT_RUN_ERROR_CODES,
} from '@agent/contracts'

import { AGENT_STEP_TYPES } from '../../agent-runtime/lifecycle/agent-run-recorder.service.js'
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

/** 投影输入就是 service 按 select 读出的行；类型从 select 派生，不另抄一份镜像接口。 */
type AdminRunListRecord = Prisma.AgentRunGetPayload<{ select: typeof ADMIN_RUN_LIST_SELECT }>
export type AdminRunDetailRecord = Prisma.AgentRunGetPayload<{ select: typeof ADMIN_RUN_DETAIL_SELECT }>
type AdminRunDetailStepRecord = AdminRunDetailRecord['steps'][number]
type AdminRunDetailMessageRecord = AdminRunDetailRecord['userMessage']

export function projectAdminRunListItem(
  run: AdminRunListRecord,
): AdminRunListItem {
  const sampling = aggregateRunSampling(run.steps)

  return {
    id: run.id,
    conversationId: run.conversationId,
    status: run.status,
    // 旧 Run 没有这一列的值，读出 null 由前端显示「未记录」。
    errorCode: readAllowedString(run, 'errorCode', AGENT_RUN_ERROR_CODES),
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
  steps: AdminRunListRecord['steps'],
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
  run: AdminRunDetailRecord,
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
  step: AdminRunDetailStepRecord,
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
  step: AdminRunDetailStepRecord,
  output: Record<string, unknown> | null,
): AdminLoadConversationHistoryStep {
  return {
    ...knownStepBase(step),
    type: AGENT_STEP_TYPES.loadConversationHistory,
    messageCount: readNonNegativeInteger(output, 'messageCount'),
  }
}

function projectModelSampling(
  step: AdminRunDetailStepRecord,
  input: Record<string, unknown> | null,
  output: Record<string, unknown> | null,
): AdminModelSamplingStep {
  const samplingIndex = readNonNegativeInteger(input, 'samplingIndex')

  return {
    ...knownStepBase(step),
    type: AGENT_STEP_TYPES.modelSampling,
    // 轮次从 1 起算；0 只可能来自损坏数据，按读不出处理。
    samplingIndex: samplingIndex === 0 ? null : samplingIndex,
    samplingAttemptId: readString(input, 'samplingAttemptId'),
    finishReason: readAllowedString(output, 'finishReason', ADMIN_MODEL_FINISH_REASONS),
    usage: projectTokenUsage(output),
    toolCallCount: readNonNegativeInteger(output, 'toolCallCount'),
    firstTokenMs: readNonNegativeInteger(output, 'firstTokenMs'),
    errorCode: readAllowedString(output, 'errorCode', AGENT_RUN_ERROR_CODES),
    contextInspector: projectContextInspector(input, output),
    debugRequestBody: readDebugModelIOCaptureEnvelope(output?.debugRequestBody),
    debugRawResponse: readDebugModelResponseCapture(output),
  }
}

function projectToolExecution(
  step: AdminRunDetailStepRecord,
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
    code: readAllowedString(output, 'code', ADMIN_TOOL_RESULT_CODES),
    originalChars: readNonNegativeInteger(output, 'originalChars'),
    observationChars: readNonNegativeInteger(output, 'observationChars'),
    truncated: readBoolean(output, 'truncated'),
  }
}

function projectAssistantOutput(
  step: AdminRunDetailStepRecord,
  input: Record<string, unknown> | null,
): AdminAssistantOutputStep {
  return {
    ...knownStepBase(step),
    type: AGENT_STEP_TYPES.assistantOutput,
    assistantMessageId: readString(input, 'assistantMessageId'),
  }
}

function projectGenericStep(
  step: AdminRunDetailStepRecord,
): AdminGenericStep {
  return {
    ...stepBase(step),
    kind: 'generic',
    type: toPreview(step.type, SAFE_TEXT_MAX_CHARS),
  }
}

function knownStepBase(step: AdminRunDetailStepRecord) {
  return {
    ...stepBase(step),
    kind: 'known' as const,
  }
}

function stepBase(step: AdminRunDetailStepRecord) {
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
 * 按 sampling Step 的 `input.initialContext` 与 `output.contextPlan` 逐字段投影。
 *
 * 字段能读就读，读不出就 null；不做跨字段等式或跨 Step 序列检查。
 */
function projectContextInspector(
  input: Record<string, unknown> | null,
  output: Record<string, unknown> | null,
): AdminContextInspector {
  const initialContext = readObject(input?.initialContext)
  const contextPlan = readObject(output?.contextPlan)
  const contextFailureReason = readAllowedString(
    output,
    'contextFailureReason',
    ['estimator_failure'],
  )
  const overflowReason = readAllowedString(
    contextPlan,
    'overflowReason',
    ['minimum_context'],
  )
  return {
    outcome: contextFailureReason === 'estimator_failure'
      ? 'estimator_failure'
      : overflowReason === 'minimum_context'
        ? 'minimum_context_overflow'
        : contextPlan
          ? 'success'
          : null,
    resolvedModel: readString(initialContext, 'resolvedModel'),
    providerId: readString(initialContext, 'providerId'),
    modelId: readString(initialContext, 'modelId'),
    // 预算在 plan 前就已解析并写入 initialContext，plan 失败时从这里兜底读取。
    resolvedInputBudgetTokens: readNonNegativeInteger(contextPlan, 'resolvedInputBudgetTokens')
      ?? readNonNegativeInteger(initialContext, 'resolvedInputBudgetTokens'),
    estimatedInputTokens: readNonNegativeInteger(contextPlan, 'estimatedInputTokens'),
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
  left: AdminRunDetailStepRecord,
  right: AdminRunDetailStepRecord,
): number {
  return left.sequence - right.sequence || left.id.localeCompare(right.id)
}
