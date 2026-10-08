import assert from 'node:assert/strict'
import { it } from 'vitest'
import { renderConversationMarkdown } from './conversation-markdown'

it('中文强调、基本 Markdown 与空内容', () => {
  const html = renderConversationMarkdown('# 标题\n\n**结论：**后文\n\n- 项目\n\n1. 步骤\n\n> 引用\n\n`code`\n\n```ts\nconst n = 1\n```\n\n| 字段 | 值 |\n| --- | --- |\n| a | b |')
  for (const tag of ['h1', 'strong', 'ul', 'ol', 'blockquote', 'code', 'pre', 'table'])
    assert.match(html, new RegExp(`<${tag}(?:>| )`))
  assert.match(html, /<strong>结论：<\/strong>后文/)
  assert.equal(renderConversationMarkdown(''), '')
})

it('HTML 和代码内的脚本只显示原文，不产生可执行节点', () => {
  const html = renderConversationMarkdown('<script>alert(1)</script>\n<img src="https://leak.invalid" onerror="alert(1)">\n\n```html\n<script>alert(2)</script>\n```')
  assert.doesNotMatch(html, /<(?:script|img)\b/)
  assert.match(html, /&lt;script&gt;/)
})

it('危险协议及其大小写、实体混淆不生成可点击链接', () => {
  for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'javascript&#58;alert(1)', 'vbscript:msgbox(1)', 'file:///etc/passwd', 'data:text/html,test', 'data:image/png;base64,AAAA']) {
    const html = renderConversationMarkdown(`[危险](${url})\n\n![图片](${url})`)
    assert.doesNotMatch(html, /<(?:a|img)\b/)
  }
})

it('图片转为安全链接、不嵌套链接、转义 alt 与地址，空地址只显示文字', () => {
  const html = renderConversationMarkdown('![<危险>](https://leak.invalid/a?q=%22&b=2)\n\n[![内层](https://leak.invalid/b)](https://example.com)\n\n![空]()')
  assert.doesNotMatch(html, /<img\b/)
  assert.equal((html.match(/<a /g) ?? []).length, 2)
  assert.equal((html.match(/target="_blank" rel="noreferrer noopener"/g) ?? []).length, 2)
  assert.match(html, /&lt;危险&gt;/)
  assert.match(html, /&amp;b=2/)
  assert.doesNotMatch(html, /href="https:\/\/leak.invalid\/b"|href=""/)
  assert.match(html, />内层<\/a>/)
  assert.match(html, /<p>空<\/p>/)
})

it('显式、引用与自动链接均具备外链安全属性', () => {
  const html = renderConversationMarkdown('[链接](https://example.com)\n\n[引用][ref]\n\nhttps://example.org\n\n[ref]: https://example.net')
  assert.equal((html.match(/target="_blank" rel="noreferrer noopener"/g) ?? []).length, 3)
})
