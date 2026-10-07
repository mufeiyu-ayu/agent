import type { MessageActivity, MessageActivityItem, MessageActivityTool } from '@agent/contracts'

import { AGENT_STEP_TYPES } from '@agent/agent'
import { RUN_ROW_DELAY_MS } from '@agent/contracts'
import { toToolProgressArguments } from '../tools/web/tool-progress-arguments.js'
import { RESULT_COUNT } from '../tools/web/web-search.tool.js'

/**
 * 一个 Step 里还原要用的字段：SQL 只按 jsonb 路径取这几项，不读 observation（#212）。
 * JSON 里的值来自库，旧数据或损坏数据可能缺失、类型不对，一律按 unknown 读。
 */
export interface MessageActivityStepRow {
  messageId: string
  sequence: number
  type: string
  startedAt: Date | null
  endedAt: Date | null
  reasoningContent: unknown
  answerStartedMs: unknown
  callId: unknown
  toolName: unknown
  /** 回喂给模型的参数（JSON 文本）；被停止或中断的 Step 没有。 */
  arguments: unknown
  ok: unknown
  code: unknown
  display: unknown
}

/**
 * 一条回答的最新运行里的采样与工具 Step（任意顺序）→ activity；没有工具、没有思考且正文不到 1 秒就开始时没有
 * （实时也没有状态行）。
 * 数据缺失或结构不对时按降级规则省略对应字段，不抛错：被停止或进程中断遗留的工具 Step 记为「已停止」，
 * 旧运行没有 display 就不带来源与网页信息，没有 answerStartedMs 就不带「用时」。
 */
export function toMessageActivity(steps: MessageActivityStepRow[]): MessageActivity | undefined {
  const items: MessageActivityItem[] = []
  let answerStartedMs: number | undefined
  // 正文开始于哪个采样 Step：它之前的工具在正文之前。没出正文或旧数据时所有工具都算在正文之前。
  let answerStartedSequence: number | undefined
  let firstToolSequence: number | undefined

  for (const step of [...steps].sort((current, next) => current.sequence - next.sequence)) {
    if (step.type === AGENT_STEP_TYPES.modelSampling) {
      if (typeof step.reasoningContent === 'string' && step.reasoningContent)
        items.push({ kind: 'thought', text: step.reasoningContent })

      // 正文开始后收口的采样 Step 都带同一个值，取最早的那个。
      if (answerStartedSequence === undefined && isNonNegativeNumber(step.answerStartedMs)) {
        answerStartedMs = step.answerStartedMs
        answerStartedSequence = step.sequence
      }
    }
    // 没有工具名的只可能是损坏数据：跳过，不在时间线上出一行空的「使用工具」。
    else if (step.type === AGENT_STEP_TYPES.toolExecution && typeof step.toolName === 'string' && step.toolName) {
      items.push(toToolItem(step, step.toolName))
      firstToolSequence ??= step.sequence
    }
  }

  if (items.length === 0 && (answerStartedMs ?? 0) < RUN_ROW_DELAY_MS)
    return undefined

  return {
    ...(answerStartedMs === undefined ? {} : { answerStartedMs }),
    toolBeforeAnswer: firstToolSequence !== undefined
      && (answerStartedSequence === undefined || firstToolSequence < answerStartedSequence),
    items,
  }
}

/**
 * ok 与 failure 与 tool_finished 同一口径：工具自己在 display 里标了失败也算失败；
 * 没有收口结果（被停止、deadline 打断、工具抛错、进程中断停在 RUNNING）的记为已停止：ok 为 false、没有 failure。
 */
function toToolItem(step: MessageActivityStepRow, toolName: string): MessageActivityTool {
  const display = isRecord(step.display) ? step.display : {}
  const displayFailure = readFailure(display.failure)
  const skipped = step.code === 'workspace_replan'
  const failure = skipped
    ? undefined
    : step.ok === true
      ? displayFailure
      : step.ok === false
        // 旧数据没有 display：按失败码推出。
        ? displayFailure ?? (step.code === 'timeout' ? 'timeout' : 'failed')
        : undefined
  const results = readResults(display.results)
  const durationMs = step.startedAt && step.endedAt
    ? Math.max(0, step.endedAt.getTime() - step.startedAt.getTime())
    : undefined

  return {
    kind: 'tool',
    callId: typeof step.callId === 'string' ? step.callId : '',
    toolName,
    // 与 tool_started 同一规则：取不到就没有、按参数上限截断。
    ...(typeof step.arguments === 'string' ? toToolProgressArguments(unwrapFeedbackArguments(step.arguments), toolName) : {}),
    ...(isRecord(display.workspace) && typeof display.workspace.operation === 'string' && typeof display.workspace.title === 'string'
      && ['read', 'write', 'edit', 'bash', 'traffic'].includes(display.workspace.operation)
      ? { workspace: display.workspace as unknown as NonNullable<MessageActivityTool['workspace']> }
      : {}),
    ok: step.ok === true && !failure,
    ...(skipped ? { skipped: 'workspace_replan' as const } : {}),
    ...(failure ? { failure } : {}),
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(results ? { results } : {}),
    ...(typeof display.finalUrl === 'string' ? { finalUrl: display.finalUrl } : {}),
    ...(typeof display.title === 'string' ? { title: display.title } : {}),
    ...(isNonNegativeNumber(display.chars) ? { chars: display.chars } : {}),
  }
}

/**
 * 没通过校验的参数（参数无效、截断、未知工具）回喂时包成 `{"arguments": 原文}`（toFeedbackArgumentsJson）：
 * 拆出原文，与 tool_started 解析的是同一段；其余原样返回。
 */
function unwrapFeedbackArguments(argumentsJson: string): string {
  try {
    const parsed: unknown = JSON.parse(argumentsJson)

    if (isRecord(parsed) && Object.keys(parsed).length === 1 && typeof parsed.arguments === 'string')
      return parsed.arguments
  }
  catch {}

  return argumentsJson
}

function readFailure(value: unknown): 'timeout' | 'failed' | undefined {
  return value === 'timeout' || value === 'failed' ? value : undefined
}

/** 只留 title / url 都是字符串的来源；不是数组时没有来源。 */
function readResults(value: unknown): Array<{ title: string, url: string }> | undefined {
  if (!Array.isArray(value))
    return undefined

  return value
    .filter((result): result is { title: string, url: string } =>
      isRecord(result) && typeof result.title === 'string' && typeof result.url === 'string')
    .slice(0, RESULT_COUNT)
    .map(({ title, url }) => ({ title, url }))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
