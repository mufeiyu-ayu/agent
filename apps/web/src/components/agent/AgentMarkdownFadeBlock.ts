import type Token from 'markdown-it/lib/token.mjs'
import type { FunctionalComponent, VNode, VNodeArrayChildren } from 'vue'
import type { FadeBatch } from '@/utils/markdown-fade'

import { h } from 'vue'

import { FADE_MS } from '@/utils/markdown-fade'

function attrsOf(token: Token): Record<string, string | number> {
  const attrs: Record<string, string | number> = Object.fromEntries(token.attrs ?? [])
  // 与 markdown-blocks 的 link_open 规则一致；href 已在解析时经 validateLink 过滤、normalizeLink 编码。
  if (token.type === 'link_open')
    Object.assign(attrs, { target: '_blank', rel: 'noreferrer noopener' })
  return attrs
}

/** 块级标签后是否跟换行：照抄 markdown-it `Renderer.renderToken`，DOM 与 v-html 的逐节点一致。 */
function breaksAfterOpen(tokens: Token[], index: number) {
  const next = tokens[index + 1]
  return !(next && (next.type === 'inline' || next.hidden || (next.nesting === -1 && next.tag === tokens[index].tag)))
}

/**
 * 流式中的尾块（#214）：把 canFade 为真的一个顶层块渲染成 VNode，结构与 markdown-it 的 HTML 一致，
 * 落在 batches 里的文字包进 `.agent-markdown-fresh` 片段（key 由批次与偏移决定，跨提交稳定）。
 * 不经 innerHTML，文本只作为文本节点插入。
 */
const AgentMarkdownFadeBlock: FunctionalComponent<{ tokens: Token[], batches: readonly FadeBatch[] }> = ({ tokens, batches }) => {
  let offset = 0

  function fresh(batch: FadeBatch, start: number, children: VNodeArrayChildren): VNode {
    return h('span', {
      key: `${batch.id}:${start}`,
      class: 'agent-markdown-fresh',
      // 只在创建元素时写一次：之后改 animation-delay 会让进行中的动画跳帧。
      onVnodeBeforeMount: (vnode: VNode) => {
        const { style } = vnode.el as HTMLElement
        style.animationDuration = `${FADE_MS}ms`
        style.animationDelay = `${batch.bornAt - performance.now()}ms`
      },
    }, children)
  }

  /** 按批次切开一段文字；`skip` 所在批次已由外层片段淡入，不再重复包。 */
  function pushText(content: string, into: VNodeArrayChildren, skip?: FadeBatch) {
    const end = offset + content.length
    let cursor = offset

    for (const batch of batches) {
      const from = Math.max(batch.start, cursor)
      const to = Math.min(batch.end, end)

      if (batch === skip || from >= to)
        continue
      if (from > cursor)
        into.push(content.slice(cursor - offset, from - offset))
      into.push(fresh(batch, from, [content.slice(from - offset, to - offset)]))
      cursor = to
    }
    if (cursor < end)
      into.push(content.slice(cursor - offset))
    offset = end
  }

  function renderInline(children: Token[], target: VNodeArrayChildren) {
    const parents: VNodeArrayChildren[] = []
    const opened: Token[] = []
    let into = target

    for (const token of children) {
      if (token.type === 'text') {
        pushText(token.content, into)
      }
      else if (token.type === 'code_inline') {
        // 行内代码有边框底色：首字所在批次连同整个框一起淡入，不先冒出一个空框。
        const batch = batches.find(item => item.start <= offset && offset < item.end)
        const start = offset
        const code: VNodeArrayChildren = []
        pushText(token.content, code, batch)
        const element = h('code', attrsOf(token), code)
        into.push(batch ? fresh(batch, start, [element]) : element)
      }
      else if (token.type === 'softbreak' || token.type === 'hardbreak') {
        into.push(h('br'), '\n')
      }
      else if (token.nesting === 1) {
        parents.push(into)
        opened.push(token)
        into = []
      }
      else if (token.nesting === -1) {
        const open = opened.pop()!
        const element = h(open.tag, attrsOf(open), into)
        into = parents.pop()!
        into.push(element)
      }
    }
  }

  const root: VNodeArrayChildren = []
  const parents: VNodeArrayChildren[] = []
  const opened: Token[] = []
  let into = root

  for (const [index, token] of tokens.entries()) {
    if (token.type === 'inline') {
      renderInline(token.children ?? [], into)
      continue
    }
    // 紧凑列表里的段落标签隐藏，只留内容。
    if (token.hidden)
      continue
    if (token.nesting === 1 && index > 0 && tokens[index - 1].hidden)
      into.push('\n')
    if (token.nesting === 1) {
      parents.push(into)
      opened.push(token)
      into = breaksAfterOpen(tokens, index) ? ['\n'] : []
    }
    else {
      const open = opened.pop()!
      const element = h(open.tag, attrsOf(open), into)
      into = parents.pop()!
      into.push(element, '\n')
    }
  }
  return root
}

export default AgentMarkdownFadeBlock
