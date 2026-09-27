import type { Dispatcher } from 'undici'
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutor,
  ValidatedToolInvocation,
} from '../core/tool.types.js'
import process from 'node:process'
import { Injectable, Logger } from '@nestjs/common'
import { fetch, getGlobalDispatcher } from 'undici'

import { createOutboundProxyAgent, resolveOutboundProxyConfig } from '../../llm/outbound-proxy.js'

export const SERPER_SEARCH_URL = 'https://google.serper.dev/search'
const MAX_QUERY_LENGTH = 200
const RESULT_COUNT = 10
const LOG_BODY_CHARS = 200
// 含汉字就按中文搜（不带 hl 时 Google 容易返回繁体结果）；带假名或谚文的是日文 / 韩文，不加。
const HAN_PATTERN = /\p{Script=Han}/u
const KANA_HANGUL_PATTERN = /[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u

export interface WebSearchInput {
  query: string
}

export const webSearchDefinition: ToolDefinition<WebSearchInput> = {
  name: 'web_search',
  version: '1',
  description: '用 Google 搜索网页，返回最多 10 条结果的标题、链接、摘要和日期。',
  input: {
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '搜索查询词，简短具体，最多 200 个字符。' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    parse: parseWebSearchInput,
  },
  timeoutMs: 10_000,
  maxObservationChars: 8_000,
}

/** 只接 Serper 一家（Issue #204）：换服务商时改这个执行器。 */
@Injectable()
export class WebSearchTool implements ToolExecutor<WebSearchInput> {
  private readonly logger = new Logger(WebSearchTool.name)
  // 与 GoogleAuthService 同一写法：配了 OUTBOUND_PROXY_URL 走代理，没配直连，不替换全局 dispatcher。
  readonly dispatcher: Dispatcher = (() => {
    const proxy = resolveOutboundProxyConfig(process.env)
    return proxy ? createOutboundProxyAgent(proxy) : getGlobalDispatcher()
  })()

  async execute(
    invocation: ValidatedToolInvocation<WebSearchInput>,
    context: ToolExecutionContext,
  ) {
    context.signal.throwIfAborted()

    const apiKey = process.env.SERPER_API_KEY?.trim()

    if (!apiKey) {
      this.logger.error('web_search 失败：未配置 SERPER_API_KEY')
      throw new Error('web search is not configured')
    }

    const { query } = invocation.input
    const response = await fetch(SERPER_SEARCH_URL, {
      method: 'POST',
      headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, num: RESULT_COUNT, ...(isChineseQuery(query) ? { hl: 'zh-cn' } : {}) }),
      dispatcher: this.dispatcher,
      signal: context.signal,
    })

    if (!response.ok) {
      // 额度用完等状态码没有公开文档，靠响应原文判断原因。
      const body = (await response.text()).slice(0, LOG_BODY_CHARS)
      this.logger.error(`web_search 失败：Serper HTTP ${response.status} ${body}`)
      throw new Error(`web search failed with HTTP ${response.status}`)
    }

    const modelContent = formatSearchResults(await response.json())

    context.signal.throwIfAborted()

    return { ok: true as const, modelContent }
  }
}

function isChineseQuery(query: string): boolean {
  return HAN_PATTERN.test(query) && !KANA_HANGUL_PATTERN.test(query)
}

export function parseWebSearchInput(value: unknown): WebSearchInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('invalid web_search input')

  const record = value as Record<string, unknown>

  if (Object.keys(record).some(key => key !== 'query') || typeof record.query !== 'string')
    throw new Error('invalid web_search input')

  const query = record.query.trim()

  if (query.length === 0 || query.length > MAX_QUERY_LENGTH)
    throw new Error('invalid web_search query')

  return { query }
}

/** Serper 响应字段一律按可缺失读取，格式变化时少给结果而不是抛异常。 */
export function formatSearchResults(data: unknown): string {
  const record = asRecord(data)
  const blocks: string[] = []
  const answerBox = asRecord(record.answerBox)
  const answer = text(answerBox.answer) ?? text(answerBox.snippet)

  if (answer)
    blocks.push(['直接答案：', answer, text(answerBox.link)].filter(Boolean).join('\n'))

  const organic = Array.isArray(record.organic) ? record.organic : []

  for (const item of organic.map(asRecord)) {
    const link = text(item.link)

    if (!link)
      continue

    const date = text(item.date)
    blocks.push([
      `标题：${text(item.title) ?? ''}`,
      `链接：${link}`,
      `摘要：${text(item.snippet) ?? ''}`,
      ...(date ? [`日期：${date}`] : []),
    ].join('\n'))
  }

  return blocks.length === 0 ? '没有找到结果' : blocks.join('\n\n')
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
