import type { DeepSeekReasoningEffort, MessageGroundingV1 } from '@agent/contracts'
import type { ChatMessage } from '../llm/llm.types.js'

export type AgentRuntimeEvent
  = | AgentRuntimeRunStartedEvent
    | AgentRuntimeAssistantDeltaEvent
    | AgentRuntimeRunCompletedEvent
    | AgentRuntimeRunFailedEvent
    | AgentRuntimeRunAbortedEvent

export interface AgentRuntimeRunStartedEvent {
  type: 'run_started'
  runId: string
  conversationId: string
  userMessageId: string
  assistantMessageId: string
}

export interface AgentRuntimeAssistantDeltaEvent {
  type: 'assistant_delta'
  runId: string
  conversationId: string
  assistantMessageId: string
  contentDelta: string
}

export interface AgentRuntimeRunCompletedEvent {
  type: 'run_completed'
  runId: string
  conversationId: string
  assistantMessageId: string
  content: string
  generatedAt: string
  /** 仅 Evidence-backed 回答携带；普通回答没有 Grounding。 */
  grounding?: MessageGroundingV1
}

export interface AgentRuntimeRunFailedEvent {
  type: 'run_failed'
  runId?: string
  conversationId: string
  assistantMessageId?: string
  /**
   * terminalization_unknown：终态收口失败或 COMMIT 结果未知，run 可能实际
   * 已成功提交；消费者应引导「刷新确认」而不是「重试」，避免重复发送计费。
   */
  failureReason?: 'conversation_not_found' | 'terminalization_unknown'
  message: string
}

export interface AgentRuntimeRunAbortedEvent {
  type: 'run_aborted'
  runId?: string
  conversationId: string
  assistantMessageId: string
  content: string
}

export interface RunTurnStreamInput {
  conversationId: string
  userContent: string
  model?: string
  reasoningEffort?: DeepSeekReasoningEffort
  signal?: AbortSignal
  maxTokens?: number
  buildModelMessages: (historyMessages: ChatMessage[]) => ChatMessage[]
}
