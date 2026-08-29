/**
 * 翻译质检站快照导入（Issue #109，一次性、幂等）。
 *
 * 用法（在 apps/api 目录，沿用项目 CLI 的 env-file 约定）：
 *   node --import tsx --env-file-if-exists=../../.env scripts/import-qa-snapshot.ts [快照目录]
 * 默认快照目录：data/snapshots/2026-08-29
 *
 * 行为：
 * 1. 清空旧 Article 体系数据（chunks / indexState / translations / scores / articles）与术语库；
 * 2. 从快照导入文章（元数据 + 中文原文）、候选译文、术语库全量、术语命中数；
 * 3. 输出导入统计，供与 Issue 验收标准对账。
 *
 * 脚本只在本地开发库执行，可重复运行（先清后导，结果一致）。
 */
import { createReadStream } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { createInterface } from 'node:readline'
import { createGunzip } from 'node:zlib'
import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '../src/generated/prisma/client.js'

const SNAPSHOT_DIR = process.argv[2] ?? path.resolve(process.cwd(), '../../data/snapshots/2026-08-29')
const CREATE_CHUNK_SIZE = 1000

interface SnapshotArticleMeta {
  id: number
  category_id: number | null
  slug: string
  is_published: number
  published_at: string | null
  view_count: number
  created_at: string | null
  updated_at: string | null
}

interface SnapshotTranslation {
  id: number
  article_id: number
  language_code: string
  title: string
  summary: string | null
  content: string
  meta_title: string | null
  meta_description: string | null
  updated_at?: string | null
}

interface SnapshotGlossary {
  id: number
  name: string
  description: string | null
  is_active: number
  revision: number
}

interface SnapshotGlossaryTerm {
  id: number
  translation_glossary_id: number
  is_active: number
}

interface SnapshotTermTranslation {
  id: number
  translation_glossary_id: number
  translation_glossary_term_id: number
  language_code: string
  text: string
}

async function readJsonl<T>(file: string): Promise<T[]> {
  const rows: T[] = []
  const rl = createInterface({
    input: createReadStream(path.join(SNAPSHOT_DIR, file)).pipe(createGunzip()),
  })
  for await (const line of rl) {
    if (line.trim())
      rows.push(JSON.parse(line) as T)
  }
  return rows
}

