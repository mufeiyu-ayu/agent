import type { Conversation, ConversationMessage } from '@agent/contracts'
import type { ChatAttachment, ConversationTurn, ConversationTurnStatus, TurnRun } from '../types/chat'

import { restoreRun } from './run-status'

interface MapConversationMessagesOptions {
  activeTurnId: string | null
  turnErrors: Record<string, string>
  /** 按助手消息 id 的等待过程；只有当前页面里发出的轮次才有，优先于接口下发的 activity。 */
  runs?: Record<string, TurnRun>
  /** 用户消息的附件：调用方决定用本地的还是接口下发的，并保证同一条消息返回同一个数组。 */
  attachmentsOf?: (message: ConversationMessage) => ChatAttachment[] | undefined
  /** 其余回答的等待过程：restoreMessageRun，或调用方带缓存的同一个函数。 */
  restoredRun: (message: ConversationMessage) => TurnRun | undefined
}

/** 已结束的回答才还原；还在生成的（或进程中断遗留的）没有摘要可给。 */
const RESTORED_OUTCOMES: Partial<Record<ConversationMessage['status'], NonNullable<TurnRun['outcome']>>> = {
  COMPLETED: 'done',
  FAILED: 'error',
  ABORTED: 'aborted',
}

/**
 * 将后端 Message 列表转换为当前聊天 UI 使用的 turn 列表。
 *
 * @param messages - 后端按时间正序返回的消息列表。
 * @param options - 当前正在处理的 user message id 和本地错误映射。
 * @returns 可以直接传给 `AgentConversation` 的 turn 列表。
 */
export function mapMessagesToConversationTurns(
  messages: ConversationMessage[],
  options: MapConversationMessagesOptions,
): ConversationTurn[] {
  return messages.reduce<ConversationTurn[]>((turns, item) => {
    if (item.role === 'USER') {
      const errorMessage = options.turnErrors[item.id]
      const attachments = options.attachmentsOf?.(item)

      turns.push({
        id: item.id,
        userMessage: item.content,
        ...(attachments ? { attachments } : {}),
        status: getUserMessageTurnStatus(item.id, options.activeTurnId, errorMessage),
        createdAt: item.createdAt,
        ...(errorMessage ? { errorMessage } : {}),
      })

      return turns
    }

    const currentTurn = turns[turns.length - 1]

    if (!currentTurn || currentTurn.reply)
      return turns

    const errorMessage = options.turnErrors[item.id]

    currentTurn.reply = item.content
    currentTurn.generatedAt = item.updatedAt
    currentTurn.status = mapAssistantMessageStatus(item.status)

    const run = options.runs?.[item.id] ?? options.restoredRun(item)

    if (run)
      currentTurn.run = run

    if (item.status === 'FAILED') {
      currentTurn.errorMessage = errorMessage ?? item.content
    }

    return turns
  }, [])
}

/**
 * 按会话更新时间倒序排序，保证最近更新的会话排在最前面。
 *
 * @param conversations - 后端返回或本地拼接后的会话列表。
 * @returns 新的已排序会话数组，不修改原数组。
 */
export function sortConversationsByUpdatedAt(conversations: Conversation[]): Conversation[] {
  return [...conversations].sort((current, next) => {
    return new Date(next.updatedAt).getTime() - new Date(current.updatedAt).getTime()
  })
}

/**
 * 比较两条消息的创建时间，用于将消息按时间正序展示。
 *
 * @param current - 当前消息。
 * @param next - 下一条消息。
 * @returns 负数表示当前消息应排在前面，正数表示下一条消息应排在前面。
 */
export function compareMessagesByCreatedAt(
  current: ConversationMessage,
  next: ConversationMessage,
): number {
  return new Date(current.createdAt).getTime() - new Date(next.createdAt).getTime()
}

/** 接口消息的等待过程（#212）：已结束的回答按 activity 还原，结局取自消息状态。 */
export function restoreMessageRun(message: ConversationMessage): TurnRun | undefined {
  const outcome = RESTORED_OUTCOMES[message.status]

  return message.activity && outcome ? restoreRun(message.activity, outcome) : undefined
}

function getUserMessageTurnStatus(
  messageId: string,
  activeTurnId: string | null,
  errorMessage: string | undefined,
): ConversationTurn['status'] {
  if (errorMessage)
    return 'error'

  if (messageId === activeTurnId)
    return 'thinking'

  return 'success'
}

function mapAssistantMessageStatus(
  status: ConversationMessage['status'],
): ConversationTurnStatus {
  switch (status) {
    case 'STREAMING':
      return 'generating'
    case 'FAILED':
      return 'error'
    case 'ABORTED':
      return 'aborted'
    case 'PENDING':
      return 'thinking'
    case 'COMPLETED':
    default:
      return 'success'
  }
}
