import type { Dispatcher } from 'undici'
import type { GeminiEmbeddingClient } from './gemini-embedding.provider.js'
import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { GoogleGenAI } from '@google/genai'
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici'
import {
  EmbeddingError,
  resolveEmbeddingRuntimeConfig,
} from './embedding-provider.js'
import { GeminiEmbeddingProvider } from './gemini-embedding.provider.js'

// 这些用例必须真正经过 @google/genai 的 models.embedContent -> ApiClient -> p-retry -> fetch，
// 因此只替换最底层的 undici dispatcher，不注入 fake GeminiEmbeddingClient。
const GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com'
// SDK deadline 必须远小于 mock 响应延迟，才能证明是 timeout 触发而不是响应返回。
const SDK_TIMEOUT_MS = 300
const MOCK_DELAY_MS = 1_500
const UPSTREAM_ERROR_BODY = { error: { message: 'controlled upstream payload', code: 503 } }
const JSON_HEADERS = { headers: { 'content-type': 'application/json' } }

interface SafeErrorShape {
  constructorName: string | null
  name: string | null
  status: number | null
  code: string | null
  causeConstructorName: string | null
}

interface MockedTransport {
  client: GeminiEmbeddingClient
  pool: ReturnType<MockAgent['get']>
  transportCalls: () => number
}

describe('Gemini SDK transport boundary', () => {
  it('连接失败由 SDK 原样透传为 TypeError，不存在 APIConnectionError', async () => {
    const shapes: SafeErrorShape[] = []

    await withMockedTransport(async ({ client, pool, transportCalls }) => {
      pool.intercept({ path: matchEmbedContent, method: 'POST' })
        .replyWithError(new Error('controlled transport failure'))

      await assert.rejects(
        () => embedOnce(client),
        (error: unknown) => {
          shapes.push(toSafeErrorShape(error))
          return error instanceof TypeError
        },
      )
      assert.equal(transportCalls(), 1)
    })

    assert.deepEqual(shapes, [{
      constructorName: 'TypeError',
      name: 'TypeError',
      status: null,
      code: null,
      causeConstructorName: 'Error',
    }])
  })

  it('SDK request timeout 由自身 deadline 触发并透传为 AbortError', async () => {
    const shapes: SafeErrorShape[] = []
    const callerAbort = new AbortController()
    let elapsedMs = 0

    await withMockedTransport(async ({ client, pool }) => {
      pool.intercept({ path: matchEmbedContent, method: 'POST' })
        .reply(200, embeddingResponse(1))
        .delay(MOCK_DELAY_MS)

      const startedAt = Date.now()
      await assert.rejects(
        () => embedOnce(client, { signal: callerAbort.signal }),
        (error: unknown) => {
          elapsedMs = Date.now() - startedAt
          shapes.push(toSafeErrorShape(error))
          return error instanceof Error && error.name === 'AbortError'
        },
      )
    })

    assert.deepEqual(shapes, [{
      constructorName: 'DOMException',
      name: 'AbortError',
      status: null,
      code: null,
      causeConstructorName: null,
    }])
    // 早于 mock 响应即失败，说明是 httpOptions.timeout 而不是响应本身结束了请求。
    assert.ok(elapsedMs < MOCK_DELAY_MS, `timeout 耗时 ${elapsedMs}ms 应小于 ${MOCK_DELAY_MS}ms`)
    assert.equal(callerAbort.signal.aborted, false)
  })

  for (const status of [429, 503]) {
    it(`首次 ${status}、第二次成功：SDK 内置重试让 Provider 正常返回`, async () => {
      await withMockedTransport(async ({ client, pool, transportCalls }) => {
        pool.intercept({ path: matchEmbedContent, method: 'POST' })
          .reply(status, UPSTREAM_ERROR_BODY, JSON_HEADERS)
        pool.intercept({ path: matchEmbedContent, method: 'POST' })
          .reply(200, embeddingResponse(1))

        const result = await new GeminiEmbeddingProvider(config(), client).embed(
          ['safe input'],
          { signal: new AbortController().signal },
        )

        assert.equal(result.vectors.length, 1)
        // 重试发生在 SDK 内部：Provider 只数到一次 embedContent，transport 打了两次。
        assert.equal(result.providerRequests, 1)
        assert.equal(result.retryCount, 0)
        assert.equal(transportCalls(), 2)
      })
    })
  }

  it('可重试状态码由 attempts: 3 兜底，耗尽后映射为 retry_exhausted 且不泄漏原始错误', async () => {
    await withMockedTransport(async ({ client, pool, transportCalls }) => {
      pool.intercept({ path: matchEmbedContent, method: 'POST' })
        .reply(503, UPSTREAM_ERROR_BODY, JSON_HEADERS)
        .times(3)

      await assert.rejects(
        new GeminiEmbeddingProvider(config(), client).embed(
          ['safe input'],
          { signal: new AbortController().signal },
        ),
        error => error instanceof EmbeddingError
          && error.code === 'retry_exhausted'
          && error.providerRequests === 1
          && error.retryCount === 0
          && !/payload|upstream/i.test(error.message)
          && error.cause === undefined,
      )
      assert.equal(transportCalls(), 3)
    })
  })

  it('连接失败不被 SDK 重试（p-retry@4 不放行 Node 的 fetch failed），Provider 按 network 上报', async () => {
    await withMockedTransport(async ({ client, pool, transportCalls }) => {
      pool.intercept({ path: matchEmbedContent, method: 'POST' })
        .replyWithError(new Error('controlled transport failure'))
        .times(3)

      await assert.rejects(
        new GeminiEmbeddingProvider(config(), client).embed(
          ['safe input'],
          { signal: new AbortController().signal },
        ),
        error => error instanceof EmbeddingError
          && error.code === 'network'
          && error.providerRequests === 1
          && !/controlled|transport/i.test(error.message),
      )
      assert.equal(transportCalls(), 1)
    })
  })

  it('caller 主动 Abort 转成 EmbeddingAbortError 且 SDK 不再重试', async () => {
    await withMockedTransport(async ({ client, pool, transportCalls }) => {
      pool.intercept({ path: matchEmbedContent, method: 'POST' })
        .reply(200, embeddingResponse(1))
        .delay(MOCK_DELAY_MS)
        .times(3)

      const callerAbort = new AbortController()
      const pending = new GeminiEmbeddingProvider(config(), client)
        .embed(['safe input'], { signal: callerAbort.signal })
      setTimeout(() => callerAbort.abort(), 20)

      await assert.rejects(
        pending,
        error => error instanceof EmbeddingError
          && error.name === 'AbortError'
          && error.providerRequests === 1
          && error.retryCount === 0,
      )
      assert.equal(transportCalls(), 1)
    })
  })
})

