import type {
  ArticleRetrievalHit,
  ArticleRetrievalResult,
  NormalizedArticleRetrievalQuery,
} from '../article-retrieval.js'
import type { RetrievalQualityV2Strategies } from './article-retrieval-quality-v2.js'
import assert from 'node:assert/strict'
// 项目本轮使用 Node 原生测试运行器，不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { runArticleRetrievalQualityV2Cli } from './article-retrieval-quality-v2.cli.js'
import {
  ARTICLE_RETRIEVAL_QUALITY_V2_DATASET,
  evaluateArticleRetrievalQualityV2,
} from './article-retrieval-quality-v2.js'

describe('Article retrieval quality-v2 evaluation', () => {
  it('固定数据集覆盖质量场景，并分开计算 answerable 与 no-answer', async () => {
    const scenarios = new Set(
      ARTICLE_RETRIEVAL_QUALITY_V2_DATASET.cases.flatMap(item => item.scenarios),
    )

    assert.deepEqual(
      [...scenarios].sort(),
      [
        'duplicate-chunks-one-article',
        'exact-keyword',
        'irrelevant-nearest-neighbor',
        'language-filter',
        'multiple-relevant',
        'no-answer',
        'semantic-paraphrase',
        'special-characters',
        'stable-ordering',
        'zero-result',
      ],
    )

    const clock = createClock()
    const report = await evaluateArticleRetrievalQualityV2({
      strategies: createStrategies(clock),
      now: clock.now,
    })

    assert.equal(report.datasetVersion, 'article-retrieval-quality-v2')
    assert.deepEqual(report.strategies.map(item => item.kind), [
      'lexical',
      'vector',
      'hybrid',
    ])
    assert.deepEqual(report.strategies[0]?.summary, {
      answerableCaseCount: 5,
      noAnswerCaseCount: 3,
      hitAt5: 0.8,
      meanRecallAt5: 0.8,
      meanPrecisionAt5: 0.2,
      mrr: 0.8,
      noAnswerAccuracy: 1,
      falsePositiveQueryCount: 0,
      falsePositiveHitCount: 0,
      zeroHitCount: 4,
      latencyMs: {
        queryEmbedding: { p50: null, p95: null },
        vectorSql: { p50: null, p95: null },
        endToEnd: { p50: 4, p95: 8 },
      },
      embedding: {
        providerRequests: 0,
        retryCount: 0,
      },
      vectorEvidence: {
        threshold: null,
        positive: emptyDistribution(),
        negative: emptyDistribution(),
      },
    })
    assert.deepEqual(report.strategies[1]?.summary, {
      answerableCaseCount: 5,
      noAnswerCaseCount: 3,
      hitAt5: 1,
      meanRecallAt5: 1,
      meanPrecisionAt5: 0.24,
      mrr: 1,
      noAnswerAccuracy: 0,
      falsePositiveQueryCount: 3,
      falsePositiveHitCount: 3,
      zeroHitCount: 0,
      latencyMs: {
        queryEmbedding: { p50: 5, p95: 9 },
        vectorSql: { p50: 4, p95: 8 },
        endToEnd: { p50: 14, p95: 18 },
      },
      embedding: {
        providerRequests: 8,
        retryCount: 1,
      },
      vectorEvidence: {
        threshold: null,
        positive: {
          count: 6,
          cosineDistance: { min: 0.1, median: 0.1, max: 0.11 },
          similarity: { min: 0.89, median: 0.9, max: 0.9 },
        },
        negative: {
          count: 3,
          cosineDistance: { min: 0.1, median: 0.1, max: 0.1 },
          similarity: { min: 0.9, median: 0.9, max: 0.9 },
        },
      },
    })
    assert.equal(report.strategies[2]?.summary.noAnswerAccuracy, 2 / 3)
    assert.equal(report.strategies[2]?.summary.zeroHitCount, 2)

    const semantic = report.strategies[1]?.cases.find(item => (
      item.id === 'semantic-paraphrase'
    ))
    const noAnswer = report.strategies[1]?.cases.find(item => (
      item.id === 'no-answer'
    ))

    assert.deepEqual(semantic?.expectedRanks, [{ sourceId: 25, rank: 1 }])
    assert.deepEqual(semantic?.returned, [{
      sourceId: 25,
      rank: 1,
      cosineDistance: 0.1,
      similarity: 0.9,
    }])
    assert.equal(noAnswer?.expected.kind, 'no-answer')
    assert.equal(noAnswer?.hitAt5, null)
    assert.equal(noAnswer?.reciprocalRank, null)
    assert.equal(noAnswer?.noAnswerCorrect, false)
    assert.equal(noAnswer?.falsePositiveCount, 1)
    assert.equal(noAnswer?.zeroHit, false)
  })

  it('拒绝 duplicate sourceId 和非法 Embedding metrics', async () => {
    const clock = createClock()
    const strategies = createStrategies(clock)
    const validRun = strategies.vector.run
    let callCount = 0

    strategies.vector.run = async (query, context) => {
      if (callCount++ > 0)
        return await validRun(query, context)

      return {
        result: createResult(query, 'pgvector_cosine_exact', [46, 46]),
        embedding: { latencyMs: 1, providerRequests: 1, retryCount: 0 },
        vectorSqlLatencyMs: 1,
      }
    }

    await assert.rejects(
      evaluateArticleRetrievalQualityV2({ strategies, now: clock.now }),
      /hits require unique sourceId/,
    )

    const invalidMetrics = createStrategies(createClock())
    invalidMetrics.lexical.run = async query => ({
      result: createResult(query, 'postgres_lexical_ranked', []),
      embedding: { latencyMs: null, providerRequests: 0, retryCount: 1 },
      vectorSqlLatencyMs: null,
    })

    await assert.rejects(
      evaluateArticleRetrievalQualityV2({
        strategies: invalidMetrics,
        now: () => 0,
      }),
      /embedding metrics are invalid/,
    )
  })

  it('CLI entry 只负责输出注入策略生成的 JSON', async () => {
    const clock = createClock()
    let output = ''
    const report = await runArticleRetrievalQualityV2Cli({
      strategies: createStrategies(clock),
      now: clock.now,
      stdout: { write: text => (output += text) },
    })

    assert.deepEqual(JSON.parse(output), report)
  })
})

