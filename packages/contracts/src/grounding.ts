/**
 * Grounded Answer 公共契约（v1）。
 *
 * 三层语义必须分开理解：
 * - `evidenceAvailability` 由服务端根据本次 Run 的 Tool 执行事实派生，模型无法提交或覆盖；
 * - `citationIntegrity` 只表示「引用身份属于本次 Run 的真实证据」，不代表内容支持每个断言；
 * - `faithfulnessStatus` 在 v1 恒为 `not_evaluated`，禁止对外宣称已完成逐断言事实核验。
 */

/** 服务端派生的证据可用性；不是模型字段。 */
export type MessageEvidenceAvailability
  = | 'available' // 至少一个有效 evidence ref，且没有 evidence-eligible Tool 失败
    | 'partial' // 至少一个有效 evidence ref，同时存在 evidence-eligible Tool 失败
    | 'none' // evidence-eligible Tool 成功，但 zero-hit / not found，没有 ref
    | 'unavailable' // 没有 ref，且 evidence-eligible Tool 失败

/** 模型在终态结构化输出中声明、并经服务端校验的回答结论。 */
export type MessageGroundingOutcome
  = | 'answered'
    | 'insufficient_evidence'
    | 'conflicting_evidence'

/** Citation 指向整篇文章还是文章内的某个 chunk。 */
export type MessageCitationGranularity = 'article' | 'chunk'

export interface MessageCitationV1 {
  /** 公开、持久化的 server-issued ID；与内部 Run-scoped citationKey 无关且不泄漏它。 */
  citationId: string
  sourceId: number
  chunkId: string | null
  granularity: MessageCitationGranularity
  title: string
  slug: string
  languageCode: string
  sectionPath: string | null
  /** 有界证据快照；article 粒度证据可以为空。 */
  excerpt: string | null
  rank: number | null
  /** 只由服务端按持久化 slug 与 allowlisted internal route 派生；没有真实公开路由时为 null。 */
  href: string | null
  strategy: {
    name: string
    version: string
  }
}

export interface MessageGroundingV1 {
  schemaVersion: 1
  evidenceAvailability: MessageEvidenceAvailability
  outcome: MessageGroundingOutcome
  /** v1 只表示引用身份通过校验，不等价于 semantic faithfulness。 */
  citationIntegrity: 'validated'
  /** v1 固定为 not_evaluated，不伪造 verified。 */
  faithfulnessStatus: 'not_evaluated'
  citations: MessageCitationV1[]
}

/** 当前 Grounding 契约版本；持久化与投影都以它为准。 */
export const MESSAGE_GROUNDING_SCHEMA_VERSION = 1

/** 单条 Message 最多携带的 Citation 数量。 */
export const MESSAGE_GROUNDING_MAX_CITATIONS = 5

const EVIDENCE_AVAILABILITIES: readonly MessageEvidenceAvailability[] = [
  'available',
  'partial',
  'none',
  'unavailable',
]
const OUTCOMES: readonly MessageGroundingOutcome[] = [
  'answered',
  'insufficient_evidence',
  'conflicting_evidence',
]
const GRANULARITIES: readonly MessageCitationGranularity[] = ['article', 'chunk']
const CITATION_KEYS: readonly string[] = [
  'citationId',
  'sourceId',
  'chunkId',
  'granularity',
  'title',
  'slug',
  'languageCode',
  'sectionPath',
  'excerpt',
  'rank',
  'href',
  'strategy',
]
const GROUNDING_KEYS: readonly string[] = [
  'schemaVersion',
  'evidenceAvailability',
  'outcome',
  'citationIntegrity',
  'faithfulnessStatus',
  'citations',
]

const MAX_CITATION_ID_CHARS = 128
const MAX_CHUNK_ID_CHARS = 200
const MAX_TITLE_CHARS = 300
const MAX_SLUG_CHARS = 300
const MAX_LANGUAGE_CODE_CHARS = 32
const MAX_SECTION_PATH_CHARS = 300
const MAX_EXCERPT_CHARS = 500
const MAX_STRATEGY_NAME_CHARS = 64
const MAX_STRATEGY_VERSION_CHARS = 32

/**
 * Grounding 的唯一严格语义校验入口。
 *
 * 服务端 durable projector 与 Web NDJSON parser 必须共用它，避免两侧对
 * 「什么是合法 Grounding」给出不同答案。
 *
 * 它同时校验三层：
 * 1. 结构：字段集合、类型、长度、安全整数；
 * 2. 版本：`schemaVersion` / `citationIntegrity` / `faithfulnessStatus` 固定值；
 * 3. 语义：`outcome` × `evidenceAvailability` 组合、Citation 数量与来源约束。
 *
 * 任何一处不满足都 fail closed 返回 `null`，绝不返回「半份」Grounding。
 *
 * @returns 合法时返回结构化 Grounding；否则返回 `null`。
 */
