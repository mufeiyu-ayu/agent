import type {
  AdminAssistantOutputStep,
  AdminContextCompactionStep,
  AdminContextInspector,
  AdminConversationCompaction,
  AdminDebugModelIOCapture,
  AdminDebugModelResponseCapture,
  AdminGenericStep,
  AdminLoadConversationHistoryStep,
  AdminModelRef,
  AdminModelSamplingStep,
  AdminRunDetail,
  AdminRunListItem,
  AdminRunMessage,
  AdminRunTimelineItem,
  AdminToolExecutionStep,
  AgentRunStatus,
  AgentStepStatus,
} from '@agent/contracts'
import type { Prisma } from '../../generated/prisma/client.js'
import type { ModelKey } from '../admin-model-refs.js'
import type { ADMIN_RUN_COMPACTION_SELECT, ADMIN_RUN_DETAIL_SELECT } from '../admin-runs.service.js'
import {
  ADMIN_MODEL_FINISH_REASONS,
  ADMIN_TOOL_RESULT_CODES,
  AGENT_RUN_ERROR_CODES,
} from '@agent/contracts'

import { AGENT_STEP_TYPES } from '../../agent-runtime/lifecycle/agent-run-recorder.service.js'
import {
  elapsedMs,
  readAllowedString,
  readBoolean,
  readNonNegativeInteger,
  readObject,
  readString,
  readText,
  toAllowedString,
  toIsoString,
  toPreview,
} from './safe-readers.js'
import {
  aggregateRunModelCalls,
  projectTokenUsage,
} from './sampling-usage.projector.js'

const QUESTION_PREVIEW_MAX_CHARS = 200
const MESSAGE_PREVIEW_MAX_CHARS = 500
const FAILURE_MESSAGE_MAX_CHARS = 300
const SAFE_TEXT_MAX_CHARS = 128
const COMPACTION_REASONS = ['threshold', 'overflow', 'after_run'] as const

/**
 * 列表页的 Run 行：Run 列加上该 Run 的 Step 行。列表的 Step 行由 service 用 SQL 只取计数、usage、
 * 模型快照与错误文案需要的 JSON 路径；详情行是它的超集，同一个投影直接复用。
 */
export interface AdminRunListRecord {
  id: string
  conversationId: string
  status: AgentRunStatus
  errorCode: string | null
  startedAt: Date
  endedAt: Date | null
  createdAt: Date
  userMessage: { content: string }
  steps: AdminRunListStepRecord[]
}

export interface AdminRunListStepRecord {
  sequence: number
  type: string
  status: AgentStepStatus
  input: unknown
  output: unknown
  errorMessage: string | null
  endedAt: Date | null
}

/** 详情投影输入就是 service 按 select 读出的行；类型从 select 派生，不另抄一份镜像接口。 */
export type AdminRunDetailRecord = Prisma.AgentRunGetPayload<{ select: typeof ADMIN_RUN_DETAIL_SELECT }>
type AdminRunDetailStepRecord = AdminRunDetailRecord['steps'][number]
type AdminRunDetailMessageRecord = AdminRunDetailRecord['userMessage']
/** 历史压缩记录的行（#220），由 service 按 `ADMIN_RUN_COMPACTION_SELECT` 读出。 */
export type AdminRunCompactionRecord = Prisma.ConversationCompactionGetPayload<{ select: typeof ADMIN_RUN_COMPACTION_SELECT }>

/** model 由 service 按 `readRunModelKey` 的结果关联模型行得出。 */
export function projectAdminRunListItem(
  run: AdminRunListRecord,
  model: AdminModelRef | null,
): AdminRunListItem {
  const modelCalls = aggregateRunModelCalls(run.steps)

  return {
    id: run.id,
    conversationId: run.conversationId,
    status: run.status,
    // 旧 Run 没有这一列的值，读出 null 由前端显示「未记录」。
    errorCode: toAllowedString(run.errorCode, AGENT_RUN_ERROR_CODES),
    failureMessage: readFailureMessage(run),
    model,
    questionPreview: toPreview(run.userMessage.content, QUESTION_PREVIEW_MAX_CHARS),
    samplingCount: modelCalls.count,
    toolCallCount: run.steps.filter(
      step => step.type === AGENT_STEP_TYPES.toolExecution,
    ).length,
    usage: modelCalls.usage,
    durationMs: elapsedMs(run.startedAt, run.endedAt),
    startedAt: run.startedAt.toISOString(),
    endedAt: toIsoString(run.endedAt),
    createdAt: run.createdAt.toISOString(),
  }
}

