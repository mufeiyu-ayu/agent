import type { Prisma } from '../generated/prisma/client.js'
import type {
  ToolDefinition,
  ToolExecutor,
  ValidatedToolInvocation,
} from './tool.types.js'
import { Inject, Injectable } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service.js'

const DEFAULT_LIMIT = 5
const MAX_LIMIT = 10
const MAX_QUERY_LENGTH = 100
const MAX_LANGUAGE_CODE_LENGTH = 20
const EXCERPT_LENGTH = 200

export interface SearchArticlesInput {
  query: string
  languageCode?: string
  limit: number
}

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
  requiresApproval: false,
  idempotent: true,
  risk: { level: 'low', sideEffect: 'none', network: false },
}

@Injectable()
export class SearchArticlesTool implements ToolExecutor<SearchArticlesInput, SearchArticlesOutput> {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
  ) {}

  async execute(
    invocation: ValidatedToolInvocation<SearchArticlesInput>,
  ) {
    const { languageCode, limit, query } = invocation.input
    const where: Prisma.ArticleWhereInput = {
      ...(languageCode ? { languageCode } : {}),
      OR: [
        { title: { contains: query, mode: 'insensitive' } },
        { slug: { contains: query, mode: 'insensitive' } },
        { seoTitle: { contains: query, mode: 'insensitive' } },
        { seoDescription: { contains: query, mode: 'insensitive' } },
        { content: { contains: query, mode: 'insensitive' } },
      ],
    }

    const [total, records] = await Promise.all([
      this.prismaService.article.count({ where }),
      this.prismaService.article.findMany({
        where,
        select: {
          sourceId: true,
          slug: true,
          languageCode: true,
          title: true,
          seoTitle: true,
          seoDescription: true,
          content: true,
        },
        orderBy: [
          { updatedAt: 'desc' },
          { sourceId: 'asc' },
        ],
        take: limit,
      }),
    ])
    const articles = records.map(({ content, ...article }) => ({
      ...article,
      excerpt: toExcerpt(content),
    }))
    const data: SearchArticlesOutput = {
      query,
      ...(languageCode ? { languageCode } : {}),
      total,
      articles,
    }

    return {
      ok: true as const,
      data,
      modelContent: articles.length === 0
        ? `没有找到与“${query}”匹配的文章。`
        : `共找到 ${total} 篇匹配文章，以下是 ${articles.length} 条精简结果：\n${JSON.stringify(articles)}`,
    }
  }
}

function parseSearchArticlesInput(value: unknown): SearchArticlesInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('invalid search_articles input')

  const record = value as Record<string, unknown>
  const allowedKeys = new Set(['query', 'languageCode', 'limit'])

  if (Object.keys(record).some(key => !allowedKeys.has(key)))
    throw new Error('invalid search_articles input')

  if (typeof record.query !== 'string')
    throw new Error('invalid search_articles query')

  const query = record.query.trim()

  if (query.length === 0 || query.length > MAX_QUERY_LENGTH)
    throw new Error('invalid search_articles query')

  let languageCode: string | undefined

  if (Object.hasOwn(record, 'languageCode')) {
    if (typeof record.languageCode !== 'string')
      throw new Error('invalid search_articles languageCode')

    languageCode = record.languageCode.trim().toLowerCase()

    if (languageCode.length === 0 || languageCode.length > MAX_LANGUAGE_CODE_LENGTH)
      throw new Error('invalid search_articles languageCode')
  }

  let limit = DEFAULT_LIMIT

  if (Object.hasOwn(record, 'limit')) {
    if (
      typeof record.limit !== 'number'
      || !Number.isInteger(record.limit)
      || record.limit < 1
      || record.limit > MAX_LIMIT
    ) {
      throw new Error('invalid search_articles limit')
    }

    limit = record.limit
  }

  return {
    query,
    ...(languageCode ? { languageCode } : {}),
    limit,
  }
}

function toExcerpt(content: string): string {
  const plainText = content
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return [...plainText].slice(0, EXCERPT_LENGTH).join('')
}
