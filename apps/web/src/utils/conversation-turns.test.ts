import type {
  ChatStreamDoneEvent,
  ConversationMessage,
  MessageGroundingV1,
} from '@agent/contracts'

import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，Web 侧同样不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { mapMessagesToConversationTurns } from './conversation-turns'
import {
  applyStreamDoneToMessage,
  normalizeConversationMessages,
} from './message-grounding'

const GROUNDING: MessageGroundingV1 = {
  schemaVersion: 1,
  evidenceAvailability: 'available',
  outcome: 'answered',
  citationIntegrity: 'validated',
  faithfulnessStatus: 'not_evaluated',
  citations: [{
    citationId: 'cit_0123456789abcdef0123456789abcdef',
    sourceId: 301,
    chunkId: 'article-301-chunk-0',
    granularity: 'chunk',
    title: 'SEO 基础',
    slug: 'seo-basics',
    languageCode: 'zh-cn',
    sectionPath: 'Section 0',
    excerpt: '候选片段',
    rank: 1,
    href: null,
    strategy: { name: 'hybrid_rrf', version: '1' },
  }],
}

const MAP_OPTIONS = { activeTurnId: null, turnErrors: {} }

const USER_MESSAGE: ConversationMessage = {
  id: 'user-1',
  conversationId: 'conversation-1',
  role: 'USER',
  content: '这个页面怎么优化？',
  status: 'COMPLETED',
  createdAt: '2026-08-16T08:00:00.000Z',
  updatedAt: '2026-08-16T08:00:00.000Z',
  grounding: null,
}

function createAssistantMessage(
  overrides: Partial<ConversationMessage> = {},
): ConversationMessage {
  return {
    id: 'assistant-1',
    conversationId: 'conversation-1',
    role: 'ASSISTANT',
    content: '最终回答',
    status: 'COMPLETED',
    createdAt: '2026-08-16T08:00:01.000Z',
    updatedAt: '2026-08-16T08:00:02.000Z',
    grounding: null,
    ...overrides,
  }
}

describe('turn 的 Grounding 投影', () => {
  it('COMPLETED 助手消息把 Grounding 带到 turn', () => {
    const [turn] = mapMessagesToConversationTurns(
      [USER_MESSAGE, createAssistantMessage({ grounding: GROUNDING })],
      MAP_OPTIONS,
    )

    assert.equal(turn.status, 'success')
    assert.deepEqual(turn.grounding, GROUNDING)
  })

  it('非 COMPLETED 助手消息即使残留 Grounding 也不投影', () => {
    for (const status of ['STREAMING', 'FAILED', 'ABORTED', 'PENDING'] as const) {
      const [turn] = mapMessagesToConversationTurns(
        [USER_MESSAGE, createAssistantMessage({ status, grounding: GROUNDING })],
        MAP_OPTIONS,
      )

      assert.equal(turn.grounding, undefined, `${status} 不应带来源`)
    }
  })

  it('legacy / 普通回答不产生 Grounding 字段', () => {
    const [turn] = mapMessagesToConversationTurns(
      [USER_MESSAGE, createAssistantMessage()],
      MAP_OPTIONS,
    )

    assert.equal(Object.hasOwn(turn, 'grounding'), false)
    assert.equal(turn.reply, '最终回答')
  })

  it('回答正文里的引用记号与 URL 不会生成来源', () => {
    const [turn] = mapMessagesToConversationTurns(
      [
        USER_MESSAGE,
        createAssistantMessage({
          content: '参考 [1] 与 [2]，详见 https://evil.example/a 和 /articles/seo-basics。',
        }),
      ],
      MAP_OPTIONS,
    )

    assert.equal(turn.grounding, undefined)
  })
})

describe('实时 done 与页面重载的一致性', () => {
  const doneEvent: ChatStreamDoneEvent = {
    type: 'done',
    conversationId: 'conversation-1',
    assistantMessageId: 'assistant-1',
    content: '最终回答',
    generatedAt: '2026-08-16T08:00:02.000Z',
    grounding: GROUNDING,
  }

  it('done 合并后的 turn 与 Messages API 重载后的 turn 深度一致', () => {
    // 实时：流式消息收到 done 后就地合并。
    const realtimeMessages = [
      USER_MESSAGE,
      applyStreamDoneToMessage(
        createAssistantMessage({ content: '增量', status: 'STREAMING' }),
        doneEvent,
      ),
    ]

    // 重载：Messages API 返回同一份 durable 事实，经 Web 边界归一化。
    const reloadedMessages = normalizeConversationMessages([
      USER_MESSAGE,
      createAssistantMessage({ grounding: GROUNDING }),
    ])

    assert.deepEqual(
      mapMessagesToConversationTurns(realtimeMessages, MAP_OPTIONS),
      mapMessagesToConversationTurns(reloadedMessages, MAP_OPTIONS),
    )
  })

  it('重载后来源既不丢失也不重复', () => {
    const [turn] = mapMessagesToConversationTurns(
      normalizeConversationMessages([
        USER_MESSAGE,
        createAssistantMessage({ grounding: GROUNDING }),
      ]),
      MAP_OPTIONS,
    )

    assert.equal(turn.grounding?.citations.length, 1)
  })

  it('重载到 malformed Grounding 时正文仍然可读且没有来源', () => {
    const [turn] = mapMessagesToConversationTurns(
      normalizeConversationMessages([
        USER_MESSAGE,
        createAssistantMessage({
          grounding: { ...GROUNDING, outcome: 'verified' } as unknown as MessageGroundingV1,
        }),
      ]),
      MAP_OPTIONS,
    )

    assert.equal(turn.grounding, undefined)
    assert.equal(turn.reply, '最终回答')
    assert.equal(turn.status, 'success')
  })
})
