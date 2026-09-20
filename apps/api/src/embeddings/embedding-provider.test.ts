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
      UNRELATED_API_KEY: 'chat-key',
      UNRELATED_MODEL: 'deepseek-v4-flash',
    })

    assert.deepEqual(config, {
      apiKey: 'gemini-key',
      model: 'gemini-embedding-2',
      dimensions: 1536,
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
      { UNRELATED_API_KEY: 'chat-key' },
    ]) {
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
  it('每 64 条输入一次请求、每条独立 Content，固定 1536 并把重试交给 SDK', async () => {
    const calls: Parameters<GeminiEmbeddingClient['models']['embedContent']>[0][] = []
    const abortController = new AbortController()
    const provider = new GeminiEmbeddingProvider(
      config(),
      fakeClient(async (request) => {
        calls.push(request)
        return response(request.contents.length, request.config.outputDimensionality)
      }),
    )
    const inputs = Array.from({ length: 65 }, (_, index) => `input ${index}`)

    const result = await provider.embed(inputs, {
      signal: abortController.signal,
    })

    assert.equal(result.vectors.length, 65)
    assert.equal(result.providerRequests, 2)
    assert.equal(result.retryCount, 0)
    assert.equal(new Set(calls.map(request => request.config.abortSignal)).size, 2)
    assert.equal(getEventListeners(abortController.signal, 'abort').length, 0)
    assert.deepEqual(calls.map(request => ({
      model: request.model,
      contents: request.contents.length,
      firstText: request.contents[0]?.parts,
      outputDimensionality: request.config.outputDimensionality,
      timeout: request.config.httpOptions.timeout,
      retryOptions: request.config.httpOptions.retryOptions,
      hasTaskType: Object.hasOwn(request.config, 'taskType'),
    })), [
      {
        model: 'gemini-embedding-2',
        contents: 64,
        firstText: [{ text: 'input 0' }],
        outputDimensionality: 1536,
        timeout: 60_000,
        retryOptions: { attempts: 3 },
        hasTaskType: false,
      },
      {
        model: 'gemini-embedding-2',
        contents: 1,
        firstText: [{ text: 'input 64' }],
        outputDimensionality: 1536,
        timeout: 60_000,
        retryOptions: { attempts: 3 },
        hasTaskType: false,
      },
    ])
  })

  it('SDK 耗尽后抛出的 timeout、408、429、5xx 映射为 retry_exhausted，不泄漏原始错误', async () => {
    const exhausted = [
      new DOMException('SDK timeout after secret payload', 'AbortError'),
      apiError(408, 'secret payload'),
      apiError(429, 'secret payload'),
      apiError(429, 'Please retry in 42.600363495s. secret payload'),
      apiError(500, 'secret payload'),
      apiError(503, 'secret payload'),
    ]

    for (const sdkError of exhausted) {
      let calls = 0
      const provider = new GeminiEmbeddingProvider(
        config(),
        fakeClient(async () => {
          calls += 1
          throw sdkError
        }),
      )

      await assert.rejects(
        provider.embed(['safe input'], { signal: new AbortController().signal }),
        error => error instanceof EmbeddingError
          && error.code === 'retry_exhausted'
          && error.retryable === false
          && error.providerRequests === 1
          && error.retryCount === 0
          && !/secret|payload/i.test(error.message)
          && error.cause === undefined,
      )
      // Provider 自身不再重试：一次 embedContent 调用内的重试全部在 SDK 里。
      assert.equal(calls, 1)
    }
  })

  it('SDK 不重试的网络错误按 network 上报并保留安全 metrics', async () => {
    let calls = 0
    const provider = new GeminiEmbeddingProvider(
      config(),
      fakeClient(async () => {
        calls += 1
        throw new TypeError('fetch failed: secret upstream URL and payload')
      }),
    )

    await assert.rejects(
      provider.embed(['safe input'], { signal: new AbortController().signal }),
      error => error instanceof EmbeddingError
        && error.code === 'network'
        && error.retryable === false
        && error.providerRequests === 1
        && error.retryCount === 0
        && !/secret|payload|URL/i.test(error.message)
        && error.cause === undefined,
    )
    assert.equal(calls, 1)
  })

  it('认证、daily quota、其他 4xx、protocol mismatch 和 caller Abort 按原分类上报', async () => {
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
      )

      await assert.rejects(
        provider.embed(['safe input'], { signal: new AbortController().signal }),
        candidate => candidate instanceof EmbeddingError
          && candidate.code !== 'retry_exhausted'
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
    )
    await assert.rejects(
      abortProvider.embed(['safe input'], { signal: abortController.signal }),
      error => error instanceof EmbeddingError
        && error.name === 'AbortError'
        && error.providerRequests === 1,
    )
  })

  it('未识别的普通 Error 归类为 unknown 且 fail closed', async () => {
    let calls = 0
    const provider = new GeminiEmbeddingProvider(
      config(),
      fakeClient(async () => {
        calls += 1
        throw new Error('generic provider failure with secret payload')
      }),
    )

    await assert.rejects(
      provider.embed(['safe input'], { signal: new AbortController().signal }),
      error => error instanceof EmbeddingError
        // EmbeddingAbortError 同样是 unknown / 不可重试，用 name 区分真正的分类结果。
        && error.name === 'EmbeddingError'
        && error.code === 'unknown'
        && error.retryable === false
        && error.providerRequests === 1
        && error.retryCount === 0
        && !/secret|payload/i.test(error.message)
        && error.cause === undefined,
    )
    assert.equal(calls, 1)
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

  it('多 batch 中 Abort 保留已发生的安全请求统计，且 Abort 优先于晚到的成功响应', async () => {
    let calls = 0
    const abortController = new AbortController()
    const batched = new GeminiEmbeddingProvider(
      config(),
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
      batched.embed(
        Array.from({ length: 65 }, (_, index) => `input ${index}`),
        { signal: abortController.signal },
      ),
      error => error instanceof EmbeddingError
        && error.name === 'AbortError'
        && error.providerRequests === 2
        && error.retryCount === 0,
    )

    const lateAbort = new AbortController()
    const lateSuccess = new GeminiEmbeddingProvider(
      config(),
      fakeClient(async (request) => {
        lateAbort.abort()
        return response(request.contents.length, request.config.outputDimensionality)
      }),
    )
    await assert.rejects(
      lateSuccess.embed(['one'], { signal: lateAbort.signal }),
      error => error instanceof EmbeddingError
        && error.name === 'AbortError'
        && error.providerRequests === 1,
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
