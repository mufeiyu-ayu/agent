import type { ModelInputItem } from '@agent/ai'
import type { ConversationHistory, HistoryGroup } from './conversation-history.js'
import type { ModelContextToolExchange } from './model-context.js'

import { groupItems } from './conversation-history.js'
import { estimateItemTokens, roughTokens } from './token-estimate.js'

/**
 * 上下文压缩的纯逻辑（#220）：提示词、序列化、切点与分块。编排（何时压、写 Step、落库）在
 * `context-compaction.service.ts`。机制照抄 Pi（`packages/coding-agent/src/core/compaction/`，890f920），
 * 我们加的逐条标明。
 */

/** 历史摘要与本轮 UPDATE 的输出上限（Pi 0.8 × reserveTokens 16384）；实际再取 min(它, 模型最大输出)。 */
export const SUMMARY_MAX_TOKENS = 13_107
/** 本轮压缩首次写前缀摘要的输出上限（Pi 0.5 × 16384）。 */
export const TURN_PREFIX_SUMMARY_MAX_TOKENS = 8_192
/** 保留最近原文最多占触发线的比例（我们加的，参考 opencode 保留量默认 25%）。 */
const KEEP_RECENT_RATIO = 0.25
/** 摘要输入粗估超过触发线的这个比例就按整组分块（我们加的：长会话首次压缩可能超过模型窗口，opencode #48844）。 */
const CHUNK_RATIO = 0.5
/** 序列化时工具结果截到的字符数（照抄 Pi，按 JS 字符串长度）。 */
const TOOL_RESULT_MAX_CHARS = 2_000

const BEIJING_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' })

// 提示词：照抄 Pi 890f920 英文原文（`utils.ts:156-158`、`compaction.ts:479-551,847-860`），
// 【我们加的】见 Issue #220 附录：Sources 一栏，URL / 数字 / 日期一字不改，修改要求与否决方案必须保留，
// 没回答的问题不进进行中，用用户的语言写；UPDATE 的「冲突时以新内容为准」改写自 opencode
// `packages/core/src/session/compaction.ts:51`（原文："The <conversation> is more recent than the <prior-summary>.
// Where they conflict, the conversation wins: state the corrected fact and drop the old claim."）。

export const SUMMARIZATION_SYSTEM_PROMPT = `You are a context summarization assistant. Your task is to read a conversation between a user and an AI assistant, then produce a structured summary following the exact format specified.

Do NOT continue the conversation. Do NOT respond to any questions in the conversation. ONLY output the structured summary.`

const SUMMARIZATION_PROMPT = `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.

Use this EXACT format:

## Goal
[What is the user trying to accomplish? Can be multiple items if the session covers different tasks.]

## Constraints & Preferences
- [Any constraints, preferences, or requirements mentioned by user]
- [Or "(none)" if none were mentioned]

## Progress
### Done
- [x] [Completed tasks/changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Any data, examples, or references needed to continue]
- [Or "(none)" if not applicable]

## Sources
- [<URL> — <page title or what question it answered> (<date from the [User] line>)]
- [Search queries that were run]
- [Or "(none)" if no tools were used]

Keep each section concise. Preserve exact file paths, function names, and error messages.
Also preserve exact URLs, numbers and dates.
For ordinary Q&A, record each question with the answer or conclusion given under Done; write "(none)" under In Progress and Next Steps unless the user explicitly left a multi-step task unfinished.
Questions marked (unanswered) were abandoned; do not list them under In Progress or Next Steps.
Record every change request and every rejected approach from the user under Constraints & Preferences, and never drop them.
Keep the whole summary well under 4,000 tokens; if Sources grows long, keep the most relevant ones.
Write the summary in the language the user writes in.`

