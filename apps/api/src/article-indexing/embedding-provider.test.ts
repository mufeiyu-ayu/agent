import type { CreateEmbeddingResponse } from 'openai/resources/embeddings'
import type { OpenAIEmbeddingClient } from './openai-embedding.provider.js'
import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
} from 'openai'

import {
  ACTIVE_EMBEDDING_PROFILE,
  EmbeddingError,
  resolveEmbeddingRuntimeConfig,
} from './embedding-provider.js'
import {
  createOpenAIEmbeddingClient,
  OpenAIEmbeddingProvider,
  validateEmbeddingResponse,
} from './openai-embedding.provider.js'

describe('Embedding configuration', () => {
  it('使用固定 OpenAI profile 和独立 EMBEDDING_* 默认值，不读取 LLM_*', () => {
    const config = resolveEmbeddingRuntimeConfig({
      EMBEDDING_API_KEY: 'embedding-key',
      LLM_API_KEY: 'chat-key',
      LLM_BASE_URL: 'https://chat.example/v1',
      LLM_MODEL: 'deepseek-v4-flash',
    })

    assert.deepEqual(config, {
      apiKey: 'embedding-key',
      baseUrl: 'https://api.openai.com/v1',
      model: 'text-embedding-3-small',
      dimensions: 1536,
      batchSize: 64,
      requestTimeoutMs: 60_000,
      maxRetries: 2,
    })
    assert.deepEqual(ACTIVE_EMBEDDING_PROFILE, {
      provider: 'openai',
      model: 'text-embedding-3-small',
      dimensions: 1536,
      version: 'openai:text-embedding-3-small:1536:v1',
    })
  })

  it('缺 key、非法固定 profile 和失控数值全部 fail closed', () => {
    const invalidEnvironments = [
      {},
      { EMBEDDING_API_KEY: 'key', EMBEDDING_BASE_URL: 'file:///tmp/provider' },
      { EMBEDDING_API_KEY: 'key', EMBEDDING_MODEL: 'other-model' },
      { EMBEDDING_API_KEY: 'key', EMBEDDING_DIMENSIONS: '3072' },
      { EMBEDDING_API_KEY: 'key', EMBEDDING_BATCH_SIZE: '0' },
      { EMBEDDING_API_KEY: 'key', EMBEDDING_BATCH_SIZE: '376' },
      { EMBEDDING_API_KEY: 'key', EMBEDDING_REQUEST_TIMEOUT_MS: '1.5' },
      { EMBEDDING_API_KEY: 'key', EMBEDDING_MAX_RETRIES: '3' },
    ]

    for (const env of invalidEnvironments) {
      assert.throws(
        () => resolveEmbeddingRuntimeConfig(env),
        error => error instanceof EmbeddingError
          && error.code === 'configuration',
      )
    }
  })

  it('OpenAI SDK adapter 关闭隐式重试、调试日志与 OPENAI_* org/project 回退', () => {
    const client = createOpenAIEmbeddingClient(config()) as OpenAIEmbeddingClient & {
      logLevel?: string
      maxRetries?: number
      organization?: string | null
      project?: string | null
    }
    assert.equal(client.maxRetries, 0)
    assert.equal(client.organization, null)
    assert.equal(client.project, null)
    assert.equal(client.logLevel, 'off')
  })
})

