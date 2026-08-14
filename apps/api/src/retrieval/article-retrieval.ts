import type { DatabaseOperationDeadline } from '../prisma/prisma.service.js'

const DEFAULT_LIMIT = 5
const MAX_LIMIT = 10
const MAX_QUERY_LENGTH = 100
const MAX_LANGUAGE_CODE_LENGTH = 20
const EXCERPT_LENGTH = 500

export interface ArticleRetrievalInput {
  query: string
  languageCode?: string
  limit?: number
}

export interface NormalizedArticleRetrievalQuery {
  query: string
  languageCode?: string
  limit: number
}

export interface ArticleRetrievalExecutionContext {
  signal: AbortSignal
}

export interface DatabaseArticleRetrievalExecutionContext extends ArticleRetrievalExecutionContext {
  databaseDeadline: DatabaseOperationDeadline
}

export interface ArticleRetrievalHit {
  sourceId: number
  slug: string
  languageCode: string
  title: string
  seoTitle: string | null
  seoDescription: string | null
  excerpt: string
  rank: number
  evidence?: ArticleRetrievalEvidence
}

export interface ArticleRetrievalEvidence {
  chunkId: string
  sectionPath: string
  cosineDistance: number
}

export interface ArticleRetrievalResult {
  query: NormalizedArticleRetrievalQuery
  strategy: {
    name: string
    version: string
  }
  total: number
  hits: ArticleRetrievalHit[]
}

export interface ArticleRetriever<
  TContext extends ArticleRetrievalExecutionContext = ArticleRetrievalExecutionContext,
> {
  retrieve: (
    input: ArticleRetrievalInput,
    context: TContext,
  ) => Promise<ArticleRetrievalResult>
}

export function normalizeArticleRetrievalInput(
  value: unknown,
): NormalizedArticleRetrievalQuery {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('invalid article retrieval input')

  const record = value as Record<string, unknown>
  const allowedKeys = new Set(['query', 'languageCode', 'limit'])

  if (Object.keys(record).some(key => !allowedKeys.has(key)))
    throw new Error('invalid article retrieval input')

  if (typeof record.query !== 'string')
    throw new Error('invalid article retrieval query')

  const query = record.query.trim()

  if (query.length === 0 || query.length > MAX_QUERY_LENGTH)
    throw new Error('invalid article retrieval query')

  let languageCode: string | undefined

  if (Object.hasOwn(record, 'languageCode')) {
    if (typeof record.languageCode !== 'string')
      throw new Error('invalid article retrieval languageCode')

    languageCode = record.languageCode.trim().toLowerCase()

    if (languageCode.length === 0 || languageCode.length > MAX_LANGUAGE_CODE_LENGTH)
      throw new Error('invalid article retrieval languageCode')
  }

  let limit = DEFAULT_LIMIT

  if (Object.hasOwn(record, 'limit')) {
    if (
      typeof record.limit !== 'number'
      || !Number.isInteger(record.limit)
      || record.limit < 1
      || record.limit > MAX_LIMIT
    ) {
      throw new Error('invalid article retrieval limit')
    }

    limit = record.limit
  }

  return {
    query,
    ...(languageCode ? { languageCode } : {}),
    limit,
  }
}

export function toArticleExcerpt(content: string): string {
  const plainText = content
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return [...plainText].slice(0, EXCERPT_LENGTH).join('')
}
