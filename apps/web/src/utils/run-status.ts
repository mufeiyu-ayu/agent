import type { ChatStreamEvent, MessageActivity } from '@agent/contracts'
import type { NamedValue } from 'vue-i18n'
import type { TurnRun, TurnRunStep, TurnRunThought } from '../types/chat'

/** 组件里 useI18n() 的 t 与测试里带文案类型的 t 都能传进来。 */
type Translate = (key: string, named?: NamedValue, plural?: number) => string

/** 状态行里的一段文字：动作（进行中带流光）+ 对象（加粗），末尾的「· xxx」由调用方另排。 */
export interface RunStatusText {
  label: string
  object?: string
}

/** 摘要行：动作文字、末尾的「· 用时」与强调色的「· k 步失败」。 */
export interface RunSummaryText extends RunStatusText {
  meta?: string
  warning?: string
}

/** 时间线里的一步。 */
export interface RunStepText {
  verb: string
  object: string
  meta?: string
}

export function startRun(now: number): TurnRun {
  return { startedAt: now, phase: 'waiting', toolBeforeAnswer: false, steps: [], thoughts: [] }
}

/** 按流事件推进等待过程；没有变化时返回原对象，调用方据此跳过写入。 */
export function applyRunEvent(run: TurnRun, event: ChatStreamEvent, now: number): TurnRun {
  if (run.phase === 'ended')
    return run

  switch (event.type) {
    case 'reasoning_delta': {
      // 一轮只在思考中（start 或 tool_finished 之后）收原文，到 tool_started 或正文开始为止；
      // 同一轮的步骤数不变，所以末尾那段 at 相同就是这一轮，接着拼。
      if (run.phase !== 'waiting' || !event.delta)
        return run

      const at = run.steps.length
      const last = run.thoughts.at(-1)

      return {
        ...run,
        thoughts: last?.at === at
          ? [...run.thoughts.slice(0, -1), { at, text: last.text + event.delta }]
          : [...run.thoughts, { at, text: event.delta }],
      }
    }

    case 'tool_started':
      return {
        ...run,
        phase: 'tool',
        toolBeforeAnswer: run.toolBeforeAnswer || run.answerAt === undefined,
        steps: [...run.steps, {
          callId: event.callId,
          toolName: event.toolName,
          ...(event.workspace === undefined ? {} : { workspace: event.workspace }),
          ...(event.query === undefined ? {} : { query: event.query }),
          ...(event.url === undefined ? {} : { url: event.url }),
          status: 'running',
        }],
      }

    case 'tool_finished': {
      const { callId, ok, failure, results, finalUrl, title, chars, workspace } = event
      // 工具顺序执行，结束的总是最后一步；只按 callId 找不行，不同轮次的 callId 可能重复。
      const steps = [...run.steps]
      const last = steps.at(-1)

      // 只合并结果字段：事件以后多带的字段不能改写这一步的工具名、网址。
      if (last?.callId === callId && last.status === 'running') {
        steps[steps.length - 1] = {
          ...last,
          status: ok ? 'ok' : 'failed',
          ...(workspace === undefined ? {} : { workspace: { ...last.workspace, ...workspace } }),
          ...(failure === undefined ? {} : { failure }),
          ...(results === undefined ? {} : { results }),
          ...(finalUrl === undefined ? {} : { finalUrl }),
          ...(title === undefined ? {} : { title }),
          ...(chars === undefined ? {} : { chars }),
        }
      }

      return { ...run, phase: 'waiting', steps }
    }

    case 'delta':
      // 只有空白（如调工具前先吐的换行）不算正文开始：屏幕上还没有字。
      return run.phase === 'answering' || !event.contentDelta.trim()
        ? run
        : { ...run, phase: 'answering', answerAt: run.answerAt ?? now }

    default:
      return run
  }
}

/** done / error / aborted 或本地停止：没等到 tool_finished 的步骤记为已停止。 */
export function endRun(run: TurnRun, now: number, outcome: NonNullable<TurnRun['outcome']>): TurnRun {
  if (run.phase === 'ended')
    return run

  return {
    ...run,
    phase: 'ended',
    endedAt: now,
    outcome,
    steps: run.steps.map(step => step.status === 'running' ? { ...step, status: 'stopped' } : step),
  }
}

/**
 * 由接口下发的 activity 还原一轮已结束的等待过程（#212）：与实时路径同一份步骤模型，摘要与时间线走同一组文案函数。
 * 时间只还原「用时」：起点记 0、正文开始记 answerStartedMs，没有结束时刻；没有 answerStartedMs 时摘要不显示用时。
 */
