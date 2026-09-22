import type Token from 'markdown-it/lib/token.mjs'

import MarkdownIt from 'markdown-it'

import { highlightCode } from './code-highlighter'
import { completeStreamingMarkdown } from './streaming-markdown'

export type ParsedContentBlock
  = | { type: 'markdown', html: string }
    | { type: 'code', language: string, code: string, isOpen: boolean }

/** 上一次渲染留下的块级 HTML 缓存；由调用方持有并原样传回，本模块不保存状态。 */
export interface MarkdownBlockCache {
  /** reference 定义的完整快照：label、href、title 任一变化都会让前面块的解析结果失效。 */
  referencesKey: string
  html: Map<string, string>
}

export interface RenderMarkdownBlocksOptions {
  /** 流式中：对最后一个顶层块补齐未闭合的行内标记，避免字面标记与格式来回翻转。 */
  streaming?: boolean
  cache?: MarkdownBlockCache
}

export interface RenderMarkdownBlocksResult {
  blocks: ParsedContentBlock[]
  /** 只含本次用到的块，交给下一次渲染。 */
  cache: MarkdownBlockCache
}

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

interface Segment {
  /** 顶层 open 到对应 close 的整组 token；nesting 为 0 的顶层 token 单独成组。 */
  tokens: Token[]
  /** 源码行范围，来自 open token 的 map。 */
  map: [number, number] | null
}

interface ParsedDocument {
  env: { references?: Record<string, unknown> }
  lines: string[]
  segments: Segment[]
}

function parseDocument(
  text: string,
  env: ParsedDocument['env'] = {},
  lineOffset = 0,
): ParsedDocument {
  const tokens = markdown.parse(text, env)
  const segments: Segment[] = []

  for (let index = 0; index < tokens.length;) {
    const open = tokens[index]
    let end = index + 1
    if (open.nesting === 1) {
      while (end < tokens.length && !(tokens[end].level === 0 && tokens[end].nesting === -1))
        end++
      end++
    }
    segments.push({
      tokens: tokens.slice(index, end),
      map: open.map ? [open.map[0] + lineOffset, open.map[1] + lineOffset] : null,
    })
    index = end
  }

  return { env, lines: text.replace(/\r\n?/g, '\n').split('\n'), segments }
}

function isCodeSegment(segment: Segment) {
  const type = segment.tokens[0]?.type
  return type === 'fence' || type === 'code_block'
}

/**
 * 只将顶层围栏变成独立卡片。列表、引用等嵌套结构整组交给 markdown-it，
 * 不切断其 HTML 层级；全篇共享同一次解析的 env，保留跨块 reference links。
 *
 * 对照 Streamdown：每次都重新解析全文（块边界可能被后到的内容改写），
 * 但按顶层块输出 HTML，并以块源码为 key 复用上次渲染结果；流式时只有
 * 最后一个块的 HTML 会变，前面的块字符串不变，Vue 不会重建它们的 DOM。
 */
export function renderMarkdownBlocks(
  text: string,
  options: RenderMarkdownBlocksOptions = {},
): RenderMarkdownBlocksResult {
  let document = parseDocument(text)

  if (options.streaming) {
    const tail = document.segments.at(-1)
    if (tail && tail.map && !isCodeSegment(tail)) {
      const [start, end] = tail.map
      const tailSource = document.lines.slice(start, end).join('\n')
      const completed = completeStreamingMarkdown(tailSource)
      // 补齐只改尾块末尾，前面的块不受影响：沿用同一个 env 只重解析尾块及其后的行
      // （reference 定义、空行不产生 token，但必须保留），不再解析全文第二次。
      if (completed !== tailSource) {
        const rest = parseDocument(
          [completed, ...document.lines.slice(end)].join('\n'),
          document.env,
          start,
        )
        document = {
          env: document.env,
          lines: [...document.lines.slice(0, start), ...rest.lines],
          segments: [...document.segments.slice(0, -1), ...rest.segments],
        }
      }
    }
  }

  const { env, lines, segments } = document
  const referencesKey = JSON.stringify(env.references ?? {})
  const previous = options.cache?.referencesKey === referencesKey ? options.cache.html : undefined
  const html = new Map<string, string>()
  const blocks: ParsedContentBlock[] = []

  for (const segment of segments) {
    const token = segment.tokens[0]

    if (token.type === 'fence' && segment.map) {
      const [start, end] = segment.map
      const closingLine = lines[end - 1] ?? ''
      const closing = closingLine.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/)?.[1]
      const isClosed = end > start + 1 && closing?.[0] === token.markup[0] && closing.length >= token.markup.length
      blocks.push({
        type: 'code',
        language: token.info.trim().split(/\s+/)[0] || 'text',
        code: token.content,
        isOpen: !isClosed,
      })
      continue
    }

    const key = segment.map ? lines.slice(segment.map[0], segment.map[1]).join('\n') : null
    let rendered = key === null ? undefined : (html.get(key) ?? previous?.get(key))
    if (rendered === undefined)
      rendered = markdown.renderer.render(segment.tokens, markdown.options, env)
    if (key !== null)
      html.set(key, rendered)
    blocks.push({ type: 'markdown', html: rendered })
  }

  return { blocks, cache: { referencesKey, html } }
}
