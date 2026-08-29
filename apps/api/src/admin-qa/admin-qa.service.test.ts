import type { PrismaService } from '../prisma/prisma.service.js'
import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，不为 Admin 查询引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { NotFoundException } from '@nestjs/common'

import { AdminQaService, QA_LANGUAGE_TOTAL } from './admin-qa.service.js'

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
})

interface HarnessOverrides {
  glossary?: { id: number, name: string } | null
}

function createHarness(overrides: HarnessOverrides = {}) {
  const calls = {
    articleFindMany: [] as Array<Record<string, unknown>>,
    termFindMany: [] as Array<Record<string, unknown>>,
  }

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
