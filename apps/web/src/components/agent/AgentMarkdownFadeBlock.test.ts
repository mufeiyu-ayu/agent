import type Token from 'markdown-it/lib/token.mjs'
import type { FadeBatch } from '@/utils/markdown-fade'

import assert from 'node:assert/strict'
import { it } from 'vitest'

import { h } from 'vue'
import { renderToString } from 'vue/server-renderer'

import { renderMarkdownBlocks } from '@/utils/markdown-blocks'
import { fadeText } from '@/utils/markdown-fade'

import AgentMarkdownFadeBlock from './AgentMarkdownFadeBlock'

function lastBlock(text: string, streaming = false) {
  const block = renderMarkdownBlocks(text, { streaming }).blocks.at(-1)
  assert.ok(block?.type === 'markdown')
  return block
}

/** SSR 渲染 VNode 路径，去掉 Fragment 的注释锚点。 */
async function render(tokens: Token[], batches: FadeBatch[]) {
  return (await renderToString(h(AgentMarkdownFadeBlock, { tokens, batches }))).replace(/<!--[[\]]-->/g, '')
}

/** 去掉片段 span 后的 HTML；SSR 把 `'` 转义成 `&#39;`，markdown-it 不转义。 */
async function vnodeHtml(text: string, batches: FadeBatch[] = []) {
  return (await render(lastBlock(text).tokens, batches)).replace(/<\/?span[^>]*>/g, '').replaceAll('&#39;', '\'')
}

/** 把整块纯文本切成几批，每段文字都会被包进片段。 */
function batchesOver(text: string, size: number): FadeBatch[] {
  const length = fadeText(lastBlock(text).tokens).length
  return Array.from({ length: Math.ceil(length / size) }, (_, id) => ({ id, start: id * size, end: Math.min(length, (id + 1) * size), bornAt: 0 }))
}

const SUPPORTED = [
  '普通段落，含 **加粗**、*斜体*、~~删除~~、`行内代码` 与 [链接](https://example.com/a?b=1&c="2" "标题")，It\'s <b>字面</b>。',
  '第一行\n第二行，行尾两空格硬换行  \n第三行',
  '## 二级标题 **重点**',
  '- 项一 https://example.com/x\n- 项二\n  - 嵌套 *子项*\n  - 嵌套二\n- 项三',
  '3. 序号从三开始\n\n4. 松散列表的段落\n   续行',
  '> 引用第一行\n> 引用 `code`\n>\n> - 引用里的列表',
]

it('#214 AC-05 VNode 渲染与 v-html 的结构、文本一致（去掉片段后比较）', async () => {
  for (const text of SUPPORTED) {
    const expected = lastBlock(text).html
    assert.equal(await vnodeHtml(text), expected, text)
    // 每 3 个字一批：片段切在强调、链接、代码的中间也不改变结构。
    assert.equal(await vnodeHtml(text, batchesOver(text, 3)), expected, text)
  }
})

it('#214 AC-05 片段只包住批次覆盖的文字，行内代码首字所在批次连框一起包', async () => {
  const text = '前文 `ab` 后'
  const html = await render(lastBlock(text).tokens, [
    { id: 1, start: 2, end: 4, bornAt: 0 },
    { id: 2, start: 4, end: 6, bornAt: 0 },
  ])
  assert.equal(html, '<p>前文<span class="agent-markdown-fresh"> </span><span class="agent-markdown-fresh"><code>a<span class="agent-markdown-fresh">b</span></code></span><span class="agent-markdown-fresh"> </span>后</p>\n')
})

it('#214 AC-06 链接沿用 validateLink 与 target / rel，危险协议不成链接', async () => {
  const text = '[坏](javascript:alert(1)) [也坏](data:text/html,x) [好](https://ok.example)\n\n尾'
  const first = renderMarkdownBlocks(text)
  // 命中缓存的块没经过 link_open 渲染规则，token 上还没有 target / rel。
  const [block] = renderMarkdownBlocks(text, { cache: first.cache }).blocks
  assert.ok(block?.type === 'markdown')
  const html = await render(block.tokens, [])
  assert.equal(html, block.html)
  assert.doesNotMatch(html, /href="(?:javascript|data):/)
  assert.match(html, /<a href="https:\/\/ok.example" target="_blank" rel="noreferrer noopener">好<\/a>/)
})