describe('OpenAIEmbeddingProvider', () => {
  it('只发送固定 model/dimensions/float 和输入文本，并按配置 batching 保序', async () => {
    const calls: Array<{ body: Record<string, unknown>, timeout: number }> = []
    const provider = new OpenAIEmbeddingProvider(
      { ...config(), batchSize: 2 },
      fakeClient(async (body, options) => {
        calls.push({ body, timeout: options.timeout })
        return response(body.input.length, body.model, body.dimensions)
      }),
    )

    const result = await provider.embed(['one', 'two', 'three'], {
      signal: new AbortController().signal,
    })

    assert.equal(result.vectors.length, 3)
    assert.equal(result.providerRequests, 2)
    assert.equal(result.retryCount, 0)
    assert.deepEqual(calls, [
      {
        body: {
          input: ['one', 'two'],
          model: 'text-embedding-3-small',
          dimensions: 1536,
          encoding_format: 'float',
        },
        timeout: 60_000,
      },
      {
        body: {
          input: ['three'],
          model: 'text-embedding-3-small',
          dimensions: 1536,
          encoding_format: 'float',
        },
        timeout: 60_000,
      },
    ])
  })

  it('连接、timeout、429 和 5xx 才重试，并准确累计 attempts/retries', async () => {
    const retryableErrors = [
      new APIConnectionError({ cause: new Error('network') }),
      new APIConnectionTimeoutError({}),
      httpError(408),
      httpError(429),
      httpError(503),
    ]

    for (const retryableError of retryableErrors) {
      const sleeps: number[] = []
      let calls = 0
      const provider = new OpenAIEmbeddingProvider(
        config(),
        fakeClient(async (body) => {
          calls += 1
          if (calls <= 2)
            throw retryableError
          return response(body.input.length, body.model, body.dimensions)
        }),
        async milliseconds => void sleeps.push(milliseconds),
      )

      const result = await provider.embed(['safe input'], {
        signal: new AbortController().signal,
      })

      assert.equal(calls, 3)
      assert.deepEqual(sleeps, [250, 500])
      assert.equal(result.providerRequests, 3)
      assert.equal(result.retryCount, 2)
    }
  })

  it('retry exhaustion 是 fatal 且保留安全请求计数', async () => {
    let calls = 0
    const provider = new OpenAIEmbeddingProvider(
      config(),
      fakeClient(async () => {
        calls += 1
        throw new APIConnectionError({ cause: new Error('network') })
      }),
      async () => {},
    )

    await assert.rejects(
      provider.embed(['safe input'], { signal: new AbortController().signal }),
      error => error instanceof EmbeddingError
        && error.code === 'retry_exhausted'
        && error.providerRequests === 3
        && error.retryCount === 2,
    )
    assert.equal(calls, 3)
  })

  it('认证、其他 4xx、protocol mismatch 和 Abort 不重试', async () => {
    const nonRetryable = [httpError(401), httpError(403), httpError(400)]

    for (const error of nonRetryable) {
      let calls = 0
      let sleeps = 0
      const provider = new OpenAIEmbeddingProvider(
        config(),
        fakeClient(async () => {
          calls += 1
          throw error
        }),
        async () => void (sleeps += 1),
      )

      await assert.rejects(
        provider.embed(['safe input'], { signal: new AbortController().signal }),
        candidate => candidate instanceof EmbeddingError
          && candidate.retryable === false,
      )
      assert.equal(calls, 1)
      assert.equal(sleeps, 0)
    }

    let protocolCalls = 0
    const protocolProvider = new OpenAIEmbeddingProvider(
      config(),
      fakeClient(async () => {
        protocolCalls += 1
        return response(0, ACTIVE_EMBEDDING_PROFILE.model, 1536)
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

    const abortProvider = new OpenAIEmbeddingProvider(
      config(),
      fakeClient(async () => {
        throw new APIUserAbortError()
      }),
      async () => assert.fail('Abort must not retry'),
    )
    await assert.rejects(
      abortProvider.embed(['safe input'], {
        signal: new AbortController().signal,
      }),
      { name: 'AbortError' },
    )
  })

  it('严格拒绝 partial、乱序、重复 index、错误 model/维度和非有限数字', () => {
    const valid = response(2, 'model', 3)
    assert.deepEqual(
      validateEmbeddingResponse(valid, 2, 'model', 3),
      [[0, 0, 0], [1, 1, 1]],
    )

    const invalidResponses = [
      response(1, 'model', 3),
      response(2, 'other-model', 3),
      { ...valid, data: [valid.data[1], valid.data[0]] },
      { ...valid, data: [{ ...valid.data[0], index: 0 }, { ...valid.data[1], index: 0 }] },
      { ...valid, data: [{ ...valid.data[0], embedding: [0, 0] }, valid.data[1]] },
      { ...valid, data: [{ ...valid.data[0], embedding: [0, Number.NaN, 0] }, valid.data[1]] },
      { ...valid, data: [{ ...valid.data[0], embedding: [0, Number.POSITIVE_INFINITY, 0] }, valid.data[1]] },
    ]

    for (const invalid of invalidResponses) {
      assert.throws(
        () => validateEmbeddingResponse(invalid, 2, 'model', 3),
        error => error instanceof EmbeddingError && error.code === 'protocol',
      )
    }
  })

  it('空输入不请求 provider；已 Abort signal 在请求前失败', async () => {
    let calls = 0
    const provider = new OpenAIEmbeddingProvider(
      config(),
      fakeClient(async () => {
        calls += 1
        return response(1, ACTIVE_EMBEDDING_PROFILE.model, 1536)
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

  it('多 batch 或 retry wait 中 Abort 仍保留已发生的安全请求统计', async () => {
    let calls = 0
    const batched = new OpenAIEmbeddingProvider(
      { ...config(), batchSize: 1 },
      fakeClient(async (body) => {
        calls += 1
        if (calls === 2)
          throw new APIUserAbortError()
        return response(body.input.length, body.model, body.dimensions)
      }),
    )
    await assert.rejects(
      batched.embed(['one', 'two'], {
        signal: new AbortController().signal,
      }),
      error => error instanceof EmbeddingError
        && error.name === 'AbortError'
        && error.providerRequests === 2
        && error.retryCount === 0,
    )

    const abortController = new AbortController()
    const duringWait = new OpenAIEmbeddingProvider(
      config(),
      fakeClient(async () => {
        throw new APIConnectionError({ cause: new Error('network') })
      }),
      async (_milliseconds, signal) => {
        abortController.abort()
        signal.throwIfAborted()
      },
    )
    await assert.rejects(
      duringWait.embed(['one'], { signal: abortController.signal }),
      error => error instanceof EmbeddingError
        && error.name === 'AbortError'
        && error.providerRequests === 1
        && error.retryCount === 1,
    )
  })
})

function config() {
  return resolveEmbeddingRuntimeConfig({
    EMBEDDING_API_KEY: 'test-key',
  })
}

function fakeClient(
  create: OpenAIEmbeddingClient['embeddings']['create'],
): OpenAIEmbeddingClient {
  return { embeddings: { create } }
}

function response(
  count: number,
  model: string,
  dimensions: number,
): CreateEmbeddingResponse {
  return {
    object: 'list',
    model,
    data: Array.from({ length: count }, (_, index) => ({
      object: 'embedding' as const,
      index,
      embedding: Array.from(new Float64Array(dimensions).fill(index)),
    })),
    usage: { prompt_tokens: count, total_tokens: count },
  }
}

function httpError(status: number): APIError {
  return new APIError(status, {}, `HTTP ${status}`, new Headers())
}
