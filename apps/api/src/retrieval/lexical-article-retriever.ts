import type {
  ArticleRetrievalInput,
  ArticleRetrievalResult,
  ArticleRetriever,
  DatabaseArticleRetrievalExecutionContext,
} from './article-retrieval.js'
import type { ArticleRetrievalRepositoryContract } from './postgres-article-retrieval.repository.js'

import {
  normalizeArticleRetrievalInput,
  toArticleExcerpt,
} from './article-retrieval.js'

export const POSTGRES_LEXICAL_STRATEGY = {
  name: 'postgres_lexical_ranked',
  version: '1',
} as const

export class LexicalArticleRetriever implements ArticleRetriever<DatabaseArticleRetrievalExecutionContext> {
  constructor(
    private readonly repository: Pick<
      ArticleRetrievalRepositoryContract,
      'findLexicalCandidates'
    >,
  ) {}

  async retrieve(
    input: ArticleRetrievalInput,
    context: DatabaseArticleRetrievalExecutionContext,
  ): Promise<ArticleRetrievalResult> {
    context.signal.throwIfAborted()
    const query = normalizeArticleRetrievalInput(input)
    const candidates = await this.repository.findLexicalCandidates(query, context)
    context.signal.throwIfAborted()

    const hits = candidates.slice(0, query.limit).map(({ content, ...candidate }, index) => ({
      ...candidate,
      excerpt: toArticleExcerpt(content),
      rank: index + 1,
    }))

    return {
      query,
      strategy: POSTGRES_LEXICAL_STRATEGY,
      total: candidates.length,
      hits,
    }
  }
}