function config() {
  return resolveEmbeddingRuntimeConfig({ GEMINI_API_KEY: 'test-key' })
}

async function embedOnce(
  client: GeminiEmbeddingClient,
  options: { signal?: AbortSignal } = {},
): Promise<unknown> {
  const runtime = config()

  return await client.models.embedContent({
    model: runtime.model,
    contents: [{ parts: [{ text: 'safe input' }] }],
    config: {
      outputDimensionality: runtime.dimensions,
      abortSignal: options.signal ?? new AbortController().signal,
      httpOptions: {
        timeout: SDK_TIMEOUT_MS,
        retryOptions: { attempts: 1 },
      },
    },
  })
}

/**
 * 安装受控 undici dispatcher，让真实 SDK 请求落在 MockAgent 上。
 *
 * client 级 retryOptions 只把退避缩到 1ms；SDK 按 key 合并 client 级与请求级 retryOptions，
 * attempts 仍由 Provider 的请求级 `{ attempts: 3 }` 决定，所以 transport 次数能证明上限。
 * 不经过 createGeminiEmbeddingClient()，避免它在检测到 proxy 环境变量时
 * setGlobalDispatcher(EnvHttpProxyAgent) 覆盖掉 MockAgent。
 */
async function withMockedTransport(
  run: (transport: MockedTransport) => Promise<void>,
): Promise<void> {
  const originalDispatcher = getGlobalDispatcher()
  const agent = new MockAgent()
  agent.disableNetConnect()
  try {
    const sdk = new GoogleGenAI({
      apiKey: config().apiKey,
      httpOptions: { retryOptions: { initialDelay: 0.001, maxDelay: 0.001 } },
    })
    let calls = 0
    const countingDispatcher = {
      dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler) {
        calls += 1
        return agent.dispatch(options, handler)
      },
      close: async () => await agent.close(),
      destroy: async () => await agent.destroy(),
    } as unknown as Dispatcher
    setGlobalDispatcher(countingDispatcher)

    await run({
      client: {
        models: {
          embedContent: async request => await sdk.models.embedContent(request),
        },
      },
      pool: agent.get(GEMINI_ORIGIN),
      transportCalls: () => calls,
    })
  }
  finally {
    setGlobalDispatcher(originalDispatcher)
    await agent.close()
  }

  assert.equal(getGlobalDispatcher(), originalDispatcher)
}

function matchEmbedContent(path: string): boolean {
  return path.split('?')[0]?.endsWith(':batchEmbedContents') ?? false
}

function embeddingResponse(count: number) {
  const dimensions = config().dimensions

  return {
    embeddings: Array.from({ length: count }, (_, index) => ({
      values: Array.from(
        new Float64Array(dimensions).fill((index + 1) / Math.sqrt(dimensions)),
      ),
    })),
  }
}

function toSafeErrorShape(error: unknown): SafeErrorShape {
  const candidate = error as {
    constructor?: { name?: string }
    name?: unknown
    status?: unknown
    code?: unknown
    cause?: { constructor?: { name?: string } }
  }

  return {
    constructorName: candidate?.constructor?.name ?? null,
    name: error instanceof Error ? error.name : null,
    status: typeof candidate?.status === 'number' ? candidate.status : null,
    code: typeof candidate?.code === 'string' ? candidate.code : null,
    causeConstructorName: candidate?.cause?.constructor?.name ?? null,
  }
}
