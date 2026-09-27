import { parentPort, workerData } from 'node:worker_threads'
import { Readability } from '@mozilla/readability'
import { parseHTML } from 'linkedom'

/**
 * `web_fetch` 的正文提取（Issue #206）：HTML → 标题与纯文本，在 worker 线程里跑。网页是不可信输入，
 * linkedom 解析与 Readability 都是同步计算，构造的页面（深层嵌套、接近 2 MB 的大页面）能跑几秒到几十秒；
 * 放进 worker，超时或停止时由 `web-fetch.tool.ts` 直接终止，API 的事件循环不受影响。
 * 只 import npm 包、不 import 本地模块：测试里 Node 按类型剥离直接运行这个 .ts 文件，本地 `.js` 路径解析不到。
 */
export interface PageText {
  title: string
  text: string
}

// 块级元素前后断行，保留段落；表格单元格之间补一个空格。
const BLOCK_TAGS = new Set('ADDRESS ARTICLE ASIDE BLOCKQUOTE BR DD DETAILS DIV DL DT FIELDSET FIGCAPTION FIGURE FOOTER FORM H1 H2 H3 H4 H5 H6 HEADER HR LI MAIN NAV OL P SECTION SUMMARY TABLE TR UL'.split(' '))
const CELL_TAGS = new Set(['TD', 'TH'])
const ELEMENT_NODE = 1
const TEXT_NODE = 3

parentPort?.postMessage({ pageText: extractPageText(workerData as string) })

/**
 * Readability 提取标题与正文。首页、列表页上它往往不返回空，而是只抓一小块（实测人民网、新华网、IT之家首页
 * 都不到整页文本的 5%，文章页多在 40% 以上）：正文不到整页文本的 1/5 时，退回去掉脚本、样式和导航后的整页文本。
 */
function extractPageText(html: string): PageText {
  const document = parseDocument(html)
  // Readability 会改动传入的 document，整页文本用一份副本。
  const page = document.cloneNode(true) as Document
  const article = new Readability<Node>(document, { serializer: node => node }).parse()
  // 空白合并成一个空格：标题里的换行伪造不出「链接：」行。
  const title = (article?.title || page.title).replace(/\s+/g, ' ').trim()

  // 页眉只删页面级的：列表页每条的标题、栏目名常在 <article> / <section> 的 <header> 里。
  for (const element of page.querySelectorAll('script, style, template, noscript, select, nav, header:not(article header, section header), footer'))
    element.remove()

  const articleText = article?.content ? blockText(article.content) : ''
  const pageText = blockText(page.body)

  return { title, text: articleText.length * 5 < pageText.length ? pageText : articleText }
}

/**
 * linkedom 不按规范补全文档结构：document.head / body 只认 html 下的第一个子元素是 head、紧跟着是 body，
 * 对不上（片段、省略 head 或 body、两者之间夹了元素）时会新建空元素，标题与正文都丢。这些情况整份包进 body 重新解析。
 */
function parseDocument(html: string): Document {
  const { document } = parseHTML(html)
  const head = document.documentElement?.firstElementChild

  if (document.documentElement?.tagName === 'HTML' && head?.tagName === 'HEAD' && head.nextElementSibling?.tagName === 'BODY')
    return document

  // 原文里的 </body></html> 会提前关掉外层的 body，后面的内容就丢了，先去掉。
  const wrapped = parseHTML(`<!doctype html><html><head></head><body>${html.replace(/<\/(?:body|html)\s*>/gi, '')}</body></html>`).document
  const title = wrapped.body.querySelector('title:not(svg title)')

  // 被包进 body 的 <title> 挪回 head：document.title 与 Readability 才读得到标题，也不会混进正文。
  if (title)
    wrapped.head.append(title)

  return wrapped
}

/** 按行拼文本：块级元素前后断行，行内空白（含源码换行）合并成一个空格，空行去掉；<pre> 原样保留换行与缩进，<svg> 跳过。 */
function blockText(root: Node): string {
  const lines: string[] = []
  let line = ''
  const breakLine = (): void => {
    const text = line.replace(/\s+/g, ' ').trim()

    if (text)
      lines.push(text)

    line = ''
  }
  const walk = (node: Node): void => {
    for (const child of node.childNodes) {
      if (child.nodeType === TEXT_NODE) {
        line += child.textContent ?? ''
        continue
      }

      if (child.nodeType !== ELEMENT_NODE)
        continue

      const tagName = (child as Element).tagName

      if (tagName === 'SVG')
        continue

      if (tagName === 'PRE') {
        breakLine()
        lines.push((child.textContent ?? '').replace(/^\n/, '').trimEnd())
        continue
      }

      const isBlock = BLOCK_TAGS.has(tagName)

      if (isBlock)
        breakLine()

      walk(child)

      if (isBlock)
        breakLine()
      else if (CELL_TAGS.has(tagName))
        line += ' '
    }
  }

  walk(root)
  breakLine()

  return lines.filter(Boolean).join('\n')
}
