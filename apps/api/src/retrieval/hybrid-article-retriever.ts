import type {
  ArticleRetrievalHit,
  ArticleRetrievalInput,
  ArticleRetrievalResult,
  ArticleRetriever,
  DatabaseArticleRetrievalExecutionContext,
  NormalizedArticleRetrievalQuery,
} from './article-retrieval.js'

import { normalizeArticleRetrievalInput } from './article-retrieval.js'
import { LEXICAL_ARTICLE_CANDIDATE_LIMIT } from './postgres-article-retrieval.repository.js'
import { VECTOR_ARTICLE_CANDIDATE_LIMIT } from './vector-article-retriever.js'

export const RRF_CONSTANT = 60
export const HYBRID_RRF_STRATEGY = {
  name: 'hybrid_rrf',
  version: '1',
} as const

export class HybridArticleRetriever implements ArticleRetriever<DatabaseArticleRetrievalExecutionContext> {
  constructor(
    private readonly lexicalRetriever: ArticleRetriever<DatabaseArticleRetrievalExecutionContext>,
    private readonly vectorRetriever: ArticleRetriever<DatabaseArticleRetrievalExecutionContext>,
  ) {}

  async retrieve(
    input: ArticleRetrievalInput,
    context: DatabaseArticleRetrievalExecutionContext,
  ): Promise<ArticleRetrievalResult> {
    context.signal.throwIfAborted()
    const query = normalizeArticleRetrievalInput(input)
    const candidateQuery: NormalizedArticleRetrievalQuery = {
      ...query,
      limit: Math.max(
        LEXICAL_ARTICLE_CANDIDATE_LIMIT,
        VECTOR_ARTICLE_CANDIDATE_LIMIT,
      ),
    }
    const [lexicalResult, vectorResult] = await Promise.all([
      this.lexicalRetriever.retrieve(candidateQuery, context),
      this.vectorRetriever.retrieve(candidateQuery, context),
    ])
    context.signal.throwIfAborted()

    const fusedHits = fuseArticleHits(lexicalResult.hits, vectorResult.hits)
    return {
      query,
      strategy: HYBRID_RRF_STRATEGY,
      total: fusedHits.length,
      hits: fusedHits.slice(0, query.limit).map((hit, index) => ({
        ...hit,
        rank: index + 1,
      })),
    }
  }
}

export function fuseArticleHits(
  lexicalHits: readonly ArticleRetrievalHit[],
  vectorHits: readonly ArticleRetrievalHit[],
): ArticleRetrievalHit[] {
  const candidates = new Map<number, FusionCandidate>()

  for (const hit of lexicalHits) {
    candidates.set(hit.sourceId, {
      hit,
      score: reciprocalRank(hit.rank),
    })
  }

  for (const hit of vectorHits) {
    const existing = candidates.get(hit.sourceId)
    candidates.set(hit.sourceId, {
      // 相同 Article 优先保留带真实 Chunk evidence 的 vector hit。
      hit,
      score: reciprocalRank(hit.rank) + (existing?.score ?? 0),
    })
  }

  return [...candidates.values()]
    .sort((left, right) => (
      right.score - left.score
      || left.hit.sourceId - right.hit.sourceId
    ))
    .map(({ hit }, index) => ({
      ...hit,
      rank: index + 1,
    }))
}

interface FusionCandidate {
  hit: ArticleRetrievalHit
  score: number
}

function reciprocalRank(rank: number): number {
  return 1 / (RRF_CONSTANT + rank)
}
