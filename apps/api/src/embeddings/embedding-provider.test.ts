import type { GeminiEmbeddingClient } from './gemini-embedding.provider.js'
import assert from 'node:assert/strict'
import { getEventListeners } from 'node:events'
// 项目使用 Node 原生测试运行器，不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { ApiError } from '@google/genai'
import {
  formatEmbeddingDocumentInput,
  formatEmbeddingQueryInput,
} from './embedding-formatter.js'
import {
  ACTIVE_EMBEDDING_PROFILE,
  EmbeddingError,
  resolveEmbeddingRuntimeConfig,
} from './embedding-provider.js'
import {
  GeminiEmbeddingProvider,
  validateGeminiEmbeddingResponse,
} from './gemini-embedding.provider.js'

describe('Embedding shared boundary', () => {
  it('固定 Gemini profile，只读取 GEMINI_API_KEY 且不回退旧 Key / LLM 配置', () => {
    const config = resolveEmbeddingRuntimeConfig({
      GEMINI_API_KEY: '  gemini-key  ',
      EMBEDDING_API_KEY: 'old-embedding-key',
      EMBEDDING_MODEL: 'old-model',
      EMBEDDING_DIMENSIONS: '3072',
      LLM_API_KEY: 'chat-key',
      LLM_MODEL: 'deepseek-v4-flash',
    })

    assert.deepEqual(config, {
      apiKey: 'gemini-key',
      model: 'gemini-embedding-2',
      dimensions: 1536,
      batchSize: 64,
      requestTimeoutMs: 60_000,
      maxRetries: 2,
    })
    assert.deepEqual(ACTIVE_EMBEDDING_PROFILE, {
      provider: 'google',
      model: 'gemini-embedding-2',
      dimensions: 1536,
      version: 'google:gemini-embedding-2:1536:search-result-v1',
    })

    for (const env of [
      {},
      { EMBEDDING_API_KEY: 'old-key' },
      { LLM_API_KEY: 'chat-key' },
    ]) {
      assert.throws(
        () => resolveEmbeddingRuntimeConfig(env),
        error => error instanceof EmbeddingError
          && error.code === 'configuration',
      )
    }
  })

  it('provider-neutral batch / timeout / retry 数值配置 fail closed', () => {
    const invalidEnvironments = [
      { GEMINI_API_KEY: 'key', EMBEDDING_BATCH_SIZE: '0' },
      { GEMINI_API_KEY: 'key', EMBEDDING_BATCH_SIZE: '376' },
      { GEMINI_API_KEY: 'key', EMBEDDING_REQUEST_TIMEOUT_MS: '1.5' },
      { GEMINI_API_KEY: 'key', EMBEDDING_MAX_RETRIES: '3' },
    ]

    for (const env of invalidEnvironments) {
      assert.throws(
        () => resolveEmbeddingRuntimeConfig(env),
        error => error instanceof EmbeddingError
          && error.code === 'configuration',
      )
    }
  })

  it('集中 formatter 使用版本化 asymmetric prompt 并规范化输入', () => {
    assert.equal(
      formatEmbeddingQueryInput('  cafe\u0301\n  canonical   URL  '),
      'task: search result | query: café canonical URL',
    )
    assert.equal(
      formatEmbeddingDocumentInput(
        '  Article   title ',
        ' H2: "Overview" ',
        ' First\n\n chunk\u200B text ',
      ),
      'title: Article title | text: H2: "Overview"\n\nFirst chunk text',
    )
    assert.equal(
      formatEmbeddingDocumentInput('', '', 'Body'),
      'title: none | text: Body',
    )
    assert.throws(() => formatEmbeddingQueryInput('   '), /非空字符串/)
    assert.throws(
      () => formatEmbeddingDocumentInput('Title', '', '   '),
      /非空字符串/,
    )
  })
})

