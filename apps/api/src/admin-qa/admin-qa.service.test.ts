import type { PrismaService } from '../prisma/prisma.service.js'
import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，不为 Admin 查询引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { NotFoundException } from '@nestjs/common'

import {
  AdminQaService,
  QA_LANGUAGE_TOTAL,
  sanitizeArticlePreviewHtml,
  scoreByLengthRatio,
  stripHtmlToText,
} from './admin-qa.service.js'

describe('AdminQaService', () => {
  it('文章列表默认分页并映射语言完整度与候选标记', async () => {
    const harness = createHarness()

    const response = await harness.service.listArticles({})

    assert.equal(harness.calls.articleFindMany[0]?.skip, 0)
    assert.equal(harness.calls.articleFindMany[0]?.take, 20)
    assert.deepEqual(response.items[0], {
      id: 'article-1',
      sourceId: 1642,
      slug: 'demo-guide',
      title: '演示文章',
      translatedLanguageCount: 18,
      languageTotal: QA_LANGUAGE_TOTAL,
      termHitCount: 74,
      isQaCandidate: true,
      isPublished: true,
      publishedAt: '2026-08-14T10:23:04.000Z',
    })
    assert.deepEqual(response.pagination, {
      page: 1,
      pageSize: 20,
      totalItems: 1,
      totalPages: 1,
    })
  })

  it('文章列表筛选语义：search 走标题模糊，qaCandidateOnly / publishedOnly 精确过滤', async () => {
    const harness = createHarness()

    await harness.service.listArticles({
      search: '原神',
      qaCandidateOnly: true,
      publishedOnly: true,
      page: 3,
      pageSize: 10,
    })

    assert.deepEqual(harness.calls.articleFindMany[0]?.where, {
      title: { contains: '原神', mode: 'insensitive' },
      isQaCandidate: true,
      isPublished: true,
    })
    assert.equal(harness.calls.articleFindMany[0]?.skip, 20)
    assert.equal(harness.calls.articleFindMany[0]?.take, 10)
  })

  it('词条列表按目标语言投影源文本与译文，zh 精确命中优先于 zh 变体', async () => {
    const harness = createHarness()

    const response = await harness.service.listGlossaryTerms(3, { targetLanguage: 'FR' })

    assert.equal(response.targetLanguage, 'fr')
    assert.deepEqual(response.availableLanguages, ['en', 'fr'])
    assert.deepEqual(response.items[0], {
      termId: 11,
      isActive: true,
      sourceText: '原神',
      targetText: 'Genshin Impact FR',
    })
    // 无目标语言译文的词条 targetText 为 null
    assert.equal(response.items[1]?.targetText, null)
    assert.equal(response.items[1]?.sourceText, '幻塔')
  })

  it('术语库不存在时抛出 NotFoundException', async () => {
    const harness = createHarness({ glossary: null })

    await assert.rejects(
      harness.service.listGlossaryTerms(999, {}),
      NotFoundException,
    )
  })

  it('长度比规则按三档分带，零长度原文归为 REJECT', () => {
    assert.deepEqual(scoreByLengthRatio(1000, 1500), { lengthRatio: 1.5, ruleScore: 90, verdict: 'PASS' })
    assert.deepEqual(scoreByLengthRatio(1000, 500), { lengthRatio: 0.5, ruleScore: 60, verdict: 'REVIEW' })
    assert.deepEqual(scoreByLengthRatio(1000, 100), { lengthRatio: 0.1, ruleScore: 25, verdict: 'REJECT' })
    assert.equal(scoreByLengthRatio(0, 100).verdict, 'REJECT')
  })

  it('stripHtmlToText 剥离标签并保留块级换行', () => {
    const text = stripHtmlToText('<h1>标题</h1><p>第一段&nbsp;A&amp;B</p><p>第二段</p>')
    assert.equal(text, '标题\n第一段 A&B\n第二段')
  })

  it('正文预览只保留无属性的排版标签', () => {
    const html = sanitizeArticlePreviewHtml(
      '<section><h2 onclick="alert(1)">标题</h2><p>正文 <strong style="color:red">重点</strong><a href="javascript:alert(1)">链接</a><script>alert(1)</script></p></section>',
    )

    assert.equal(html, '<h2>标题</h2><p>正文 <strong>重点</strong>链接</p>')
  })

  it('打分 upsert 只覆盖规则字段，不触碰审核状态', async () => {
    const harness = createHarness()

    const result = await harness.service.scoreTranslation('article-1', 'en')

    const upsert = harness.calls.scoreUpsert[0] as {
      update: Record<string, unknown>
    }
    assert.deepEqual(
      Object.keys(upsert.update).sort(),
      ['lengthRatio', 'ruleScore', 'scoredAt', 'verdict'],
    )
    assert.equal(result.score.verdict, 'PASS')
    assert.equal(result.score.reviewStatus, 'PENDING')
  })

  it('未打分的译文审核时抛出 BadRequestException', async () => {
    const harness = createHarness({ translationScore: null })

    await assert.rejects(
      harness.service.reviewTranslation('article-1', 'en', { decision: 'APPROVED' }),
      /先打分/,
    )
  })

  it('审核成功写入决定与理由，后续不传理由时保留已有值', async () => {
    const harness = createHarness()

    await harness.service.reviewTranslation('article-1', 'en', {
      decision: 'REJECTED',
      note: '  术语误译  ',
    })
    await harness.service.reviewTranslation('article-1', 'en', { decision: 'APPROVED' })

    assert.equal(harness.calls.scoreUpdate[0]?.data.reviewStatus, 'REJECTED')
    assert.equal(harness.calls.scoreUpdate[0]?.data.reviewNote, '术语误译')
    assert.equal(harness.calls.scoreUpdate[1]?.data.reviewStatus, 'APPROVED')
    assert.equal('reviewNote' in (harness.calls.scoreUpdate[1]?.data ?? {}), false)
  })

  it('同语种已有 PENDING 任务时幂等返回，不重复创建', async () => {
    const harness = createHarness({ pendingTask: { id: 'task-1', status: 'PENDING' } })

    const result = await harness.service.requestTranslation('article-1', 'fr')

    assert.equal(result.alreadyQueued, true)
    assert.equal(result.taskId, 'task-1')
    assert.equal(harness.calls.taskCreate.length, 0)
  })

  it('并发创建命中 P2002 时回读既有 PENDING 任务', async () => {
    const conflict = Object.assign(new Error('unique conflict'), { code: 'P2002' })
    const harness = createHarness({
      pendingTasks: [null, { id: 'task-raced', status: 'PENDING' }],
      taskCreateError: conflict,
    })

    const result = await harness.service.requestTranslation('article-1', 'fr')

    assert.equal(result.alreadyQueued, true)
    assert.equal(result.taskId, 'task-raced')
  })

  it('不存在的目标语种拒绝创建翻译任务', async () => {
    const harness = createHarness({ targetLanguageExists: false })

    await assert.rejects(
      harness.service.requestTranslation('article-1', 'zz'),
      NotFoundException,
    )
    assert.equal(harness.calls.taskCreate.length, 0)
  })
})

