import type { ChatStreamEvent, MessageGroundingV1 } from '@agent/contracts'
import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，Web 侧同样不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { parseChatStreamEventLine, streamChatWithSeoAgent } from './seo'

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

const LEGACY_EVENTS: ChatStreamEvent[] = [
  {
    type: 'start',
    conversationId: 'conversation-1',
    userMessageId: 'user-1',
    assistantMessageId: 'assistant-1',
  },
  {
    type: 'delta',
    conversationId: 'conversation-1',
    assistantMessageId: 'assistant-1',
    contentDelta: '增量',
  },
  {
    type: 'done',
    conversationId: 'conversation-1',
    assistantMessageId: 'assistant-1',
    content: '最终回答',
    generatedAt: '2026-08-15T08:00:00.000Z',
  },
  {
    type: 'error',
    conversationId: 'conversation-1',
    message: '安全错误',
  },
  {
    type: 'aborted',
    conversationId: 'conversation-1',
    assistantMessageId: 'assistant-1',
    content: '部分回答',
  },
]

describe('NDJSON 协议兼容', () => {
  it('五类 legacy 事件解析后语义保持不变', () => {
    for (const event of LEGACY_EVENTS) {
      assert.deepEqual(
        parseChatStreamEventLine(JSON.stringify(event)),
        event,
      )
    }
  })

  it('done 上没有 grounding 时不会凭空补字段', () => {
    const parsed = parseChatStreamEventLine(JSON.stringify(LEGACY_EVENTS[2]))

    assert.ok(parsed)
    assert.equal(Object.hasOwn(parsed, 'grounding'), false)
  })

  it('done 携带合法 grounding 时原样保留', () => {
    const parsed = parseChatStreamEventLine(JSON.stringify({
      ...LEGACY_EVENTS[2],
      grounding: GROUNDING,
    }))

    assert.ok(parsed)
    assert.equal(parsed.type, 'done')
    assert.deepEqual(parsed.type === 'done' ? parsed.grounding : undefined, GROUNDING)
  })

  it('语义合法的其它组合同样被接受', () => {
    const [firstCitation] = GROUNDING.citations
    const validGroundings = [
      // zero-hit：none + insufficient + 0 citation
      {
        ...GROUNDING,
        evidenceAvailability: 'none',
        outcome: 'insufficient_evidence',
        citations: [],
      },
      // partial + answered
      { ...GROUNDING, evidenceAvailability: 'partial' },
      // 有候选但不足以回答
      { ...GROUNDING, outcome: 'insufficient_evidence' },
      // conflicting + 两个不同 source
      {
        ...GROUNDING,
        outcome: 'conflicting_evidence',
        citations: [
          firstCitation,
          {
            ...firstCitation,
            citationId: 'cit_ffffffffffffffffffffffffffffffff',
            sourceId: 302,
            chunkId: 'article-302-chunk-0',
          },
        ],
      },
      // 合法的 server-issued citationId
      {
        ...GROUNDING,
        citations: [{
          ...firstCitation,
          citationId: 'cit_abcdef0123456789abcdef0123456789',
        }],
      },
      // 空 sectionPath / excerpt 归一化为 null
      {
        ...GROUNDING,
        citations: [{ ...firstCitation, sectionPath: '', excerpt: '' }],
      },
    ]

    for (const grounding of validGroundings) {
      const parsed = parseChatStreamEventLine(JSON.stringify({
        ...LEGACY_EVENTS[2],
        grounding,
      }))

      assert.ok(parsed)
      assert.equal(parsed.type === 'done' ? Object.hasOwn(parsed, 'grounding') : false, true)
    }
  })

  it('done 上的 grounding 损坏或语义非法时只丢弃该字段，回答本身仍然可用', () => {
    const [firstCitation] = GROUNDING.citations

    for (const invalidGrounding of [
      // 结构非法
      null,
      'grounding',
      { ...GROUNDING, schemaVersion: 2 },
      { ...GROUNDING, citationIntegrity: 'verified' },
      { ...GROUNDING, faithfulnessStatus: 'verified' },
      { ...GROUNDING, citations: 'not-an-array' },
      { ...GROUNDING, citations: [{ citationId: 'cit_1' }] },
      { ...GROUNDING, citations: [{ ...firstCitation, strategy: null }] },
      { ...GROUNDING, extra: 'field' },
      // 枚举非法
      { ...GROUNDING, evidenceAvailability: 'maybe' },
      { ...GROUNDING, outcome: 'answered_maybe' },
      // 语义非法：outcome × availability 组合
      { ...GROUNDING, evidenceAvailability: 'none', citations: [] },
      { ...GROUNDING, evidenceAvailability: 'unavailable', citations: [] },
      {
        ...GROUNDING,
        evidenceAvailability: 'none',
        outcome: 'insufficient_evidence',
      },
      // answered 但没有 Citation
      { ...GROUNDING, citations: [] },
      // conflicting 但只有一个 source
      {
        ...GROUNDING,
        outcome: 'conflicting_evidence',
        citations: [
          firstCitation,
          { ...firstCitation, citationId: 'cit_2', chunkId: 'article-301-chunk-1' },
        ],
      },
      // Citation 超过 5 条
      {
        ...GROUNDING,
        citations: Array.from({ length: 6 }, (_, index) => ({
          ...firstCitation,
          citationId: `cit_${index}`,
          sourceId: 400 + index,
          chunkId: `article-${400 + index}-chunk-0`,
        })),
      },
      // citationId 重复
      {
        ...GROUNDING,
        outcome: 'conflicting_evidence',
        citations: [
          firstCitation,
          { ...firstCitation, sourceId: 302, chunkId: 'article-302-chunk-0' },
        ],
      },
      // v1 的 href 必须为 null
      {
        ...GROUNDING,
        citations: [{ ...firstCitation, href: '/articles/seo-basics' }],
      },
      // 非安全整数与字段长度
      {
        ...GROUNDING,
        citations: [{ ...firstCitation, sourceId: Number.MAX_SAFE_INTEGER + 2 }],
      },
      { ...GROUNDING, citations: [{ ...firstCitation, rank: -1 }] },
      { ...GROUNDING, citations: [{ ...firstCitation, title: '标'.repeat(301) }] },
      // article / chunk 一致性
      { ...GROUNDING, citations: [{ ...firstCitation, granularity: 'article' }] },
      { ...GROUNDING, citations: [{ ...firstCitation, chunkId: null }] },
      // chunkId 是身份字段，空字符串不能被当成「没有这项内容」
      { ...GROUNDING, citations: [{ ...firstCitation, chunkId: '' }] },
      { ...GROUNDING, citations: [{ ...firstCitation, chunkId: 'c'.repeat(201) }] },
      // 公开 citationId 必须是 server-issued 的 cit_<32hex>
      {
        ...GROUNDING,
        citations: [{
          ...firstCitation,
          citationId: 'evk_0123456789abcdef0123456789abcdef',
        }],
      },
      { ...GROUNDING, citations: [{ ...firstCitation, citationId: 'cit_1' }] },
      { ...GROUNDING, citations: [{ ...firstCitation, citationId: '' }] },
      { ...GROUNDING, citations: [{ ...firstCitation, citationId: '   ' }] },
      {
        ...GROUNDING,
        citations: [{
          ...firstCitation,
          citationId: 'sid_0123456789abcdef0123456789abcdef',
        }],
      },
      {
        ...GROUNDING,
        citations: [{
          ...firstCitation,
          citationId: 'cit_0123456789ABCDEF0123456789abcdef',
        }],
      },
    ]) {
      const parsed = parseChatStreamEventLine(JSON.stringify({
        ...LEGACY_EVENTS[2],
        grounding: invalidGrounding,
      }))

      assert.ok(parsed)
      assert.equal(parsed.type, 'done')
      assert.equal(parsed.type === 'done' ? parsed.content : '', '最终回答')
      assert.equal(Object.hasOwn(parsed, 'grounding'), false)
    }
  })

  it('未知 top-level event type 继续 fail closed', () => {
    assert.throws(
      () => parseChatStreamEventLine(JSON.stringify({
        type: 'citation_delta',
        conversationId: 'conversation-1',
      })),
      /流式响应事件格式不正确/,
    )
  })

  it('已知事件缺必填字段时继续 fail closed', () => {
    assert.throws(
      () => parseChatStreamEventLine(JSON.stringify({
        type: 'done',
        conversationId: 'conversation-1',
      })),
      /流式响应事件格式不正确/,
    )
  })

  it('非 JSON 行报可读错误', () => {
    assert.throws(
      () => parseChatStreamEventLine('{not json'),
      /流式响应 JSON 解析失败/,
    )
  })

  it('空行被忽略', () => {
    assert.equal(parseChatStreamEventLine('   '), null)
  })
})

