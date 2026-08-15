import type {
  ArticleRetriever,
  DatabaseArticleRetrievalExecutionContext,
  NormalizedArticleRetrievalQuery,
} from '../../retrieval/article-retrieval.js'
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutor,
  ValidatedToolInvocation,
} from '../core/tool.types.js'
import { Inject, Injectable } from '@nestjs/common'

import { normalizeArticleRetrievalInput } from '../../retrieval/article-retrieval.js'
import { PrismaArticleRetriever } from '../../retrieval/prisma-article-retriever.js'

export type SearchArticlesInput = NormalizedArticleRetrievalQuery

export interface SearchArticleSummary {
  sourceId: number
  slug: string
  languageCode: string
  title: string
  seoTitle: string | null
  seoDescription: string | null
  excerpt: string
}

export interface SearchArticlesOutput {
  query: string
  languageCode?: string
  total: number
  articles: SearchArticleSummary[]
}

export const searchArticlesDefinition: ToolDefinition<SearchArticlesInput> = {
  name: 'search_articles',
  version: '1',
  description: '按关键词查询文章，返回总数和最多 10 条不含正文的精简结果。',
  input: {
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索关键词，最多 100 个字符。' },
        languageCode: { type: 'string', description: '可选语言代码，例如 zh-cn 或 en。' },
        limit: { type: 'integer', description: '返回条数，范围 1-10，默认 5。' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    parse: parseSearchArticlesInput,
  },
  timeoutMs: 5_000,
  maxObservationChars: 16_000,
  requiresApproval: false,
  idempotent: true,
  risk: { level: 'low', sideEffect: 'none', network: 'none' },
}

@Injectable()
export class SearchArticlesTool implements ToolExecutor<SearchArticlesInput, SearchArticlesOutput> {
  constructor(
    @Inject(PrismaArticleRetriever)
    private readonly articleRetriever: ArticleRetriever<DatabaseArticleRetrievalExecutionContext>,
  ) {}

  async execute(
    invocation: ValidatedToolInvocation<SearchArticlesInput>,
    context: ToolExecutionContext,
  ) {
    context.signal.throwIfAborted()

    // 零结果属于正常查询结果；未捕获的数据库或执行异常由 ToolInvocationService 统一兜底。
    const retrieval = await this.articleRetriever.retrieve(invocation.input, {
      databaseDeadline: context.databaseDeadline,
      signal: context.signal,
    })

    context.signal.throwIfAborted()
    const { languageCode, query } = retrieval.query
    const articles = retrieval.hits.map(({ rank: _rank, ...article }) => article)
    const data: SearchArticlesOutput = {
      query,
      ...(languageCode ? { languageCode } : {}),
      total: retrieval.total,
      articles,
    }

    return {
      ok: true as const,
      data,
      modelContent: articles.length === 0
        ? `没有找到与“${query}”匹配的文章。`
        : `共找到 ${retrieval.total} 篇匹配文章，以下是 ${articles.length} 条精简结果：\n${JSON.stringify(articles)}`,
    }
  }
}

function parseSearchArticlesInput(value: unknown): SearchArticlesInput {
  return normalizeArticleRetrievalInput(value)
}