export function parseMessageGroundingV1(
  value: unknown,
): MessageGroundingV1 | null {
  if (!isPlainObject(value) || !hasExactKeys(value, GROUNDING_KEYS))
    return null

  const {
    schemaVersion,
    evidenceAvailability,
    outcome,
    citationIntegrity,
    faithfulnessStatus,
    citations,
  } = value

  if (schemaVersion !== MESSAGE_GROUNDING_SCHEMA_VERSION)
    return null

  // v1 只承认这两个固定值；其它取值说明数据来自未知契约版本或被人为提升。
  if (citationIntegrity !== 'validated' || faithfulnessStatus !== 'not_evaluated')
    return null

  if (!isOneOf(evidenceAvailability, EVIDENCE_AVAILABILITIES))
    return null

  if (!isOneOf(outcome, OUTCOMES))
    return null

  if (!Array.isArray(citations) || citations.length > MESSAGE_GROUNDING_MAX_CITATIONS)
    return null

  const parsedCitations: MessageCitationV1[] = []
  const citationIds = new Set<string>()

  for (const candidate of citations) {
    const citation = parseMessageCitationV1(candidate)

    // 单条 Citation 损坏就整份作废：不返回「少了一条来源」的半份事实。
    if (!citation || citationIds.has(citation.citationId))
      return null

    citationIds.add(citation.citationId)
    parsedCitations.push(citation)
  }

  if (!isConsistentOutcome(evidenceAvailability, outcome, parsedCitations))
    return null

  return {
    schemaVersion: MESSAGE_GROUNDING_SCHEMA_VERSION,
    evidenceAvailability,
    outcome,
    citationIntegrity: 'validated',
    faithfulnessStatus: 'not_evaluated',
    citations: parsedCitations,
  }
}

/**
 * outcome 与服务端派生 availability 的组合约束。
 *
 * 与 finalization 校验保持同一套规则：durable 数据即使被绕过写入，
 * 也不能在读取时表现为一份「合法」的 Grounding。
 */
function isConsistentOutcome(
  evidenceAvailability: MessageEvidenceAvailability,
  outcome: MessageGroundingOutcome,
  citations: MessageCitationV1[],
): boolean {
  const hasEvidence
    = evidenceAvailability === 'available' || evidenceAvailability === 'partial'

  // 没有有效证据时不允许挂任何引用。
  if (!hasEvidence && citations.length > 0)
    return false

  switch (outcome) {
    case 'answered':
      return hasEvidence && citations.length >= 1

    case 'conflicting_evidence':
      if (!hasEvidence)
        return false
      // 冲突必须发生在不同来源之间；同一篇文章的两个 chunk 不算冲突。
      return new Set(citations.map(citation => citation.sourceId)).size >= 2

    case 'insufficient_evidence':
      return true
  }
}

function parseMessageCitationV1(value: unknown): MessageCitationV1 | null {
  if (!isPlainObject(value) || !hasExactKeys(value, CITATION_KEYS))
    return null

  const {
    citationId,
    sourceId,
    chunkId,
    granularity,
    title,
    slug,
    languageCode,
    sectionPath,
    excerpt,
    rank,
    href,
    strategy,
  } = value

  if (!isBoundedString(citationId, MAX_CITATION_ID_CHARS))
    return null

  if (!isPositiveSafeInteger(sourceId))
    return null

  if (!isOneOf(granularity, GRANULARITIES))
    return null

  if (!isBoundedNullableString(chunkId, MAX_CHUNK_ID_CHARS))
    return null

  // article 粒度不得携带 chunk identity；chunk 粒度必须有真实 chunkId。
  if (granularity === 'article' && chunkId !== null)
    return null
  if (granularity === 'chunk' && typeof chunkId !== 'string')
    return null

  if (
    !isBoundedString(title, MAX_TITLE_CHARS)
    || !isBoundedString(slug, MAX_SLUG_CHARS)
    || !isBoundedString(languageCode, MAX_LANGUAGE_CODE_CHARS)
    || !isBoundedNullableString(sectionPath, MAX_SECTION_PATH_CHARS)
    || !isBoundedNullableString(excerpt, MAX_EXCERPT_CHARS)
  ) {
    return null
  }

  if (rank !== null && !isNonNegativeSafeInteger(rank))
    return null

  // v1 没有 allowlisted 的公开文章路由，href 只能是 null；
  // 任何非空值都说明它不是服务端派生的，一律 fail closed。
  if (href !== null)
    return null

  if (!isPlainObject(strategy) || !hasExactKeys(strategy, ['name', 'version']))
    return null

  if (
    !isBoundedString(strategy.name, MAX_STRATEGY_NAME_CHARS)
    || !isBoundedString(strategy.version, MAX_STRATEGY_VERSION_CHARS)
  ) {
    return null
  }

  return {
    citationId,
    sourceId,
    chunkId: chunkId as string | null,
    granularity,
    title,
    slug,
    languageCode,
    sectionPath: toNullableString(sectionPath),
    excerpt: toNullableString(excerpt),
    rank: rank as number | null,
    href: null,
    strategy: {
      name: strategy.name,
      version: strategy.version,
    },
  }
}

function isOneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
}

function isBoundedString(value: unknown, maxChars: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && [...value].length <= maxChars
}

/**
 * 可空展示字段：`null` 与空字符串都表示「没有这项内容」。
 *
 * 真实语料里存在没有标题层级的 chunk，空 `sectionPath` 是合法数据而不是损坏。
 */
function isBoundedNullableString(value: unknown, maxChars: number): boolean {
  return value === null
    || value === ''
    || isBoundedString(value, maxChars)
}

/** 把可空展示字段统一归一化为 `null` 或非空字符串。 */
function toNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function hasExactKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value)

  return actual.length === keys.length && actual.every(key => keys.includes(key))
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false

  const prototype = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}
