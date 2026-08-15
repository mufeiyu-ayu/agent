import type { MessageGroundingV1 } from '@agent/contracts'

import { parseMessageGroundingV1 } from '@agent/contracts'

/**
 * 持久化 Grounding 到公共 contract 的唯一安全投影。
 *
 * `done.grounding` 与 Messages API 都必须经过这里，页面重载后才能得到与实时
 * 流一致的结果。语义校验完全复用 `@agent/contracts` 的 `parseMessageGroundingV1`，
 * Web parser 使用同一个函数，两侧不会对「什么是合法 Grounding」给出不同答案。
 *
 * 持久化数据一旦损坏（人为改写、契约漂移、部分写入、语义非法组合），一律
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

/** 投影 Grounding 前必须复核的 Message 归属条件。 */
export interface GroundingOwnerMessage {
  role: string
  status: string
}

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

  return parseMessageGroundingV1({
    schemaVersion: persisted.schemaVersion,
    evidenceAvailability: persisted.evidenceAvailability,
    outcome: persisted.outcome,
    citationIntegrity: persisted.citationIntegrity,
    faithfulnessStatus: persisted.faithfulnessStatus,
    citations: persisted.citations,
  })
}

/**
 * 只为「已完成的助手消息」投影 Grounding。
 *
 * completed Grounding 只属于 COMPLETED assistant Message（D-25）。即便有人绕过
 * Runtime 往 STREAMING / FAILED / ABORTED 或用户消息上插入 Grounding 行，
 * 公共 API 也不会把它当成一份成立的引用事实。
 */
export function toOwnedMessageGroundingV1(
  message: GroundingOwnerMessage,
  persisted: PersistedMessageGrounding | null | undefined,
): MessageGroundingV1 | null {
  if (message.role !== 'ASSISTANT' || message.status !== 'COMPLETED')
    return null

  return toMessageGroundingV1(persisted)
}
