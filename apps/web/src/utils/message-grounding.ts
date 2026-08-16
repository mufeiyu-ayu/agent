import type {
  ChatStreamDoneEvent,
  ConversationMessage,
  MessageGroundingV1,
} from '@agent/contracts'

import { parseMessageGroundingV1 } from '@agent/contracts'

/**
 * Web 侧 Grounding 的唯一信任边界。
 *
 * 语义校验直接复用 `@agent/contracts` 的 `parseMessageGroundingV1`，与服务端 durable
 * projector 是同一份实现；历史 Messages API 虽然来自自己的后端，也不因为「类型上写着
 * `MessageGroundingV1`」就跳过运行时校验。
 *
 * 与服务端的唯一区别是失败处理：这里只把这个可选字段归零，不让 UI 元数据拖垮
 * 整条回答或整个会话的加载。
 *
 * @param value - 任意来源的 optional Grounding。
 * @returns 合法时返回结构化 Grounding；缺失或任何一处不合法时返回 `null`。
 */
export function sanitizeMessageGrounding(value: unknown): MessageGroundingV1 | null {
  if (value === undefined || value === null)
    return null

  return parseMessageGroundingV1(value)
}

/**
 * 历史消息列表的 Grounding 归一化。
 *
 * 只改写 `grounding` 一个字段，其它字段原样保留：单条 Grounding 损坏时该条消息的
 * 正文、状态和整个列表都必须继续可用。
 *
 * @param messages - Messages API 返回的消息列表。
 * @returns 每条消息的 `grounding` 都是合法 Grounding 或 `null` 的新列表。
 */
export function normalizeConversationMessages(
  messages: ConversationMessage[],
): ConversationMessage[] {
  return messages.map(message => ({
    ...message,
    grounding: sanitizeMessageGrounding(message.grounding),
  }))
}

/**
 * 把 `done` 终态事件合并进对应的 assistant Message。
 *
 * Grounding 只能来自本次 `done`：事件不带 Grounding 时显式归零，避免继承上一次运行、
 * 本地缓存或乐观更新留下的旧来源。
 *
 * @param message - 当前本地状态里的 assistant Message。
 * @param event - 已通过流边界校验的 `done` 事件。
 * @returns 合并后的新 Message。
 */
export function applyStreamDoneToMessage(
  message: ConversationMessage,
  event: ChatStreamDoneEvent,
): ConversationMessage {
  return {
    ...message,
    content: event.content,
    status: 'COMPLETED',
    updatedAt: event.generatedAt,
    grounding: sanitizeMessageGrounding(event.grounding),
  }
}

/**
 * 清除非终态成功路径上的 completed Grounding。
 *
 * error、server aborted 和本地 Abort 都可以保留已经收到的 partial content，
 * 但不允许保留任何「这条回答有来源支撑」的事实。
 *
 * @param message - 即将转为 FAILED / ABORTED 的 Message。
 * @returns 不带 Grounding 的新 Message。
 */
export function withoutMessageGrounding(
  message: ConversationMessage,
): ConversationMessage {
  return {
    ...message,
    grounding: null,
  }
}