describe('GeminiEmbeddingProvider', () => {
  it('每条输入使用独立 Content，固定 1536 且关闭 SDK 隐式重试', async () => {
    const calls: Parameters<GeminiEmbeddingClient['models']['embedContent']>[0][] = []
    const abortController = new AbortController()
    const provider = new GeminiEmbeddingProvider(
      { ...config(), batchSize: 2 },
      fakeClient(async (request) => {
        calls.push(request)
        return response(request.contents.length, request.config.outputDimensionality)
      }),
    )

    const result = await provider.embed(['one', 'two', 'three'], {
      signal: abortController.signal,
    })

    assert.equal(result.vectors.length, 3)
    assert.equal(result.providerRequests, 2)
    assert.equal(result.retryCount, 0)
    assert.equal(new Set(calls.map(request => request.config.abortSignal)).size, 2)
    assert.equal(getEventListeners(abortController.signal, 'abort').length, 0)
    assert.deepEqual(calls.map(request => ({
      model: request.model,
      contents: request.contents,
      outputDimensionality: request.config.outputDimensionality,
      timeout: request.config.httpOptions.timeout,
      retryOptions: request.config.httpOptions.retryOptions,
      hasTaskType: Object.hasOwn(request.config, 'taskType'),
    })), [
      {
        model: 'gemini-embedding-2',
        contents: [
          { parts: [{ text: 'one' }] },
          { parts: [{ text: 'two' }] },
        ],
        outputDimensionality: 1536,
        timeout: 60_000,
        retryOptions: { attempts: 1 },
        hasTaskType: false,
      },
      {
        model: 'gemini-embedding-2',
        contents: [{ parts: [{ text: 'three' }] }],
        outputDimensionality: 1536,
        timeout: 60_000,
        retryOptions: { attempts: 1 },
        hasTaskType: false,
      },
    ])
  })

  it('network、timeout、408、429 和 5xx 显式重试并记录 metrics', async () => {
    const retryableErrors: Array<{ error: Error, sleeps: number[] }> = [
      { error: new TypeError('fetch failed'), sleeps: [250, 500] },
      { error: new DOMException('SDK timeout', 'AbortError'), sleeps: [250, 500] },
      { error: apiError(408), sleeps: [250, 500] },
      { error: apiError(429), sleeps: [60_000, 60_000] },
      {
        error: apiError(429, 'Please retry in 42.600363495s.'),
        sleeps: [43_601, 43_601],
      },
      { error: apiError(503), sleeps: [250, 500] },
    ]

    for (const retryableError of retryableErrors) {
      const sleeps: number[] = []
      let calls = 0
      const provider = new GeminiEmbeddingProvider(
        config(),
        fakeClient(async (request) => {
          calls += 1
          if (calls <= 2)
            throw retryableError.error
          return response(request.contents.length, request.config.outputDimensionality)
        }),
        async milliseconds => void sleeps.push(milliseconds),
      )

      const result = await provider.embed(['safe input'], {
        signal: new AbortController().signal,
      })

      assert.equal(calls, 3)
      assert.deepEqual(sleeps, retryableError.sleeps)
      assert.equal(result.providerRequests, 3)
      assert.equal(result.retryCount, 2)
    }
  })

  it('重试耗尽保留安全 metrics，不泄漏 SDK 原始错误', async () => {
    let calls = 0
    const provider = new GeminiEmbeddingProvider(
      config(),
      fakeClient(async () => {
        calls += 1
        throw new TypeError('secret upstream URL and payload')
      }),
      async () => {},
    )

    await assert.rejects(
      provider.embed(['safe input'], { signal: new AbortController().signal }),
      error => error instanceof EmbeddingError
        && error.code === 'retry_exhausted'
        && error.providerRequests === 3
        && error.retryCount === 2
        && !/secret|payload|URL/i.test(error.message)
        && error.cause === undefined,
    )
    assert.equal(calls, 3)
  })

  it('认证、daily quota、其他 4xx、protocol mismatch 和 caller Abort 不重试', async () => {
    const nonRetryable = [
      apiError(401),
      apiError(403),
      apiError(429, 'EmbedContentRequestsPerDayPerUserPerProjectPerModel-FreeTier'),
      apiError(400, 'API_KEY_INVALID: secret-key'),
      apiError(400, 'invalid input containing secret payload'),
    ]

    for (const error of nonRetryable) {
      let calls = 0
      const provider = new GeminiEmbeddingProvider(
        config(),
        fakeClient(async () => {
          calls += 1
          throw error
        }),
        async () => assert.fail('non-retryable error must not sleep'),
      )

      await assert.rejects(
        provider.embed(['safe input'], { signal: new AbortController().signal }),
        candidate => candidate instanceof EmbeddingError
          && candidate.retryable === false
          && !/secret|payload/i.test(candidate.message),
      )
      assert.equal(calls, 1)
    }

    let protocolCalls = 0
    const protocolProvider = new GeminiEmbeddingProvider(
      config(),
      fakeClient(async () => {
        protocolCalls += 1
        return { embeddings: [] }
      }),
      async () => assert.fail('protocol error must not retry'),
    )
    await assert.rejects(
      protocolProvider.embed(['safe input'], {
        signal: new AbortController().signal,
      }),
      error => error instanceof EmbeddingError && error.code === 'protocol',
    )
    assert.equal(protocolCalls, 1)

    const abortController = new AbortController()
    const abortProvider = new GeminiEmbeddingProvider(
      config(),
      fakeClient(async () => {
        abortController.abort()
        throw new DOMException('SDK abort', 'AbortError')
      }),
      async () => assert.fail('Abort must not retry'),
    )
    await assert.rejects(
      abortProvider.embed(['safe input'], { signal: abortController.signal }),
      error => error instanceof EmbeddingError
        && error.name === 'AbortError'
        && error.providerRequests === 1,
    )
  })

  it('严格拒绝 partial、错误维度、非有限数字和零向量，并保留响应顺序', () => {
    const valid = {
      embeddings: [
        { values: [1, 0, 0] },
        { values: [0, 1, 0] },
      ],
    }
    assert.deepEqual(
      validateGeminiEmbeddingResponse(valid, 2, 3),
      [[1, 0, 0], [0, 1, 0]],
    )

    const invalidResponses = [
      { embeddings: [valid.embeddings[0]] },
      { embeddings: [valid.embeddings[0], { values: [0, 0] }] },
      { embeddings: [valid.embeddings[0], { values: [0, Number.NaN, 0] }] },
      { embeddings: [valid.embeddings[0], { values: [0, Number.POSITIVE_INFINITY, 0] }] },
      { embeddings: [valid.embeddings[0], { values: [0, 0, 0] }] },
      { embeddings: [valid.embeddings[0], {}] },
      {},
    ]

    for (const invalid of invalidResponses) {
      assert.throws(
        () => validateGeminiEmbeddingResponse(invalid, 2, 3),
        error => error instanceof EmbeddingError && error.code === 'protocol',
      )
    }
  })

  it('空输入不请求 provider，已 Abort signal 在请求前失败', async () => {
    let calls = 0
    const provider = new GeminiEmbeddingProvider(
      config(),
      fakeClient(async (request) => {
        calls += 1
        return response(request.contents.length, request.config.outputDimensionality)
      }),
    )
    assert.deepEqual(
      await provider.embed([], { signal: new AbortController().signal }),
      { vectors: [], providerRequests: 0, retryCount: 0 },
    )

    const abortController = new AbortController()
    abortController.abort()
    await assert.rejects(
      provider.embed(['input'], { signal: abortController.signal }),
      { name: 'AbortError' },
    )
    assert.equal(calls, 0)
  })

  it('多 batch 或 retry wait 中 Abort 保留已发生的安全请求统计', async () => {
    let calls = 0
    const abortController = new AbortController()
    const batched = new GeminiEmbeddingProvider(
      { ...config(), batchSize: 1 },
      fakeClient(async (request) => {
        calls += 1
        if (calls === 2) {
          abortController.abort()
          throw new DOMException('SDK abort', 'AbortError')
        }
        return response(request.contents.length, request.config.outputDimensionality)
      }),
    )
    await assert.rejects(
      batched.embed(['one', 'two'], { signal: abortController.signal }),
      error => error instanceof EmbeddingError
        && error.name === 'AbortError'
        && error.providerRequests === 2
        && error.retryCount === 0,
    )

    const retryAbortController = new AbortController()
    const duringWait = new GeminiEmbeddingProvider(
      config(),
      fakeClient(async () => {
        throw new TypeError('network')
      }),
      async (_milliseconds, signal) => {
        retryAbortController.abort()
        signal.throwIfAborted()
      },
    )
    await assert.rejects(
      duringWait.embed(['one'], { signal: retryAbortController.signal }),
      error => error instanceof EmbeddingError
        && error.name === 'AbortError'
        && error.providerRequests === 1
        && error.retryCount === 1,
    )
  })
})

function config() {
  return resolveEmbeddingRuntimeConfig({ GEMINI_API_KEY: 'test-key' })
}

function fakeClient(
  embedContent: GeminiEmbeddingClient['models']['embedContent'],
): GeminiEmbeddingClient {
  return { models: { embedContent } }
}

function response(count: number, dimensions: number) {
  return {
    embeddings: Array.from({ length: count }, (_, index) => ({
      values: Array.from(
        new Float64Array(dimensions).fill((index + 1) / Math.sqrt(dimensions)),
      ),
    })),
  }
}

function apiError(status: number, message = `HTTP ${status}`): ApiError {
  return new ApiError({ status, message })
}
