import type {
  ArticleRetrievalResult,
  NormalizedArticleRetrievalQuery,
} from '../article-retrieval.js'
import { performance } from 'node:perf_hooks'

import { normalizeArticleRetrievalInput } from '../article-retrieval.js'
import { validateRetrievalResult } from './retrieval-evaluation.js'

const TOP_K = 5
const STRATEGY_KINDS = ['lexical', 'vector', 'hybrid'] as const

export type RetrievalQualityV2StrategyKind = typeof STRATEGY_KINDS[number]

export type RetrievalQualityV2Expectation
  = | { kind: 'sources', sourceIds: readonly number[] }
    | { kind: 'no-answer' }

export interface RetrievalQualityV2Case {
  id: string
  scenarios: readonly string[]
  query: string
  languageCode?: string
  expected: RetrievalQualityV2Expectation
}

export interface RetrievalQualityV2EmbeddingMetrics {
  latencyMs: number | null
  providerRequests: number
  retryCount: number
}

export interface RetrievalQualityV2StrategyExecution {
  result: ArticleRetrievalResult
  embedding: RetrievalQualityV2EmbeddingMetrics
  vectorSqlLatencyMs: number | null
}

export interface RetrievalQualityV2StrategyRunner {
  run: (
    query: NormalizedArticleRetrievalQuery,
    context: { signal: AbortSignal },
  ) => Promise<RetrievalQualityV2StrategyExecution>
}

export type RetrievalQualityV2Strategies = Record<
  RetrievalQualityV2StrategyKind,
  RetrievalQualityV2StrategyRunner
>

export interface RetrievalQualityV2Report {
  datasetVersion: string
  strategies: Array<{
    kind: RetrievalQualityV2StrategyKind
    strategy: ArticleRetrievalResult['strategy']
    cases: Array<{
      id: string
      scenarios: string[]
      query: string
      languageCode?: string
      expected: { kind: 'sources', sourceIds: number[] } | { kind: 'no-answer' }
      returned: Array<{
        sourceId: number
        rank: number
        cosineDistance?: number
        similarity?: number
      }>
      expectedRanks: Array<{ sourceId: number, rank: number | null }>
      hitAt5: number | null
      recallAt5: number | null
      precisionAt5: number | null
      reciprocalRank: number | null
      noAnswerCorrect: boolean | null
      falsePositiveCount: number
      zeroHit: boolean
      endToEndLatencyMs: number
      embedding: RetrievalQualityV2EmbeddingMetrics
      vectorSqlLatencyMs: number | null
    }>
    summary: {
      answerableCaseCount: number
      noAnswerCaseCount: number
      hitAt5: number
      meanRecallAt5: number
      meanPrecisionAt5: number
      mrr: number
      noAnswerAccuracy: number
      falsePositiveQueryCount: number
      falsePositiveHitCount: number
      zeroHitCount: number
      latencyMs: {
        queryEmbedding: { p50: number | null, p95: number | null }
        vectorSql: { p50: number | null, p95: number | null }
        endToEnd: { p50: number, p95: number }
      }
      embedding: {
        providerRequests: number
        retryCount: number
      }
      vectorEvidence: {
        threshold: null
        positive: VectorEvidenceDistribution
        negative: VectorEvidenceDistribution
      }
    }
  }>
}

interface VectorEvidenceDistribution {
  count: number
  cosineDistance: NumericDistribution
  similarity: NumericDistribution
}

interface NumericDistribution {
  min: number | null
  median: number | null
  max: number | null
}

