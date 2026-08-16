import type { Dispatcher } from 'undici'
import type { GeminiEmbeddingClient } from './gemini-embedding.provider.js'
import assert from 'node:assert/strict'
import process from 'node:process'
// 项目使用 Node 原生测试运行器，不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { getGlobalDispatcher, MockAgent, setGlobalDispatcher } from 'undici'
import {
  EmbeddingError,
  resolveEmbeddingRuntimeConfig,
} from './embedding-provider.js'
import {
  createGeminiEmbeddingClient,
  GeminiEmbeddingProvider,
} from './gemini-embedding.provider.js'

// 这些用例必须真正经过 @google/genai 的 models.embedContent -> ApiClient -> fetch，
// 因此只替换最底层的 undici dispatcher，不注入 fake GeminiEmbeddingClient。
const GEMINI_ORIGIN = 'https://generativelanguage.googleapis.com'
const PROXY_ENV_NAMES = ['HTTPS_PROXY', 'https_proxy', 'HTTP_PROXY', 'http_proxy'] as const
// SDK deadline 必须远小于 mock 响应延迟，才能证明是 timeout 触发而不是响应返回。
const SDK_TIMEOUT_MS = 300
const MOCK_DELAY_MS = 1_500

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

  it('Provider 把真实连接失败归类为可重试 network 并保留 metrics', async () => {
    await withMockedTransport(async ({ client, pool, transportCalls }) => {
      pool.intercept({ path: matchEmbedContent, method: 'POST' })
        .replyWithError(new Error('controlled transport failure'))
        .times(2)
      pool.intercept({ path: matchEmbedContent, method: 'POST' })
        .reply(200, embeddingResponse(1))

      const sleeps: number[] = []
      const provider = new GeminiEmbeddingProvider(
        config(),
        client,
        async milliseconds => void sleeps.push(milliseconds),
      )

      const result = await provider.embed(['safe input'], {
        signal: new AbortController().signal,
      })

      assert.equal(result.vectors.length, 1)
      assert.equal(result.providerRequests, 3)
      assert.equal(result.retryCount, 2)
      assert.deepEqual(sleeps, [250, 500])
      // AC-10：Transport 次数等于 Provider 请求次数，SDK 内部没有隐藏重试。
      assert.equal(transportCalls(), 3)
    })
  })

  it('Provider 把真实 SDK timeout 归类为可重试 timeout，不误判为 caller Abort', async () => {
    await withMockedTransport(async ({ client, pool, transportCalls }) => {
      pool.intercept({ path: matchEmbedContent, method: 'POST' })
        .reply(200, embeddingResponse(1))
        .delay(MOCK_DELAY_MS)
      pool.intercept({ path: matchEmbedContent, method: 'POST' })
        .reply(200, embeddingResponse(1))

      const sleeps: number[] = []
      const callerAbort = new AbortController()
      const provider = new GeminiEmbeddingProvider(
        { ...config(), requestTimeoutMs: SDK_TIMEOUT_MS },
        client,
        async milliseconds => void sleeps.push(milliseconds),
      )

      const result = await provider.embed(['safe input'], {
        signal: callerAbort.signal,
      })

      assert.equal(result.vectors.length, 1)
      assert.equal(result.providerRequests, 2)
      assert.equal(result.retryCount, 1)
      assert.deepEqual(sleeps, [250])
      assert.equal(callerAbort.signal.aborted, false)
      assert.equal(transportCalls(), 2)
    })
  })

  it('caller 主动 Abort 转成 EmbeddingAbortError 且不重试', async () => {
    await withMockedTransport(async ({ client, pool, transportCalls }) => {
      pool.intercept({ path: matchEmbedContent, method: 'POST' })
        .reply(200, embeddingResponse(1))
        .delay(MOCK_DELAY_MS)

      const callerAbort = new AbortController()
      const provider = new GeminiEmbeddingProvider(
        config(),
        client,
        async () => assert.fail('caller Abort 不得进入重试等待'),
      )
      const pending = provider.embed(['safe input'], { signal: callerAbort.signal })
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

  it('可重试 HTTP 状态码不触发 SDK 隐式重试，重试耗尽后不泄漏原始错误', async () => {
    await withMockedTransport(async ({ client, pool, transportCalls }) => {
      pool.intercept({ path: matchEmbedContent, method: 'POST' })
        .reply(
          503,
          { error: { message: 'controlled upstream payload', code: 503 } },
          { headers: { 'content-type': 'application/json' } },
        )
        .times(3)

      const provider = new GeminiEmbeddingProvider(
        config(),
        client,
        async () => {},
      )

      await assert.rejects(
        provider.embed(['safe input'], { signal: new AbortController().signal }),
        error => error instanceof EmbeddingError
          && error.code === 'retry_exhausted'
          && error.providerRequests === 3
          && error.retryCount === 2
          && !/payload|upstream/i.test(error.message)
          && error.cause === undefined,
      )
      // 503 属于 SDK 默认可重试状态码，attempts: 1 必须让每次 provider 请求只打一次。
      assert.equal(transportCalls(), 3)
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
 * 先删除 proxy 环境变量再创建 client，是因为 createGeminiEmbeddingClient()
 * 会在检测到 proxy 时 setGlobalDispatcher(EnvHttpProxyAgent) 覆盖掉 MockAgent。
 */
async function withMockedTransport(
  run: (transport: MockedTransport) => Promise<void>,
): Promise<void> {
  const savedProxyEnv = PROXY_ENV_NAMES.map(name => [name, process.env[name]] as const)
  for (const name of PROXY_ENV_NAMES)
    delete process.env[name]

  const originalDispatcher = getGlobalDispatcher()
  let agent: MockAgent | undefined
  try {
    const client = createGeminiEmbeddingClient(config())
    agent = new MockAgent()
    agent.disableNetConnect()

    const mockAgent = agent
    let calls = 0
    const countingDispatcher = {
      dispatch(options: Dispatcher.DispatchOptions, handler: Dispatcher.DispatchHandler) {
        calls += 1
        return mockAgent.dispatch(options, handler)
      },
      close: async () => await mockAgent.close(),
      destroy: async () => await mockAgent.destroy(),
    } as unknown as Dispatcher
    setGlobalDispatcher(countingDispatcher)

    await run({
      client,
      pool: mockAgent.get(GEMINI_ORIGIN),
      transportCalls: () => calls,
    })
  }
  finally {
    setGlobalDispatcher(originalDispatcher)
    await agent?.close()
    for (const [name, value] of savedProxyEnv) {
      if (value === undefined)
        delete process.env[name]
      else
        process.env[name] = value
    }
  }

  assert.equal(getGlobalDispatcher(), originalDispatcher)
  for (const [name, value] of savedProxyEnv)
    assert.equal(process.env[name], value)
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
