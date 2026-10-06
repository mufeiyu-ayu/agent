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

    case 'reasoning_delta':
      return {
        type: 'reasoning_delta',
        conversationId: event.conversationId,
        assistantMessageId: event.assistantMessageId,
        delta: event.delta,
      }

    case 'tool_started':
      return {
        type: 'tool_started',
        conversationId: event.conversationId,
        assistantMessageId: event.assistantMessageId,
        callId: event.callId,
        toolName: event.toolName,
        ...(event.workspace === undefined ? {} : { workspace: event.workspace }),
        ...(event.query === undefined ? {} : { query: event.query }),
        ...(event.url === undefined ? {} : { url: event.url }),
      }

    // 逐字段列出：工具在 display 里多带的字段不会发到浏览器。
    case 'tool_finished':
      return {
        type: 'tool_finished',
        conversationId: event.conversationId,
        assistantMessageId: event.assistantMessageId,
        callId: event.callId,
        ok: event.ok,
        ...(event.workspace === undefined ? {} : { workspace: event.workspace }),
        ...(event.failure === undefined ? {} : { failure: event.failure }),
        ...(event.skipped === undefined ? {} : { skipped: event.skipped }),
        ...(event.results === undefined ? {} : { results: event.results }),
        ...(event.finalUrl === undefined ? {} : { finalUrl: event.finalUrl }),
        ...(event.title === undefined ? {} : { title: event.title }),
        ...(event.chars === undefined ? {} : { chars: event.chars }),
      }

    case 'run_completed':
      return {
        type: 'done',
        conversationId: event.conversationId,
        assistantMessageId: event.assistantMessageId,
        content: event.content,
        generatedAt: event.generatedAt,
      }

    case 'run_failed':
      return {
        type: 'error',
        conversationId: event.conversationId,
        ...(event.assistantMessageId ? { assistantMessageId: event.assistantMessageId } : {}),
        message: event.message,
        ...(event.userMessagePersisted ? { userMessagePersisted: true } : {}),
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
