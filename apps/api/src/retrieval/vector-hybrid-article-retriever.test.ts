import type { EmbeddingProvider } from '../embeddings/embedding-provider.js'
import type { DatabaseOperationDeadline } from '../prisma/prisma.service.js'
import type {
  ArticleRetrievalHit,
  ArticleRetriever,
  DatabaseArticleRetrievalExecutionContext,
} from './article-retrieval.js'
import type {
  ArticleRetrievalRepositoryContract,
  VectorChunkCandidate,
} from './postgres-article-retrieval.repository.js'
import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { ACTIVE_EMBEDDING_PROFILE } from '../embeddings/embedding-provider.js'
import {
  fuseArticleHits,
  HybridArticleRetriever,
} from './hybrid-article-retriever.js'
import {
  aggregateVectorChunkCandidates,
  VectorArticleRetriever,
} from './vector-article-retriever.js'

describe('VectorArticleRetriever', () => {
  it('共用 query formatter/provider，并将 40 chunks 聚合为唯一 Article 最佳 evidence', async () => {
    const provider = new FakeEmbeddingProvider()
    const repository = new FakeVectorRepository([
      createChunkCandidate(2, 'chunk-2-1', 1, 0.2),
      createChunkCandidate(1, 'chunk-1-1', 1, 0.1),
      createChunkCandidate(1, 'chunk-1-0', 0, 0.05),
      createChunkCandidate(3, 'chunk-3-0', 0, 0.1),
    ])
    const retriever = new VectorArticleRetriever(provider, repository)

    const result = await retriever.retrieve({
      query: '  semantic   query  ',
      languageCode: ' EN ',
      limit: 3,
    }, createContext())

    assert.deepEqual(provider.inputs, [
      ['task: search result | query: semantic query'],
    ])
    assert.equal(repository.vectorCalls.length, 1)
    assert.deepEqual(repository.vectorCalls[0]?.query, {
      query: 'semantic   query',
      languageCode: 'en',
      limit: 3,
    })
    assert.deepEqual(result.hits.map(hit => hit.sourceId), [1, 3, 2])
    assert.deepEqual(result.hits.map(hit => hit.rank), [1, 2, 3])
    assert.deepEqual(result.hits[0]?.evidence, {
      chunkId: 'chunk-1-0',
      sectionPath: 'Section 0',
      cosineDistance: 0.05,
    })
    assert.equal(result.total, 3)
    assert.equal(new Set(result.hits.map(hit => hit.sourceId)).size, 3)
    assert.equal(result.strategy.name, 'pgvector_cosine_exact')
  })

  it('duplicate chunks 不占 Article top-10，且只考虑前 40 个 chunk candidates', () => {
    const firstForty = Array.from({ length: 40 }, (_, index) => (
      createChunkCandidate(
        index % 2 === 0 ? 1 : Math.floor(index / 2) + 2,
        `chunk-${index}`,
        index,
        index / 100,
      )
    ))
    const outsideCandidate = createChunkCandidate(999, 'outside-40', 0, -1)

    const result = aggregateVectorChunkCandidates([
      ...firstForty,
      outsideCandidate,
    ])

    assert.equal(result.length, 10)
    assert.equal(new Set(result.map(hit => hit.sourceId)).size, 10)
    assert.ok(result.every(hit => hit.sourceId !== 999))
    assert.deepEqual(result.map(hit => hit.rank), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('拒绝 provider 返回的 cardinality、维度和零向量错误', async () => {
    const invalidVectors = [
      [],
      [[1]],
      [createVector(0)],
    ]

    for (const vectors of invalidVectors) {
      const provider = new FakeEmbeddingProvider(vectors)
      const retriever = new VectorArticleRetriever(
        provider,
        new FakeVectorRepository([]),
      )
      await assert.rejects(
        retriever.retrieve({ query: 'invalid' }, createContext()),
        /Query embedding result is invalid/,
      )
    }
  })
})

describe('HybridArticleRetriever', () => {
  it('使用 RRF 加法提升双通道结果，单通道只加存在分量并保留 vector evidence', async () => {
    const lexical = new FakeRetriever([
      createHit(1, 1),
      createHit(2, 2),
    ])
    const vector = new FakeRetriever([
      createHit(3, 1, true),
      createHit(2, 2, true),
    ])
    const retriever = new HybridArticleRetriever(lexical, vector)

    const result = await retriever.retrieve({ query: 'hybrid', limit: 3 }, createContext())

    assert.deepEqual(result.hits.map(hit => hit.sourceId), [2, 1, 3])
    assert.deepEqual(result.hits.map(hit => hit.rank), [1, 2, 3])
    assert.equal(result.hits[0]?.evidence?.chunkId, 'chunk-2')
    assert.equal(result.total, 3)
    assert.equal(lexical.inputs[0]?.limit, 10)
    assert.equal(vector.inputs[0]?.limit, 10)
    assert.deepEqual(result.strategy, { name: 'hybrid_rrf', version: '1' })
  })

  it('RRF score 相同时按 sourceId 确定性排序', () => {
    const fused = fuseArticleHits(
      [createHit(20, 1)],
      [createHit(10, 1, true)],
    )

    assert.deepEqual(fused.map(hit => hit.sourceId), [10, 20])
    assert.deepEqual(fused.map(hit => hit.rank), [1, 2])
  })
})

class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly profile = ACTIVE_EMBEDDING_PROFILE
  readonly inputs: string[][] = []

  constructor(
    private readonly vectors: number[][] = [createVector(1)],
  ) {}

  async embed(inputs: readonly string[]): Promise<{
    vectors: number[][]
    providerRequests: number
    retryCount: number
  }> {
    this.inputs.push([...inputs])
    return {
      vectors: this.vectors,
      providerRequests: 1,
      retryCount: 0,
    }
  }
}

class FakeVectorRepository implements Pick<
  ArticleRetrievalRepositoryContract,
  'findVectorChunkCandidates'
> {
  readonly vectorCalls: Array<{
    vector: readonly number[]
    query: Parameters<ArticleRetrievalRepositoryContract['findVectorChunkCandidates']>[1]
  }> = []

  constructor(private readonly candidates: VectorChunkCandidate[]) {}

  async findVectorChunkCandidates(
    vector: readonly number[],
    query: Parameters<ArticleRetrievalRepositoryContract['findVectorChunkCandidates']>[1],
  ): Promise<VectorChunkCandidate[]> {
    this.vectorCalls.push({ vector, query })
    return this.candidates
  }
}

class FakeRetriever implements ArticleRetriever<DatabaseArticleRetrievalExecutionContext> {
  readonly inputs: Array<{ query: string, languageCode?: string, limit?: number }> = []

  constructor(private readonly hits: ArticleRetrievalHit[]) {}

  async retrieve(
    input: { query: string, languageCode?: string, limit?: number },
  ) {
    this.inputs.push(input)
    return {
      query: {
        query: input.query,
        ...(input.languageCode ? { languageCode: input.languageCode } : {}),
        limit: input.limit ?? 5,
      },
      strategy: { name: 'fake', version: '1' },
      total: this.hits.length,
      hits: this.hits,
    }
  }
}

function createContext(): DatabaseArticleRetrievalExecutionContext {
  const signal = new AbortController().signal
  return {
    signal,
    databaseDeadline: createDatabaseDeadline(signal),
  }
}

function createDatabaseDeadline(signal: AbortSignal): DatabaseOperationDeadline {
  return {
    deadlineAt: Date.now() + 60_000,
    signal,
    createTimeoutError: () => new Error('test database deadline exceeded'),
  }
}

function createVector(value: number): number[] {
  const vector: number[] = []
  for (let index = 0; index < ACTIVE_EMBEDDING_PROFILE.dimensions; index += 1)
    vector.push(value)
  return vector
}

function createChunkCandidate(
  sourceId: number,
  chunkId: string,
  ordinal: number,
  cosineDistance: number,
): VectorChunkCandidate {
  return {
    sourceId,
    slug: `article-${sourceId}`,
    languageCode: 'en',
    title: `Article ${sourceId}`,
    seoTitle: null,
    seoDescription: null,
    chunkId,
    ordinal,
    sectionPath: `Section ${ordinal}`,
    chunkContent: `<p>Evidence ${chunkId}</p>`,
    cosineDistance,
  }
}

function createHit(
  sourceId: number,
  rank: number,
  withEvidence = false,
): ArticleRetrievalHit {
  return {
    sourceId,
    slug: `article-${sourceId}`,
    languageCode: 'en',
    title: `Article ${sourceId}`,
    seoTitle: null,
    seoDescription: null,
    excerpt: `Article ${sourceId}`,
    rank,
    ...(withEvidence
      ? {
          evidence: {
            chunkId: `chunk-${sourceId}`,
            sectionPath: 'Evidence',
            cosineDistance: 0.1,
          },
        }
      : {}),
  }
}