/** Run 的模型快照：取第一条采样 Step 的 initialContext；一次 Run 只用一个模型。 */
export function readRunModelKey(steps: AdminRunListStepRecord[]): ModelKey | null {
  const sampling = steps
    .filter(step => step.type === AGENT_STEP_TYPES.modelSampling)
    .sort(bySequence)
    .at(0)
  const initialContext = readObject(readObject(sampling?.input)?.initialContext)
  // 空串与缺失同样按「没有记录」处理，与概览 SQL 的 nullif 一致。
  const modelId = readString(initialContext, 'modelId', Number.POSITIVE_INFINITY) || null
  const resolvedModel = readString(initialContext, 'resolvedModel', Number.POSITIVE_INFINITY) || null

  return modelId || resolvedModel ? { modelId, resolvedModel } : null
}

/**
 * 失败 / 中断 Run 的失败文案：终态事务用同一个时间戳收口 Run 与失败 Step，只认这批 Step；
 * 更早失败、已作为 observation 回喂模型的工具 Step 与终态无关。在两个 Step 之间中断时没有
 * 这样的 Step，返回 null。runtime 写入的都是用户可见的安全文案。
 * 服务商报超长、强制压缩又失败时（#220），失败的采样 Step 在压缩前就已收口；本 Run 还没推出过正文时，
 * 终态时没有 Step 一起收口，取最后一次以同一类别失败的采样。
 */
function readFailureMessage(run: AdminRunListRecord): string | null {
  if ((run.status !== 'FAILED' && run.status !== 'ABORTED') || !run.endedAt)
    return null

  const runEndedAt = run.endedAt.getTime()
  const failed = run.steps
    .filter(step => step.errorMessage && step.endedAt?.getTime() === runEndedAt)
    .sort(bySequence)
    .at(-1)
    ?? (run.errorCode === 'llm_context_overflow'
      ? run.steps
          .filter(step => step.type === AGENT_STEP_TYPES.modelSampling && step.errorMessage && readObject(step.output)?.errorCode === run.errorCode)
          .sort(bySequence)
          .at(-1)
      : undefined)

  return failed?.errorMessage ? toPreview(failed.errorMessage, FAILURE_MESSAGE_MAX_CHARS) : null
}

/** sequence 在同一 Run 内唯一（数据库约束），列表 Step 行没有 id 可做次序兜底。 */
function bySequence(left: { sequence: number }, right: { sequence: number }): number {
  return left.sequence - right.sequence
}

/** 本 Run 的采样基于的、与历史压缩 Step 写成的压缩记录 id（#220）；service 连同本 Run 写的记录一起读出。 */
export function readReferencedCompactionIds(steps: AdminRunDetailStepRecord[]): string[] {
  const ids = steps.flatMap((step) => {
    const output = readObject(step.output)
    const id = step.type === AGENT_STEP_TYPES.modelSampling
      ? readString(readObject(output?.contextPlan), 'compactionId')
      : step.type === AGENT_STEP_TYPES.contextCompaction
        ? readString(output, 'compactionId')
        : null

    return id ? [id] : []
  })

  return [...new Set(ids)]
}

export function projectAdminRunDetail(
  run: AdminRunDetailRecord,
  model: AdminModelRef | null,
  compactions: AdminRunCompactionRecord[] = [],
): AdminRunDetail {
  // 读到的历史条数是 Run 级事实，只记在 load_conversation_history；#220 之前的采样详情「选入 X / 候选 Y」要用它。
  const historyCandidateCount = readNonNegativeInteger(
    readObject(run.steps.find(
      step => step.type === AGENT_STEP_TYPES.loadConversationHistory,
    )?.output),
    'messageCount',
  )

  return {
    ...projectAdminRunListItem(run, model),
    assistantMessageId: run.assistantMessageId,
    updatedAt: run.updatedAt.toISOString(),
    messages: [run.userMessage, run.assistantMessage]
      .filter((message): message is AdminRunDetailMessageRecord => message !== null)
      .map(projectMessage),
    timeline: [...run.steps]
      .sort(compareSteps)
      .map(step => projectTimelineItem(step, historyCandidateCount)),
    compactions: compactions.map(projectCompaction),
  }
}

function projectCompaction(record: AdminRunCompactionRecord): AdminConversationCompaction {
  return {
    id: record.id,
    runId: record.runId,
    reason: toAllowedString(record.reason, COMPACTION_REASONS),
    summary: record.summary,
    coveredGroupCount: record.coveredGroupIds.length,
    tokensBefore: record.tokensBefore,
    usage: projectTokenUsage({ usage: record.usage }),
    createdAt: record.createdAt.toISOString(),
  }
}