describe('streamChatWithSeoAgent', () => {
  it('按行消费 NDJSON，并保留 done 上的可选 grounding', async () => {
    const lines = [
      ...LEGACY_EVENTS.slice(0, 2).map(event => JSON.stringify(event)),
      JSON.stringify({ ...LEGACY_EVENTS[2], grounding: GROUNDING }),
    ]
    const restoreFetch = stubFetch(`${lines.join('\n')}\n`)

    try {
      const events = await collect(streamChatWithSeoAgent({
        conversationId: 'conversation-1',
        message: '问题',
      }))

      assert.deepEqual(events.map(event => event.type), ['start', 'delta', 'done'])

      const doneEvent = events.at(-1)!

      assert.deepEqual(
        doneEvent.type === 'done' ? doneEvent.grounding : undefined,
        GROUNDING,
      )
    }
    finally {
      restoreFetch()
    }
  })

  it('跨 chunk 切分的行与缺少结尾换行的响应都能正确还原', async () => {
    const payload = `${JSON.stringify(LEGACY_EVENTS[0])}\n${JSON.stringify(LEGACY_EVENTS[2])}`
    const restoreFetch = stubFetch(payload, { chunkSize: 7 })

    try {
      const events = await collect(streamChatWithSeoAgent({
        conversationId: 'conversation-1',
        message: '问题',
      }))

      assert.deepEqual(events.map(event => event.type), ['start', 'done'])
    }
    finally {
      restoreFetch()
    }
  })

  it('HTTP 失败时抛出后端提供的安全错误消息', async () => {
    const restoreFetch = stubFetch('', {
      status: 503,
      body: JSON.stringify({ message: '模型服务暂时没有返回结果，请稍后重试。' }),
    })

    try {
      await assert.rejects(
        collect(streamChatWithSeoAgent({
          conversationId: 'conversation-1',
          message: '问题',
        })),
        /模型服务暂时没有返回结果/,
      )
    }
    finally {
      restoreFetch()
    }
  })
})

async function collect(
  events: AsyncGenerator<ChatStreamEvent>,
): Promise<ChatStreamEvent[]> {
  const collected: ChatStreamEvent[] = []

  for await (const event of events)
    collected.push(event)

  return collected
}

interface StubFetchOptions {
  chunkSize?: number
  status?: number
  body?: string
}

function stubFetch(
  ndjson: string,
  options: StubFetchOptions = {},
): () => void {
  const originalFetch = globalThis.fetch
  const status = options.status ?? 200

  globalThis.fetch = (async () => {
    if (status !== 200) {
      return new Response(options.body ?? '', {
        status,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const bytes = new TextEncoder().encode(ndjson)
    const chunkSize = options.chunkSize ?? bytes.length
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let offset = 0; offset < bytes.length; offset += chunkSize)
          controller.enqueue(bytes.slice(offset, offset + chunkSize))

        controller.close()
      },
    })

    return new Response(body, {
      status,
      headers: { 'Content-Type': 'application/x-ndjson' },
    })
  }) as typeof globalThis.fetch

  return () => {
    globalThis.fetch = originalFetch
  }
}
