/**
 * Tool Evidence Policy 与安全 evidence 投影边界。
 *
 * 与 `data`（服务端完整结果）、`modelContent`（模型可见文本）、`stepSummary`（审计摘要）
 * 是第四种投影：只有它可以进入 Run Evidence Registry 并成为可引用证据。
 *
 * 关键约束：Runtime 永远不从 `data` / `modelContent` / 日志字符串里猜测证据。
 * 工具必须自己声明 policy 并主动提交结构化 ref，且每一条都要通过这里的
 * fail-closed 校验；非法投影整项丢弃，不影响 Tool Call / Result pairing 与 Run 终态。
 */

/**
 * 工具在证据链中的角色。
 *
 * - `eligible`：结果可以作为回答证据，允许提交 evidence ref。
 * - `discovery_only`：只用于发现 / 关键词列举，永远不进 Evidence Registry。
 */
export type ToolEvidencePolicy = 'discovery_only' | 'eligible'

export type ToolEvidenceGranularity = 'article' | 'chunk'

/** 工具提交的单条证据引用；字段集合即 allowlist，多一个字段就整项 fail closed。 */
export interface ToolEvidenceRef {
  sourceId: number
  chunkId: string | null
  granularity: ToolEvidenceGranularity
  title: string
  slug: string
  languageCode: string
  sectionPath: string | null
  excerpt: string | null
  rank: number | null
  strategy: {
    name: string
    version: string
  }
}

/** 工具在一次成功执行中提交的完整证据投影。 */
export interface ToolEvidenceProjection {
  refs: ToolEvidenceRef[]
}

/** 单次 Tool 调用最多提交的 ref 数；Registry 另有全 Run hard cap。 */
export const TOOL_EVIDENCE_MAX_REFS_PER_CALL = 5

/** 单条 ref 序列化后的字符预算；证据快照不是正文副本。 */
export const TOOL_EVIDENCE_REF_MAX_CHARS = 2_000

const MAX_TITLE_CHARS = 300
const MAX_SLUG_CHARS = 300
const MAX_LANGUAGE_CODE_CHARS = 32
const MAX_SECTION_PATH_CHARS = 300
const MAX_EXCERPT_CHARS = 500
const MAX_CHUNK_ID_CHARS = 200
const MAX_STRATEGY_NAME_CHARS = 64
const MAX_STRATEGY_VERSION_CHARS = 32

const REF_KEYS = new Set([
  'sourceId',
  'chunkId',
  'granularity',
  'title',
  'slug',
  'languageCode',
  'sectionPath',
  'excerpt',
  'rank',
  'strategy',
])
const STRATEGY_KEYS = new Set(['name', 'version'])

/**
 * 校验工具提交的 evidence 投影是否可以安全进入 Evidence Registry。
 *
 * fail closed：单条 ref 只要类型、字段集合、长度或数值范围不合法，就丢弃该条；
 * 整个投影结构本身非法时返回空数组。拒绝原因不携带原始内容，避免把可疑数据写进日志。
 *
 * @returns 通过校验的 ref 列表；没有任何合法 ref 时为空数组。
 */
export function normalizeToolEvidenceProjection(
  projection: unknown,
): ToolEvidenceRef[] {
  if (projection === undefined || !isPlainObject(projection))
    return []

  if (Object.keys(projection).length !== 1 || !Array.isArray(projection.refs))
    return []

  const refs: ToolEvidenceRef[] = []

  for (const candidate of projection.refs) {
    if (refs.length >= TOOL_EVIDENCE_MAX_REFS_PER_CALL)
      break

    const ref = normalizeEvidenceRef(candidate)

    if (ref)
      refs.push(ref)
  }

  return refs
}

function normalizeEvidenceRef(candidate: unknown): ToolEvidenceRef | undefined {
  if (!isPlainObject(candidate))
    return undefined

  // 字段 allowlist：既拒绝缺字段，也拒绝任何额外字段（例如 cosineDistance、embedding）。
  const keys = Object.keys(candidate)

  if (keys.length !== REF_KEYS.size || keys.some(key => !REF_KEYS.has(key)))
    return undefined

  const {
    sourceId,
    chunkId,
    granularity,
    title,
    slug,
    languageCode,
    sectionPath,
    excerpt,
    rank,
    strategy,
  } = candidate

  if (!Number.isSafeInteger(sourceId) || (sourceId as number) <= 0)
    return undefined

  if (granularity !== 'article' && granularity !== 'chunk')
    return undefined

  const normalizedChunkId = normalizeNullableString(chunkId, MAX_CHUNK_ID_CHARS)
  const normalizedTitle = normalizeString(title, MAX_TITLE_CHARS)
  const normalizedSlug = normalizeString(slug, MAX_SLUG_CHARS)
  const normalizedLanguageCode = normalizeString(
    languageCode,
    MAX_LANGUAGE_CODE_CHARS,
  )
  const normalizedSectionPath = normalizeNullableString(
    sectionPath,
    MAX_SECTION_PATH_CHARS,
  )
  const normalizedExcerpt = normalizeNullableString(excerpt, MAX_EXCERPT_CHARS)

  if (
    normalizedChunkId === undefined
    || normalizedTitle === undefined
    || normalizedSlug === undefined
    || normalizedLanguageCode === undefined
    || normalizedSectionPath === undefined
    || normalizedExcerpt === undefined
  ) {
    return undefined
  }

  // article 粒度证据不得携带 chunk identity；chunk 粒度必须有真实 chunkId。
  if (granularity === 'article' && normalizedChunkId !== null)
    return undefined
  if (granularity === 'chunk' && normalizedChunkId === null)
    return undefined

  if (rank !== null && (!Number.isSafeInteger(rank) || (rank as number) < 0))
    return undefined

  if (!isPlainObject(strategy))
    return undefined

  const strategyKeys = Object.keys(strategy)

  if (
    strategyKeys.length !== STRATEGY_KEYS.size
    || strategyKeys.some(key => !STRATEGY_KEYS.has(key))
  ) {
    return undefined
  }

  const strategyName = normalizeString(strategy.name, MAX_STRATEGY_NAME_CHARS)
  const strategyVersion = normalizeString(
    strategy.version,
    MAX_STRATEGY_VERSION_CHARS,
  )

  if (strategyName === undefined || strategyVersion === undefined)
    return undefined

  const ref: ToolEvidenceRef = {
    sourceId: sourceId as number,
    chunkId: normalizedChunkId,
    granularity,
    title: normalizedTitle,
    slug: normalizedSlug,
    languageCode: normalizedLanguageCode,
    sectionPath: normalizedSectionPath,
    excerpt: normalizedExcerpt,
    rank: rank as number | null,
    strategy: {
      name: strategyName,
      version: strategyVersion,
    },
  }

  let serialized: string

  try {
    serialized = JSON.stringify(ref)
  }
  catch {
    return undefined
  }

  if ([...serialized].length > TOOL_EVIDENCE_REF_MAX_CHARS)
    return undefined

  return ref
}

function normalizeString(
  value: unknown,
  maxChars: number,
): string | undefined {
  if (typeof value !== 'string' || value.length === 0)
    return undefined

  return [...value].length <= maxChars ? value : undefined
}

function normalizeNullableString(
  value: unknown,
  maxChars: number,
): string | null | undefined {
  if (value === null)
    return null

  return normalizeString(value, maxChars)
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false

  const prototype = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}
