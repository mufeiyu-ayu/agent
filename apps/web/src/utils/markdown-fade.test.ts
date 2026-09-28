import assert from 'node:assert/strict'
import { it } from 'vitest'

import { renderMarkdownBlocks } from './markdown-blocks'
import { canFade, fadeText } from './markdown-fade'

function tokensOf(text: string) {
  const block = renderMarkdownBlocks(text).blocks.at(-1)
  assert.ok(block?.type === 'markdown')
  return block.tokens
}

it('#214 AC-08b 含不支持的 token 时整块回退 v-html：嵌套围栏、表格、图片、分隔线、未成形的表头', () => {
  for (const text of ['- 项\n  ```ts\n  code\n  ```', '> | a | b |\n> |---|---|\n> | 1 | 2 |', '见图 ![x](https://a/b.png)', '- 项\n\n  ---', '| a |\n|---|\n| 1 |', '***'])
    assert.equal(canFade(tokensOf(text)), false, text)
  const tokens = tokensOf('**甲** `乙` [丙](https://x.y)\n丁')
  assert.equal(canFade(tokens), true)
  assert.equal(fadeText(tokens), '甲 乙 丙丁')
  // 以 `|` 开头的段落多半是还没等到分隔行的表头：一开始就不走 VNode。
  assert.equal(canFade(tokensOf('| 列一 | 列二 |')), false)
})