export const ARTICLE_RETRIEVAL_QUALITY_V2_DATASET = {
  datasetVersion: 'article-retrieval-quality-v2',
  cases: [
    {
      id: 'lexical-exact',
      scenarios: ['exact-keyword'],
      query: 'soft pity Wuthering Waves',
      languageCode: 'en',
      expected: { kind: 'sources', sourceIds: [46] },
    },
    {
      id: 'semantic-paraphrase',
      scenarios: ['semantic-paraphrase'],
      query: 'Can Apple desktop players use cloud streaming when a game has no native Mac release?',
      languageCode: 'en',
      expected: { kind: 'sources', sourceIds: [25] },
    },
    {
      id: 'multiple-relevant-stable-ordering',
      scenarios: ['multiple-relevant', 'stable-ordering'],
      query: 'Can I start Arena Breakout without paying?',
      languageCode: 'en',
      expected: { kind: 'sources', sourceIds: [49, 52] },
    },
    {
      id: 'language-filter',
      scenarios: ['language-filter'],
      query: 'Delta Force 现在能在 PS5 免费玩吗',
      languageCode: 'zh-cn',
      expected: { kind: 'sources', sourceIds: [41] },
    },
    {
      id: 'no-answer',
      scenarios: ['no-answer'],
      query: 'How do I replace a bicycle chain?',
      languageCode: 'en',
      expected: { kind: 'no-answer' },
    },
    {
      id: 'irrelevant-nearest-neighbor',
      scenarios: ['irrelevant-nearest-neighbor'],
      query: 'What temperature should sourdough bread bake at?',
      languageCode: 'en',
      expected: { kind: 'no-answer' },
    },
    {
      id: 'duplicate-chunks-one-article',
      scenarios: ['duplicate-chunks-one-article'],
      query: 'Does Wuthering Waves increase five-star odds before hard pity?',
      languageCode: 'en',
      expected: { kind: 'sources', sourceIds: [46] },
    },
    {
      id: 'special-characters-zero-result',
      scenarios: ['special-characters', 'zero-result'],
      query: '%_\\',
      languageCode: 'en',
      expected: { kind: 'no-answer' },
    },
  ],
} as const satisfies {
  datasetVersion: string
  cases: readonly RetrievalQualityV2Case[]
}

export async function evaluateArticleRetrievalQualityV2(options: {
  strategies: RetrievalQualityV2Strategies
  now?: () => number
  signal?: AbortSignal
}): Promise<RetrievalQualityV2Report> {
  const now = options.now ?? (() => performance.now())
  const signal = options.signal ?? new AbortController().signal
  const reports: RetrievalQualityV2Report['strategies'] = []

  for (const kind of STRATEGY_KINDS) {
    const cases: RetrievalQualityV2Report['strategies'][number]['cases'] = []
    let strategy: ArticleRetrievalResult['strategy'] | undefined

    for (const fixture of ARTICLE_RETRIEVAL_QUALITY_V2_DATASET.cases) {
      signal.throwIfAborted()

      const query = normalizeArticleRetrievalInput({
        query: fixture.query,
        languageCode: fixture.languageCode,
        limit: TOP_K,
      })
      const startedAt = readTime(now)
      const execution = await options.strategies[kind].run(query, { signal })
      const endToEndLatencyMs = readTime(now) - startedAt

      if (endToEndLatencyMs < 0)
        throw invalidEvaluation('clock moved backwards')

      validateExecution(execution, query)

      if (
        strategy
        && (
          strategy.name !== execution.result.strategy.name
          || strategy.version !== execution.result.strategy.version
        )
      ) {
        throw invalidEvaluation(`${kind} strategy changed within one run`)
      }

      strategy ??= execution.result.strategy

      const returned = execution.result.hits.map((hit) => {
        const cosineDistance = readCosineDistance(hit)

        return {
          sourceId: hit.sourceId,
          rank: hit.rank,
          ...(cosineDistance === null
            ? {}
            : { cosineDistance, similarity: 1 - cosineDistance }),
        }
      })
      const returnedRanks = new Map(returned.map(hit => [hit.sourceId, hit.rank]))
      const expected = copyExpectation(fixture.expected)
      const firstRelevantRank = expected.kind === 'sources'
        ? returned.find(hit => expected.sourceIds.includes(hit.sourceId))?.rank ?? null
        : null
      const relevantReturned = expected.kind === 'sources'
        ? returned.filter(hit => expected.sourceIds.includes(hit.sourceId)).length
        : 0
      const noAnswerCorrect = expected.kind === 'no-answer'
        ? returned.length === 0
        : null

      cases.push({
        id: fixture.id,
        scenarios: [...fixture.scenarios],
        query: query.query,
        ...(query.languageCode ? { languageCode: query.languageCode } : {}),
        expected,
        returned,
        expectedRanks: expected.kind === 'sources'
          ? expected.sourceIds.map(sourceId => ({
              sourceId,
              rank: returnedRanks.get(sourceId) ?? null,
            }))
          : [],
        hitAt5: expected.kind === 'sources' ? Number(firstRelevantRank !== null) : null,
        recallAt5: expected.kind === 'sources'
          ? relevantReturned / expected.sourceIds.length
          : null,
        precisionAt5: expected.kind === 'sources' ? relevantReturned / TOP_K : null,
        reciprocalRank: expected.kind === 'sources'
          ? (firstRelevantRank === null ? 0 : 1 / firstRelevantRank)
          : null,
        noAnswerCorrect,
        falsePositiveCount: expected.kind === 'no-answer' ? returned.length : 0,
        zeroHit: returned.length === 0,
        endToEndLatencyMs,
        embedding: { ...execution.embedding },
        vectorSqlLatencyMs: execution.vectorSqlLatencyMs,
      })
    }

    if (!strategy)
      throw invalidEvaluation('quality-v2 dataset must not be empty')

    reports.push({ kind, strategy, cases, summary: summarize(cases) })
  }

  return {
    datasetVersion: ARTICLE_RETRIEVAL_QUALITY_V2_DATASET.datasetVersion,
    strategies: reports,
  }
}

