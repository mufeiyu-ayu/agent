import type Token from 'markdown-it/lib/token.mjs'
import MarkdownIt from 'markdown-it'
import markdownItCjkFriendly from 'markdown-it-cjk-friendly'

// 沿用 Web 的解析库与安全策略，但不引入其流式分块、代码卡片或 HTML 预览依赖。
const markdown = new MarkdownIt({ html: false, breaks: true, linkify: true })
  .use(markdownItCjkFriendly)

markdown.validateLink = url => !/^(?:javascript|vbscript|file|data):/.test(url.trim().toLowerCase())
markdown.renderer.rules.link_open = (tokens, index, options, _env, renderer) => {
  tokens[index].attrSet('target', '_blank')
  tokens[index].attrSet('rel', 'noreferrer noopener')
  return renderer.renderToken(tokens, index, options)
}

const imageIndexesInLinks = new WeakMap<Token[], Set<number>>()

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

// 禁止模型图片触发自动出站请求；已在链接中的图片只留文字，避免嵌套链接。
markdown.renderer.rules.image = (tokens, index, options, env, renderer) => {
  const token = tokens[index]
  const alt = markdown.utils.escapeHtml(renderer.renderInlineAsText(token.children ?? [], options, env))
  const src = markdown.utils.escapeHtml(token.attrGet('src') ?? '')
  if (imagesInLinks(tokens).has(index))
    return alt || src
  if (!src)
    return alt
  return `<a href="${src}" target="_blank" rel="noreferrer noopener">${alt || src}</a>`
}

export function renderConversationMarkdown(content: string): string {
  return markdown.render(content)
}
