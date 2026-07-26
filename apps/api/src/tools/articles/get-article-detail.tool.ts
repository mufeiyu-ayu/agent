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
  requiresApproval: false,
  idempotent: true,
  risk: { level: 'low', sideEffect: 'none', network: false },
}

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
    const record = await this.prismaService.article.findUnique({
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
    })

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
