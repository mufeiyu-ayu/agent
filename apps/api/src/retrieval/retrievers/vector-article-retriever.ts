import type { EmbeddingProvider } from '../../embeddings/embedding-provider.js'
import type {
  ArticleRetrievalHit,
  ArticleRetrievalInput,
  ArticleRetrievalResult,
  ArticleRetriever,
  DatabaseArticleRetrievalExecutionContext,
} from '../article-retrieval.js'
import type {
  ArticleRetrievalRepositoryContract,
  VectorChunkCandidate,
} from '../persistence/postgres-article-retrieval.repository.js'

import { formatEmbeddingQueryInput } from '../../embeddings/embedding-formatter.js'
import {
  ACTIVE_EMBEDDING_PROFILE,
} from '../../embeddings/embedding-provider.js'
import {
  normalizeArticleRetrievalInput,
  toArticleExcerpt,
} from '../article-retrieval.js'
import { VECTOR_CHUNK_CANDIDATE_LIMIT } from '../persistence/postgres-article-retrieval.repository.js'

export const VECTOR_ARTICLE_CANDIDATE_LIMIT = 10
export const EXACT_COSINE_VECTOR_STRATEGY = {
  name: 'pgvector_cosine_exact',
  version: '1',
} as const

export class VectorArticleRetriever implements ArticleRetriever<DatabaseArticleRetrievalExecutionContext> {
  constructor(
    private readonly embeddingProvider: EmbeddingProvider,
    private readonly repository: Pick<
      ArticleRetrievalRepositoryContract,
      'findVectorChunkCandidates'
    >,
  ) {}

  async retrieve(
    input: ArticleRetrievalInput,
    context: DatabaseArticleRetrievalExecutionContext,
  ): Promise<ArticleRetrievalResult> {
    context.signal.throwIfAborted()
    const query = normalizeArticleRetrievalInput(input)
    const embeddingResult = await this.embeddingProvider.embed(
      [formatEmbeddingQueryInput(query.query)],
      { signal: context.signal },
    )
    context.signal.throwIfAborted()

    const vector = embeddingResult.vectors[0]
    validateQueryEmbedding(embeddingResult.vectors, vector)
    const chunkCandidates = await this.repository.findVectorChunkCandidates(
      vector,
      query,
      context,
    )
    context.signal.throwIfAborted()

    const articleCandidates = aggregateVectorChunkCandidates(chunkCandidates)
    return {
      query,
      strategy: EXACT_COSINE_VECTOR_STRATEGY,
      total: articleCandidates.length,
      hits: articleCandidates.slice(0, query.limit).map((hit, index) => ({
        ...hit,
        rank: index + 1,
      })),
    }
  }
}

export function aggregateVectorChunkCandidates(
  candidates: readonly VectorChunkCandidate[],
): ArticleRetrievalHit[] {
  const bestBySourceId = new Map<number, VectorChunkCandidate>()

  for (const candidate of candidates.slice(0, VECTOR_CHUNK_CANDIDATE_LIMIT)) {
    const current = bestBySourceId.get(candidate.sourceId)
    if (!current || compareVectorCandidates(candidate, current) < 0)
      bestBySourceId.set(candidate.sourceId, candidate)
  }

  return [...bestBySourceId.values()]
    .sort(compareVectorCandidates)
    .slice(0, VECTOR_ARTICLE_CANDIDATE_LIMIT)
    .map((candidate, index) => ({
      sourceId: candidate.sourceId,
      slug: candidate.slug,
      languageCode: candidate.languageCode,
      title: candidate.title,
      seoTitle: candidate.seoTitle,
      seoDescription: candidate.seoDescription,
      excerpt: toArticleExcerpt(candidate.chunkContent),
      rank: index + 1,
      evidence: {
        chunkId: candidate.chunkId,
        sectionPath: candidate.sectionPath,
        cosineDistance: candidate.cosineDistance,
      },
    }))
}

function compareVectorCandidates(
  left: VectorChunkCandidate,
  right: VectorChunkCandidate,
): number {
  return left.cosineDistance - right.cosineDistance
    || left.sourceId - right.sourceId
    || left.ordinal - right.ordinal
    || left.chunkId.localeCompare(right.chunkId)
}

function validateQueryEmbedding(
  vectors: readonly (readonly number[])[],
  vector: readonly number[] | undefined,
): asserts vector is readonly number[] {
  if (
    vectors.length !== 1
    || !vector
    || vector.length !== ACTIVE_EMBEDDING_PROFILE.dimensions
    || vector.some(value => !Number.isFinite(value))
    || !vector.some(value => value !== 0)
  ) {
    throw new Error('Query embedding result is invalid')
  }
}
