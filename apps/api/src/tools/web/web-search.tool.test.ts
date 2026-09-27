import type { DatabaseOperationDeadline } from '../../prisma/prisma.service.js'
import type { ToolInvocationContext } from '../core/tool.types.js'
import assert from 'node:assert/strict'
import { Logger } from '@nestjs/common'
import { getGlobalDispatcher, ProxyAgent } from 'undici'
import { afterEach, beforeEach, describe, it, vi } from 'vitest'

import { ToolInvocationService } from '../core/tool-invocation.service.js'
import { ToolRegistryService } from '../core/tool-registry.service.js'
import {
  formatSearchResults,
  parseWebSearchInput,
  SERPER_SEARCH_URL,
  webSearchDefinition,
  WebSearchTool,
} from './web-search.tool.js'

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }))

vi.mock('undici', async importOriginal => ({
  ...await importOriginal<typeof import('undici')>(),
  fetch: fetchMock,
}))

const API_KEY = 'test-serper-key-abcd'

beforeEach(() => {
  vi.stubEnv('SERPER_API_KEY', API_KEY)
  vi.stubEnv('OUTBOUND_PROXY_URL', '')
  fetchMock.mockReset()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('web_search 参数', () => {
  it('合法输入去首尾空白', () => {
    assert.deepEqual(parseWebSearchInput({ query: '  武汉 天气  ' }), { query: '武汉 天气' })
    assert.deepEqual(parseWebSearchInput({ query: 'x'.repeat(200) }), { query: 'x'.repeat(200) })
  })

  it('缺 query、空串、超 200 字符、非字符串、额外字段都抛错', () => {
    for (const input of [null, [], {}, { query: '   ' }, { query: 'x'.repeat(201) }, { query: 1 }, { query: 'a', num: 5 }])
      assert.throws(() => parseWebSearchInput(input), /invalid web_search/)
  })
})

describe('web_search 执行器', () => {
  it('请求 Serper：地址、密钥头、body；中文查询带 hl，纯英文不带', async () => {
    fetchMock.mockImplementation(async () => jsonResponse({ organic: [] }))
    const tool = new WebSearchTool()

    await tool.execute({ toolName: 'web_search', input: { query: '武汉 天气' } }, createContext())
    await tool.execute({ toolName: 'web_search', input: { query: 'Google core update' } }, createContext())
    await tool.execute({ toolName: 'web_search', input: { query: '原神 公式サイト' } }, createContext())

    const [url, zhInit] = fetchMock.mock.calls[0]!
    const [, enInit] = fetchMock.mock.calls[1]!
    assert.equal(url, SERPER_SEARCH_URL)
    assert.equal(zhInit.method, 'POST')
    assert.equal(zhInit.headers['X-API-KEY'], API_KEY)
    assert.equal(zhInit.dispatcher, tool.dispatcher)
    assert.deepEqual(JSON.parse(zhInit.body), { q: '武汉 天气', num: 10, hl: 'zh-cn' })
    assert.deepEqual(JSON.parse(enInit.body), { q: 'Google core update', num: 10 })
    // 日文带假名，虽有汉字也不加 hl。
    assert.deepEqual(JSON.parse(fetchMock.mock.calls[2]![1].body), { q: '原神 公式サイト', num: 10 })
  })

  it('answerBox 在最前，organic 映射为标题 / 链接 / 摘要 / 日期（无日期不带）', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      answerBox: { snippet: '330 米', link: 'https://a.example' },
      organic: [
        { title: 'T1', link: 'https://1.example', snippet: 'S1', date: '2 days ago', position: 1 },
        { title: 'T2', link: 'https://2.example', snippet: 'S2', position: 2 },
      ],
    }))

    const result = await new WebSearchTool().execute(
      { toolName: 'web_search', input: { query: 'eiffel tower height' } },
      createContext(),
    )

    assert.deepEqual(result, {
      ok: true,
      modelContent: [
        '直接答案：\n330 米\nhttps://a.example',
        '标题：T1\n链接：https://1.example\n摘要：S1\n日期：2 days ago',
        '标题：T2\n链接：https://2.example\n摘要：S2',
      ].join('\n\n'),
    })
  })

  it('answerBox 先读 answer；空结果、organic 缺失或格式不对、单条缺 link 时不抛错', () => {
    assert.match(formatSearchResults({ answerBox: { answer: 'A', snippet: 'S' } }), /^直接答案：\nA$/)
    assert.equal(formatSearchResults({ organic: [] }), '没有找到结果')
    assert.equal(formatSearchResults({}), '没有找到结果')
    assert.equal(formatSearchResults(null), '没有找到结果')
    assert.equal(formatSearchResults({ organic: 'oops' }), '没有找到结果')
    assert.equal(
      formatSearchResults({ organic: [{ title: 'no link' }, null, { title: 'T', link: 'https://x.example' }] }),
      '标题：T\n链接：https://x.example\n摘要：',
    )
  })

  it('signal 已中断时不发请求', async () => {
    const abortController = new AbortController()
    abortController.abort()

    await assert.rejects(
      new WebSearchTool().execute({ toolName: 'web_search', input: { query: 'a' } }, createContext(abortController.signal)),
      { name: 'AbortError' },
    )
    assert.equal(fetchMock.mock.calls.length, 0)
  })

  it('请求中途停止时随之取消', async () => {
    const abortController = new AbortController()
    fetchMock.mockImplementation((_url: string, init: { signal: AbortSignal }) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason))
    }))

    const pending = new WebSearchTool().execute(
      { toolName: 'web_search', input: { query: 'a' } },
      createContext(abortController.signal),
    )
    abortController.abort()

    await assert.rejects(pending, { name: 'AbortError' })
    assert.equal(fetchMock.mock.calls[0]?.[1].signal, abortController.signal)
  })

  it('配了 OUTBOUND_PROXY_URL 走代理，未配直连', () => {
    assert.equal(new WebSearchTool().dispatcher, getGlobalDispatcher())

    vi.stubEnv('OUTBOUND_PROXY_URL', 'http://127.0.0.1:7890')
    assert.ok(new WebSearchTool().dispatcher instanceof ProxyAgent, 'dispatcher instanceof ProxyAgent')
  })
})

