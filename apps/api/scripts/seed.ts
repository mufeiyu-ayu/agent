import type { Article } from '../src/generated/prisma/client.js'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { PrismaPg } from '@prisma/adapter-pg'

import { PrismaClient } from '../src/generated/prisma/client.js'

type ArticleSeed = Pick<
  Article,
  'content' | 'languageCode' | 'seoDescription' | 'seoTitle' | 'slug' | 'sourceId' | 'title'
>

const connectionString = process.env.DATABASE_URL?.trim()

if (!connectionString)
  throw new Error('请在项目根目录 .env 中设置 DATABASE_URL')

const fixturePath = fileURLToPath(
  new URL('../../../prisma/fixtures/articles.json', import.meta.url),
)
const articles = JSON.parse(await readFile(fixturePath, 'utf8')) as ArticleSeed[]
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })

try {
  for (const article of articles) {
    await prisma.article.upsert({
      where: { sourceId: article.sourceId },
      create: article,
      update: article,
    })
  }

  const importedCount = await prisma.article.count({
    where: { sourceId: { in: articles.map(article => article.sourceId) } },
  })

  if (importedCount !== articles.length)
    throw new Error(`文章 Demo 数据校验失败：预期 ${articles.length} 篇，实际 ${importedCount} 篇`)

  console.log(`已导入并验证 ${importedCount} 篇文章 Demo 数据`)
}
finally {
  await prisma.$disconnect()
}
