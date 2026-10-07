import type { AssistantToolCallInputItem, MessageInputItem, ModelInputItem, ToolResultInputItem } from '@agent/ai'
import { AGENT_STEP_TYPES } from '../host.js'

export interface HistoryMessage {
  id: string
  role: 'USER' | 'ASSISTANT'
  content: string
  createdAt: Date
}

/** 历史里一次问答的 Run：只取配对、判断终态与找 Step 要用的列。 */
export interface HistoryRunRow {
  id: string
  userMessageId: string
  assistantMessageId: string | null
  status: 'RUNNING' | 'COMPLETED' | 'FAILED' | 'ABORTED'
}

/**
 * 历史回答所属 Run 的采样、工具与成功的本轮压缩 Step：SQL 只按 jsonb 路径取还原要用的几项，不读 debug 抓取等大字段。
 * JSON 里的值来自库，旧数据或损坏数据可能缺失、类型不对，一律按 unknown 读。
 */
export interface HistoryStepRow {
  runId: string
  sequence: number
  type: string
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
  /** 成功的本轮压缩 Step：从哪一轮起保留原文。 */
  keptFromSamplingAttemptId: unknown
  /** 成功的本轮压缩 Step：前缀摘要。 */
  summary: unknown
}

/** 历史里的一次问答（#218）：用户问题，加上回答还原出的工具调用、工具结果与最终回答；可以只有问题。 */
export interface HistoryGroup {
  /** 组键：组内第一条消息的 id，通常是用户问题；最旧一组没有问题的旧数据取它的第一条回答。 */
  key: string
  /** 这组对应几条 Message：contextPlan.historyIncludedCount 按 Message 条数记。 */
  messageCount: number
  /** 按读取时的快照能否进摘要（#220）：该问题的 Run 全部终态，或没有 Run 但有回答（旧数据）。 */
  summarizable: boolean
  /** 有回答消息；失败 / 停止的 Run 只留问题，序列化时标 unanswered。 */
  answered: boolean
  question: { content: string, createdAt: Date } | undefined
  /** 问题之后的还原形态：工具轮与最终回答；做过本轮压缩的问答是前缀摘要 + 保留的工具轮 + 最终回答。 */
  answer: ModelInputItem[]
  /** 问题之后的退回形式：回答消息全文（含中间文本），空回答不带。压缩的边界组按它保留。 */
  answerOnly: ModelInputItem[]
}

/** 最新一条历史压缩记录里读历史要用的部分。 */
export interface HistoryCompactionRecord {
  id: string
  summary: string
  coveredGroupIds: string[]
  answerOnlyGroupId: string | null
}

/**
 * 一次读取的历史：最新压缩记录（有的话）+ 不在它覆盖集合里的问答组，按 #218 顺序。模型看到的是
 * 摘要消息 + 这些组（记录的边界组用退回形式），见 `historyItems`。
 */
export interface ConversationHistory {
  /** 读取快照的时刻（事务里的 now()）：压缩记录按它排先后。 */
  readAt: Date
  compaction: HistoryCompactionRecord | undefined
  groups: HistoryGroup[]
}

/** 配好对、还没还原工具记录的一次问答。 */
export interface PairedGroup {
  key: string
  question: HistoryMessage | undefined
  /** 按时间先后；通常只有 Run 对上的那一条回答。没配上 Run 的回答没有 runId，只按消息全文还原。 */
  answers: Array<{ message: HistoryMessage, runId: string | undefined }>
  summarizable: boolean
}

/**
 * 按 Run 把问题与回答配成问答组（#218），并按读取时的快照判断能否进摘要（#220）。
 *
 * - 一次问答从一条用户消息开始，可以没有回答；问题与回答按 Run 的 userMessageId / assistantMessageId 对应，不按相邻位置。
 *   对不上问题的回答（没有 Run 的旧数据）按相邻位置并入前一组：除最旧一组外每组都从用户问题开始。
 * - 能进摘要：该问题的 Run 全部终态（COMPLETED / FAILED / ABORTED），或没有 Run 但有回答（旧数据）；进行中或卡在
 *   RUNNING 的组（只有问题，体积很小）不进摘要、不进覆盖集合，照原样还原。
 *
 * @param messages 已完成的消息，最旧在前。
 * @param runs 这些用户消息的全部 Run。
 */
