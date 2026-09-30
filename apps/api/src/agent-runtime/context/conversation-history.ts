import type { AssistantToolCallInputItem, ModelInputItem, ToolResultInputItem } from '@agent/ai'
import type { Message } from '../../generated/prisma/client.js'
import type { HistoryGroup } from './model-context.js'

import { MessageRole } from '../../generated/prisma/client.js'
import { AGENT_STEP_TYPES } from '../lifecycle/agent-run-recorder.service.js'

/**
 * 候选回答所属 Run 的一个采样或工具 Step：SQL 只按 jsonb 路径取还原要用的几项，不读 debug 抓取等大字段。
 * 没有采样与工具 Step 的 Run 也有一行（Step 列为空），只用来把回答对上问题。
 * JSON 里的值来自库，旧数据或损坏数据可能缺失、类型不对，一律按 unknown 读。
 */
export interface HistoryStepRow {
  userMessageId: string
  assistantMessageId: string
  sequence: number | null
  type: string | null
  /** 采样与工具 Step 的 input 里都有，靠它把工具 Step 对上所属的采样轮。 */
  samplingAttemptId: unknown
  /** 采样 Step：这一轮模型给出的 call 数。 */
  toolCallCount: unknown
  /** 采样 Step：Tool Call 轮给用户看的文字，非空才有。 */
  intermediateText: unknown
  callId: unknown
  toolName: unknown
  /** 工具 Step：回喂给模型的参数（没通过校验时是 `{"arguments": raw}` 包装），收口时才写入。 */
  arguments: unknown
  /** 工具 Step：回喂给模型的正文（已按工具上限截断），收口时才写入。 */
  observation: unknown
  ok: unknown
}

/**
 * 把一个会话的历史候选还原成按问答分好组的模型输入（#218）。
 *
 * - 一次问答从一条用户消息开始，可以没有回答；问题与回答按 Run 的 userMessageId / assistantMessageId 对应，不按相邻位置。
 *   对不上问题的回答（没有 Run 的旧数据）按相邻位置并入前一组：除最旧一组外每组都从用户问题开始，按组裁剪后的历史不会以回答开头。
 * - 带工具的回答还原成：每个工具调用轮一条 assistant（带 tool_calls，中间文本作 content，reasoning 给空串、不回放思考）
 *   和逐个工具结果，最后是最终回答；参数与 observation 原样带回，不解包、不缩短。
 * - 空的回答（含最后一轮没有文字时的最终回答）不带：部分服务商拒收空内容，这条历史会让后续每次提问都失败；它仍计入 messageCount。
 * - 工具记录不完整、或最终回答的前缀对不上中间文本时，这次问答退回只带一问一答，不带半截记录。
 *
 * @param messages 严格早于当前用户消息的已完成消息，最旧在前。
 * @param steps 这些回答所属 Run 的采样与工具 Step，任意顺序。
 */
export function toHistoryGroups(messages: Message[], steps: HistoryStepRow[]): HistoryGroup[] {
  const runs = new Map<string, { userMessageId: string, steps: HistoryStepRow[] }>()

  for (const step of steps) {
    const run = runs.get(step.assistantMessageId) ?? { userMessageId: step.userMessageId, steps: [] }

    if (step.sequence !== null)
      run.steps.push(step)
    runs.set(step.assistantMessageId, run)
  }

  interface Group {
    user?: Message
    /** 按时间先后；通常只有 Run 对上的那一条回答。 */
    answers: Array<{ message: Message, steps: HistoryStepRow[] }>
    paired: boolean
  }

  const groups: Group[] = []
  const groupsByUser = new Map<string, Group>()

  for (const message of messages) {
    if (message.role === MessageRole.USER) {
      const group: Group = { user: message, answers: [], paired: false }

      groups.push(group)
      groupsByUser.set(message.id, group)
      continue
    }

    const run = runs.get(message.id)
    const group = run && groupsByUser.get(run.userMessageId)

    if (group && !group.paired) {
      group.answers.push({ message, steps: run.steps })
      group.paired = true
    }
    else if (groups.length > 0) {
      groups.at(-1)!.answers.push({ message, steps: [] })
    }
    else {
      groups.push({ answers: [{ message, steps: [] }], paired: false })
    }
  }

  return groups.map(({ user, answers }) => ({
    messageCount: (user ? 1 : 0) + answers.length,
    items: [
      ...(user ? [{ type: 'message' as const, role: 'user' as const, content: user.content }] : []),
      ...answers.flatMap(({ message, steps: answerSteps }) => restoreToolRecords(message.content, answerSteps)
        ?? toAnswerItems(message.content)),
    ],
  }))
}