export function restoreRun(activity: MessageActivity, outcome: NonNullable<TurnRun['outcome']>): TurnRun {
  const steps: TurnRunStep[] = []
  const thoughts: TurnRunThought[] = []

  for (const item of activity.items) {
    // 与实时路径一样：一轮思考排在它之后的第一个步骤之前。
    if (item.kind === 'thought') {
      thoughts.push({ at: steps.length, text: item.text })
      continue
    }

    const { callId, toolName, query, url, ok, failure, results, finalUrl, title, chars, workspace } = item

    steps.push({
      callId,
      toolName,
      ...(workspace === undefined ? {} : { workspace }),
      ...(query === undefined ? {} : { query }),
      ...(url === undefined ? {} : { url }),
      // ok 为 false 且没有 failure：执行中被停止或中断，与实时路径没等到 tool_finished 的步骤一样。
      status: ok ? 'ok' : failure ? 'failed' : 'stopped',
      ...(failure === undefined ? {} : { failure }),
      ...(results === undefined ? {} : { results }),
      ...(finalUrl === undefined ? {} : { finalUrl }),
      ...(title === undefined ? {} : { title }),
      ...(chars === undefined ? {} : { chars }),
    })
  }

  return {
    startedAt: 0,
    ...(activity.answerStartedMs === undefined ? {} : { answerAt: activity.answerStartedMs }),
    phase: 'ended',
    outcome,
    toolBeforeAnswer: activity.toolBeforeAnswer,
    steps,
    thoughts,
  }
}

/** 进行中的状态行文字：当前工具步骤；没有工具时是思考短句，还没有短句就是「思考中」。 */
export function runStatusText(step: TurnRunStep | undefined, t: Translate, thought?: string): RunStatusText {
  if (!step)
    return { label: thought || t('conversation.run.thinking') }

  if (step.workspace)
    return withObject(t(`workspace.operations.${step.workspace.operation}`), step.workspace.path ?? step.workspace.title)

  switch (step.toolName) {
    case 'web_search':
      return withObject(t('conversation.run.searching'), step.query)
    case 'web_fetch':
      return withObject(t('conversation.run.reading'), step.url && siteName(step.url))
    default:
      return withObject(t('conversation.run.usingTool'), step.toolName)
  }
}

/**
 * 摘要：有工具时「已搜索 n 次、阅读 m 个网页 · 用时 t」（只列出现过的类别，被停止的不计），有失败时加「· k 步失败」；
 * 只有思考时「已思考 t」；工具全被停止时「已停止 · 用时 t」。用时从 start 到正文开始，没有正文时到结束；
 * 两者都没有（刷新后还原、没出正文或旧数据，#212）时不写用时。
 */
export function runSummaryText(run: TurnRun, t: Translate): RunSummaryText {
  const finished = run.steps.filter(step => step.status === 'ok' || step.status === 'failed')
  const count = (toolName?: string) => finished.filter(step => toolName
    ? step.toolName === toolName
    : step.toolName !== 'web_search' && step.toolName !== 'web_fetch').length
  const searches = count('web_search')
  const reads = count('web_fetch')
  const others = count()
  const failed = finished.filter(step => step.status === 'failed').length
  const end = run.answerAt ?? run.endedAt
  const took = end === undefined ? undefined : formatRunSeconds(end - run.startedAt, t)
  const meta = took === undefined ? {} : { meta: t('conversation.run.took', { time: took }) }
  const parts = [
    searches && t('conversation.run.searched', { n: searches }, searches),
    reads && t('conversation.run.readPages', { n: reads }, reads),
    others && t('conversation.run.usedTools', { n: others }, others),
  ].filter(Boolean)

  if (parts.length === 0) {
    return run.steps.length === 0
      ? { label: took === undefined ? t('conversation.run.thoughtDone') : t('conversation.run.thought', { time: took }) }
      : { label: t('conversation.run.stopped'), ...meta }
  }

  const summary = t('conversation.run.summary', { parts: parts.join(t('conversation.run.partSeparator')) })

  return {
    // 英文各部分是小写短语，拼好后句首大写；中文不受影响。
    label: summary.charAt(0).toUpperCase() + summary.slice(1),
    ...meta,
    ...(failed ? { warning: t('conversation.run.failedSteps', { n: failed }, failed) } : {}),
  }
}