export function pairHistory(messages: HistoryMessage[], runs: HistoryRunRow[]): PairedGroup[] {
  // 每条回答取最新的一次运行（runs 按创建时间升序，后到的覆盖先到的，同 messages.service.ts）。
  const runByAnswer = new Map<string, HistoryRunRow>()
  const runsByQuestion = new Map<string, HistoryRunRow[]>()

  for (const run of runs) {
    if (run.assistantMessageId)
      runByAnswer.set(run.assistantMessageId, run)
    const questionRuns = runsByQuestion.get(run.userMessageId)

    if (questionRuns)
      questionRuns.push(run)
    else
      runsByQuestion.set(run.userMessageId, [run])
  }

  const groups: Array<PairedGroup & { paired: boolean }> = []
  const groupsByQuestion = new Map<string, PairedGroup & { paired: boolean }>()

  for (const message of messages) {
    if (message.role === 'USER') {
      const group = { key: message.id, question: message, answers: [], summarizable: false, paired: false }

      groups.push(group)
      groupsByQuestion.set(message.id, group)
      continue
    }

    const run = runByAnswer.get(message.id)
    const group = run && groupsByQuestion.get(run.userMessageId)

    if (group && !group.paired) {
      group.answers.push({ message, runId: run.id })
      group.paired = true
    }
    else if (groups.length > 0) {
      groups.at(-1)!.answers.push({ message, runId: undefined })
    }
    else {
      groups.push({ key: message.id, question: undefined, answers: [{ message, runId: undefined }], summarizable: false, paired: false })
    }
  }

  return groups.map(({ paired: _paired, ...group }) => {
    const questionRuns = group.question ? runsByQuestion.get(group.question.id) ?? [] : []

    return {
      ...group,
      summarizable: questionRuns.length > 0
        ? questionRuns.every(run => run.status !== 'RUNNING')
        : group.answers.length > 0,
    }
  })
}

/**
 * 把配好的问答还原成模型输入（#218）：
 * - 带工具的回答还原成：每个工具调用轮一条 assistant（带 tool_calls，中间文本作 content，reasoning 给空串、不回放思考）
 *   和逐个工具结果，最后是最终回答；参数与 observation 原样带回，不解包、不缩短。
 * - 做过本轮压缩的回答（#220）按最后一条成功的本轮压缩还原：前缀摘要 + 从它保留的那一轮起的工具轮 + 最终回答。
 * - 空的回答（含最后一轮没有文字时的最终回答）不带：部分服务商拒收空内容，这条历史会让后续每次提问都失败；它仍计入 messageCount。
 * - 工具记录不完整、或最终回答的前缀对不上中间文本时，这次问答退回只带一问一答，不带半截记录与前缀摘要。
 *
 * @param groups 配好对的问答。
 * @param steps 回答所属 Run 的采样、工具与成功的本轮压缩 Step，任意顺序；没查 Step 的回答按消息全文还原。
 */
export function restoreGroups(groups: PairedGroup[], steps: HistoryStepRow[]): HistoryGroup[] {
  const stepsByRun = new Map<string, HistoryStepRow[]>()

  for (const step of steps) {
    const runSteps = stepsByRun.get(step.runId)

    if (runSteps)
      runSteps.push(step)
    else
      stepsByRun.set(step.runId, [step])
  }

  return groups.map(group => ({
    key: group.key,
    messageCount: (group.question ? 1 : 0) + group.answers.length,
    summarizable: group.summarizable,
    answered: group.answers.length > 0,
    question: group.question && { content: group.question.content, createdAt: group.question.createdAt },
    answer: group.answers.flatMap(({ message, runId }) => (runId && restoreToolRecords(message.content, stepsByRun.get(runId) ?? []))
      || toAnswerItems(message.content)),
    answerOnly: group.answers.flatMap(({ message }) => toAnswerItems(message.content)),
  }))
}

