import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'

import { alignRevealBoundary, completeStreamingMarkdown } from './streaming-markdown'

test('补齐未闭合的粗体、斜体、删除线与行内代码', () => {
  assert.equal(completeStreamingMarkdown('先说 **结论'), '先说 **结论**')
  assert.equal(completeStreamingMarkdown('先说 *重点'), '先说 *重点*')
  assert.equal(completeStreamingMarkdown('先说 ~~旧'), '先说 ~~旧~~')
  assert.equal(completeStreamingMarkdown('调用 `fetch('), '调用 `fetch(`')
  assert.equal(completeStreamingMarkdown('调用 ``a`b'), '调用 ``a`b``')
  assert.equal(completeStreamingMarkdown('***强调'), '***强调***')
})

test('嵌套标记按打开顺序反向闭合，已闭合的不重复补', () => {
  assert.equal(completeStreamingMarkdown('**粗 *斜'), '**粗 *斜***')
  assert.equal(completeStreamingMarkdown('**已闭合** 正文'), '**已闭合** 正文')
  assert.equal(completeStreamingMarkdown('1. **要点**：说明 **第二'), '1. **要点**：说明 **第二**')
})

test('刚到达、还没有正文的 opener 先隐藏', () => {
  assert.equal(completeStreamingMarkdown('先说 **'), '先说 ')
  assert.equal(completeStreamingMarkdown('先说 `'), '先说 ')
  assert.equal(completeStreamingMarkdown('先说 **结论**'), '先说 **结论**')
})

test('列表标记、词内下划线、乘号与转义不当作强调', () => {
  assert.equal(completeStreamingMarkdown('* 第一项\n* 第二'), '* 第一项\n* 第二')
  assert.equal(completeStreamingMarkdown('变量 user_name 与 a_b'), '变量 user_name 与 a_b')
  assert.equal(completeStreamingMarkdown('2 * 3 = 6'), '2 * 3 = 6')
  assert.equal(completeStreamingMarkdown('字面 \\*星号'), '字面 \\*星号')
  assert.equal(completeStreamingMarkdown('代码里 `a ** b` 之外'), '代码里 `a ** b` 之外')
})

test('列表项内的围栏后面视为代码，不补标记', () => {
  const text = '- **要点**\n  ```ts\n  const a = "**"'
  assert.equal(completeStreamingMarkdown(text), text)
})

test('未完成的图片整段隐藏，未完成的链接先按链接显示', () => {
  assert.equal(completeStreamingMarkdown('见图 ![示意'), '见图 ')
  assert.equal(completeStreamingMarkdown('见图 ![示意](https://a'), '见图 ')
  assert.equal(completeStreamingMarkdown('见 [文档](https://exa'), '见 [文档](https://exa)')
  assert.equal(completeStreamingMarkdown('见 [文档](https://example.com) 后文'), '见 [文档](https://example.com) 后文')
})

test('切点不落在代理对与标记 run 中间', () => {
  const emoji = '好😀了'
  assert.equal(alignRevealBoundary(emoji, 2), 3)
  assert.equal(alignRevealBoundary('先 **结论**', 3), 4)
  assert.equal(alignRevealBoundary('a ``b', 3), 4)
  assert.equal(alignRevealBoundary('普通', 1), 1)
  assert.equal(alignRevealBoundary('普通', 9), 2)
})

test('波浪线围栏与列表标记同行的围栏也视为代码起始', () => {
  for (const text of ['- 示例\n  ~~~ts\n  a = b', '- ```ts\n  const a', '> ```\n> **x', '1. ~~~\n   a']) {
    assert.equal(completeStreamingMarkdown(text), text)
  }
  assert.equal(completeStreamingMarkdown('删除 ~~旧'), '删除 ~~旧~~')
})

test('切点不落在转义符与图片感叹号之后', () => {
  assert.equal(alignRevealBoundary('字面 \\*星号', 4), 5)
  assert.equal(alignRevealBoundary('见图 ![示意', 4), 5)
  assert.equal(alignRevealBoundary('结尾\\', 3), 3)
})

test('闭合符紧贴正文，切在空白后也不会退化成字面标记', () => {
  assert.equal(completeStreamingMarkdown('先说 **结论 '), '先说 **结论**')
  assert.equal(completeStreamingMarkdown('**见图 ![示意'), '**见图**')
  assert.equal(completeStreamingMarkdown('a `b '), 'a `b `')
})

test('图片隐藏不跨行，链接没有 href 内容时不补右括号', () => {
  assert.equal(completeStreamingMarkdown('见图 ![示意\n后续内容'), '见图 ![示意\n后续内容')
  assert.equal(completeStreamingMarkdown('a [b]('), 'a [b](')
  assert.equal(completeStreamingMarkdown('a [b](h'), 'a [b](h)')
})

test('列表项内已闭合的围栏之后继续补齐', () => {
  assert.equal(completeStreamingMarkdown('- ```ts\n  a\n  ```\n- **要点'), '- ```ts\n  a\n  ```\n- **要点**')
  assert.equal(completeStreamingMarkdown('- ~~~\n  **x\n  ~~~\n- *y'), '- ~~~\n  **x\n  ~~~\n- *y*')
})

test('四个及以上星号按成对分隔符记账', () => {
  assert.equal(completeStreamingMarkdown('****x'), '****x****')
  assert.equal(completeStreamingMarkdown('**a** ****b'), '**a** ****b****')
})