function validateExecution(
  execution: RetrievalQualityV2StrategyExecution,
  expectedQuery: NormalizedArticleRetrievalQuery,
): void {
  const { result, embedding, vectorSqlLatencyMs } = execution
  validateRetrievalResult(result, expectedQuery)

  if (
    typeof embedding !== 'object'
    || embedding === null
    || (
      embedding.latencyMs !== null
      && (!Number.isFinite(embedding.latencyMs) || embedding.latencyMs < 0)
    )
    || !Number.isSafeInteger(embedding.providerRequests)
    || embedding.providerRequests < 0
    || !Number.isSafeInteger(embedding.retryCount)
    || embedding.retryCount < 0
    || embedding.retryCount > embedding.providerRequests
    || (
      vectorSqlLatencyMs !== null
      && (!Number.isFinite(vectorSqlLatencyMs) || vectorSqlLatencyMs < 0)
    )
  ) {
    throw invalidEvaluation('embedding metrics are invalid')
  }
}

function summarize(
  cases: RetrievalQualityV2Report['strategies'][number]['cases'],
): RetrievalQualityV2Report['strategies'][number]['summary'] {
  const answerable = cases.filter(item => item.expected.kind === 'sources')
  const noAnswer = cases.filter(item => item.expected.kind === 'no-answer')
  const embeddingLatencies = cases.flatMap(item => (
    item.embedding.latencyMs === null ? [] : [item.embedding.latencyMs]
  ))
  const vectorSqlLatencies = cases.flatMap(item => (
    item.vectorSqlLatencyMs === null ? [] : [item.vectorSqlLatencyMs]
  ))
  const positiveDistances: number[] = []
  const negativeDistances: number[] = []

  for (const item of cases) {
    const expectedSourceIds = item.expected.kind === 'sources'
      ? new Set(item.expected.sourceIds)
      : new Set<number>()

    for (const hit of item.returned) {
      if (hit.cosineDistance === undefined) {
        continue
      }

      ;(expectedSourceIds.has(hit.sourceId) ? positiveDistances : negativeDistances)
        .push(hit.cosineDistance)
    }
  }

  return {
    answerableCaseCount: answerable.length,
    noAnswerCaseCount: noAnswer.length,
    hitAt5: mean(answerable.map(item => item.hitAt5 ?? 0)),
    meanRecallAt5: mean(answerable.map(item => item.recallAt5 ?? 0)),
    meanPrecisionAt5: mean(answerable.map(item => item.precisionAt5 ?? 0)),
    mrr: mean(answerable.map(item => item.reciprocalRank ?? 0)),
    noAnswerAccuracy: mean(noAnswer.map(item => Number(item.noAnswerCorrect))),
    falsePositiveQueryCount: noAnswer.filter(item => !item.noAnswerCorrect).length,
    falsePositiveHitCount: noAnswer.reduce(
      (sum, item) => sum + item.falsePositiveCount,
      0,
    ),
    zeroHitCount: cases.filter(item => item.zeroHit).length,
    latencyMs: {
      queryEmbedding: optionalPercentileSummary(embeddingLatencies),
      vectorSql: optionalPercentileSummary(vectorSqlLatencies),
      endToEnd: percentileSummary(cases.map(item => item.endToEndLatencyMs)),
    },
    embedding: {
      providerRequests: cases.reduce(
        (sum, item) => sum + item.embedding.providerRequests,
        0,
      ),
      retryCount: cases.reduce(
        (sum, item) => sum + item.embedding.retryCount,
        0,
      ),
    },
    vectorEvidence: {
      threshold: null,
      positive: vectorEvidenceDistribution(positiveDistances),
      negative: vectorEvidenceDistribution(negativeDistances),
    },
  }
}

