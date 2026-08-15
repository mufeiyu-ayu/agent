import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutor,
  ValidatedToolInvocation,
} from '../core/tool.types.js'
import { Inject, Injectable } from '@nestjs/common'

import { PrismaService } from '../../prisma/prisma.service.js'

export interface GetArticleDetailInput {
  sourceId: number
}

export interface ArticleDetail {
  sourceId: number
  slug: string
  languageCode: string
  title: string
  content: string
  seoTitle: string | null
  seoDescription: string | null
  createdAt: string
  updatedAt: string
}

export interface GetArticleDetailOutput {
  sourceId: number
  found: boolean
  article: ArticleDetail | null
}

export const getArticleDetailDefinition: ToolDefinition<GetArticleDetailInput> = {
  name: 'get_article_detail',
  version: '1',
  description: '根据 sourceId 查询单篇文章的完整详情。',
  input: {
    schema: {
      type: 'object',
      properties: {
        sourceId: { type: 'integer', description: '文章来源 ID，必须是大于 0 的整数。' },
      },
      required: ['sourceId'],
      additionalProperties: false,
    },
    parse: parseGetArticleDetailInput,
  },
  timeoutMs: 5_000,
  maxObservationChars: 64_000,
  requiresApproval: false,
  idempotent: true,
  risk: { level: 'low', sideEffect: 'none', network: 'none' },
  // 命中时可以作为 article 粒度证据；not found 属于成功但无证据。
  evidencePolicy: 'eligible',
}

/** Article Detail 只声明整篇文章身份，不伪造 chunk / sectionPath / rank。 */
const ARTICLE_DETAIL_EVIDENCE_STRATEGY = {
  name: 'article_detail',
  version: '1',
} as const

@Injectable()
export class GetArticleDetailTool implements ToolExecutor<
  GetArticleDetailInput,
  GetArticleDetailOutput
> {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
  ) {}

  async execute(
    invocation: ValidatedToolInvocation<GetArticleDetailInput>,
    context: ToolExecutionContext,
  ) {
    context.signal.throwIfAborted()

    const { sourceId } = invocation.input
    const record = await this.prismaService.withDeadlineTransaction(
      context.databaseDeadline,
      async (transaction) => {
        context.signal.throwIfAborted()
        const record = await transaction.execute(prisma =>
          prisma.article.findUnique({
            where: { sourceId },
            select: {
              sourceId: true,
              slug: true,
              languageCode: true,
              title: true,
              content: true,
              seoTitle: true,
              seoDescription: true,
              createdAt: true,
              updatedAt: true,
            },
          }))

        context.signal.throwIfAborted()
        return record
      },
    )

    context.signal.throwIfAborted()

    if (!record) {
      const data: GetArticleDetailOutput = {
        sourceId,
        found: false,
        article: null,
      }

      return {
        ok: true as const,
        data,
        modelContent: JSON.stringify(data),
      }
    }

    const article: ArticleDetail = {
      sourceId: record.sourceId,
      slug: record.slug,
      languageCode: record.languageCode,
      title: record.title,
      content: record.content,
      seoTitle: record.seoTitle,
      seoDescription: record.seoDescription,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    }
    const data: GetArticleDetailOutput = {
      sourceId,
      found: true,
      article,
    }

    return {
      ok: true as const,
      data,
      modelContent: JSON.stringify(data),
      // 只投影可引用的来源身份与展示快照；完整正文留在 Observation，不进 Registry。
      evidence: {
        refs: [{
          sourceId: article.sourceId,
          chunkId: null,
          granularity: 'article' as const,
          title: article.title,
          slug: article.slug,
          languageCode: article.languageCode,
          sectionPath: null,
          excerpt: null,
          rank: null,
          strategy: { ...ARTICLE_DETAIL_EVIDENCE_STRATEGY },
        }],
      },
    }
  }
}

function parseGetArticleDetailInput(value: unknown): GetArticleDetailInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('invalid get_article_detail input')

  const record = value as Record<string, unknown>

  if (
    Object.keys(record).length !== 1
    || !Object.hasOwn(record, 'sourceId')
    || typeof record.sourceId !== 'number'
    || !Number.isInteger(record.sourceId)
    || record.sourceId <= 0
  ) {
    throw new Error('invalid get_article_detail sourceId')
  }

  return { sourceId: record.sourceId }
}
