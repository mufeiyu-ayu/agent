import type { ChatStreamEvent } from '@agent/contracts'
import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，Web 侧同样不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { ChatStreamHttpError, parseChatStreamEventLine, streamChat } from './chat'

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

  it('未知 top-level event type 继续 fail closed', () => {
    assert.throws(
      () => parseChatStreamEventLine(JSON.stringify({
        type: 'unknown',
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

describe('streamChat', () => {
  it('按行消费 NDJSON', async () => {
    const lines = LEGACY_EVENTS.slice(0, 3).map(event => JSON.stringify(event))
    const restoreFetch = stubFetch(`${lines.join('\n')}\n`)

    try {
      const events = await collect(streamChat({
        conversationId: 'conversation-1',
        message: '问题',
      }))

      assert.deepEqual(events.map(event => event.type), ['start', 'delta', 'done'])
    }
    finally {
      restoreFetch()
    }
  })

  it('跨 chunk 切分的行与缺少结尾换行的响应都能正确还原', async () => {
    const payload = `${JSON.stringify(LEGACY_EVENTS[0])}\n${JSON.stringify(LEGACY_EVENTS[2])}`
    const restoreFetch = stubFetch(payload, { chunkSize: 7 })

    try {
      const events = await collect(streamChat({
        conversationId: 'conversation-1',
        message: '问题',
      }))

      assert.deepEqual(events.map(event => event.type), ['start', 'done'])
    }
    finally {
      restoreFetch()
    }
  })

  it('解析失败或消费者提前退出时取消底层流（关闭 HTTP 连接）', async () => {
    const originalFetch = globalThis.fetch
    let cancelCount = 0
    const createOpenResponse = (lines: string[]): Response => {
      const bytes = new TextEncoder().encode(`${lines.join('\n')}\n`)
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(bytes)
          // 刻意不 close：模拟仍在进行中的流，只有 cancel 能关闭连接。
          // 若实现只 releaseLock 不 cancel，后端会继续采样计费。
        },
        cancel() {
          cancelCount += 1
        },
      })

      return new Response(body, {
        status: 200,
        headers: { 'Content-Type': 'application/x-ndjson' },
      })
    }

    try {
      // 场景一：某行 JSON 损坏 → 抛错，且底层流必须被 cancel。
      globalThis.fetch = (async () => createOpenResponse([
        JSON.stringify(LEGACY_EVENTS[0]),
        '{ broken',
      ])) as typeof globalThis.fetch

      await assert.rejects(
        collect(streamChat({
          conversationId: 'conversation-1',
          message: '问题',
        })),
        /JSON 解析失败/,
      )
      assert.equal(cancelCount, 1)

      // 场景二：消费者提前 break（触发 generator.return()）→ 同样 cancel。
      globalThis.fetch = (async () => createOpenResponse([
        JSON.stringify(LEGACY_EVENTS[0]),
        JSON.stringify(LEGACY_EVENTS[1]),
      ])) as typeof globalThis.fetch

      const stream = streamChat({
        conversationId: 'conversation-1',
        message: '问题',
      })
      const first = await stream.next()

      assert.equal((first.value as ChatStreamEvent | undefined)?.type, 'start')
      // for-await break 的等价语义：显式触发 generator.return()。
      await stream.return(undefined)
      assert.equal(cancelCount, 2)
    }
    finally {
      globalThis.fetch = originalFetch
    }
  })

  it('HTTP 失败时抛出后端提供的安全错误消息', async () => {
    const restoreFetch = stubFetch('', {
      status: 503,
      body: JSON.stringify({ message: '模型服务暂时没有返回结果，请稍后重试。' }),
    })

    try {
      await assert.rejects(
        collect(streamChat({
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

  it('只有不带校验明细的 400 才标记为模型不可用', async () => {
    const cases = [
      { status: 400, error: { statusCode: 400, error: 'Bad Request', details: [] }, expected: true },
      { status: 400, error: { statusCode: 400, error: 'Bad Request', details: ['message must be a string'] }, expected: false },
      { status: 503, error: { statusCode: 503, error: 'Service Unavailable', details: [] }, expected: false },
    ]

    for (const { status, error, expected } of cases) {
      const restoreFetch = stubFetch('', { status, body: JSON.stringify({ message: '请求的模型未对前台开放', error }) })

      try {
        await assert.rejects(
          collect(streamChat({ conversationId: 'conversation-1', message: '问题' })),
          (thrown: unknown) => thrown instanceof ChatStreamHttpError
            && thrown.status === status
            && thrown.isModelUnavailable === expected
            && thrown.message === '请求的模型未对前台开放',
        )
      }
      finally {
        restoreFetch()
      }
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
