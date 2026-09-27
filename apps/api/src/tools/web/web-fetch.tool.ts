import type { Response } from 'undici'
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutor,
  ToolResult,
  ValidatedToolInvocation,
} from '../core/tool.types.js'
import type { PageText } from './page-text.worker.js'
import { Buffer } from 'node:buffer'
import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { Injectable } from '@nestjs/common'
import { Agent, fetch } from 'undici'

import { createOutboundDispatcher } from '../../llm/outbound-proxy.js'
import { assertPublicHost, guardedLookup } from './ssrf-guard.js'

// 请求
export const MAX_URL_LENGTH = 2048
const MAX_REDIRECTS = 5
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const USER_AGENT = 'Mozilla/5.0 (compatible; KuroBot/1.0; +https://askkuro.com)'

// 响应
const MAX_BODY_BYTES = 2 * 1024 * 1024
const TEXT_TYPES = new Set(['text/html', 'application/xhtml+xml', 'text/plain'])
const HTML_START_PATTERN = /^(?:\xEF\xBB\xBF)?\s*</
const EMPTY_PAGE = '正文为空，可能是需要浏览器运行脚本才能显示的动态页面'

// 编码
const BOMS = [
  { bytes: [0xEF, 0xBB, 0xBF], encoding: 'utf-8' },
  { bytes: [0xFF, 0xFE], encoding: 'utf-16le' },
  { bytes: [0xFE, 0xFF], encoding: 'utf-16be' },
] as const
const CHARSET_PATTERN = /charset\s*=\s*["']?([\w-]+)/i
const META_CHARSET_PATTERN = /<meta[^<>]+charset\s*=\s*["']?([\w-]+)/i
const META_CHARSET_SCAN_BYTES = 64 * 1024

// 正文提取：线上跑编译后的 .js，测试直接跑源码，worker 也用 .ts（Node 24 自带类型剥离）。
// 2 MB 的页面解析完约占 300 MB 堆，超过堆上限只终止 worker，不拖垮 API 进程。
const PAGE_TEXT_WORKER = new URL(`./page-text.worker${extname(fileURLToPath(import.meta.url))}`, import.meta.url)
const PAGE_TEXT_WORKER_MAX_HEAP_MB = 512

export interface WebFetchInput {
  url: string
}

export const webFetchDefinition: ToolDefinition<WebFetchInput> = {
  name: 'web_fetch',
  version: '1',
  description: '打开一个网页，返回标题和正文纯文本（不含图片和链接）。只支持 HTML 网页和纯文本，不支持 PDF、图片、需要登录或要运行脚本才显示内容的页面。',
  input: {
    schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: '完整的网页地址，以 http:// 或 https:// 开头。' },
      },
      required: ['url'],
      additionalProperties: false,
    },
    parse: parseWebFetchInput,
  },
  // 覆盖整个过程：重定向、下载与正文提取。
  timeoutMs: 15_000,
  maxObservationChars: 20_000,
}

/**
 * 由服务器直接请求目标网站（Issue #206）：每一跳先过 SSRF 检查（`ssrf-guard.ts`），
 * 响应体限 2 MB、只收 HTML 与纯文本，HTML 的正文提取在 worker 里跑（`page-text.worker.ts`）。
 */
@Injectable()
export class WebFetchTool implements ToolExecutor<WebFetchInput> {
  // 配了 OUTBOUND_PROXY_URL 走代理（本地开发）：域名由代理解析，只剩请求前的检查；
  // 没配直连（线上）：连接时再用 guardedLookup 校验一次解析结果，防 DNS 换绑。
  readonly dispatcher = createOutboundDispatcher(new Agent({ connect: { lookup: guardedLookup } }))

  async execute(
    invocation: ValidatedToolInvocation<WebFetchInput>,
    context: ToolExecutionContext,
  ) {
    context.signal.throwIfAborted()

    let url = new URL(invocation.input.url)

    // 自己跟重定向：自动跟随会绕过检查。
    for (let redirects = 0; ; redirects++) {
      await assertPublicHost(url)

      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT },
        redirect: 'manual',
        dispatcher: this.dispatcher,
        signal: context.signal,
      }).catch((error: unknown) => {
        throw unwrapFetchError(error)
      })
      const location = REDIRECT_STATUSES.has(response.status) ? response.headers.get('location') : null

      if (location === null)
        return await readPage(response, url, context.signal)

      await response.body?.cancel()

      if (redirects === MAX_REDIRECTS)
        throw new Error(`web_fetch: more than ${MAX_REDIRECTS} redirects`)

      url = new URL(location, url)
      assertHttpUrl(url)
    }
  }
}

export function parseWebFetchInput(value: unknown): WebFetchInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('invalid web_fetch input')

  const record = value as Record<string, unknown>

  if (Object.keys(record).some(key => key !== 'url') || typeof record.url !== 'string')
    throw new Error('invalid web_fetch input')

  const url = record.url.trim()

  if (url.length === 0 || url.length > MAX_URL_LENGTH)
    throw new Error('invalid web_fetch url')

  assertHttpUrl(new URL(url))

  return { url }
}

/** 只接受 http(s)，不接受带用户名密码的地址；模型给的与重定向跳到的都过这一关。 */
function assertHttpUrl(url: URL): void {
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password)
    throw new Error(`web_fetch: only http(s) urls without credentials, got ${url.protocol}`)
}