const UPDATE_SUMMARIZATION_PROMPT = `The messages above are NEW conversation messages to incorporate into the existing summary provided in <previous-summary> tags.

Update the existing structured summary with new information. RULES:
- PRESERVE all existing information from the previous summary
- ADD new progress, decisions, and context from the new messages
- UPDATE the Progress section: move items from "In Progress" to "Done" when completed
- UPDATE "Next Steps" based on what was accomplished
- PRESERVE exact file paths, function names, and error messages
- PRESERVE exact URLs, numbers and dates
- If something is no longer relevant, you may remove it
- The new messages are more recent than the previous summary. Where they conflict, the new messages win: state the corrected fact and drop the old claim.

Use this EXACT format:

## Goal
[Preserve existing goals, add new ones if the task expanded]

## Constraints & Preferences
- [Preserve existing, add new ones discovered]

## Progress
### Done
- [x] [Include previously done items AND newly completed items]

### In Progress
- [ ] [Current work - update based on progress]

### Blocked
- [Current blockers - remove if resolved]

## Key Decisions
- **[Decision]**: [Brief rationale] (preserve all previous, add new)

## Next Steps
1. [Update based on current state]

## Critical Context
- [Preserve important context, add new if needed]

## Sources
- [Preserve existing sources, add new ones: <URL> — <page title or what question it answered> (<date>)]

Keep each section concise. Preserve exact file paths, function names, and error messages.
Also preserve exact URLs, numbers and dates.
For ordinary Q&A, record each question with the answer or conclusion given under Done; write "(none)" under In Progress and Next Steps unless the user explicitly left a multi-step task unfinished.
Questions marked (unanswered) were abandoned; do not list them under In Progress or Next Steps.
Record every change request and every rejected approach from the user under Constraints & Preferences, and never drop them.
Keep the whole summary well under 4,000 tokens; if Sources grows long, keep the most relevant ones.
Write the summary in the language the user writes in.`

const TURN_PREFIX_SUMMARIZATION_PROMPT = `This is the PREFIX of a turn that was too large to keep. The SUFFIX (recent work) is retained.

Summarize the prefix to provide context for the retained suffix:

## Original Request
[What did the user ask for in this turn?]

## Early Progress
- [Key decisions and work done in the prefix]

## Context for Suffix
- [Information needed to understand the retained recent work]

## Sources
- [<URL> — <page title or what it was used for>]
- [Or "(none)"]

Be concise. Focus on what's needed to understand the kept suffix.
Preserve exact URLs, numbers and dates.
Write the summary in the language the user writes in.`

/** 保留最近原文的预算：min(运行配置, 触发线的 1/4)（我们加的：保留部分离触发线太近会反复压缩或压不下去）。 */
export function keepRecentBudget(keepRecentTokens: number, triggerTokens: number): number {
  return Math.min(keepRecentTokens, Math.floor(KEEP_RECENT_RATIO * triggerTokens))
}

/** 摘要输入按整组分块的预算。 */
function summaryChunkBudget(triggerTokens: number): number {
  return Math.floor(CHUNK_RATIO * triggerTokens)
}

/**
 * 摘要请求里的那条用户消息（照抄 Pi `compaction.ts:701-705`）：对话原文包在 `<conversation>` 里，
 * 有旧摘要时放 `<previous-summary>`，最后是提示词（所以提示词写 "The messages above"）。
 */
export function summaryRequestText(input: {
  kind: 'history' | 'turn_prefix'
  conversation: string
  previousSummary: string | undefined
}): string {
  const prompt = input.previousSummary !== undefined
    ? UPDATE_SUMMARIZATION_PROMPT
    : input.kind === 'history' ? SUMMARIZATION_PROMPT : TURN_PREFIX_SUMMARIZATION_PROMPT
  const previous = input.previousSummary !== undefined
    ? `<previous-summary>\n${input.previousSummary}\n</previous-summary>\n\n`
    : ''

  return `<conversation>\n${input.conversation}\n</conversation>\n\n${previous}${prompt}`
}

/**
 * 一次问答按它在历史里的样子写成摘要输入（照抄 Pi `serializeConversation`）。问题带用户消息创建时的北京日期，
 * 没有回答的标 unanswered（都是我们加的：前者让 Sources 的时间有依据，后者防止把没答完的问题写进「进行中」）。
 */
export function serializeGroup(group: HistoryGroup, answerOnly: boolean): string {
  return [
    ...(group.question
      ? [`[User] (${BEIJING_DATE.format(group.question.createdAt)}${group.answered ? '' : ', unanswered'}): ${group.question.content}`]
      : []),
    ...(answerOnly ? group.answerOnly : group.answer).flatMap(serializeItem),
  ].join('\n\n')
}

