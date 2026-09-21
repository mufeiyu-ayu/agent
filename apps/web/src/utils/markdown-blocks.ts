import type Token from 'markdown-it/lib/token.mjs'

import MarkdownIt from 'markdown-it'

import { highlightCode } from './code-highlighter'

export type ParsedContentBlock
  = | { type: 'markdown', html: string }
    | { type: 'code', language: string, code: string, isOpen: boolean }

const markdown = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
  highlight: highlightCode,
})

markdown.validateLink = url => !/^(?:javascript|vbscript|file|data):/.test(url.trim().toLowerCase())
markdown.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
  tokens[index].attrSet('target', '_blank')
  tokens[index].attrSet('rel', 'noreferrer noopener')
  return renderer.renderToken(tokens, index, options)
}

/**
 * 只将顶层围栏变成独立卡片。列表、引用等嵌套结构整组交给 markdown-it，
 * 不切断其 HTML 层级；全篇共享同一次解析的 env，保留跨块 reference links。
 */
export function parseMarkdownBlocks(text: string): ParsedContentBlock[] {
  const env = {}
  const tokens = markdown.parse(text, env)
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ParsedContentBlock[] = []
  let prose: Token[] = []

  function flushProse() {
    if (!prose.length)
      return
    blocks.push({ type: 'markdown', html: markdown.renderer.render(prose, markdown.options, env) })
    prose = []
  }

  for (const token of tokens) {
    if (token.type !== 'fence' || token.level !== 0) {
      prose.push(token)
      continue
    }

    flushProse()
    const [start, end] = token.map!
    const closingLine = lines[end - 1] ?? ''
    const closing = closingLine.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/)?.[1]
    const isClosed = end > start + 1 && closing?.[0] === token.markup[0] && closing.length >= token.markup.length
    blocks.push({
      type: 'code',
      language: token.info.trim().split(/\s+/)[0] || 'text',
      code: token.content,
      isOpen: !isClosed,
    })
  }
  flushProse()
  return blocks
}