/** 已知 `type` 逐字段投影；只有未知 `type` 才是 Generic。 */
function projectTimelineItem(
  step: AdminRunDetailStepRecord,
  historyCandidateCount: number | null,
): AdminRunTimelineItem {
  const input = readObject(step.input)
  const output = readObject(step.output)

  switch (step.type) {
    case AGENT_STEP_TYPES.loadConversationHistory:
      return projectLoadConversationHistory(step, output)
    case AGENT_STEP_TYPES.modelSampling:
      return projectModelSampling(step, input, output, historyCandidateCount)
    case AGENT_STEP_TYPES.toolExecution:
      return projectToolExecution(step, input, output)
    case AGENT_STEP_TYPES.assistantOutput:
      return projectAssistantOutput(step, input)
    case AGENT_STEP_TYPES.contextCompaction:
      return projectContextCompaction(step, input, output)
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
  historyCandidateCount: number | null,
): AdminModelSamplingStep {
  const samplingIndex = readNonNegativeInteger(input, 'samplingIndex')
  const finishReason = readAllowedString(output, 'finishReason', ADMIN_MODEL_FINISH_REASONS)
  const toolCallCount = readNonNegativeInteger(output, 'toolCallCount')
  // 只有收完的 Tool Call 轮才把思考回填模型；最终回答轮与没收完的一轮也存了思考（#212），只为前台还原，这里不列。
  const fedBackToModel = !!toolCallCount && (finishReason === 'tool_calls' || finishReason === 'length')

  return {
    ...knownStepBase(step),
    type: AGENT_STEP_TYPES.modelSampling,
    // 轮次从 1 起算；0 只可能来自损坏数据，按读不出处理。
    samplingIndex: samplingIndex === 0 ? null : samplingIndex,
    samplingAttemptId: readString(input, 'samplingAttemptId'),
    finishReason,
    usage: projectTokenUsage(output),
    toolCallCount,
    firstTokenMs: readNonNegativeInteger(output, 'firstTokenMs'),
    errorCode: readAllowedString(output, 'errorCode', AGENT_RUN_ERROR_CODES),
    intermediateText: readText(output, 'intermediateText'),
    reasoningContent: fedBackToModel ? readText(output, 'reasoningContent') : null,
    contextInspector: projectContextInspector(input, output, historyCandidateCount),
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
    arguments: readText(input, 'arguments'),
    observation: readText(output, 'observation'),
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

function projectContextCompaction(
  step: AdminRunDetailStepRecord,
  input: Record<string, unknown> | null,
  output: Record<string, unknown> | null,
): AdminContextCompactionStep {
  return {
    ...knownStepBase(step),
    type: AGENT_STEP_TYPES.contextCompaction,
    layer: readAllowedString(input, 'kind', ['history', 'turn']),
    tokensBefore: readNonNegativeInteger(output, 'tokensBefore'),
    usage: projectTokenUsage(output),
    errorMessage: step.errorMessage === null ? null : toPreview(step.errorMessage, FAILURE_MESSAGE_MAX_CHARS),
    compactionId: readString(output, 'compactionId'),
    keptFromSamplingAttemptId: readString(input, 'keptFromSamplingAttemptId'),
    summary: readText(output, 'summary'),
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
 * 按 sampling Step 的 `input.initialContext` 与 `output.contextPlan` 逐字段投影；
 * 读到的历史条数是 Run 级事实，由调用方从 load_conversation_history 读好传入。
 * outcome：#220 起按本轮的失败类别得出（服务商报超长），旧 Run 照旧读 contextFailureReason / overflowReason。
 *
 * 字段能读就读，读不出就 null；不做跨字段等式或跨 Step 序列检查。
 */
function projectContextInspector(
  input: Record<string, unknown> | null,
  output: Record<string, unknown> | null,
  historyCandidateCount: number | null,
): AdminContextInspector {
  const initialContext = readObject(input?.initialContext)
  const contextPlan = readObject(output?.contextPlan)
  // #220 起 contextPlan 总带 compactionId 键（没有为 null）：之前的按预算选入历史，「候选」条数只对它们有意义。
  // 还没收口的采样没有 contextPlan，不当成旧的。
  const budgetTrimmed = contextPlan !== null && !Object.hasOwn(contextPlan, 'compactionId')
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
  const errorCode = readAllowedString(output, 'errorCode', AGENT_RUN_ERROR_CODES)

  return {
    outcome: errorCode === 'llm_context_overflow'
      ? 'llm_context_overflow'
      : contextFailureReason === 'estimator_failure'
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
    historyIncludedCount: readNonNegativeInteger(contextPlan, 'historyIncludedCount'),
    historyCandidateCount: budgetTrimmed ? historyCandidateCount : null,
    compactionId: readString(contextPlan, 'compactionId'),
    turnCompactionStepId: readString(contextPlan, 'turnCompactionStepId'),
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