/** 本轮压缩的摘要输入：首次带上当前问题（Pi 的前缀里有这条用户消息），UPDATE 只写上次保留起点之后的工具轮。 */
export function serializeTurnPrefix(input: {
  question: { content: string, createdAt: Date } | undefined
  exchanges: readonly ModelContextToolExchange[]
}): string {
  return [
    ...(input.question ? [`[User] (${BEIJING_DATE.format(input.question.createdAt)}): ${input.question.content}`] : []),
    ...input.exchanges.flatMap(exchange => [
      ...serializeItem(exchange.assistantCall),
      ...exchange.results.flatMap(serializeItem),
    ]),
  ].join('\n\n')
}

/**
 * 一个输入项写成若干段（照抄 Pi `utils.ts:109-150`）：同一条 assistant 按思考 → 正文 → 工具调用；
 * 工具参数写成 `k=JSON`、不截断；工具结果超过 2,000 字符截断并标出截掉的字符数；空的段不写。
 */
function serializeItem(item: ModelInputItem): string[] {
  switch (item.type) {
    case 'message':
      if (item.role === 'user')
        return item.content ? [`[User]: ${item.content}`] : []
      return item.role === 'assistant' ? [`[Assistant]: ${item.content}`] : []
    case 'assistant_tool_call':
      return [
        ...(item.reasoningContent ? [`[Assistant thinking]: ${item.reasoningContent}`] : []),
        ...(item.content === undefined ? [] : [`[Assistant]: ${item.content}`]),
        `[Assistant tool calls]: ${item.calls.map(call => `${call.name}(${formatArguments(call.rawArgumentsJson)})`).join('; ')}`,
      ]
    case 'tool_result':
      return item.content ? [`[Tool result]: ${truncateForSummary(item.content)}`] : []
  }
}

/** 回喂的参数总是 JSON 对象（没通过校验的是 `{"arguments": raw}` 包装）；读不出对象时按同一包装写。 */
function formatArguments(rawArgumentsJson: string): string {
  let args: unknown

  try {
    args = JSON.parse(rawArgumentsJson)
  }
  catch {}

  const entries = typeof args === 'object' && args !== null && !Array.isArray(args)
    ? Object.entries(args)
    : [['arguments', rawArgumentsJson] as const]

  return entries.map(([key, value]) => `${key}=${JSON.stringify(value)}`).join(', ')
}

function truncateForSummary(text: string): string {
  return text.length <= TOOL_RESULT_MAX_CHARS
    ? text
    : `${text.slice(0, TOOL_RESULT_MAX_CHARS)}\n\n[... ${text.length - TOOL_RESULT_MAX_CHARS} more characters truncated]`
}

/** 一次历史压缩要做什么。 */
export interface HistoryCompactionPlan {
  /** 要写进摘要的组，按历史顺序；每组按它现在在历史里的样子序列化。 */
  groups: HistoryGroup[]
  /** 以「问题 + 回答全文」保留的边界组：完整形态进了摘要，但仍显示、不进覆盖集合。 */
  answerOnlyGroupKey: string | undefined
}

/**
 * 历史压缩的切点（我们加的：会话级只覆盖问答整组，参考 opencode 整轮保留）：只看可摘要的组，从最新往回按每组
 * 在历史里的样子整组累加粗估，放得下就保留；第一组放不下的是边界组，它的退回形式放得下就以退回形式保留、
 * 完整内容进摘要，否则整组进摘要；更早的全部进摘要。没有新的可摘要组时返回 undefined（照 Pi `:817-819`）。
 */