/**
 * 回答带工具记录时还原成 tool_calls / 工具结果 / 最终回答；没有工具调用轮或任何一步对不上时返回 undefined，调用方退回纯文本回答。
 * 「工具调用轮」指有对应工具 Step 的采样 Step；是否完整只看字段齐不齐，不看 Step 状态（ok=false、finishReason=length 照常还原）。
 */
function restoreToolRecords(content: string, steps: HistoryStepRow[]): ModelInputItem[] | undefined {
  const sorted = [...steps].sort((current, next) => current.sequence! - next.sequence!)
  // 按采样 Step 的先后插入，遍历顺序就是工具调用轮的顺序。
  const rounds = new Map<string, { sampling: HistoryStepRow, tools: HistoryStepRow[] }>()

  for (const step of sorted) {
    if (step.type === AGENT_STEP_TYPES.modelSampling && typeof step.samplingAttemptId === 'string')
      rounds.set(step.samplingAttemptId, { sampling: step, tools: [] })
  }

  let toolStepCount = 0

  for (const step of sorted) {
    if (step.type !== AGENT_STEP_TYPES.toolExecution)
      continue

    const round = typeof step.samplingAttemptId === 'string' ? rounds.get(step.samplingAttemptId) : undefined

    if (!round)
      return undefined
    round.tools.push(step)
    toolStepCount += 1
  }

  if (toolStepCount === 0)
    return undefined

  const items: ModelInputItem[] = []
  // 各工具调用轮的文字当时就是按这个规则拼进回答的：逐轮重放，得到最终回答之前的那段前缀。
  let prefix = ''

  for (const { sampling, tools } of rounds.values()) {
    if (tools.length === 0)
      continue
    if (tools.length !== sampling.toolCallCount)
      return undefined

    const intermediateText = sampling.intermediateText ?? ''

    if (typeof intermediateText !== 'string')
      return undefined

    const calls: AssistantToolCallInputItem['calls'] = []
    const results: ToolResultInputItem[] = []

    for (const tool of tools) {
      if (
        typeof tool.callId !== 'string'
        || typeof tool.toolName !== 'string'
        || typeof tool.arguments !== 'string'
        || typeof tool.observation !== 'string'
      ) {
        return undefined
      }

      calls.push({ callId: tool.callId, name: tool.toolName, rawArgumentsJson: tool.arguments })
      results.push({ type: 'tool_result', callId: tool.callId, name: tool.toolName, content: tool.observation, ok: tool.ok === true })
    }

    items.push(
      { type: 'assistant_tool_call', calls, reasoningContent: '', ...(intermediateText ? { content: intermediateText } : {}) },
      ...results,
    )
    prefix += separateFromPreviousText(prefix, intermediateText)
  }

  if (!content.startsWith(prefix))
    return undefined

  // 最终回答那一轮的文字前面同样加过一段分隔符：去掉它，剩下的才是最终回答，同一段文字不出现两次。
  const rest = content.slice(prefix.length)
  const separator = rest ? separateFromPreviousText(prefix, rest).slice(0, -rest.length) : ''

  if (!rest.startsWith(separator))
    return undefined

  // 调完工具直接结束、最后一轮没有文字时（Claude、Gemini 常见）最终回答为空，不带。
  items.push(...toAnswerItems(rest.slice(separator.length)))

  return items
}

/** 回答的 assistant 消息；空的（含只有空白）不带。 */
function toAnswerItems(content: string): ModelInputItem[] {
  return content.trim() ? [{ type: 'message', role: 'assistant', content }] : []
}

/**
 * 用户可见文本跨轮拼接时保证中间隔一个空行，新一轮的文本另起一段：否则以 `## 标题` 或列表开头的
 * 回答会粘进上一段，只隔单个换行也只是段内软换行。runtime 按它拼回答，历史还原按它拆回。
 */
export function separateFromPreviousText(previous: string, next: string): string {
  if (!previous || !next || previous.endsWith('\n\n'))
    return next

  return `${previous.endsWith('\n') ? '\n' : '\n\n'}${next}`
}
