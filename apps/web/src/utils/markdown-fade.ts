import type Token from 'markdown-it/lib/token.mjs'

/** 一段新字的淡入时长（#214）；片段的 animation-duration 与摘掉片段的时机都取它。 */
export const FADE_MS = 420

/** 一次提交新放出的文字：按尾块渲染后纯文本（text 与 code_inline 的内容依次拼接）的偏移记录。 */
export interface FadeBatch {
  id: number
  start: number
  end: number
  /** 放出时刻（performance.now）；元素被重建时按它续上淡入进度，不从头重播。 */
  bornAt: number
}

/** VNode 路径只支持这些 token；其余（嵌套围栏、表格、图片、hr 等）整块回退 v-html。 */
const BLOCK_TOKENS = new Set([
  'inline',
  'paragraph_open',
  'paragraph_close',
  'heading_open',
  'heading_close',
  'bullet_list_open',
  'bullet_list_close',
  'ordered_list_open',
  'ordered_list_close',
  'list_item_open',
  'list_item_close',
  'blockquote_open',
  'blockquote_close',
])
const INLINE_TOKENS = new Set([
  'text',
  'softbreak',
  'hardbreak',
  'strong_open',
  'strong_close',
  'em_open',
  'em_close',
  's_open',
  's_close',
  'code_inline',
  'link_open',
  'link_close',
])

/**
 * VNode 路径能否渲染这个块。段落以 `|` 开头多半是表头，分隔行一到就变成表格：
 * 一开始就走 v-html，免得淡入到一半切回 v-html 时整行跳满。
 */
export function canFade(tokens: Token[]): boolean {
  if (tokens[0]?.type === 'paragraph_open' && tokens[1]?.content.startsWith('|'))
    return false
  return tokens.every(token => BLOCK_TOKENS.has(token.type) && (token.children ?? []).every(child => INLINE_TOKENS.has(child.type)))
}

/** 块渲染后的纯文本：text 与 code_inline 的内容依次拼接，片段按它的偏移切分。 */
export function fadeText(tokens: Token[]): string {
  let text = ''

  for (const token of tokens) {
    for (const child of token.children ?? []) {
      if (child.type === 'text' || child.type === 'code_inline')
        text += child.content
    }
  }
  return text
}
