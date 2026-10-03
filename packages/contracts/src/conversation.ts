import type { ChatStreamToolFinishedEvent, ChatStreamToolStartedEvent } from './chat.js'

export interface Conversation {
  id: string
  title: string
  createdAt: string
  updatedAt: string
}

export interface ListConversationsRequest {
  cursor?: string
  limit?: number
}

export interface ListConversationsResponse {
  items: Conversation[]
  nextCursor: string | null
}

export interface CreateConversationRequest {
  title?: string
}

export interface UpdateConversationRequest {
  title: string
}

export interface DeleteConversationResponse {
  deleted: boolean
  id: string
}

/**
 * 等待过程出现状态行的界限（Nielsen 响应时间界限，#208）：调过工具，或满这么久还没有正文。
 * 前台判断状态行、后端决定是否下发 activity（#212）共用这一个值。
 */
export const RUN_ROW_DELAY_MS = 1000

export type MessageRole = 'USER' | 'ASSISTANT'

export type MessageStatus
  = | 'PENDING' // 消息已创建，等待开始处理（如等待模型响应）
    | 'STREAMING' // 模型正在流式返回内容，消息处于生成中
    | 'COMPLETED' // 消息已正常生成完毕
    | 'FAILED' // 处理过程中出错，未能正常完成
    | 'ABORTED' // 被主动中断（如用户手动停止生成）

export interface ConversationMessage {
  id: string
  conversationId: string
  role: MessageRole
  content: string
  status: MessageStatus
  createdAt: string
  updatedAt: string
  /** 回答的等待过程（#212）：只有 assistant 消息、且对应运行调过工具、有思考或正文满 1 秒才开始时才有。 */
  activity?: MessageActivity
}

/**
 * 刷新后还原摘要行与时间线用的精简数据（#212），取自回答对应的最新一次运行；不含 observation、网页正文与搜索摘要。
 * 字段与流事件（tool_started / tool_finished / reasoning_delta）同义，前台用同一份步骤模型渲染。
 */
export interface MessageActivity {
  /** 从运行开始（start 事件）到第一段正文的毫秒数；没出正文或旧数据没有，此时摘要不显示「用时」。 */
  answerStartedMs?: number
  /** 正文开始之前调过工具：这一轮一定有状态行。 */
  toolBeforeAnswer: boolean
  /** 按执行顺序排列的思考与工具步骤。 */
  items: MessageActivityItem[]
}

export type MessageActivityItem = MessageActivityThought | MessageActivityTool

/** 一轮完整的思考原文；前台照实时路径取最后写完的一句。 */
export interface MessageActivityThought {
  kind: 'thought'
  text: string
}

/**
 * 一次工具调用：字段与 tool_started / tool_finished 同义（协议只在 chat.ts 维护一处）。
 * ok 为 false 时：有 failure 是工具失败（timeout 超时，其余为 failed）；没有 failure 是执行中被停止或中断，没有结果。
 */
export interface MessageActivityTool
  extends Pick<ChatStreamToolStartedEvent, 'callId' | 'toolName' | 'query' | 'url'>,
  Pick<ChatStreamToolFinishedEvent, 'ok' | 'failure' | 'results' | 'finalUrl' | 'title' | 'chars' | 'workspace'> {
  kind: 'tool'
  /** 步骤的起止时间差。 */
  durationMs?: number
}
