import assert from 'node:assert/strict'
import { it } from 'vitest'
import { highlightCode } from './code-highlighter'
import { FILE_CODE_LIMIT, formatFileCode, highlightedCodeLines } from './source-code'

it('文件高亮覆盖超过 20 KB 的 HTML；聊天仍按原预算回退且保留完整文本', () => {
  const code = `<html><style>body{color:red}</style><script>const title="<img onerror=alert(1)>";</script><body>${'正文'.repeat(11_000)}</body></html>`
  assert.doesNotMatch(highlightCode(code, 'html'), /<span/)
  const highlighted = highlightCode(code, 'html', FILE_CODE_LIMIT)
  assert.match(highlighted, /hljs-tag/)
  assert.match(highlighted, /hljs-keyword/)
  assert.doesNotMatch(highlighted, /<img/)
})

it('高亮分行保留跨行嵌套 token，空行仍占一行', () => {
  assert.deepEqual(highlightedCodeLines('<span class="hljs-comment">a\n<span class="hljs-doctag">b\nc</span></span>\n'), [
    '<span class="hljs-comment">a</span>',
    '<span class="hljs-comment"><span class="hljs-doctag">b</span></span>',
    '<span class="hljs-comment"><span class="hljs-doctag">c</span></span>',
    '',
  ])
})

it('格式化 HTML 内的 CSS / JavaScript 与 TS，非法代码拒绝且不修改输入', async () => {
  const code = '<html><head><style>body{color:red;margin:0}</style></head><body><script>const answer={n:42};</script></body></html>'
  const formatted = await formatFileCode(code, 'index.html')
  assert.match(formatted, /color: red;/)
  assert.match(formatted, /const answer = \{ n: 42 \};/)
  assert.match(await formatFileCode('const answer:number=42', 'answer.ts'), /const answer: number = 42;/)
  await assert.rejects(formatFileCode('const = ;', 'invalid.js'))
  assert.equal(code.includes('color:red'), true)
})
