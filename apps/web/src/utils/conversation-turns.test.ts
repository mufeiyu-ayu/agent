import type { ConversationMessage } from '@agent/contracts'

import assert from 'node:assert/strict'
import { describe, it } from 'vitest'

import { mapMessagesToConversationTurns, restoreMessageRun } from './conversation-turns'
import { startRun } from './run-status'

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
      { activeTurnId: null, turnErrors: {}, restoredRun: restoreMessageRun },
    )

    assert.equal(turn.status, 'success')
    assert.equal(turn.reply, '最终回答')
  })

  it('#212 已结束的回答按 activity 还原 run：结局随消息状态；还在生成的不还原', () => {
    const activity = { answerStartedMs: 2_000, toolBeforeAnswer: false, items: [{ kind: 'thought' as const, text: '想一想。' }] }
    const map = (status: ConversationMessage['status']) => mapMessagesToConversationTurns(
      [USER_MESSAGE, { ...ASSISTANT_MESSAGE, status, activity }],
      { activeTurnId: null, turnErrors: {}, restoredRun: restoreMessageRun },
    )[0]?.run

    assert.equal(map('COMPLETED')?.outcome, 'done')
    assert.equal(map('FAILED')?.outcome, 'error')
    assert.equal(map('ABORTED')?.outcome, 'aborted')
    assert.equal(map('COMPLETED')?.phase, 'ended')
    // 还在生成（或进程中断遗留）的回答没有摘要可还原。
    assert.equal(map('STREAMING'), undefined)
    assert.equal(restoreMessageRun(ASSISTANT_MESSAGE), undefined)
  })

  it('#212 用调用方给的还原函数：带缓存时历史轮次的 run 保持同一个对象', () => {
    const message = { ...ASSISTANT_MESSAGE, activity: { toolBeforeAnswer: false, items: [] } }
    const cached = restoreMessageRun(message)
    const map = () => mapMessagesToConversationTurns([USER_MESSAGE, message], {
      activeTurnId: null,
      turnErrors: {},
      restoredRun: () => cached,
    })[0]?.run

    assert.equal(map(), cached)
    assert.equal(map(), map())
  })

  it('#212 当前页面里的 run 优先于接口下发的 activity', () => {
    const live = startRun(0)
    const [turn] = mapMessagesToConversationTurns(
      [USER_MESSAGE, { ...ASSISTANT_MESSAGE, activity: { toolBeforeAnswer: false, items: [] } }],
      { activeTurnId: null, turnErrors: {}, runs: { 'assistant-1': live }, restoredRun: restoreMessageRun },
    )

    assert.equal(turn?.run, live)
  })
})
