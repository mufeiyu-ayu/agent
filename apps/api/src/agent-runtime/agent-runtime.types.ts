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
}

export interface AgentRuntimeRunFailedEvent {
  type: 'run_failed'
  runId?: string
  conversationId: string
  assistantMessageId?: string
  failureReason?: 'conversation_not_found'
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
  signal?: AbortSignal
  historyLimit: number
  temperature: number
  maxTokens: number
  buildModelMessages: (historyMessages: ChatMessage[]) => ChatMessage[]
}
