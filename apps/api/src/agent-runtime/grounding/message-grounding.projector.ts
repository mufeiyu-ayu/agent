import type {
  MessageCitationGranularity,
  MessageCitationV1,
  MessageEvidenceAvailability,
  MessageGroundingOutcome,
  MessageGroundingV1,
} from '@agent/contracts'

import {
  MESSAGE_GROUNDING_MAX_CITATIONS,
  MESSAGE_GROUNDING_SCHEMA_VERSION,
} from '@agent/contracts'

/**
 * 持久化 Grounding 到公共 contract 的唯一安全投影。
 *
 * `done.grounding` 与 Messages API 都必须经过这里，页面重载后才能得到与实时
 * 流一致的结果。持久化数据一旦损坏（人为改写、契约漂移、部分写入），一律
 * fail closed 返回 null，绝不把原始 JSON 透传给客户端。
 */

/** 数据库中一行 MessageGrounding 的最小读取形状。 */
export interface PersistedMessageGrounding {
  schemaVersion: number
  evidenceAvailability: string
  outcome: string
  citationIntegrity: string
  faithfulnessStatus: string
  citations: unknown
}

const EVIDENCE_AVAILABILITIES = new Set<MessageEvidenceAvailability>([
  'available',
  'partial',
  'none',
  'unavailable',
])
const OUTCOMES = new Set<MessageGroundingOutcome>([
  'answered',
  'insufficient_evidence',
  'conflicting_evidence',
])
const GRANULARITIES = new Set<MessageCitationGranularity>(['article', 'chunk'])
const CITATION_KEYS = new Set([
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
])

/**
 * 把持久化行投影为公共 Grounding。
 *
 * @returns 合法时返回 `MessageGroundingV1`；缺失或任何一处不合法时返回 null。
 */
export function toMessageGroundingV1(
  persisted: PersistedMessageGrounding | null | undefined,
): MessageGroundingV1 | null {
  if (!persisted)
    return null

  if (persisted.schemaVersion !== MESSAGE_GROUNDING_SCHEMA_VERSION)
    return null

  if (!isEvidenceAvailability(persisted.evidenceAvailability))
    return null

  if (!isOutcome(persisted.outcome))
    return null

  // v1 只承认这两个固定值；出现别的取值说明数据来自未知契约版本。
  if (persisted.citationIntegrity !== 'validated')
    return null

  if (persisted.faithfulnessStatus !== 'not_evaluated')
    return null

  if (!Array.isArray(persisted.citations))
    return null

  if (persisted.citations.length > MESSAGE_GROUNDING_MAX_CITATIONS)
    return null

  const citations: MessageCitationV1[] = []

  for (const candidate of persisted.citations) {
    const citation = toMessageCitationV1(candidate)

    // 单条 Citation 损坏就整份 fail closed：不返回「少了一条来源」的半份事实。
    if (!citation)
      return null

    citations.push(citation)
  }

  return {
    schemaVersion: MESSAGE_GROUNDING_SCHEMA_VERSION,
    evidenceAvailability: persisted.evidenceAvailability,
    outcome: persisted.outcome,
    citationIntegrity: 'validated',
    faithfulnessStatus: 'not_evaluated',
    citations,
  }
}

function toMessageCitationV1(candidate: unknown): MessageCitationV1 | undefined {
  if (!isPlainObject(candidate))
    return undefined

  const keys = Object.keys(candidate)

  if (keys.length !== CITATION_KEYS.size || keys.some(key => !CITATION_KEYS.has(key)))
    return undefined

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
  } = candidate

  if (typeof citationId !== 'string' || citationId.length === 0)
    return undefined

  if (!Number.isSafeInteger(sourceId) || (sourceId as number) <= 0)
    return undefined

  if (!isNullableString(chunkId))
    return undefined

  if (typeof granularity !== 'string' || !GRANULARITIES.has(granularity as MessageCitationGranularity))
    return undefined

  // article 粒度不得携带 chunk identity；chunk 粒度必须带。
  if (granularity === 'article' && chunkId !== null)
    return undefined
  if (granularity === 'chunk' && typeof chunkId !== 'string')
    return undefined

  if (typeof title !== 'string' || typeof slug !== 'string' || typeof languageCode !== 'string')
    return undefined

  if (!isNullableString(sectionPath) || !isNullableString(excerpt) || !isNullableString(href))
    return undefined

  if (rank !== null && (!Number.isSafeInteger(rank) || (rank as number) < 0))
    return undefined

  if (!isPlainObject(strategy))
    return undefined

  const strategyKeys = Object.keys(strategy)

  if (
    strategyKeys.length !== 2
    || typeof strategy.name !== 'string'
    || typeof strategy.version !== 'string'
  ) {
    return undefined
  }

  return {
    citationId,
    sourceId: sourceId as number,
    chunkId: chunkId as string | null,
    granularity: granularity as MessageCitationGranularity,
    title,
    slug,
    languageCode,
    sectionPath: sectionPath as string | null,
    excerpt: excerpt as string | null,
    rank: rank as number | null,
    href: href as string | null,
    strategy: {
      name: strategy.name,
      version: strategy.version,
    },
  }
}

function isEvidenceAvailability(
  value: string,
): value is MessageEvidenceAvailability {
  return EVIDENCE_AVAILABILITIES.has(value as MessageEvidenceAvailability)
}

function isOutcome(value: string): value is MessageGroundingOutcome {
  return OUTCOMES.has(value as MessageGroundingOutcome)
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === 'string'
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false

  const prototype = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}
