import type {
  MessageEvidenceAvailability,
  MessageGroundingOutcome,
  MessageGroundingV1,
} from '@agent/contracts'

/** 来源状态的视觉语气；不表达可信度，只表达「需要多少注意」。 */
export type GroundingTone = 'neutral' | 'caution' | 'warning'

/** 单张来源卡片的安全展示投影。 */
export interface GroundingSourceView {
  /** server-issued 公开 ID，只用于列表 key，不进入可见文本。 */
  citationId: string
  /** UI 编号：严格等于 contract 数组顺序的 index + 1。 */
  index: number
  title: string
  languageCode: string
  granularity: 'article' | 'chunk'
  sectionPath: string | null
  excerpt: string | null
}

export interface GroundingView {
  tone: GroundingTone
  /** 主状态文案 key，对应 `conversation.grounding.status.*`。 */
  statusKey: string
  /** availability 引起的补充说明 key；没有补充说明时为 `null`。 */
  noteKey: string | null
  /** 来源列表标题 key，对应 `conversation.grounding.sources.*`。 */
  sourcesKey: string
  sources: GroundingSourceView[]
}

/**
 * outcome × evidenceAvailability 的完整状态表。
 *
 * 八个组合就是 contract 允许的全部：`isConsistentOutcome()` 保证 answered 与
 * conflicting_evidence 必然带有效证据，因此它们不会出现 none / unavailable。
 * 这里刻意穷举而不留 default 分支——未知组合只可能来自被绕过的边界校验，
 * 应该在 parser 阶段就 fail closed，而不是在这里被兜底成某种「看起来正常」的状态。
 */
const GROUNDING_STATES: Record<
  `${MessageGroundingOutcome}:${MessageEvidenceAvailability}`,
  { tone: GroundingTone, statusKey: string } | undefined
> = {
  'answered:available': { tone: 'neutral', statusKey: 'answered' },
  'answered:partial': { tone: 'caution', statusKey: 'answered' },
  'answered:none': undefined,
  'answered:unavailable': undefined,
  'conflicting_evidence:available': { tone: 'warning', statusKey: 'conflicting' },
  'conflicting_evidence:partial': { tone: 'warning', statusKey: 'conflicting' },
  'conflicting_evidence:none': undefined,
  'conflicting_evidence:unavailable': undefined,
  'insufficient_evidence:available': { tone: 'caution', statusKey: 'insufficientWithEvidence' },
  'insufficient_evidence:partial': { tone: 'caution', statusKey: 'insufficientWithEvidence' },
  'insufficient_evidence:none': { tone: 'caution', statusKey: 'insufficientNone' },
  'insufficient_evidence:unavailable': { tone: 'caution', statusKey: 'insufficientUnavailable' },
}

/**
 * 来源列表标题只由 outcome 决定。
 *
 * `insufficient_evidence` 下的 Citation 是「已检查过的资料」，不是「支撑结论的来源」；
 * 把两者用同一句话表达就等于把候选渲染成了已验证答案。
 */
const SOURCES_KEYS: Record<MessageGroundingOutcome, string> = {
  answered: 'answered',
  insufficient_evidence: 'checked',
  conflicting_evidence: 'conflicting',
}

/**
 * 把 durable Grounding 投影为 UI 展示模型。
 *
 * 只读取公共 contract 已有的字段，不解析回答正文、不按 rank / title / sourceId 重排、
 * 不派生任何相关性或可信度评分。
 *
 * @param grounding - 已通过边界校验的 Grounding，或 `null`。
 * @returns 可渲染的展示模型；没有 Grounding 或组合不被 contract 允许时返回 `null`。
 */
export function toGroundingView(
  grounding: MessageGroundingV1 | null | undefined,
): GroundingView | null {
  if (!grounding)
    return null

  const state = GROUNDING_STATES[`${grounding.outcome}:${grounding.evidenceAvailability}`]

  if (!state)
    return null

  return {
    tone: state.tone,
    statusKey: state.statusKey,
    noteKey: grounding.evidenceAvailability === 'partial' ? 'partial' : null,
    sourcesKey: SOURCES_KEYS[grounding.outcome],
    sources: grounding.citations.map((citation, citationIndex) => ({
      citationId: citation.citationId,
      index: citationIndex + 1,
      title: citation.title,
      languageCode: citation.languageCode,
      granularity: citation.granularity,
      sectionPath: citation.sectionPath,
      excerpt: citation.excerpt,
    })),
  }
}
