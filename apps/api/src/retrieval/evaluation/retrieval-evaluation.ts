import type {
  ArticleRetrievalResult,
  ArticleRetriever,
  NormalizedArticleRetrievalQuery,
} from '../article-retrieval.js'

import { normalizeArticleRetrievalInput } from '../article-retrieval.js'

export interface RetrievalEvaluationCase {
  id: string
  query: string
  languageCode?: string
  k: number
  relevantSourceIds: number[]
}

export interface RetrievalEvaluationDataset {
  datasetVersion: string
  cases: RetrievalEvaluationCase[]
}

export interface RetrievalEvaluationCaseResult {
  id: string
  query: string
  languageCode?: string
  k: number
  relevantSourceIds: number[]
  returnedSourceIds: number[]
  recallAtK: number
  reciprocalRank: number
}

export interface RetrievalEvaluationReport {
  datasetVersion: string
  strategy: {
    name: string
    version: string
  }
  cases: RetrievalEvaluationCaseResult[]
  summary: {
    caseCount: number
    meanRecallAtK: number
    mrr: number
    zeroHitCount: number
  }
}

interface ValidatedEvaluationCase extends RetrievalEvaluationCase {
  normalizedQuery: NormalizedArticleRetrievalQuery
}

export function validateRetrievalEvaluationCases(
  cases: readonly RetrievalEvaluationCase[],
): ValidatedEvaluationCase[] {
  if (!Array.isArray(cases) || cases.length === 0)
    throw invalidFixture('cases must not be empty')

  const ids = new Set<string>()

  return cases.map((item) => {
    if (
      typeof item !== 'object'
      || item === null
      || typeof item.id !== 'string'
    ) {
      throw invalidFixture('case id must be unique and non-empty')
    }

    const id = item.id.trim()

    if (id.length === 0 || ids.has(id))
      throw invalidFixture('case id must be unique and non-empty')

    ids.add(id)

    if (
      !Array.isArray(item.relevantSourceIds)
      || item.relevantSourceIds.length === 0
      || item.relevantSourceIds.some((sourceId: unknown) => (
        typeof sourceId !== 'number'
        || !Number.isSafeInteger(sourceId)
        || sourceId <= 0
      ))
      || new Set(item.relevantSourceIds).size !== item.relevantSourceIds.length
    ) {
      throw invalidFixture('relevantSourceIds must contain unique positive integers')
    }

    let normalizedQuery: NormalizedArticleRetrievalQuery

    try {
      normalizedQuery = normalizeArticleRetrievalInput({
        query: item.query,
        ...(item.languageCode === undefined
          ? {}
          : { languageCode: item.languageCode }),
        limit: item.k,
      })
    }
    catch {
      throw invalidFixture('query, languageCode or k is invalid')
    }

    return {
      ...item,
      id,
      normalizedQuery,
    }
  })
}

export async function evaluateArticleRetrieval(
  retriever: ArticleRetriever,
  dataset: RetrievalEvaluationDataset,
): Promise<RetrievalEvaluationReport> {
  if (typeof dataset.datasetVersion !== 'string' || dataset.datasetVersion.trim().length === 0)
    throw invalidFixture('datasetVersion must be non-empty')

  const cases = validateRetrievalEvaluationCases(dataset.cases)
  const results: RetrievalEvaluationCaseResult[] = []
  const signal = new AbortController().signal
  let strategy: RetrievalEvaluationReport['strategy'] | undefined
  let zeroHitCount = 0

  for (const item of cases) {
    const retrieval = await retriever.retrieve(item.normalizedQuery, { signal })
    validateRetrievalResult(retrieval, item.normalizedQuery)

    if (
      strategy
      && (
        strategy.name !== retrieval.strategy.name
        || strategy.version !== retrieval.strategy.version
      )
    ) {
      throw invalidResult('strategy changed within one evaluation run')
    }

    strategy ??= retrieval.strategy

    const returnedSourceIds = retrieval.hits.map(hit => hit.sourceId)
    const relevantSourceIds = new Set(item.relevantSourceIds)
    const returnedAtK = returnedSourceIds.slice(0, item.k)
    const relevantReturned = returnedAtK.filter(sourceId => (
      relevantSourceIds.has(sourceId)
    )).length
    const firstRelevantIndex = returnedAtK.findIndex(sourceId => (
      relevantSourceIds.has(sourceId)
    ))

    if (returnedSourceIds.length === 0)
      zeroHitCount += 1

    results.push({
      id: item.id,
      query: item.normalizedQuery.query,
      ...(item.normalizedQuery.languageCode
        ? { languageCode: item.normalizedQuery.languageCode }
        : {}),
      k: item.k,
      relevantSourceIds: [...item.relevantSourceIds],
      returnedSourceIds,
      recallAtK: relevantReturned / item.relevantSourceIds.length,
      reciprocalRank: firstRelevantIndex === -1 ? 0 : 1 / (firstRelevantIndex + 1),
    })
  }

  if (!strategy)
    throw invalidFixture('cases must not be empty')

  return {
    datasetVersion: dataset.datasetVersion.trim(),
    strategy,
    cases: results,
    summary: {
      caseCount: results.length,
      meanRecallAtK: mean(results.map(item => item.recallAtK)),
      mrr: mean(results.map(item => item.reciprocalRank)),
      zeroHitCount,
    },
  }
}

export function validateRetrievalResult(
  result: ArticleRetrievalResult,
  expectedQuery: NormalizedArticleRetrievalQuery,
): void {
  if (
    typeof result !== 'object'
    || result === null
    || !Array.isArray(result.hits)
    || !Number.isSafeInteger(result.total)
    || result.total < result.hits.length
    || typeof result.strategy?.name !== 'string'
    || result.strategy.name.length === 0
    || typeof result.strategy.version !== 'string'
    || result.strategy.version.length === 0
  ) {
    throw invalidResult('total or strategy is invalid')
  }

  if (
    typeof result.query !== 'object'
    || result.query === null
    || result.query.query !== expectedQuery.query
    || result.query.languageCode !== expectedQuery.languageCode
    || result.query.limit !== expectedQuery.limit
  ) {
    throw invalidResult('query does not match the evaluation case')
  }

  if (result.hits.length > expectedQuery.limit)
    throw invalidResult('hits exceed the evaluation case limit')

  const sourceIds = new Set<number>()

  for (const [index, hit] of result.hits.entries()) {
    if (
      !Number.isSafeInteger(hit.sourceId)
      || hit.sourceId <= 0
      || sourceIds.has(hit.sourceId)
      || hit.rank !== index + 1
    ) {
      throw invalidResult('hits require unique sourceId and contiguous rank from 1')
    }

    sourceIds.add(hit.sourceId)
  }
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function invalidFixture(message: string): Error {
  return new Error(`invalid retrieval evaluation fixture: ${message}`)
}

function invalidResult(message: string): Error {
  return new Error(`invalid retrieval result: ${message}`)
}
