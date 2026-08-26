import type { Prisma } from '../../generated/prisma/client.js'
import type {
  ArticleRetrievalInput,
  ArticleRetrievalResult,
  ArticleRetriever,
  DatabaseArticleRetrievalExecutionContext,
} from '../article-retrieval.js'
import { Inject, Injectable } from '@nestjs/common'

import { PrismaService } from '../../prisma/prisma.service.js'
import {
  normalizeArticleRetrievalInput,
  toArticleExcerpt,
} from '../article-retrieval.js'

export const PRISMA_LEXICAL_STRATEGY = {
  name: 'prisma_lexical',
  version: '1',
} as const

@Injectable()
export class PrismaArticleRetriever implements ArticleRetriever<DatabaseArticleRetrievalExecutionContext> {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
  ) {}

  async retrieve(
    input: ArticleRetrievalInput,
    context: DatabaseArticleRetrievalExecutionContext,
  ): Promise<ArticleRetrievalResult> {
    context.signal.throwIfAborted()

    const query = normalizeArticleRetrievalInput(input)

    const queryPattern = query.query.replace(/[\\%_]/g, '\\$&')
    const where: Prisma.ArticleWhereInput = {
      ...(query.languageCode ? { languageCode: query.languageCode } : {}),
      OR: [
        { title: { contains: queryPattern, mode: 'insensitive' } },
        { slug: { contains: queryPattern, mode: 'insensitive' } },
        { seoTitle: { contains: queryPattern, mode: 'insensitive' } },
        { seoDescription: { contains: queryPattern, mode: 'insensitive' } },
        { content: { contains: queryPattern, mode: 'insensitive' } },
      ],
    }

    const { total, records } = await this.prismaService.withDeadlineTransaction(
      context.databaseDeadline,
      async (transaction) => {
        context.signal.throwIfAborted()
        const total = await transaction.execute(prisma =>
          prisma.article.count({ where }))

        context.signal.throwIfAborted()
        const records = await transaction.execute(prisma =>
          prisma.article.findMany({
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
            take: query.limit,
          }))

        context.signal.throwIfAborted()
        return { total, records }
      },
    )

    context.signal.throwIfAborted()

    return {
      query,
      strategy: PRISMA_LEXICAL_STRATEGY,
      total,
      hits: records.map(({ content, ...record }, index) => ({
        ...record,
        excerpt: toArticleExcerpt(content),
        rank: index + 1,
      })),
    }
  }
}