describe('web_search 经 ToolInvocationService', () => {
  it('合法参数得到结果；参数无效时不执行，返回 invalid_arguments', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ organic: [{ title: 'T', link: 'https://x.example', snippet: 'S' }] }))
    const invocationService = createInvocationService()

    const ok = await invocationService.invoke(createEnvelope({ query: ' seo ' }), createContext())
    const invalid = await invocationService.invoke(createEnvelope({ query: '' }), createContext())

    assert.equal(ok.result.ok, true)
    assert.equal(invalid.result.ok ? undefined : invalid.result.code, 'invalid_arguments')
    assert.equal(fetchMock.mock.calls.length, 1)
  })

  it('未配密钥、Serper 返回 401 / 403 / 429 / 5xx 时得到 execution_failed，日志有状态码与响应摘要且不含密钥', async () => {
    const logs: string[] = []
    const record = (...args: unknown[]) => void logs.push(JSON.stringify(args))
    vi.spyOn(Logger.prototype, 'error').mockImplementation(record)
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(record)
    const invocationService = createInvocationService()
    const outcomes: string[] = []

    for (const status of [401, 403, 429, 500, 503]) {
      fetchMock.mockResolvedValueOnce(new Response(`{"message":"status ${status}"}`, { status }))
      const { result } = await invocationService.invoke(createEnvelope({ query: 'a' }), createContext())
      outcomes.push(result.ok ? 'ok' : `${result.code}:${result.modelContent}`)
    }

    vi.stubEnv('SERPER_API_KEY', '')
    const { result } = await invocationService.invoke(createEnvelope({ query: 'a' }), createContext())
    outcomes.push(result.ok ? 'ok' : `${result.code}:${result.modelContent}`)

    assert.deepEqual(outcomes, Array.from({ length: 6 }).fill('execution_failed:工具 web_search 执行失败。'))
    for (const status of [401, 403, 429, 500, 503])
      assert.ok(logs.some(log => log.includes(`Serper HTTP ${status} {\\"message\\":\\"status ${status}\\"}`)), `log ${status}`)
    assert.ok(logs.some(log => log.includes('未配置 SERPER_API_KEY')), 'log missing key')
    assert.ok(logs.some(log => log.includes('web search failed with HTTP 429')), 'error message logged')
    assert.ok(!logs.join('\n').includes(API_KEY), 'logs must not contain the key')
    assert.ok(!outcomes.join('\n').includes(API_KEY), 'modelContent must not contain the key')
  })
})

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } })
}

function createInvocationService() {
  const registry = new ToolRegistryService()
  registry.register({ definition: webSearchDefinition, executor: new WebSearchTool() })
  return new ToolInvocationService(registry)
}

function createEnvelope(input: Record<string, unknown>) {
  return { callId: 'call-web-1', toolName: 'web_search', rawArgumentsJson: JSON.stringify(input) }
}

function createContext(signal = new AbortController().signal): ToolInvocationContext {
  const databaseDeadline: DatabaseOperationDeadline = {
    deadlineAt: Date.now() + 60_000,
    signal,
    createTimeoutError: () => new Error('test database deadline exceeded'),
  }
  return { databaseDeadline, signal, argumentsTruncated: false }
}