export function planHistoryCompaction(history: ConversationHistory, keepBudget: number): HistoryCompactionPlan | undefined {
  const candidates = history.groups.filter(group => group.summarizable)
  const shownTokens = (group: HistoryGroup, answerOnly: boolean) =>
    groupItems(group, answerOnly).reduce((tokens, item) => tokens + estimateItemTokens(item), 0)
  let used = 0
  let boundaryIndex = candidates.length - 1

  for (; boundaryIndex >= 0; boundaryIndex -= 1) {
    const group = candidates[boundaryIndex]!
    const tokens = shownTokens(group, group.key === history.compaction?.answerOnlyGroupId)

    if (used + tokens > keepBudget)
      break
    used += tokens
  }

  if (boundaryIndex < 0)
    return undefined

  const boundary = candidates[boundaryIndex]!

  return {
    groups: candidates.slice(0, boundaryIndex + 1),
    answerOnlyGroupKey: used + shownTokens(boundary, true) <= keepBudget ? boundary.key : undefined,
  }
}

/** 历史摘要的一块：一次摘要调用的输入，与它成功后那条记录的覆盖范围。 */
export interface HistorySummaryChunk {
  conversation: string
  coveredGroupIds: string[]
  answerOnlyGroupId: string | null
}

/**
 * 把一次历史压缩切成若干块（我们加的：删掉兜底后压缩是唯一出路，长会话首次压缩的范围可能超过模型窗口，opencode #48844）：
 * 摘要输入粗估超过块预算时按整组分块，逐块调用、每块成功就写一条完整的记录，`coveredGroupIds` 逐块累计。
 * 边界组在最后一块里：只有最后那条记录以退回形式保留它，之前的记录还按原文显示它。
 */
export function historySummaryChunks(
  history: ConversationHistory,
  plan: HistoryCompactionPlan,
  triggerTokens: number,
): HistorySummaryChunk[] {
  const serialized = plan.groups.map(group => ({
    group,
    text: serializeGroup(group, group.key === history.compaction?.answerOnlyGroupId),
  }))
  const chunks = chunkGroups(serialized, ({ text }) => roughTokens(text), summaryChunkBudget(triggerTokens))
  const covered = [...(history.compaction?.coveredGroupIds ?? [])]

  return chunks.map((chunk, index) => {
    const last = index === chunks.length - 1

    covered.push(...chunk.map(({ group }) => group.key).filter(key => !last || key !== plan.answerOnlyGroupKey))

    return {
      conversation: chunk.map(({ text }) => text).filter(Boolean).join('\n\n'),
      coveredGroupIds: [...covered],
      answerOnlyGroupId: last ? plan.answerOnlyGroupKey ?? null : null,
    }
  })
}

/**
 * 按整组把要摘要的内容分块：加上下一组会超出块预算就另起一块，单组超出时自成一块。
 * 返回每块的组，顺序不变。
 */
function chunkGroups<T>(groups: T[], tokens: (group: T) => number, budget: number): T[][] {
  const chunks: T[][] = []
  let current: T[] = []
  let used = 0

  for (const group of groups) {
    const size = tokens(group)

    if (current.length > 0 && used + size > budget) {
      chunks.push(current)
      current = []
      used = 0
    }
    current.push(group)
    used += size
  }
  if (current.length > 0)
    chunks.push(current)

  return chunks
}

/**
 * 本轮压缩的切点：从本 Run 最新的工具轮往回累加粗估，放得下就保留，最少保留最新一轮（最新一轮单独超出预算时
 * 保留它，照 Pi `findCutPoint` 取最近的合法切点）；只切在某一轮的开头，工具结果不作切点。返回第一条保留的工具轮下标；
 * 不比上次保留的起点更靠后（前缀为空）时返回 undefined。
 */
export function planTurnCompaction(
  exchanges: readonly ModelContextToolExchange[],
  keptFrom: number,
  keepBudget: number,
): number | undefined {
  let cut = exchanges.length - 1
  let used = cut >= 0 ? exchangeTokens(exchanges[cut]!) : 0

  while (cut - 1 >= keptFrom) {
    const tokens = exchangeTokens(exchanges[cut - 1]!)

    if (used + tokens > keepBudget)
      break
    used += tokens
    cut -= 1
  }

  return cut > keptFrom ? cut : undefined
}

function exchangeTokens(exchange: ModelContextToolExchange): number {
  return exchange.results.reduce(
    (tokens, result) => tokens + estimateItemTokens(result),
    estimateItemTokens(exchange.assistantCall),
  )
}
