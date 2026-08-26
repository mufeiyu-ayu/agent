import type {
  ArticleRetrievalHit,
  ArticleRetrievalResult,
  ArticleRetriever,
} from '../article-retrieval.js'
import assert from 'node:assert/strict'
// 项目本轮使用 Node 原生测试运行器，不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import {
  createRetrievalBaselineReport,
  createRetrievalBaselineRetriever,
  getRetrievalBaselineArticleContent,
  RETRIEVAL_BASELINE_EXCERPT_SOURCE_ID,
} from './retrieval-baseline.js'
import {
  evaluateArticleRetrieval,
  validateRetrievalEvaluationCases,
} from './retrieval-evaluation.js'

describe('Retrieval evaluation', () => {
  it('按手算结果计算 per-case Recall@K、RR、macro Mean Recall@K、MRR 和 zero-hit', async () => {
    const cases = [
      createCase('partial', 2, [1, 3]),
      createCase('rank-two', 2, [4]),
      createCase('zero', 2, [8]),
    ]
    const results: Record<string, ArticleRetrievalResult> = {
      'partial': createResult(
        { query: 'partial', limit: 2 },
        [createHit(3, 1), createHit(9, 2)],
        3,
      ),
      'rank-two': createResult(
        { query: 'rank-two', limit: 2 },
        [createHit(7, 1), createHit(4, 2)],
        2,
      ),
      'zero': createResult({ query: 'zero', limit: 2 }, [], 0),
    }
    const report = await evaluateArticleRetrieval(
      createScriptedRetriever(query => results[query.query]!),
      { datasetVersion: 'manual-v1', cases },
    )

    assert.deepEqual(report, {
      datasetVersion: 'manual-v1',
      strategy: { name: 'test_lexical', version: '1' },
      cases: [
        {
          id: 'partial',
          query: 'partial',
          k: 2,
          relevantSourceIds: [1, 3],
          returnedSourceIds: [3, 9],
          recallAtK: 0.5,
          reciprocalRank: 1,
        },
        {
          id: 'rank-two',
          query: 'rank-two',
          k: 2,
          relevantSourceIds: [4],
          returnedSourceIds: [7, 4],
          recallAtK: 1,
          reciprocalRank: 0.5,
        },
        {
          id: 'zero',
          query: 'zero',
          k: 2,
          relevantSourceIds: [8],
          returnedSourceIds: [],
          recallAtK: 0,
          reciprocalRank: 0,
        },
      ],
      summary: {
        caseCount: 3,
        meanRecallAtK: 0.5,
        mrr: 0.5,
        zeroHitCount: 1,
      },
    })
  })

  it('拒绝重复 case ID、空 query、非法 k、空或重复 relevantSourceIds', () => {
    const invalidCaseSets = [
      [createCase('duplicate'), createCase('duplicate')],
      [createCase('trimmed-duplicate'), createCase(' trimmed-duplicate ')],
      [{ ...createCase('empty-query'), query: '   ' }],
      [{ ...createCase('invalid-k'), k: 0 }],
      [{ ...createCase('empty-relevant'), relevantSourceIds: [] }],
      [{ ...createCase('duplicate-relevant'), relevantSourceIds: [1, 1] }],
    ]

    for (const cases of invalidCaseSets) {
      assert.throws(
        () => validateRetrievalEvaluationCases(cases),
        /invalid retrieval evaluation fixture/,
      )
    }
  })

  it('拒绝 duplicate sourceId、不连续 rank 和 total 小于 hits 数量', async () => {
    const invalidResults = [
      createResult(
        { query: 'case', limit: 2 },
        [createHit(1, 1), createHit(1, 2)],
        2,
      ),
      createResult(
        { query: 'case', limit: 2 },
        [createHit(1, 1), createHit(2, 3)],
        2,
      ),
      createResult(
        { query: 'case', limit: 2 },
        [createHit(1, 1), createHit(2, 2)],
        1,
      ),
    ]

    for (const result of invalidResults) {
      await assert.rejects(
        evaluateArticleRetrieval(
          createScriptedRetriever(() => result),
          { datasetVersion: 'invalid-v1', cases: [createCase('case')] },
        ),
        /invalid retrieval result/,
      )
    }
  })

  it('拒绝与当前 case 不一致的 query、languageCode、limit 和超出 limit 的 hits', async () => {
    const evaluationCase = {
      id: 'case',
      query: '  Case  ',
      languageCode: ' EN ',
      k: 2,
      relevantSourceIds: [1],
    }
    const expectedQuery = { query: 'Case', languageCode: 'en', limit: 2 }
    const invalidResults = [
      createResult({ ...expectedQuery, query: 'other' }, [], 0),
      createResult({ ...expectedQuery, languageCode: 'zh-cn' }, [], 0),
      createResult({ ...expectedQuery, limit: 1 }, [], 0),
      createResult(
        expectedQuery,
        [createHit(1, 1), createHit(2, 2), createHit(3, 3)],
        3,
      ),
    ]

    for (const result of invalidResults) {
      await assert.rejects(
        evaluateArticleRetrieval(
          createScriptedRetriever(() => result),
          { datasetVersion: 'query-binding-v1', cases: [evaluationCase] },
        ),
        /invalid retrieval result/,
      )
    }
  })

  it('拒绝同一次 evaluation 中变化的 strategy', async () => {
    let callCount = 0
    const retriever: ArticleRetriever = {
      retrieve: async input => ({
        ...createResult(
          { query: input.query, limit: input.limit ?? 2 },
          [],
          0,
        ),
        strategy: { name: 'test_lexical', version: String(++callCount) },
      }),
    }

    await assert.rejects(
      evaluateArticleRetrieval(retriever, {
        datasetVersion: 'strategy-v1',
        cases: [createCase('first'), createCase('second')],
      }),
      /strategy changed within one evaluation run/,
    )
  })

  it('向调用方传播 Retriever 执行错误', async () => {
    const retriever: ArticleRetriever = {
      retrieve: async () => {
        throw new Error('fixture adapter failed')
      },
    }

    await assert.rejects(
      evaluateArticleRetrieval(retriever, {
        datasetVersion: 'failure-v1',
        cases: [createCase('failure')],
      }),
      /fixture adapter failed/,
    )
  })

  it('向调用方传播 fixture getter 错误', () => {
    assert.throws(
      () => getRetrievalBaselineArticleContent(404),
      /unknown retrieval baseline article: 404/,
    )
  })

  it('版本化 baseline 覆盖既定场景并生成逐字稳定 JSON', async () => {
    const first = JSON.stringify(await createRetrievalBaselineReport(), null, 2)
    const second = JSON.stringify(await createRetrievalBaselineReport(), null, 2)
    const report = JSON.parse(first) as Awaited<
      ReturnType<typeof createRetrievalBaselineReport>
    >

    assert.equal(second, first)
    assert.equal(report.datasetVersion, 'article-retrieval-baseline-v1')
    assert.deepEqual(
      report.cases.map(item => item.id),
      [
        'title-hit',
        'content-hit',
        'multiple-relevant',
        'language-filter',
        'zero-hit',
        'stable-ordering',
        'html-excerpt',
        'special-query-characters',
      ],
    )
    assert.deepEqual(
      report.cases.find(item => item.id === 'stable-ordering')
        ?.returnedSourceIds,
      [108, 109],
    )
    assert.deepEqual(
      report.cases.find(item => item.id === 'language-filter')
        ?.returnedSourceIds,
      [105],
    )
    assert.deepEqual(
      report.cases.find(item => item.id === 'special-query-characters')
        ?.returnedSourceIds,
      [111],
    )
    const excerptResult = await createRetrievalBaselineRetriever().retrieve({
      query: 'structured data html',
      limit: 3,
    }, { signal: new AbortController().signal })
    const excerpt = excerptResult.hits.find(hit => (
      hit.sourceId === RETRIEVAL_BASELINE_EXCERPT_SOURCE_ID
    ))?.excerpt

    assert.equal(excerpt, 'Structured data HTML Clean excerpt.')
    assert.notEqual(
      excerpt,
      getRetrievalBaselineArticleContent(RETRIEVAL_BASELINE_EXCERPT_SOURCE_ID),
    )
    assert.doesNotMatch(excerpt ?? '', /<article>|<h1>|<p>/)
    assert.deepEqual(report.summary, {
      caseCount: 8,
      meanRecallAtK: 0.875,
      mrr: 0.875,
      zeroHitCount: 1,
    })
    assert.doesNotMatch(first, /timestamp|generatedAt|\/Users\//)
  })
})

function createCase(
  id: string,
  k = 2,
  relevantSourceIds = [1],
) {
  return { id, query: id, k, relevantSourceIds }
}

function createHit(sourceId: number, rank: number): ArticleRetrievalHit {
  return {
    sourceId,
    slug: `article-${sourceId}`,
    languageCode: 'en',
    title: `Article ${sourceId}`,
    seoTitle: null,
    seoDescription: null,
    excerpt: `Excerpt ${sourceId}`,
    rank,
  }
}

function createResult(
  query: ArticleRetrievalResult['query'],
  hits: ArticleRetrievalHit[],
  total: number,
): ArticleRetrievalResult {
  return {
    query,
    strategy: { name: 'test_lexical', version: '1' },
    total,
    hits,
  }
}

function createScriptedRetriever(
  getResult: (query: { query: string }) => ArticleRetrievalResult,
): ArticleRetriever {
  return {
    retrieve: async (input) => {
      const query = typeof input.query === 'string' ? input.query : ''
      return getResult({ query })
    },
  }
}
