import type Token from 'markdown-it/lib/token.mjs'

import MarkdownIt from 'markdown-it'
import markdownItCjkFriendly from 'markdown-it-cjk-friendly'

import { highlightCode } from './code-highlighter'
import { CJK_PUNCTUATION_CHARS, completeStreamingMarkdown } from './streaming-markdown'

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

// CommonMark 的强调规则在全角标点紧贴 `**` 时配不上对（`**结论：**后文` 显示字面 `**`）；
// markdown-it-cjk-friendly 是 CommonMark「CJK 友好强调」修订提案的参考实现。
const markdown = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
  highlight: highlightCode,
}).use(markdownItCjkFriendly)

type LinkifyMatch = NonNullable<ReturnType<typeof markdown.linkify.matchAtStart>>
const CJK_PUNCTUATION = new RegExp(`[${CJK_PUNCTUATION_CHARS}]`)

/**
 * linkify 会把「https://x.com/a。后文」整段并进链接：在第一个全角标点处截断，后文照常解析。
 * 上限：路径里本来就带全角标点的 URL（`/wiki/東京（曖昧さ回避）`、以 `。` 分隔标签的 IDN 主机）会被截短。
 */
function trimAtCjkPunctuation(match: LinkifyMatch): LinkifyMatch {
  const cut = match.raw.search(CJK_PUNCTUATION)

  if (cut <= 0)
    return match

  const removed = match.raw.length - cut

  return Object.assign(match, {
    raw: match.raw.slice(0, cut),
    text: match.text.slice(0, -removed),
    url: match.url.slice(0, -removed),
    lastIndex: match.lastIndex - removed,
  })
}

const { linkify } = markdown
const matchAtStart = linkify.matchAtStart.bind(linkify)
const matchAll = linkify.match.bind(linkify)

// 带协议的链接走 inline 规则（matchAtStart），www. 这类走 core 规则（match）。
linkify.matchAtStart = (text) => {
  const found = matchAtStart(text)
  return found && trimAtCjkPunctuation(found)
}
linkify.match = text => matchAll(text)?.map(trimAtCjkPunctuation) ?? null

markdown.validateLink = url => !/^(?:javascript|vbscript|file|data):/.test(url.trim().toLowerCase())
markdown.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
  tokens[index].attrSet('target', '_blank')
  tokens[index].attrSet('rel', 'noreferrer noopener')
  return renderer.renderToken(tokens, index, options)
}
/**
 * 模型输出不可信：`<img>` 会让浏览器立即请求任意地址（可把对话内容拼进 URL 外带），
 * 图片一律渲染成链接，文字取 alt。已在链接里的图片只留文字，避免 `<a>` 嵌套。
 */
markdown.renderer.rules.image = (tokens, index, options, env, renderer) => {
  const token = tokens[index]
  const alt = markdown.utils.escapeHtml(renderer.renderInlineAsText(token.children ?? [], options, env))
  const src = markdown.utils.escapeHtml(token.attrGet('src') ?? '')
  // 链接不能嵌套：在链接里的图片只留文字。
  if (imagesInLinks(tokens).has(index))
    return alt || src
  // 空地址的 `<a href="">` 会在新标签页打开当前页，只留文字。
  if (!src)
    return alt
  return `<a href="${src}" target="_blank" rel="noreferrer noopener">${alt || src}</a>`
}

const imageIndexesInLinks = new WeakMap<Token[], Set<number>>()

/** 一组 inline token 里位于链接内的图片下标；每组只遍历一次，不为每张图片往回扫。 */
function imagesInLinks(tokens: Token[]): Set<number> {
  let indexes = imageIndexesInLinks.get(tokens)

  if (!indexes) {
    indexes = new Set()
    let depth = 0

    for (const [index, token] of tokens.entries()) {
      if (token.type === 'link_open')
        depth++
      else if (token.type === 'link_close')
        depth--
      else if (token.type === 'image' && depth > 0)
        indexes.add(index)
    }
    imageIndexesInLinks.set(tokens, indexes)
  }
  return indexes
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
 * 文末一行只有 `-` / `=`（可带引用符与缩进）且尾块里有 setext 标题止于这一行：段落下一行刚写出 `-`，
 * 会先被解析成标题，而它还可能长成列表项（`1. 第一点：\n   - 子项`）或正文。
 */
function endsWithPendingSetextUnderline(segment: Segment, lines: string[]) {
  return /^[ \t>]*(?:-+|=+)[ \t]*$/.test(lines.at(-1) ?? '')
    && segment.tokens.some(token => token.type === 'heading_open'
      && (token.markup === '-' || token.markup === '=')
      && token.map?.[1] === lines.length)
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
    // 尾块之后还有行，说明它的最后一行已经换行写完：按终态显示，不再补齐（多补的标记会一直挂到下一行开始）。
    if (tail && tail.map && !isCodeSegment(tail) && tail.map[1] === document.lines.length) {
      const [start, end] = tail.map
      const tailSource = document.lines.slice(start, end).join('\n')
      // 「要点如下：\n-」先按 H2 渲染、下一字符到达后又变回段落加列表：下划线在文末时先不显示。
      // 其后已有换行说明这一行已经写完，是真的 setext 标题，照常渲染。
      const settledSource = endsWithPendingSetextUnderline(tail, document.lines)
        ? document.lines.slice(start, end - 1).join('\n')
        : tailSource
      const completed = completeStreamingMarkdown(settledSource, { table: tail.tokens[0]?.type === 'table_open' })
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

  for (const [index, segment] of segments.entries()) {
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

    // 最后一块的解析结果依赖是否到达文末（嵌套未闭合围栏的内容带不带尾换行），源码相同也不能复用。
    const key = segment.map && index < segments.length - 1 ? lines.slice(segment.map[0], segment.map[1]).join('\n') : null
    let rendered = key === null ? undefined : (html.get(key) ?? previous?.get(key))
    if (rendered === undefined)
      rendered = markdown.renderer.render(segment.tokens, markdown.options, env)
    if (key !== null)
      html.set(key, rendered)
    blocks.push({ type: 'markdown', html: rendered })
  }

  return { blocks, cache: { referencesKey, html } }
}