function createStrategies(
  clock: ReturnType<typeof createClock>,
): RetrievalQualityV2Strategies {
  let lexicalCall = 0
  let vectorCall = 0
  let hybridCall = 0

  return {
    lexical: {
      run: async (query: NormalizedArticleRetrievalQuery) => {
        const index = lexicalCall++
        clock.advance(index + 1)

        return {
          result: createResult(
            query,
            'postgres_lexical_ranked',
            idsFor(query.query, 'lexical'),
          ),
          embedding: { latencyMs: null, providerRequests: 0, retryCount: 0 },
          vectorSqlLatencyMs: null,
        }
      },
    },
    vector: {
      run: async (query: NormalizedArticleRetrievalQuery) => {
        const index = vectorCall++
        clock.advance(index + 11)

        return {
          result: createResult(
            query,
            'pgvector_cosine_exact',
            idsFor(query.query, 'vector'),
          ),
          embedding: {
            latencyMs: index + 2,
            providerRequests: 1,
            retryCount: index === 0 ? 1 : 0,
          },
          vectorSqlLatencyMs: index + 1,
        }
      },
    },
    hybrid: {
      run: async (query: NormalizedArticleRetrievalQuery) => {
        const index = hybridCall++
        clock.advance(index + 21)

        return {
          result: createResult(
            query,
            'hybrid_rrf',
            idsFor(query.query, 'hybrid'),
          ),
          embedding: {
            latencyMs: index + 3,
            providerRequests: 1,
            retryCount: 0,
          },
          vectorSqlLatencyMs: index + 2,
        }
      },
    },
  }
}

function idsFor(
  query: string,
  strategy: 'lexical' | 'vector' | 'hybrid',
): number[] {
  const fixture = ARTICLE_RETRIEVAL_QUALITY_V2_DATASET.cases.find(item => (
    item.query === query
  ))!

  if (fixture.expected.kind === 'sources') {
    if (strategy === 'lexical' && fixture.id === 'semantic-paraphrase')
      return []

    return [...fixture.expected.sourceIds]
  }

  if (strategy === 'vector')
    return [fixture.id === 'irrelevant-nearest-neighbor' ? 62 : 25]

  if (strategy === 'hybrid' && fixture.id === 'irrelevant-nearest-neighbor')
    return [48]

  return []
}

function createResult(
  query: NormalizedArticleRetrievalQuery,
  strategyName: string,
  sourceIds: number[],
): ArticleRetrievalResult {
  return {
    query,
    strategy: { name: strategyName, version: '1' },
    total: sourceIds.length,
    hits: sourceIds.map((sourceId, index) => createHit(
      sourceId,
      index + 1,
      strategyName === 'postgres_lexical_ranked' ? null : 0.1 + index / 100,
    )),
  }
}

function createHit(
  sourceId: number,
  rank: number,
  cosineDistance: number | null,
): ArticleRetrievalHit {
  return {
    sourceId,
    slug: `article-${sourceId}`,
    languageCode: 'en',
    title: `Article ${sourceId}`,
    seoTitle: null,
    seoDescription: null,
    excerpt: `Excerpt ${sourceId}`,
    rank,
    ...(cosineDistance === null
      ? {}
      : {
          evidence: {
            chunkId: `chunk-${sourceId}`,
            sectionPath: 'Overview',
            cosineDistance,
          },
        }),
  }
}

function emptyDistribution() {
  return {
    count: 0,
    cosineDistance: { min: null, median: null, max: null },
    similarity: { min: null, median: null, max: null },
  }
}

function createClock() {
  let current = 0

  return {
    now: () => current,
    advance: (milliseconds: number) => {
      current += milliseconds
    },
  }
}