/** 时间线一行：「搜索 {query} · n 条结果」「阅读 {标题} · {域名} · 约 n 字」「阅读 {url} · 超时」。 */
export function runStepText(step: TurnRunStep, t: Translate, locale: string): RunStepText {
  const outcome = step.status === 'failed'
    ? t(`conversation.run.failure.${step.failure ?? 'failed'}`)
    : step.status === 'stopped' ? t('conversation.run.stopped') : undefined

  if (step.workspace)
    return { verb: t(`workspace.operations.${step.workspace.operation}`), object: step.workspace.path ?? step.workspace.title, meta: outcome ?? (step.workspace.exitCode !== undefined ? `exit ${step.workspace.exitCode}` : undefined) }

  switch (step.toolName) {
    case 'web_search':
      return {
        verb: t('conversation.run.steps.search'),
        object: step.query ?? '',
        meta: outcome ?? (step.results && t('conversation.run.results', { n: step.results.length }, step.results.length)),
      }

    case 'web_fetch': {
      if (step.status !== 'ok')
        return { verb: t('conversation.run.steps.read'), object: step.url ?? '', meta: outcome }

      const site = siteName(step.finalUrl ?? step.url ?? '')
      // 没有标题时标题位写域名，后面就不再重复域名。
      const meta = [step.title ? site : '', step.chars ? t('conversation.run.chars', { n: step.chars.toLocaleString(locale) }) : '']
        .filter(Boolean)
        .join(' · ')

      return { verb: t('conversation.run.steps.read'), object: step.title || site, ...(meta ? { meta } : {}) }
    }

    default:
      return { verb: t('conversation.run.steps.tool'), object: step.toolName, meta: outcome }
  }
}

/**
 * 句末：中文句号 / 叹号 / 问号、换行，或后面跟着空白的英文 . ! ?（「19.2」里的点不算，流末尾的点等下一片再定）；
 * 紧跟的右引号、右括号归前一句（中文句末后的 ASCII 引号分不清左右，不归）。不用 lookbehind：Safari 16.4 之前不支持，整个模块会加载失败。
 */
const SENTENCE_END = /[。！？][”’」』）)\]]*|\n|[.!?]["'”’)\]]*(?=\s)/g
/** 缩写里的点不算句末（看点之前的几个字）。 */
const ABBREVIATION_BEFORE_DOT = /(?:^|[^a-z])(?:e\.g|i\.e|vs)$/i
/** 短于这个字数的句子（「好的。」「嗯。」）跳过，取更早的一句。 */
const MIN_THOUGHT_CHARS = 6

/**
 * 思考短句（#209）：原文里最新一句写完的话，去掉 Markdown 符号、合并空白；短句跳过。
 * complete 为 true 时这一轮已结束，末尾没有句末标点的半句也算写完。
 */
export function latestThoughtSentence(text: string, complete = false): string | undefined {
  const source = complete ? `${text}\n` : text
  const ends = [...source.matchAll(SENTENCE_END)]
    .filter(match => !(match[0].startsWith('.') && ABBREVIATION_BEFORE_DOT.test(source.slice(Math.max(0, match.index - 4), match.index))))
    .map(match => match.index + match[0].length)

  for (let index = ends.length - 1; index >= 0; index--) {
    const sentence = plainThought(source.slice(ends[index - 1] ?? 0, ends[index]))

    if ([...sentence].length >= MIN_THOUGHT_CHARS)
      return sentence
  }
}

/** 状态行上的思考短句：只取这一轮（没有新步骤之后）的原文，上一轮的不沿用。 */
export function liveThought(run: TurnRun): string | undefined {
  const last = run.thoughts.at(-1)

  return run.phase === 'waiting' && last?.at === run.steps.length ? latestThoughtSentence(last.text) : undefined
}

/** 时间线思考行的文字：这一轮最后一句写完的话；都太短时用整段（本来就短）。 */
export function thoughtTitle(text: string): string {
  return latestThoughtSentence(text, true) ?? plainThought(text)
}

/** 时间线思考行能否展开：原文去掉 Markdown 符号后就是标题这一句时（如 GPT 只给一行摘要标题），展开只会重复一遍。 */
export function thoughtHasMore(text: string): boolean {
  return plainThought(text) !== thoughtTitle(text)
}

/** 去掉行首的标题 / 引用 / 列表符号（可嵌套，如「> - 」）与行内的加粗、代码、删除线标记，合并空白；单个 * 与 _ 保留（乘号、__init__）。 */
function plainThought(text: string): string {
  return text
    .trimStart()
    // 分隔线（*** / - - -）整行不算文字。
    .replace(/^(?:[-*_]\s*){3,}$/, '')
    .replace(/^(?:(?:#{1,6}|[-*+])\s+|>\s*)+/, '')
    .replace(/\*\*|`+|~~/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** 整秒；不到 1 秒写「不到 1 秒」。 */
export function formatRunSeconds(ms: number, t: Translate): string {
  const seconds = Math.floor(Math.max(0, ms) / 1000)

  return seconds < 1 ? t('conversation.run.underOneSecond') : t('conversation.run.seconds', { n: seconds })
}

/** 域名去掉 www.；不是合法网址时原样返回。 */
export function siteName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  }
  catch {
    return url
  }
}

/** 只放行 http(s) 链接：来源地址来自搜索结果与模型参数，不能让 javascript: 之类进 href。 */
export function safeHref(url: string | undefined): string | undefined {
  try {
    const parsed = new URL(url ?? '')

    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : undefined
  }
  catch {
    return undefined
  }
}

function withObject(label: string, object: string | undefined): RunStatusText {
  return object ? { label, object } : { label }
}
