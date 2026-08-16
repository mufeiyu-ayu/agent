import type {
  ChatStreamDoneEvent,
  ConversationMessage,
  MessageGroundingV1,
} from '@agent/contracts'

import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，Web 侧同样不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import {
  applyStreamDoneToMessage,
  normalizeConversationMessages,
  sanitizeMessageGrounding,
  withoutMessageGrounding,
} from './message-grounding'

const CITATION = {
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
} as const

const GROUNDING: MessageGroundingV1 = {
  schemaVersion: 1,
  evidenceAvailability: 'available',
  outcome: 'answered',
  citationIntegrity: 'validated',
  faithfulnessStatus: 'not_evaluated',
  citations: [{ ...CITATION }],
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
    createdAt: '2026-08-16T08:00:00.000Z',
    updatedAt: '2026-08-16T08:00:00.000Z',
    grounding: null,
    ...overrides,
  }
}

function createDoneEvent(
  overrides: Partial<ChatStreamDoneEvent> = {},
): ChatStreamDoneEvent {
  return {
    type: 'done',
    conversationId: 'conversation-1',
    assistantMessageId: 'assistant-1',
    content: '最终回答',
    generatedAt: '2026-08-16T08:00:00.000Z',
    ...overrides,
  }
}

describe('sanitizeMessageGrounding', () => {
  it('缺失的 Grounding 归一化为 null', () => {
    assert.equal(sanitizeMessageGrounding(undefined), null)
    assert.equal(sanitizeMessageGrounding(null), null)
  })

  it('合法 Grounding 原样通过', () => {
    assert.deepEqual(sanitizeMessageGrounding(GROUNDING), GROUNDING)
  })

  it('malformed Grounding 一律 fail closed', () => {
    const malformedCandidates: unknown[] = [
      // 缺字段
      { ...GROUNDING, citations: undefined },
      // 多余字段
      { ...GROUNDING, confidence: 0.99 },
      // 契约版本被人为提升
      { ...GROUNDING, schemaVersion: 2 },
      // 伪造 semantic faithfulness
      { ...GROUNDING, faithfulnessStatus: 'verified' },
      // 内部 Run-scoped citationKey 泄漏
      {
        ...GROUNDING,
        citations: [{ ...CITATION, citationId: 'evk_0123456789abcdef0123456789abcdef' }],
      },
      // 非法 outcome × availability 组合：没有证据却声称已回答
      { ...GROUNDING, evidenceAvailability: 'none', citations: [] },
      // conflicting 却只有单一来源
      { ...GROUNDING, outcome: 'conflicting_evidence' },
      // 重复 citationId
      { ...GROUNDING, citations: [{ ...CITATION }, { ...CITATION }] },
      // article 粒度携带 chunk identity
      { ...GROUNDING, citations: [{ ...CITATION, granularity: 'article' }] },
      // 危险协议 href
      { ...GROUNDING, citations: [{ ...CITATION, href: 'javascript:alert(1)' }] },
      // 外部 URL href
      { ...GROUNDING, citations: [{ ...CITATION, href: 'https://evil.example/a' }] },
      // 自行拼接的内部路由
      { ...GROUNDING, citations: [{ ...CITATION, href: '/articles/seo-basics' }] },
      // 非对象
      'grounding',
      42,
      [],
    ]

    for (const candidate of malformedCandidates) {
      assert.equal(
        sanitizeMessageGrounding(candidate),
        null,
        `应当拒绝：${JSON.stringify(candidate)}`,
      )
    }
  })
})

describe('normalizeConversationMessages', () => {
  it('合法历史 Grounding 保留，其它字段不变', () => {
    const message = createAssistantMessage({ grounding: GROUNDING })

    assert.deepEqual(normalizeConversationMessages([message]), [message])
  })

  it('malformed 历史 Grounding 被剥离，正文与状态保持可用', () => {
    const message = createAssistantMessage({
      grounding: { ...GROUNDING, schemaVersion: 9 } as unknown as MessageGroundingV1,
    })

    const [normalized] = normalizeConversationMessages([message])

    assert.equal(normalized.grounding, null)
    assert.equal(normalized.content, '最终回答')
    assert.equal(normalized.status, 'COMPLETED')
  })

  it('单条 Grounding 损坏不影响同一列表里的其它消息', () => {
    const normalized = normalizeConversationMessages([
      createAssistantMessage({
        id: 'assistant-broken',
        grounding: { broken: true } as unknown as MessageGroundingV1,
      }),
      createAssistantMessage({ id: 'assistant-ok', grounding: GROUNDING }),
    ])

    assert.equal(normalized.length, 2)
    assert.equal(normalized[0].grounding, null)
    assert.deepEqual(normalized[1].grounding, GROUNDING)
  })

  it('legacy Message 没有 grounding 字段时归一化为 null', () => {
    const legacyMessage = {
      id: 'assistant-legacy',
      conversationId: 'conversation-1',
      role: 'ASSISTANT',
      content: '旧回答',
      status: 'COMPLETED',
      createdAt: '2026-08-16T08:00:00.000Z',
      updatedAt: '2026-08-16T08:00:00.000Z',
    } as ConversationMessage

    assert.equal(normalizeConversationMessages([legacyMessage])[0].grounding, null)
  })
})

describe('applyStreamDoneToMessage', () => {
  it('done 携带合法 Grounding 时与终态内容一起写入', () => {
    const merged = applyStreamDoneToMessage(
      createAssistantMessage({ content: '增量', status: 'STREAMING' }),
      createDoneEvent({ grounding: GROUNDING }),
    )

    assert.equal(merged.status, 'COMPLETED')
    assert.equal(merged.content, '最终回答')
    assert.equal(merged.updatedAt, '2026-08-16T08:00:00.000Z')
    assert.deepEqual(merged.grounding, GROUNDING)
  })

  it('done 不带 Grounding 时不继承旧的、缓存的或上一轮的来源', () => {
    const merged = applyStreamDoneToMessage(
      createAssistantMessage({ grounding: GROUNDING }),
      createDoneEvent(),
    )

    assert.equal(merged.grounding, null)
  })

  it('done 携带 malformed Grounding 时 fail closed，但正文照常完成', () => {
    const merged = applyStreamDoneToMessage(
      createAssistantMessage({ grounding: GROUNDING }),
      createDoneEvent({
        grounding: { ...GROUNDING, citationIntegrity: 'trusted' } as unknown as MessageGroundingV1,
      }),
    )

    assert.equal(merged.grounding, null)
    assert.equal(merged.content, '最终回答')
    assert.equal(merged.status, 'COMPLETED')
  })
})

describe('withoutMessageGrounding', () => {
  it('error 与 aborted 路径清除 completed Grounding 但保留 partial content', () => {
    for (const status of ['FAILED', 'ABORTED'] as const) {
      const cleared = withoutMessageGrounding(createAssistantMessage({
        status,
        content: '部分回答',
        grounding: GROUNDING,
      }))

      assert.equal(cleared.grounding, null)
      assert.equal(cleared.content, '部分回答')
      assert.equal(cleared.status, status)
    }
  })
})
