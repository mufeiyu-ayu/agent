import type {
  QaArticleDetail,
  QaArticleListResponse,
  QaDiagnoseResponse,
  QaGlossaryListResponse,
  QaGlossaryTermListResponse,
  QaReviewRequest,
  QaScoreResult,
  QaTranslateTaskResponse,
  QaTranslationDetail,
  QaTranslationScore,
} from '@agent/contracts'
import type {
  ListQaArticlesQueryDto,
  ListQaGlossaryTermsQueryDto,
} from './dto/admin-qa.dto.js'
import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { load } from 'cheerio'

import { PrismaService } from '../prisma/prisma.service.js'

const DEFAULT_PAGE = 1
const DEFAULT_PAGE_SIZE = 20
/** 生产快照的语言总数口径；本地未导入全量译文时仍以此为完整度分母 */
export const QA_LANGUAGE_TOTAL = 19
/** 词条页默认目标语言 */
const DEFAULT_TARGET_LANGUAGE = 'en'

// ponytail: 长度比为全局 naive 带，不区分语言族（CJK 目标语的合理比值更接近 1）；
// A-3 规则打分器扩展时按语言族校准阈值。
const LENGTH_RATIO_PASS_MIN = 0.7
const LENGTH_RATIO_PASS_MAX = 3.0
const LENGTH_RATIO_REVIEW_MIN = 0.4
const LENGTH_RATIO_REVIEW_MAX = 4.5

const ARTICLE_PREVIEW_ELEMENTS = new Set([
  'b',
  'blockquote',
  'br',
  'code',
  'del',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'li',
  'mark',
  'ol',
  'p',
  'pre',
  's',
  'strong',
  'sub',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
])

const ARTICLE_PREVIEW_DROPPED_ELEMENTS = [
  'audio',
  'button',
  'canvas',
  'embed',
  'form',
  'head',
  'iframe',
  'input',
  'link',
  'math',
  'meta',
  'noscript',
  'object',
  'script',
  'select',
  'style',
  'svg',
  'template',
  'textarea',
  'video',
].join(',')

