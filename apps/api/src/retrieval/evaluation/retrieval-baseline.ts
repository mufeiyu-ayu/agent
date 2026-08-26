import type {
  ArticleRetrievalExecutionContext,
  ArticleRetrievalInput,
  ArticleRetrievalResult,
  ArticleRetriever,
} from '../article-retrieval.js'
import type {
  RetrievalEvaluationDataset,
  RetrievalEvaluationReport,
} from './retrieval-evaluation.js'

import {
  normalizeArticleRetrievalInput,
  toArticleExcerpt,
} from '../article-retrieval.js'
import { evaluateArticleRetrieval } from './retrieval-evaluation.js'

const FIXTURE_LEXICAL_STRATEGY = {
  name: 'fixture_lexical',
  version: '1',
} as const

export const RETRIEVAL_BASELINE_EXCERPT_SOURCE_ID = 110

interface FixtureArticle {
  sourceId: number
  slug: string
  languageCode: string
  title: string
  content: string
  seoTitle: string | null
  seoDescription: string | null
  updatedAt: string
}

const ARTICLES: FixtureArticle[] = [
  article(101, 'canonical-url-guide', 'en', 'Canonical URL Guide', 'A concise reference.', '2026-01-01T00:00:00.000Z'),
  article(102, 'crawler-efficiency', 'en', 'Crawler Efficiency', 'Use crawl budget deliberately.', '2026-01-02T00:00:00.000Z'),
  article(103, 'technical-seo-a', 'en', 'Technical SEO Checklist A', 'First technical SEO reference.', '2026-01-03T00:00:00.000Z'),
  article(104, 'technical-seo-b', 'en', 'Technical SEO Checklist B', 'Second technical SEO reference.', '2026-01-04T00:00:00.000Z'),
  article(105, 'international-seo-zh', 'zh-cn', 'International SEO 中文', '国际站点说明。', '2026-01-05T00:00:00.000Z'),
  article(106, 'international-seo-en', 'en', 'International SEO English', 'English market notes.', '2026-01-06T00:00:00.000Z'),
  article(108, 'stable-keyword-a', 'en', 'Stable Keyword A', 'Stable ordering record A.', '2026-01-08T00:00:00.000Z'),
  article(109, 'stable-keyword-b', 'en', 'Stable Keyword B', 'Stable ordering record B.', '2026-01-08T00:00:00.000Z'),
  article(110, 'structured-data-html', 'en', 'HTML Example', '<article><h1>Structured data HTML</h1><p>Clean excerpt.</p></article>', '2026-01-10T00:00:00.000Z'),
  article(111, 'literal-special-query', 'en', 'Literal %_\\ Query', 'The special characters are literal.', '2026-01-11T00:00:00.000Z'),
]

export const RETRIEVAL_BASELINE_DATASET: RetrievalEvaluationDataset = {
  datasetVersion: 'article-retrieval-baseline-v1',
  cases: [
    { id: 'title-hit', query: 'canonical url', k: 3, relevantSourceIds: [101] },
    { id: 'content-hit', query: 'crawl budget', k: 3, relevantSourceIds: [102] },
    { id: 'multiple-relevant', query: 'technical seo', k: 2, relevantSourceIds: [103, 104] },
    { id: 'language-filter', query: 'international seo', languageCode: 'zh-cn', k: 3, relevantSourceIds: [105] },
    { id: 'zero-hit', query: 'missing retrieval topic', k: 3, relevantSourceIds: [999] },
    { id: 'stable-ordering', query: 'stable keyword', k: 2, relevantSourceIds: [108, 109] },
    { id: 'html-excerpt', query: 'structured data html', k: 3, relevantSourceIds: [110] },
    { id: 'special-query-characters', query: '%_\\', k: 3, relevantSourceIds: [111] },
  ],
}

export function createRetrievalBaselineRetriever(): ArticleRetriever {
  return new FixtureArticleRetriever(ARTICLES)
}

export function getRetrievalBaselineArticleContent(sourceId: number): string {
  const article = ARTICLES.find(item => item.sourceId === sourceId)

  if (!article)
    throw new Error(`unknown retrieval baseline article: ${sourceId}`)

  return article.content
}

export async function createRetrievalBaselineReport(): Promise<RetrievalEvaluationReport> {
  return await evaluateArticleRetrieval(
    createRetrievalBaselineRetriever(),
    RETRIEVAL_BASELINE_DATASET,
  )
}

class FixtureArticleRetriever implements ArticleRetriever {
  constructor(private readonly articles: readonly FixtureArticle[]) {}

  async retrieve(
    input: ArticleRetrievalInput,
    context: ArticleRetrievalExecutionContext,
  ): Promise<ArticleRetrievalResult> {
    context.signal.throwIfAborted()

    const query = normalizeArticleRetrievalInput(input)
    const needle = query.query.toLowerCase()
    const matches = this.articles
      .filter(article => (
        (!query.languageCode || article.languageCode === query.languageCode)
        && [
          article.title,
          article.slug,
          article.seoTitle,
          article.seoDescription,
          article.content,
        ].some(value => value?.toLowerCase().includes(needle))
      ))
      .sort((left, right) => (
        right.updatedAt.localeCompare(left.updatedAt)
        || left.sourceId - right.sourceId
      ))

    context.signal.throwIfAborted()

    return {
      query,
      strategy: FIXTURE_LEXICAL_STRATEGY,
      total: matches.length,
      hits: matches.slice(0, query.limit).map((article, index) => ({
        sourceId: article.sourceId,
        slug: article.slug,
        languageCode: article.languageCode,
        title: article.title,
        seoTitle: article.seoTitle,
        seoDescription: article.seoDescription,
        excerpt: toArticleExcerpt(article.content),
        rank: index + 1,
      })),
    }
  }
}

function article(
  sourceId: number,
  slug: string,
  languageCode: string,
  title: string,
  content: string,
  updatedAt: string,
): FixtureArticle {
  return {
    sourceId,
    slug,
    languageCode,
    title,
    content,
    seoTitle: null,
    seoDescription: null,
    updatedAt,
  }
}