interface HarnessOverrides {
  glossary?: { id: number, name: string } | null
  translationScore?: { id: string } | null
  pendingTask?: { id: string, status: string } | null
  pendingTasks?: Array<{ id: string, status: string } | null>
  taskCreateError?: Error
  targetLanguageExists?: boolean
}

function createHarness(overrides: HarnessOverrides = {}) {
  const calls = {
    articleFindMany: [] as Array<Record<string, unknown>>,
    termFindMany: [] as Array<Record<string, unknown>>,
    scoreUpsert: [] as Array<Record<string, unknown>>,
    scoreUpdate: [] as Array<{ data: Record<string, unknown> }>,
    taskCreate: [] as Array<Record<string, unknown>>,
  }
  let taskFindFirstIndex = 0

  const prisma = {
    article: {
      findMany: async (args: Record<string, unknown>) => {
        calls.articleFindMany.push(args)
        return [{
          id: 'article-1',
          sourceId: 1642,
          slug: 'demo-guide',
          title: '演示文章',
          termHitCount: 74,
          isQaCandidate: true,
          isPublished: true,
          publishedAt: new Date('2026-08-14T10:23:04.000Z'),
          _count: { translations: 18 },
        }]
      },
      count: async () => 1,
      findUnique: async () => ({ id: 'article-1' }),
    },
    articleTranslation: {
      findUnique: async () => ({
        id: 'translation-1',
        languageCode: 'en',
        content: '<p>hello world translated content</p>',
        article: { content: `<p>${'原'.repeat(20)}</p>` },
        score: overrides.translationScore !== undefined
          ? overrides.translationScore
          : { id: 'score-1' },
      }),
      findFirst: async () => (
        overrides.targetLanguageExists === false ? null : { languageCode: 'fr' }
      ),
      groupBy: async () => [],
    },
    translationScore: {
      upsert: async (args: Record<string, unknown>) => {
        calls.scoreUpsert.push(args)
        const create = args.create as Record<string, unknown>
        return {
          ruleScore: create.ruleScore,
          judgeScore: null,
          lengthRatio: create.lengthRatio,
          verdict: create.verdict,
          reviewStatus: 'PENDING',
          reviewNote: null,
          scoredAt: new Date('2026-08-29T08:00:00.000Z'),
          reviewedAt: null,
        }
      },
      update: async (args: { data: Record<string, unknown> }) => {
        calls.scoreUpdate.push(args)
        return {
          ruleScore: 90,
          judgeScore: null,
          lengthRatio: 1.5,
          verdict: 'PASS',
          reviewStatus: args.data.reviewStatus,
          reviewNote: args.data.reviewNote ?? null,
          scoredAt: new Date('2026-08-29T08:00:00.000Z'),
          reviewedAt: new Date('2026-08-29T08:05:00.000Z'),
        }
      },
    },
    translationTask: {
      findFirst: async () => {
        if (overrides.pendingTasks)
          return overrides.pendingTasks[taskFindFirstIndex++] ?? null
        return overrides.pendingTask ?? null
      },
      create: async (args: Record<string, unknown>) => {
        calls.taskCreate.push(args)
        if (overrides.taskCreateError)
          throw overrides.taskCreateError
        return { id: 'task-new', status: 'PENDING' }
      },
    },
    glossary: {
      findMany: async () => [],
      findUnique: async () => (
        overrides.glossary !== undefined
          ? overrides.glossary
          : { id: 3, name: '游戏术语' }
      ),
    },
    glossaryTerm: {
      findMany: async (args: Record<string, unknown>) => {
        calls.termFindMany.push(args)
        return [
          {
            id: 11,
            isActive: true,
            translations: [
              { languageCode: 'zh-hk', text: '原神（港）' },
              { languageCode: 'zh', text: '原神' },
              { languageCode: 'fr', text: 'Genshin Impact FR' },
            ],
          },
          {
            id: 12,
            isActive: true,
            translations: [
              { languageCode: 'zh', text: '幻塔' },
            ],
          },
        ]
      },
      count: async () => 2,
    },
    glossaryTermTranslation: {
      groupBy: async () => [
        { glossaryId: 3, languageCode: 'zh' },
        { glossaryId: 3, languageCode: 'en' },
        { glossaryId: 3, languageCode: 'fr' },
      ],
    },
  } as unknown as PrismaService

  return { calls, service: new AdminQaService(prisma) }
}
