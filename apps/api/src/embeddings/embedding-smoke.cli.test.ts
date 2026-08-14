import type { EmbeddingProvider } from './embedding-provider.js'
import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import {
  ACTIVE_EMBEDDING_PROFILE,
  EmbeddingAbortError,
} from './embedding-provider.js'
import {
  executeEmbeddingSmoke,
  safeSmokeFailure,
  serializeEmbeddingSmokeSummary,
} from './embedding-smoke.cli.js'

describe('Gemini embedding smoke CLI', () => {
  it('只输出 provider、model、维度、norm 与安全 metrics，不接触 DB 或泄漏输入/向量', async () => {
    const provider: EmbeddingProvider = {
      profile: ACTIVE_EMBEDDING_PROFILE,
      embed: async (inputs) => {
        assert.equal(inputs.length, 1)
        assert.match(inputs[0]!, /^task: search result \| query: /)
        return {
          vectors: [normalizedVector()],
          providerRequests: 1,
          retryCount: 0,
        }
      },
    }

    const summary = await executeEmbeddingSmoke(
      new AbortController().signal,
      () => provider,
    )
    const json = serializeEmbeddingSmokeSummary(summary)

    assert.equal(summary.vectorCount, 1)
    assert.equal(summary.provider, 'google')
    assert.equal(summary.model, 'gemini-embedding-2')
    assert.equal(summary.dimensions, 1536)
    assert.ok(Math.abs(summary.norm - 1) < 1e-10)
    assert.doesNotMatch(json, /provider smoke check|apiKey|raw|values|business text/i)
  })

  it('拒绝 partial 与零向量，且已 Abort 时不创建 provider', async () => {
    for (const vectors of [[], [Array.from(new Float64Array(1536))]]) {
      const provider: EmbeddingProvider = {
        profile: ACTIVE_EMBEDDING_PROFILE,
        embed: async () => ({
          vectors,
          providerRequests: 1,
          retryCount: 0,
        }),
      }
      await assert.rejects(
        executeEmbeddingSmoke(new AbortController().signal, () => provider),
        /非法结果/,
      )
    }

    const abortController = new AbortController()
    abortController.abort()
    await assert.rejects(
      executeEmbeddingSmoke(abortController.signal, () => {
        assert.fail('aborted smoke must not create provider')
      }),
      { name: 'AbortError' },
    )
    assert.equal(
      safeSmokeFailure(new EmbeddingAbortError(1, 0)).error,
      'embedding_aborted',
    )
  })
})

function normalizedVector(): number[] {
  return Array.from(
    new Float64Array(1536).fill(1 / Math.sqrt(1536)),
  )
}
