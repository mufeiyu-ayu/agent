import type { RenderMarkdownBlocksOptions } from './markdown-blocks'

import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'

import { highlightCode } from './code-highlighter'
import { renderMarkdownBlocks } from './markdown-blocks'

function blocksOf(text: string, options?: RenderMarkdownBlocksOptions) {
  return renderMarkdownBlocks(text, options).blocks
}

function html(text: string, options?: RenderMarkdownBlocksOptions) {
  return blocksOf(text, options).filter(block => block.type === 'markdown').map(block => block.html).join('')
}

function firstHtml(text: string, options?: RenderMarkdownBlocksOptions) {
  const [block] = blocksOf(text, options)
  return block.type === 'markdown' ? block.html : ''
}

test('空文档与普通段落', () => {
  assert.deepEqual(blocksOf(''), [])
  assert.deepEqual(blocksOf('正文'), [{ type: 'markdown', html: '<p>正文</p>\n' }])
})

test('顶层围栏形成稳定卡片，原样保留空白与缩进', () => {
  assert.deepEqual(blocksOf('前文\n```ts\n\n    const a = 1\n\n```\n后文'), [
    { type: 'markdown', html: '<p>前文</p>\n' },
    { type: 'code', language: 'ts', code: '\n    const a = 1\n\n', isOpen: false },
    { type: 'markdown', html: '<p>后文</p>\n' },
  ])
})

test('开头围栏即建立卡片，不把无语言开头误判为已闭合', () => {
  for (const input of ['```', '```html', '~~~json']) {
    const blocks = blocksOf(input)
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0].type, 'code')
    if (blocks[0].type === 'code') {
      assert.equal(blocks[0].isOpen, true)
      assert.equal(blocks[0].code, '')
    }
  }
})

test('未闭合代码保留缩进，完成状态由调用方而非围栏决定', () => {
  assert.deepEqual(blocksOf('```svg\n  <svg>'), [
    { type: 'code', language: 'svg', code: '  <svg>', isOpen: true },
  ])
})

test('行内反引号与代码字符串中的反引号不是围栏', () => {
  assert.equal(blocksOf('文字 ```js``` 文字')[0].type, 'markdown')
  assert.deepEqual(blocksOf('```js\nconst s = "```"\n```'), [
    { type: 'code', language: 'js', code: 'const s = "```"\n', isOpen: false },
  ])
})

test('围栏长度、波浪线、info 字符串与 CRLF 按 CommonMark 处理', () => {
  for (const fence of ['````', '~~~~']) {
    assert.deepEqual(blocksOf(`${fence}c++ title=x\r\nbody\r\n${fence}  \r\n`), [
      { type: 'code', language: 'c++', code: 'body\n', isOpen: false },
    ])
  }
  assert.deepEqual(blocksOf('````md\n```js\n1\n```\n````'), [
    { type: 'code', language: 'md', code: '```js\n1\n```\n', isOpen: false },
  ])
})

test('列表与引用内围栏不打断 HTML 层级', () => {
  const list = html('1. 前文\n\n   ```text\n   code\n   ```\n\n   后文\n\n2. 第二项')
  assert.match(list, /<ol>\s*<li>[\s\S]*<pre><code[\s\S]*后文[\s\S]*<\/li>\s*<li>\s*<p>第二项/)
  assert.match(html('> ```text\n> quoted\n> ```'), /<blockquote>\s*<pre><code[\s\S]*quoted[\s\S]*<\/pre>\s*<\/blockquote>/)
})

test('跨围栏 reference links 仍使用整篇 env', () => {
  const rendered = html('[link][id]\n\n```text\nx\n```\n\n[id]: https://example.com')
  assert.match(rendered, /href="https:\/\/example.com"/)
  assert.match(rendered, /target="_blank" rel="noreferrer noopener"/)
})

