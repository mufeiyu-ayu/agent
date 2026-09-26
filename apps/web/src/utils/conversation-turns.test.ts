import type { ConversationMessage } from '@agent/contracts'

import assert from 'node:assert/strict'
import { describe, it } from 'vitest'

import { mapMessagesToConversationTurns } from './conversation-turns'

const USER_MESSAGE: ConversationMessage = {
  id: 'user-1',
  conversationId: 'conversation-1',
  role: 'USER',
  content: '这个页面怎么优化？',
  status: 'COMPLETED',
  createdAt: '2026-08-16T08:00:00.000Z',
  updatedAt: '2026-08-16T08:00:00.000Z',
}

const ASSISTANT_MESSAGE: ConversationMessage = {
  id: 'assistant-1',
  conversationId: 'conversation-1',
  role: 'ASSISTANT',
  content: '最终回答',
  status: 'COMPLETED',
  createdAt: '2026-08-16T08:00:01.000Z',
  updatedAt: '2026-08-16T08:00:02.000Z',
}

describe('mapMessagesToConversationTurns', () => {
  it('COMPLETED 助手消息投影为 success turn 并带上正文', () => {
    const [turn] = mapMessagesToConversationTurns(
      [USER_MESSAGE, ASSISTANT_MESSAGE],
      { activeTurnId: null, turnErrors: {} },
    )

    assert.equal(turn.status, 'success')
    assert.equal(turn.reply, '最终回答')
  })
})