function toDate(value: string | null | undefined): Date | null {
  if (!value)
    return null
  // 快照时间为生产库（Asia/Shanghai）墙钟时间，显式固定 +08:00，
  // 避免在其他时区机器上导入产生偏移
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
    ? `${value.replace(' ', 'T')}+08:00`
    : value.replace(' ', 'T')
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

async function main() {
  const connectionString = process.env.DATABASE_URL?.trim()
  if (!connectionString)
    throw new Error('未找到 DATABASE_URL；请按脚本头部用法通过 --env-file-if-exists 加载 .env')
  const schema = new URL(connectionString).searchParams.get('schema')?.trim()
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString }, schema ? { schema } : undefined),
  })
  try {
    console.log(`快照目录：${SNAPSHOT_DIR}`)

    const [metas, zhOriginals, translations, glossaries, terms, termTranslations] = await Promise.all([
      readJsonl<SnapshotArticleMeta>('articles_meta.jsonl.gz'),
      readJsonl<SnapshotTranslation>('zh_originals.jsonl.gz'),
      readJsonl<SnapshotTranslation>('candidate_translations.jsonl.gz'),
      readJsonl<SnapshotGlossary>('glossaries.jsonl.gz'),
      readJsonl<SnapshotGlossaryTerm>('glossary_terms.jsonl.gz'),
      readJsonl<SnapshotTermTranslation>('glossary_term_translations.jsonl.gz'),
    ])
    const candidates = JSON.parse(
      await readFile(path.join(SNAPSHOT_DIR, 'candidates.json'), 'utf8'),
    ) as { top150: Array<{ articleId: number, termHits: number }> }
    const termHitsBySourceId = new Map(candidates.top150.map(c => [c.articleId, c.termHits]))

    // 1. 清空旧数据（FK 顺序：子表先删；ArticleChunk/IndexState/Translation 均 onDelete: Cascade，
    //    但显式删除让统计更直白）
    console.log('清空旧数据……')
    await prisma.$transaction([
      prisma.translationScore.deleteMany(),
      prisma.articleTranslation.deleteMany(),
      prisma.articleChunk.deleteMany(),
      prisma.articleIndexState.deleteMany(),
      prisma.article.deleteMany(),
      prisma.glossaryTermTranslation.deleteMany(),
      prisma.glossaryTerm.deleteMany(),
      prisma.glossary.deleteMany(),
    ])

    // 2. 文章：优先 language_code === 'zh' 的原文行，缺失时回退任一 zh* 变体
    const zhByArticle = new Map<number, SnapshotTranslation>()
    for (const row of zhOriginals) {
      const prev = zhByArticle.get(row.article_id)
      if (!prev || (row.language_code === 'zh' && prev.language_code !== 'zh'))
        zhByArticle.set(row.article_id, row)
    }

    const seenSlugs = new Set<string>()
    let skippedNoZhOriginal = 0
    let skippedInvalidOrDuplicateSlug = 0
    const articleRows = metas.flatMap((meta) => {
      const zh = zhByArticle.get(meta.id)
      if (!zh) {
        skippedNoZhOriginal++
        return []
      }
      if (!meta.slug || seenSlugs.has(meta.slug)) {
        skippedInvalidOrDuplicateSlug++
        return []
      }
      seenSlugs.add(meta.slug)
      return [{
        sourceId: meta.id,
        slug: meta.slug,
        languageCode: zh.language_code,
        title: zh.title,
        summary: zh.summary,
        content: zh.content,
        seoTitle: zh.meta_title,
        seoDescription: zh.meta_description,
        isPublished: Boolean(meta.is_published),
        publishedAt: toDate(meta.published_at),
        isQaCandidate: termHitsBySourceId.has(meta.id),
        termHitCount: termHitsBySourceId.get(meta.id) ?? null,
      }]
    })

    for (let i = 0; i < articleRows.length; i += CREATE_CHUNK_SIZE)
      await prisma.article.createMany({ data: articleRows.slice(i, i + CREATE_CHUNK_SIZE) })

    const articleIdBySourceId = new Map(
      (await prisma.article.findMany({ select: { id: true, sourceId: true } }))
        .map(a => [a.sourceId, a.id]),
    )

    // 3. 候选译文（快照含 zh 变体行，全部导入；文章原文行与译文行按语言码天然区分）
    const translationRows = translations.flatMap((row) => {
      const articleId = articleIdBySourceId.get(row.article_id)
      if (!articleId)
        return []
      return [{
        sourceId: row.id,
        articleId,
        languageCode: row.language_code,
        title: row.title,
        summary: row.summary,
        content: row.content,
        metaTitle: row.meta_title,
        metaDescription: row.meta_description,
        sourceUpdatedAt: toDate(row.updated_at),
      }]
    })
    for (let i = 0; i < translationRows.length; i += CREATE_CHUNK_SIZE)
      await prisma.articleTranslation.createMany({ data: translationRows.slice(i, i + CREATE_CHUNK_SIZE) })

    // 4. 术语库全量
    await prisma.glossary.createMany({
      data: glossaries.map(g => ({
        id: g.id,
        name: g.name,
        description: g.description,
        isActive: Boolean(g.is_active),
        revision: g.revision,
      })),
    })
    for (let i = 0; i < terms.length; i += CREATE_CHUNK_SIZE) {
      await prisma.glossaryTerm.createMany({
        data: terms.slice(i, i + CREATE_CHUNK_SIZE).map(t => ({
          id: t.id,
          glossaryId: t.translation_glossary_id,
          isActive: Boolean(t.is_active),
        })),
      })
    }
    for (let i = 0; i < termTranslations.length; i += CREATE_CHUNK_SIZE) {
      await prisma.glossaryTermTranslation.createMany({
        data: termTranslations.slice(i, i + CREATE_CHUNK_SIZE).map(tt => ({
          id: tt.id,
          glossaryId: tt.translation_glossary_id,
          termId: tt.translation_glossary_term_id,
          languageCode: tt.language_code,
          text: tt.text,
        })),
      })
    }

    // 5. 对账统计
    const stats = {
      articles: await prisma.article.count(),
      qaCandidates: await prisma.article.count({ where: { isQaCandidate: true } }),
      articleTranslations: await prisma.articleTranslation.count(),
      glossaries: await prisma.glossary.count(),
      glossaryTerms: await prisma.glossaryTerm.count(),
      glossaryTermTranslations: await prisma.glossaryTermTranslation.count(),
      skippedNoZhOriginal,
      skippedInvalidOrDuplicateSlug,
    }
    console.log(JSON.stringify(stats, null, 2))
  }
  finally {
    await prisma.$disconnect()
  }
}

main().catch((error) => {
  console.error('导入失败：', error)
  process.exitCode = 1
})
