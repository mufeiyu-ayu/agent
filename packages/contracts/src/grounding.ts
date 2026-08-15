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