export function stripHtmlToText(html: string): string {
  return html
    .replace(/<(?:br|\/p|\/h[1-6]|\/li|\/tr|\/div)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, '\'')
    // &amp; 必须最后解码，避免 &amp;lt; 这类转义文本被二次解码
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** 只保留预览排版所需标签；属性全部移除，其他容器仅保留文本内容。 */
export function sanitizeArticlePreviewHtml(html: string): string {
  const $ = load(html, {}, false)

  $(ARTICLE_PREVIEW_DROPPED_ELEMENTS).remove()
  $('*').each((_index, element) => {
    if (element.type !== 'tag')
      return
    if (!ARTICLE_PREVIEW_ELEMENTS.has(element.name)) {
      $(element).replaceWith($(element).contents())
      return
    }
    for (const attribute of Object.keys(element.attribs))
      $(element).removeAttr(attribute)
  })

  return $.html().trim()
}

/** 最小真规则：按长度比给 verdict 三档与 0-100 的 ruleScore */
export function scoreByLengthRatio(originalChars: number, translationChars: number): {
  lengthRatio: number
  ruleScore: number
  verdict: 'PASS' | 'REVIEW' | 'REJECT'
} {
  const lengthRatio = originalChars === 0
    ? 0
    : Number((translationChars / originalChars).toFixed(3))

  if (lengthRatio >= LENGTH_RATIO_PASS_MIN && lengthRatio <= LENGTH_RATIO_PASS_MAX)
    return { lengthRatio, ruleScore: 90, verdict: 'PASS' }
  if (lengthRatio >= LENGTH_RATIO_REVIEW_MIN && lengthRatio <= LENGTH_RATIO_REVIEW_MAX)
    return { lengthRatio, ruleScore: 60, verdict: 'REVIEW' }
  return { lengthRatio, ruleScore: 25, verdict: 'REJECT' }
}

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

  async getArticleDetail(articleId: string): Promise<QaArticleDetail> {
    const [article, knownLanguages] = await Promise.all([this.prismaService.article.findUnique({
      where: { id: articleId },
      select: {
        id: true,
        sourceId: true,
        slug: true,
        title: true,
        summary: true,
        content: true,
        isPublished: true,
        publishedAt: true,
        isQaCandidate: true,
        termHitCount: true,
        translations: {
          orderBy: { languageCode: 'asc' },
          select: {
            languageCode: true,
            title: true,
            score: {
              select: { verdict: true, reviewStatus: true },
            },
          },
        },
        translationTasks: {
          where: { status: 'PENDING' },
          select: { languageCode: true },
        },
      },
    }), this.prismaService.articleTranslation.groupBy({
      by: ['languageCode'],
    })])
    if (!article)
      throw new NotFoundException('文章不存在')

    const pendingLanguages = new Set(article.translationTasks.map(task => task.languageCode))
    const translatedLanguages = new Set(article.translations.map(t => t.languageCode))
    // 缺失语种 = 全库出现过的语种 - 该文章已有语种（zh* 原文语种除外）
    const missingLanguages = knownLanguages
      .map(group => group.languageCode)
      .filter(code => !code.startsWith('zh') && !translatedLanguages.has(code))
      .sort()

    return {
      id: article.id,
      sourceId: article.sourceId,
      slug: article.slug,
      title: article.title,
      summary: article.summary,
      contentHtml: sanitizeArticlePreviewHtml(article.content),
      isPublished: article.isPublished,
      publishedAt: article.publishedAt?.toISOString() ?? null,
      isQaCandidate: article.isQaCandidate,
      termHitCount: article.termHitCount,
      languageTotal: QA_LANGUAGE_TOTAL,
      translations: article.translations
        .filter(t => !t.languageCode.startsWith('zh'))
        .map(t => ({
          languageCode: t.languageCode,
          title: t.title,
          verdict: t.score?.verdict ?? null,
          reviewStatus: t.score?.reviewStatus ?? null,
          hasPendingTask: pendingLanguages.has(t.languageCode),
        })),
      missingLanguages,
      pendingLanguages: missingLanguages.filter(code => pendingLanguages.has(code)),
    }
  }

  async getTranslationDetail(articleId: string, languageCode: string): Promise<QaTranslationDetail> {
    const [translation, pendingTask] = await Promise.all([
      this.findTranslationOrThrow(articleId, languageCode, {
        languageCode: true,
        title: true,
        summary: true,
        content: true,
        metaTitle: true,
        metaDescription: true,
        score: true,
      }),
      this.prismaService.translationTask.findFirst({
        where: { articleId, languageCode, status: 'PENDING' },
        select: { id: true },
      }),
    ])

    return {
      languageCode: translation.languageCode,
      title: translation.title,
      summary: translation.summary,
      contentHtml: sanitizeArticlePreviewHtml(translation.content),
      metaTitle: translation.metaTitle,
      metaDescription: translation.metaDescription,
      score: translation.score ? projectScore(translation.score) : null,
      hasPendingTask: pendingTask !== null,
    }
  }

  async scoreTranslation(articleId: string, languageCode: string): Promise<QaScoreResult> {
    const translation = await this.findTranslationOrThrow(articleId, languageCode, {
      id: true,
      content: true,
      article: { select: { content: true } },
    })

    const originalText = stripHtmlToText(translation.article.content)
    const translationText = stripHtmlToText(translation.content)
    const { lengthRatio, ruleScore, verdict } = scoreByLengthRatio(
      originalText.length,
      translationText.length,
    )

    const score = await this.prismaService.translationScore.upsert({
      where: { translationId: translation.id },
      create: {
        translationId: translation.id,
        ruleScore,
        lengthRatio,
        verdict,
        scoredAt: new Date(),
      },
      // 重新打分只覆盖规则分与 verdict，保留既有审核状态与理由
      update: {
        ruleScore,
        lengthRatio,
        verdict,
        scoredAt: new Date(),
      },
    })

    return { score: projectScore(score) }
  }

  async reviewTranslation(
    articleId: string,
    languageCode: string,
    input: QaReviewRequest,
  ): Promise<QaScoreResult> {
    const translation = await this.findTranslationOrThrow(articleId, languageCode, {
      id: true,
      score: { select: { id: true } },
    })
    if (!translation.score)
      throw new BadRequestException('请先打分再审核（先打分后分流的审核语义）')

    const score = await this.prismaService.translationScore.update({
      where: { translationId: translation.id },
      data: {
        reviewStatus: input.decision,
        reviewedAt: new Date(),
        // 只有显式传入 note 才覆盖；否则保留既有理由（打回理由是打分器校准的学习材料）
        ...(input.note !== undefined ? { reviewNote: input.note.trim() || null } : {}),
      },
    })

    return { score: projectScore(score) }
  }

  async requestTranslation(articleId: string, languageCode: string): Promise<QaTranslateTaskResponse> {
    const [article, targetLanguage] = await Promise.all([
      this.prismaService.article.findUnique({
        where: { id: articleId },
        select: { id: true },
      }),
      languageCode.startsWith('zh')
        ? null
        : this.prismaService.articleTranslation.findFirst({
            where: { languageCode },
            select: { languageCode: true },
          }),
    ])
    if (!article)
      throw new NotFoundException('文章不存在')
    if (!targetLanguage)
      throw new NotFoundException('目标语种不存在')

    // 同文章同语种已有排队任务时幂等返回；并发下由 PENDING 部分唯一索引兜底，
    // 唯一冲突（P2002）时回读既有任务，杜绝 findFirst-then-create 的 TOCTOU 竞态
    const existing = await this.prismaService.translationTask.findFirst({
      where: { articleId, languageCode, status: 'PENDING' },
      select: { id: true, status: true },
    })
    if (existing) {
      return {
        taskId: existing.id,
        languageCode,
        status: existing.status,
        alreadyQueued: true,
      }
    }

    try {
      const task = await this.prismaService.translationTask.create({
        data: { articleId, languageCode },
        select: { id: true, status: true },
      })
      return {
        taskId: task.id,
        languageCode,
        status: task.status,
        alreadyQueued: false,
      }
    }
    catch (error) {
      if ((error as { code?: string }).code !== 'P2002')
        throw error
      const raced = await this.prismaService.translationTask.findFirst({
        where: { articleId, languageCode, status: 'PENDING' },
        select: { id: true, status: true },
      })
      if (!raced)
        throw error
      return {
        taskId: raced.id,
        languageCode,
        status: raced.status,
        alreadyQueued: true,
      }
    }
  }

  // ponytail: 占位实现，不接 LLM、不持久化；阶段 D 由 Agent Runtime + 工具链替换
  async diagnose(articleId: string, question: string): Promise<QaDiagnoseResponse> {
    const article = await this.prismaService.article.findUnique({
      where: { id: articleId },
      select: { title: true },
    })
    if (!article)
      throw new NotFoundException('文章不存在')

    return {
      answer: `诊断能力将在阶段 D 接入 Agent Runtime（工具：gsc_inspect / 质量分 / 检索对照）。`
        + `当前为占位应答——你的问题「${question}」已收到，但《${article.title}》的质量分、审核状态与收录数据尚未关联分析。`,
      mock: true,
    }
  }

  private async findTranslationOrThrow<S extends object>(
    articleId: string,
    languageCode: string,
    select: S,
  ) {
    const translation = await this.prismaService.articleTranslation.findUnique({
      where: { articleId_languageCode: { articleId, languageCode } },
      select,
    })
    if (!translation)
      throw new NotFoundException('该语种译文不存在')
    return translation
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

interface ScoreRow {
  ruleScore: number | null
  judgeScore: number | null
  lengthRatio: number | null
  verdict: 'PASS' | 'REVIEW' | 'REJECT' | null
  reviewStatus: 'PENDING' | 'APPROVED' | 'REJECTED'
  reviewNote: string | null
  scoredAt: Date | null
  reviewedAt: Date | null
}

function projectScore(score: ScoreRow): QaTranslationScore {
  return {
    ruleScore: score.ruleScore,
    judgeScore: score.judgeScore,
    lengthRatio: score.lengthRatio,
    verdict: score.verdict,
    reviewStatus: score.reviewStatus,
    reviewNote: score.reviewNote,
    scoredAt: score.scoredAt?.toISOString() ?? null,
    reviewedAt: score.reviewedAt?.toISOString() ?? null,
  }
}