function optionalPercentileSummary(
  values: number[],
): { p50: number | null, p95: number | null } {
  return values.length === 0
    ? { p50: null, p95: null }
    : percentileSummary(values)
}

function vectorEvidenceDistribution(
  cosineDistances: number[],
): VectorEvidenceDistribution {
  return {
    count: cosineDistances.length,
    cosineDistance: numericDistribution(cosineDistances),
    similarity: numericDistribution(cosineDistances.map(value => 1 - value)),
  }
}

function numericDistribution(values: number[]): NumericDistribution {
  if (values.length === 0)
    return { min: null, median: null, max: null }

  const sorted = [...values].sort((left, right) => left - right)
  const middle = Math.floor(sorted.length / 2)
  const median = sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!

  return { min: sorted[0]!, median, max: sorted.at(-1)! }
}

function percentileSummary(values: number[]): { p50: number, p95: number } {
  const sorted = [...values].sort((left, right) => left - right)

  return {
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
  }
}

function percentile(sorted: number[], quantile: number): number {
  return sorted[Math.ceil(sorted.length * quantile) - 1]!
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function readTime(now: () => number): number {
  const value = now()

  if (!Number.isFinite(value))
    throw invalidEvaluation('clock returned a non-finite value')

  return value
}

function readCosineDistance(
  hit: ArticleRetrievalResult['hits'][number],
): number | null {
  const evidence = (hit as { evidence?: { cosineDistance?: unknown } }).evidence

  if (evidence?.cosineDistance === undefined)
    return null

  if (
    typeof evidence.cosineDistance !== 'number'
    || !Number.isFinite(evidence.cosineDistance)
    || evidence.cosineDistance < 0
    || evidence.cosineDistance > 2
  ) {
    throw invalidEvaluation('cosine distance evidence is invalid')
  }

  return evidence.cosineDistance
}

function copyExpectation(
  expectation: RetrievalQualityV2Expectation,
): RetrievalQualityV2Report['strategies'][number]['cases'][number]['expected'] {
  return expectation.kind === 'sources'
    ? { kind: 'sources', sourceIds: [...expectation.sourceIds] }
    : { kind: 'no-answer' }
}

function invalidEvaluation(message: string): Error {
  return new Error(`invalid article retrieval quality-v2 evaluation: ${message}`)
}