/**
 * fetch 的外层错误只有「fetch failed」，连接时被拦截、连不上等真实原因在 cause 里；
 * 双栈地址都连不上时 cause 是 message 为空的 AggregateError，拼出各个地址的原因，日志才看得出来。
 */
function unwrapFetchError(error: unknown): unknown {
  const cause = error instanceof TypeError && error.cause instanceof Error ? error.cause : error

  return cause instanceof AggregateError ? new Error(cause.errors.map(String).join('; ')) : cause
}

/**
 * 最终响应 → modelContent：`标题：`、`链接：<最终地址>`、空行、正文。纯文本也带这个开头，「链接：」一行只能是这里写的。
 * display 给界面（#208）：最终地址、标题与正文字数；不支持的类型模型会拿到说明，界面上算未能完成。
 */
async function readPage(response: Response, url: URL, signal: AbortSignal): Promise<ToolResult> {
  if (!response.ok) {
    await response.body?.cancel()
    throw new Error(`web_fetch: HTTP ${response.status}`)
  }

  const contentType = response.headers.get('content-type') ?? ''
  const mimeType = contentType.split(';')[0]!.trim().toLowerCase()

  if (mimeType && !TEXT_TYPES.has(mimeType)) {
    await response.body?.cancel()
    return { ok: true, modelContent: `不支持的内容类型：${mimeType}`, display: { failure: 'failed' } }
  }

  const bytes = await readBody(response)
  // 没写 Content-Type 时像浏览器一样看开头：以「<」开头按 HTML，否则不支持。
  const isHtml = mimeType ? mimeType !== 'text/plain' : HTML_START_PATTERN.test(bytes.subarray(0, 1024).toString('latin1'))

  if (!mimeType && !isHtml)
    return { ok: true, modelContent: '不支持的内容类型：未知', display: { failure: 'failed' } }

  const text = decodeBody(bytes, contentType, isHtml)
  const page = isHtml ? await extractPageText(text, signal) : { title: '', text }
  const body = page.text.trim()

  return {
    ok: true,
    modelContent: [`标题：${page.title}`, `链接：${url.href}`, '', body || EMPTY_PAGE].join('\n'),
    display: { finalUrl: url.href, title: page.title, chars: body.length },
  }
}

/** 按流读取，超过上限立即中断：不信任 Content-Length，内存不随响应体增长。 */
async function readBody(response: Response): Promise<Buffer> {
  const chunks: Uint8Array[] = []
  let size = 0

  if (response.body) {
    // 在循环里抛错会经迭代器的 return() 取消响应流，连接随之关闭。
    for await (const chunk of response.body) {
      size += chunk.byteLength

      if (size > MAX_BODY_BYTES)
        throw new Error(`web_fetch: response body exceeds ${MAX_BODY_BYTES} bytes`)

      chunks.push(chunk)
    }
  }

  return Buffer.concat(chunks)
}

/**
 * 按规范的优先级选编码：BOM > Content-Type 的 charset > HTML 的 <meta charset> > UTF-8，TextDecoder 不认识的标签（如 cp936）跳过。
 * meta 在前 64 KB 里找：规范的预扫描只看 1024 字节，但浏览器在后面遇到 meta 还会改用新编码，meta 前有大段注释或脚本的老 GBK 站点靠这个。
 * meta 声明 UTF-16 时按 UTF-8：能按 ASCII 读到这个 meta，正文就不是 UTF-16。
 */
function decodeBody(bytes: Buffer, contentType: string, isHtml: boolean): string {
  const bom = BOMS.find(item => item.bytes.every((byte, index) => bytes[index] === byte))
  const meta = isHtml
    ? createDecoder(META_CHARSET_PATTERN.exec(bytes.subarray(0, META_CHARSET_SCAN_BYTES).toString('latin1'))?.[1])
    : undefined
  const decoder = createDecoder(bom?.encoding)
    ?? createDecoder(CHARSET_PATTERN.exec(contentType)?.[1])
    ?? (meta?.encoding.startsWith('utf-16') ? undefined : meta)
    ?? new TextDecoder()

  return decoder.decode(bytes)
}

/** 没写或 TextDecoder 不认识的编码返回 undefined。 */
function createDecoder(label: string | undefined): TextDecoder | undefined {
  try {
    return label ? new TextDecoder(label) : undefined
  }
  catch {
    return undefined
  }
}

/** 在 worker 里提取正文：同步计算只能靠终止线程打断，超时或停止时直接终止，交给 invoke 按超时或停止处理。 */
async function extractPageText(html: string, signal: AbortSignal): Promise<PageText> {
  signal.throwIfAborted()

  return new Promise((resolve, reject) => {
    const worker = new Worker(PAGE_TEXT_WORKER, {
      workerData: html,
      resourceLimits: { maxOldGenerationSizeMb: PAGE_TEXT_WORKER_MAX_HEAP_MB },
    })
    const terminate = (): void => void worker.terminate()

    signal.addEventListener('abort', terminate, { once: true })
    // 只认自己的结果：node --watch（本地 dev）会从 worker 发 { 'watch:import': [...] } 这类依赖追踪消息。
    worker.on('message', (message: { pageText?: PageText }) => {
      if (message.pageText)
        resolve(message.pageText)
    })
    worker.once('error', reject)
    // 正常结束时 Promise 已经 resolve，这里的 reject 不生效。
    worker.once('exit', (code) => {
      signal.removeEventListener('abort', terminate)
      reject(signal.reason ?? new Error(`web_fetch: page text worker exited with code ${code}`))
    })
  })
}
