import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'

import { highlightCode } from './code-highlighter'
import { parseMarkdownBlocks } from './markdown-blocks'

function html(text: string) {
  return parseMarkdownBlocks(text).filter(block => block.type === 'markdown').map(block => block.html).join('')
}

test('空文档与普通段落', () => {
  assert.deepEqual(parseMarkdownBlocks(''), [])
  assert.deepEqual(parseMarkdownBlocks('正文'), [{ type: 'markdown', html: '<p>正文</p>\n' }])
})

test('顶层围栏形成稳定卡片，原样保留空白与缩进', () => {
  const blocks = parseMarkdownBlocks('前文\n```ts\n\n    const a = 1\n\n```\n后文')
  assert.deepEqual(blocks, [
    { type: 'markdown', html: '<p>前文</p>\n' },
    { type: 'code', language: 'ts', code: '\n    const a = 1\n\n', isOpen: false },
    { type: 'markdown', html: '<p>后文</p>\n' },
  ])
})

test('开头围栏即建立卡片，不把无语言开头误判为已闭合', () => {
  for (const input of ['```', '```html', '~~~json']) {
    const blocks = parseMarkdownBlocks(input)
    assert.equal(blocks.length, 1)
    assert.equal(blocks[0].type, 'code')
    if (blocks[0].type === 'code') {
      assert.equal(blocks[0].isOpen, true)
      assert.equal(blocks[0].code, '')
    }
  }
})

test('未闭合代码保留缩进，完成状态由调用方而非围栏决定', () => {
  assert.deepEqual(parseMarkdownBlocks('```svg\n  <svg>'), [
    { type: 'code', language: 'svg', code: '  <svg>', isOpen: true },
  ])
})

test('行内反引号与代码字符串中的反引号不是围栏', () => {
  assert.equal(parseMarkdownBlocks('文字 ```js``` 文字')[0].type, 'markdown')
  assert.deepEqual(parseMarkdownBlocks('```js\nconst s = "```"\n```'), [
    { type: 'code', language: 'js', code: 'const s = "```"\n', isOpen: false },
  ])
})

test('围栏长度、波浪线、info 字符串与 CRLF 按 CommonMark 处理', () => {
  for (const fence of ['````', '~~~~']) {
    const blocks = parseMarkdownBlocks(`${fence}c++ title=x\r\nbody\r\n${fence}  \r\n`)
    assert.deepEqual(blocks, [{ type: 'code', language: 'c++', code: 'body\n', isOpen: false }])
  }
  assert.deepEqual(parseMarkdownBlocks('````md\n```js\n1\n```\n````'), [
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
