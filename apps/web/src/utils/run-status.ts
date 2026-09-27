import type { ChatStreamEvent } from '@agent/contracts'
import type { NamedValue } from 'vue-i18n'
import type { TurnRun, TurnRunStep } from '../types/chat'

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
  return { startedAt: now, phase: 'waiting', toolBeforeAnswer: false, steps: [] }
}

/** 按流事件推进等待过程；没有变化时返回原对象，调用方据此跳过写入。 */
export function applyRunEvent(run: TurnRun, event: ChatStreamEvent, now: number): TurnRun {
  if (run.phase === 'ended')
    return run

  switch (event.type) {
    case 'tool_started':
      return {
        ...run,
        phase: 'tool',
        toolBeforeAnswer: run.toolBeforeAnswer || run.answerAt === undefined,
        steps: [...run.steps, {
          callId: event.callId,
          toolName: event.toolName,
          ...(event.query === undefined ? {} : { query: event.query }),
          ...(event.url === undefined ? {} : { url: event.url }),
          status: 'running',
        }],
      }

    case 'tool_finished': {
      const { callId, ok, failure, results, finalUrl, title, chars } = event
      // 工具顺序执行，结束的总是最后一步；只按 callId 找不行，不同轮次的 callId 可能重复。
      const steps = [...run.steps]
      const last = steps.at(-1)

      // 只合并结果字段：事件以后多带的字段不能改写这一步的工具名、网址。
      if (last?.callId === callId && last.status === 'running') {
        steps[steps.length - 1] = {
          ...last,
          status: ok ? 'ok' : 'failed',
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

/** 进行中的状态行文字：思考中，或当前工具步骤。 */
export function runStatusText(step: TurnRunStep | undefined, t: Translate): RunStatusText {
  if (!step)
    return { label: t('conversation.run.thinking') }

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
 * 只有思考时「已思考 t」；工具全被停止时「已停止 · 用时 t」。用时从 start 到正文开始，没有正文时到结束。
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
  const took = formatRunSeconds((run.answerAt ?? run.endedAt ?? run.startedAt) - run.startedAt, t)
  const parts = [
    searches && t('conversation.run.searched', { n: searches }, searches),
    reads && t('conversation.run.readPages', { n: reads }, reads),
    others && t('conversation.run.usedTools', { n: others }, others),
  ].filter(Boolean)

  if (parts.length === 0) {
    return run.steps.length === 0
      ? { label: t('conversation.run.thought', { time: took }) }
      : { label: t('conversation.run.stopped'), meta: t('conversation.run.took', { time: took }) }
  }

  const summary = t('conversation.run.summary', { parts: parts.join(t('conversation.run.partSeparator')) })

  return {
    // 英文各部分是小写短语，拼好后句首大写；中文不受影响。
    label: summary.charAt(0).toUpperCase() + summary.slice(1),
    meta: t('conversation.run.took', { time: took }),
    ...(failed ? { warning: t('conversation.run.failedSteps', { n: failed }, failed) } : {}),
  }
}

/** 时间线一行：「搜索 {query} · n 条结果」「阅读 {标题} · {域名} · 约 n 字」「阅读 {url} · 超时」。 */
export function runStepText(step: TurnRunStep, t: Translate, locale: string): RunStepText {
  const outcome = step.status === 'failed'
    ? t(`conversation.run.failure.${step.failure ?? 'failed'}`)
    : step.status === 'stopped' ? t('conversation.run.stopped') : undefined

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