/** 一次问答发给模型的样子：问题 + 还原形态，或问题 + 退回形式。 */
export function groupItems(group: HistoryGroup, answerOnly: boolean): ModelInputItem[] {
  return [
    ...(group.question ? [{ type: 'message' as const, role: 'user' as const, content: group.question.content }] : []),
    ...(answerOnly ? group.answerOnly : group.answer),
  ]
}

/** 历史发给模型的样子：压缩记录的摘要消息 + 未被覆盖的组（记录的边界组用退回形式）。 */
export function historyItems(history: ConversationHistory): ModelInputItem[] {
  return [
    ...(history.compaction ? [historySummaryMessage(history.compaction.summary)] : []),
    ...history.groups.flatMap(group => groupItems(group, group.key === history.compaction?.answerOnlyGroupId)),
  ]
}

/** 历史摘要消息（一条用户消息）：前半句译自 Pi `messages.ts:11-17`；后两句是我们加的，防止把摘要里的问题再答一遍。 */
export function historySummaryMessage(summary: string): MessageInputItem {
  return {
    type: 'message',
    role: 'user',
    content: `此前的对话已压缩为以下摘要。摘要中的问题都已处理过（回答过或被放弃），只回答这条摘要之后用户的最新消息；摘要里没有的细节，可以按 Sources 重新打开或重新查询。\n\n<summary>\n${summary}\n</summary>`,
  }
}

/** 本轮压缩的前缀摘要消息（一条用户消息），放在问题之后、保留的工具轮之前；Run 结束后在历史里也这样还原。 */
export function turnSummaryMessage(summary: string): MessageInputItem {
  return {
    type: 'message',
    role: 'user',
    content: `本次问答前面的步骤已压缩为以下摘要。继续完成上面的用户请求，不要复述摘要。\n\n<summary>\n${summary}\n</summary>`,
  }
}

/**
 * 回答带工具记录时还原成 tool_calls / 工具结果 / 最终回答；没有工具调用轮或任何一步对不上时返回 undefined，调用方退回纯文本回答。
 * 「工具调用轮」指有对应工具 Step 的采样 Step；是否完整只看字段齐不齐，不看 Step 状态（ok=false、finishReason=length 照常还原）。
 * 有成功的本轮压缩时，最后一条的保留起点之前的工具轮换成前缀摘要；最终回答仍按全部轮的中间文本去前缀。
 */
function restoreToolRecords(content: string, steps: HistoryStepRow[]): ModelInputItem[] | undefined {
  const sorted = [...steps].sort((current, next) => current.sequence - next.sequence)
  // SQL 只取了成功的本轮压缩 Step；Run 内可能压过几次，最后一次决定 Run 结束时的样子。
  const turn = sorted.filter(step => step.type === AGENT_STEP_TYPES.contextCompaction).at(-1)
  // 按采样 Step 的先后插入，遍历顺序就是工具调用轮的顺序。
  const rounds = new Map<string, { sampling: HistoryStepRow, tools: HistoryStepRow[] }>()

  if (turn && (typeof turn.keptFromSamplingAttemptId !== 'string' || typeof turn.summary !== 'string'))
    return undefined

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

  const items: ModelInputItem[] = turn ? [turnSummaryMessage(turn.summary as string)] : []
  // 本轮压缩之前的工具轮不带原文，从保留起点那一轮开始带。
  let keeping = !turn
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

    keeping ||= sampling.samplingAttemptId === turn?.keptFromSamplingAttemptId
    if (keeping) {
      items.push(
        { type: 'assistant_tool_call', calls, reasoningContent: '', ...(intermediateText ? { content: intermediateText } : {}) },
        ...results,
      )
    }
    prefix += separateFromPreviousText(prefix, intermediateText)
  }

  // 保留起点那一轮对不上：退回一问一答。
  if (!keeping || !content.startsWith(prefix))
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
