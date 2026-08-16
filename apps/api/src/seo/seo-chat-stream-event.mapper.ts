import type { ChatStreamEvent } from '@agent/contracts'
import type { AgentRuntimeEvent } from '../agent-runtime/agent-runtime.types.js'

export function toChatStreamEvent(event: AgentRuntimeEvent): ChatStreamEvent {
  switch (event.type) {
    case 'run_started':
      return {
        type: 'start',
        conversationId: event.conversationId,
        userMessageId: event.userMessageId,
        assistantMessageId: event.assistantMessageId,
      }

    case 'assistant_delta':
      return {
        type: 'delta',
        conversationId: event.conversationId,
        assistantMessageId: event.assistantMessageId,
        contentDelta: event.contentDelta,
      }

    case 'run_completed':
      return {
        type: 'done',
        conversationId: event.conversationId,
        assistantMessageId: event.assistantMessageId,
        content: event.content,
        generatedAt: event.generatedAt,
        // 只在 done 上增加可选字段，不新增 top-level event type；
        // 普通回答与 legacy consumer 行为完全不变。
        ...(event.grounding ? { grounding: event.grounding } : {}),
      }

    case 'run_failed':
      return {
        type: 'error',
        conversationId: event.conversationId,
        ...(event.assistantMessageId ? { assistantMessageId: event.assistantMessageId } : {}),
        message: event.message,
      }

    case 'run_aborted':
      return {
        type: 'aborted',
        conversationId: event.conversationId,
        assistantMessageId: event.assistantMessageId,
        content: event.content,
      }
  }
}
