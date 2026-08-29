import type {
  QaArticleListResponse,
  QaGlossaryListResponse,
  QaGlossaryTermListResponse,
} from '@agent/contracts'
import type {
  ListQaArticlesQueryDto,
  ListQaGlossaryTermsQueryDto,
} from './dto/admin-qa.dto.js'
import { Inject, Injectable, NotFoundException } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service.js'

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20
/** 生产快照的语言总数口径；本地未导入全量译文时仍以此为完整度分母 */
export const QA_LANGUAGE_TOTAL = 19
/** 词条页默认目标语言 */
const DEFAULT_TARGET_LANGUAGE = 'en'

@Injectable()
export class AdminQaService {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
  ) {}

  async listArticles(input: ListQaArticlesQueryDto): Promise<QaArticleListResponse> {
    const page = input.page ?? DEFAULT_PAGE
    const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE
    const where = {
      ...(input.search
        ? { title: { contains: input.search, mode: 'insensitive' as const } }
        : {}),
      ...(input.qaCandidateOnly ? { isQaCandidate: true } : {}),
      ...(input.publishedOnly ? { isPublished: true } : {}),
    }

    const [articles, totalItems] = await Promise.all([
      this.prismaService.article.findMany({
        where,
        orderBy: [
          { termHitCount: { sort: 'desc', nulls: 'last' } },
          { publishedAt: { sort: 'desc', nulls: 'last' } },
          { sourceId: 'desc' },
        ],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          sourceId: true,
          slug: true,
          title: true,
          termHitCount: true,
          isQaCandidate: true,
          isPublished: true,
          publishedAt: true,
          _count: { select: { translations: true } },
        },
      }),
      this.prismaService.article.count({ where }),
    ])

    return {
      items: articles.map(article => ({
        id: article.id,
        sourceId: article.sourceId,
        slug: article.slug,
        title: article.title,
        translatedLanguageCount: article._count.translations,
        languageTotal: QA_LANGUAGE_TOTAL,
        termHitCount: article.termHitCount,
        isQaCandidate: article.isQaCandidate,
        isPublished: article.isPublished,
        publishedAt: article.publishedAt?.toISOString() ?? null,
      })),
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
      },
    }
  }

  async listGlossaries(): Promise<QaGlossaryListResponse> {
    const glossaries = await this.prismaService.glossary.findMany({
      orderBy: { id: 'asc' },
      select: {
        id: true,
        name: true,
        description: true,
        isActive: true,
        revision: true,
        _count: { select: { terms: true } },
      },
    })

    // 8 本库的语种数一次 groupBy 取齐，避免逐库查询；
    // 排除 zh* 源语种，与词条页目标语言下拉的口径一致
    const languageGroups = await this.prismaService.glossaryTermTranslation.groupBy({
      by: ['glossaryId', 'languageCode'],
    })
    const languageCountByGlossary = new Map<number, number>()
    for (const group of languageGroups) {
      if (group.languageCode.startsWith('zh'))
        continue
      languageCountByGlossary.set(
        group.glossaryId,
        (languageCountByGlossary.get(group.glossaryId) ?? 0) + 1,
      )
    }

    return {
      items: glossaries.map(glossary => ({
        id: glossary.id,
        name: glossary.name,
        description: glossary.description,
        isActive: glossary.isActive,
        revision: glossary.revision,
        termCount: glossary._count.terms,
        languageCount: languageCountByGlossary.get(glossary.id) ?? 0,
      })),
    }
  }

  async listGlossaryTerms(
    glossaryId: number,
    input: ListQaGlossaryTermsQueryDto,
  ): Promise<QaGlossaryTermListResponse> {
    const glossary = await this.prismaService.glossary.findUnique({
      where: { id: glossaryId },
      select: { id: true, name: true },
    })
    if (!glossary)
      throw new NotFoundException('术语库不存在')

    const page = input.page ?? DEFAULT_PAGE
    const pageSize = input.pageSize ?? DEFAULT_PAGE_SIZE

    const languageGroups = await this.prismaService.glossaryTermTranslation.groupBy({
      by: ['languageCode'],
      where: { glossaryId },
    })
    const availableLanguages = languageGroups
      .map(group => group.languageCode)
      .filter(code => !code.startsWith('zh'))
      .sort()
    // 请求语言（或默认 en）在该库无数据时回退到首个可用语种，保证前端下拉与数据一致
    const requestedLanguage = (input.targetLanguage ?? DEFAULT_TARGET_LANGUAGE).toLowerCase()
    const targetLanguage = availableLanguages.includes(requestedLanguage)
      ? requestedLanguage
      : (availableLanguages[0] ?? requestedLanguage)

    // 搜索同时命中中文源文本（含 zh-hk 等变体，与展示口径一致）与目标语言译文
    const searchFilter = input.search
      ? {
          translations: {
            some: {
              OR: [
                { languageCode: { startsWith: 'zh' } },
                { languageCode: targetLanguage },
              ],
              text: { contains: input.search, mode: 'insensitive' as const },
            },
          },
        }
      : {}
    const where = { glossaryId, ...searchFilter }

    const [terms, totalItems] = await Promise.all([
      this.prismaService.glossaryTerm.findMany({
        where,
        orderBy: { id: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          isActive: true,
          translations: {
            where: {
              OR: [
                { languageCode: { startsWith: 'zh' } },
                { languageCode: targetLanguage },
              ],
            },
            select: { languageCode: true, text: true },
          },
        },
      }),
      this.prismaService.glossaryTerm.count({ where }),
    ])

    return {
      glossary,
      targetLanguage,
      availableLanguages,
      items: terms.map((term) => {
        const zhExact = term.translations.find(t => t.languageCode === 'zh')
        const zhVariant = term.translations.find(t => t.languageCode.startsWith('zh'))
        const target = term.translations.find(t => t.languageCode === targetLanguage)
        return {
          termId: term.id,
          isActive: term.isActive,
          sourceText: (zhExact ?? zhVariant)?.text ?? null,
          targetText: target?.text ?? null,
        }
      }),
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages: totalItems === 0 ? 0 : Math.ceil(totalItems / pageSize),
      },
    }
  }
}
