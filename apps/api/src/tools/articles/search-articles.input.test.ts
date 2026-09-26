import assert from 'node:assert/strict'
// 项目本轮使用 Node 原生测试运行器，不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import {
  parseSearchArticlesInput,
  toArticleExcerpt,
} from './search-articles.tool.js'

describe('search_articles 输入规范化与摘录', () => {
  it('使用唯一规则规范化 query、languageCode 和 limit', () => {
    assert.deepEqual(
      parseSearchArticlesInput({
        query: '  Alpha%_\\  ',
        languageCode: ' ZH-CN ',
        limit: 10,
      }),
      {
        query: 'Alpha%_\\',
        languageCode: 'zh-cn',
        limit: 10,
      },
    )
    assert.deepEqual(
      parseSearchArticlesInput({ query: 'seo' }),
      { query: 'seo', limit: 5 },
    )
  })

  it('拒绝非法查询、语言、limit 和额外字段', () => {
    const invalidInputs = [
      null,
      [],
      {},
      { query: '   ' },
      { query: 'x'.repeat(101) },
      { query: 'seo', languageCode: '   ' },
      { query: 'seo', languageCode: 'x'.repeat(21) },
      { query: 'seo', limit: 0 },
      { query: 'seo', limit: 11 },
      { query: 'seo', limit: 1.5 },
      { query: 'seo', extra: true },
    ]

    for (const input of invalidInputs) {
      assert.throws(
        () => parseSearchArticlesInput(input),
        /invalid search_articles/,
      )
    }
  })

  it('同一规范化函数可直接复核已规范化的 query', () => {
    const query = parseSearchArticlesInput({
      query: '  seo  ',
      languageCode: ' EN ',
    })

    assert.deepEqual(parseSearchArticlesInput(query), query)
  })

  it('生成不含 HTML、压缩空白且 Unicode-safe 的 500 字符 excerpt', () => {
    const excerpt = toArticleExcerpt(
      `<article><h1> 标题 </h1><p>${'内容 🚀\n'.repeat(200)}</p></article>`,
    )

    assert.equal([...excerpt].length, 500)
    assert.doesNotMatch(excerpt, /<article>|<h1>|<p>|\n/)
    assert.doesNotMatch(excerpt, /\s{2,}/)
    assert.ok(excerpt.includes('🚀'), 'excerpt.includes(\'🚀\')')
  })
})