test('模型 HTML 与危险链接不能执行', () => {
  const rendered = html('<script>alert(1)</script>\n[x](javascript:alert(1))\n[x](data:text/html;base64,eA==)')
  assert.doesNotMatch(rendered, /<script|href="(?:javascript|data):/)
  assert.match(rendered, /&lt;script&gt;/)
  assert.equal(highlightCode('<img onerror="x">', 'unknown'), '&lt;img onerror=&quot;x&quot;&gt;')
})

test('注册的语言别名可高亮，大代码不运行全量语法高亮也不截断', () => {
  assert.match(highlightCode('const a = 1', 'js'), /hljs-keyword/)
  assert.match(highlightCode('<svg></svg>', 'svg'), /hljs-tag/)
  const large = 'const a = "<script>";\n'.repeat(2000)
  const highlighted = highlightCode(large, 'js')
  assert.doesNotMatch(highlighted, /hljs-/)
  assert.equal(highlighted, large.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'))
})

test('顶层块各自输出，流式时只有尾块变化，前面块的 HTML 字符串不变', () => {
  const first = renderMarkdownBlocks('# 标题\n\n第一段\n\n- 项一\n- 项二\n\n第二', { streaming: true })
  assert.equal(first.blocks.length, 4)
  assert.deepEqual(first.blocks.map(block => block.type), ['markdown', 'markdown', 'markdown', 'markdown'])
  const second = renderMarkdownBlocks('# 标题\n\n第一段\n\n- 项一\n- 项二\n\n第二段继续', { streaming: true, cache: first.cache })
  assert.deepEqual(second.blocks.slice(0, 3), first.blocks.slice(0, 3))
  assert.notDeepEqual(second.blocks[3], first.blocks[3])
  // 缓存只保留本次用到的块。
  assert.equal(second.cache.html.size, 4)
})

test('流式时只对尾块补齐未闭合标记，围栏尾块与非流式不补', () => {
  assert.equal(blocksOf('**a**\n\n先说 **结论', { streaming: true }).length, 2)
  assert.match(html('**a**\n\n先说 **结论', { streaming: true }), /<p>先说 <strong>结论<\/strong><\/p>/)
  assert.match(html('先说 **结论'), /<p>先说 \*\*结论<\/p>/)
  assert.deepEqual(blocksOf('```js\n**x', { streaming: true }), [
    { type: 'code', language: 'js', code: '**x', isOpen: true },
  ])
})

test('尾块补齐后仍保留其后的 reference 定义', () => {
  const rendered = firstHtml('[x][doc]\n\n先说 **结论\n\n[doc]: https://example.com', { streaming: true })
  assert.match(rendered, /href="https:\/\/example.com"/)
})

test('reference 定义的 label 或 href 变化都会让前面块重新解析而不是命中缓存', () => {
  const first = renderMarkdownBlocks('[link][id]\n\n中间')
  assert.doesNotMatch(firstHtml('[link][id]\n\n中间'), /href=/)
  const second = renderMarkdownBlocks('[link][id]\n\n中间\n\n[id]: https://exam', { cache: first.cache })
  assert.match(firstHtml('[link][id]\n\n中间\n\n[id]: https://exam', { cache: first.cache }), /href="https:\/\/exam"/)
  const third = renderMarkdownBlocks('[link][id]\n\n中间\n\n[id]: https://example.com', { cache: second.cache })
  assert.match(third.blocks[0].type === 'markdown' ? third.blocks[0].html : '', /href="https:\/\/example.com"/)
})

test('尾块补齐时前面块的 HTML 与 reference 都沿用第一次解析', () => {
  const text = '[id]: https://example.com\n\n[x][id]\n\n- 项\n\n先说 **结论'
  const { blocks, cache } = renderMarkdownBlocks(text, { streaming: true })
  assert.equal(blocks.length, 3)
  assert.match(blocks[0].type === 'markdown' ? blocks[0].html : '', /href="https:\/\/example.com"/)
  assert.match(blocks[2].type === 'markdown' ? blocks[2].html : '', /<strong>结论<\/strong>/)
  assert.equal(cache.html.size, 3)
  // 尾块自己引用前文定义的 reference 也能解析。
  const rendered = renderMarkdownBlocks('[id]: https://example.com\n\n段落\n\n看 [文档][id] **重', { streaming: true }).blocks
  assert.match(rendered[1].type === 'markdown' ? rendered[1].html : '', /href="https:\/\/example.com"[\s\S]*<strong>重<\/strong>/)
})
