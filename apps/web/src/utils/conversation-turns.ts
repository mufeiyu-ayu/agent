import type { Conversation, ConversationMessage } from '@agent/contracts'
import type { SeoConversationTurn } from '../types/seo'

interface MapConversationMessagesOptions {
  activeTurnId: string | null
  turnErrors: Record<string, string>
}

/**
 * 将后端 Message 列表转换为当前聊天 UI 使用的 turn 列表。
 *
 * @param messages - 后端按时间正序返回的消息列表。
 * @param options - 当前 loading 的 user message id 和本地错误映射。
 * @returns 可以直接传给 `AgentConversation` 的 turn 列表。
 */
export function mapMessagesToConversationTurns(
  messages: ConversationMessage[],
  options: MapConversationMessagesOptions,
): SeoConversationTurn[] {
  return messages.reduce<SeoConversationTurn[]>((turns, item) => {
    if (item.role === 'USER') {
      const errorMessage = options.turnErrors[item.id]

      turns.push({
        id: item.id,
        userMessage: item.content,
        status: getUserMessageTurnStatus(item.id, options.activeTurnId, errorMessage),
        createdAt: item.createdAt,
        ...(errorMessage ? { errorMessage } : {}),
      })

      return turns
    }

    const currentTurn = turns[turns.length - 1]

    if (!currentTurn || currentTurn.reply)
      return turns

    currentTurn.reply = item.content
    currentTurn.generatedAt = item.createdAt
    currentTurn.status = item.status === 'FAILED' ? 'error' : 'success'

    if (item.status === 'FAILED') {
      currentTurn.errorMessage = item.content
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

function getUserMessageTurnStatus(
  messageId: string,
  activeTurnId: string | null,
  errorMessage: string | undefined,
): SeoConversationTurn['status'] {
  if (errorMessage)
    return 'error'

  if (messageId === activeTurnId)
    return 'loading'

  return 'success'
}
