/**
 * 一次性、手动运行：用生产 `OpenAICompatibleClient` 对每个家族各发一次真实的流式 Tool Call 请求，
 * 把响应体的原始 SSE 原样存成 `src/api/__fixtures__/<key>.tool-call.sse`，
 * 供 `openai-completions-fixtures.test.ts` 经 SDK 解析回归。fixture 只有响应体，不含请求头与 key。
 *
 * 服务商取自本机 dev 库：`deepseek-direct` 是 baseUrl 为 `api.deepseek.com` 的 deepseek 服务商，
 * `openai` / `grok` / `gemini` 经中转站；每个 key 取一个可见模型（默认模型优先，再按 sortOrder）。
 * key 用 `AGENT_SECRET_KEY` 解密。SQL 走 psql，与 `export-raw-response-fixtures.ts` 一样默认用 compose 的 dev 容器。
 * 另有 `gemini-direct`：用 `.env` 的 `GEMINI_API_KEY` 直连 Google 官方 OpenAI 兼容端点
 * （2026-09-23 中转站 gemini 上游全线 400 时的替代来源），直连需要代理。
 * 请求体由生产代码按 compat 表与模型行拼装（thinking / reasoning_effort / max_tokens 与运行时一致）。
 *
 *   pnpm --filter @agent/ai exec tsx --env-file=../../.env scripts/record-tool-call-stream-fixtures.ts
 *   pnpm --filter @agent/ai exec tsx --env-file=../../.env scripts/record-tool-call-stream-fixtures.ts grok gemini
 *   # Node ≥ 24 才认 NODE_USE_ENV_PROXY，让全局 fetch 走 https_proxy
 *   NODE_USE_ENV_PROXY=1 https_proxy=http://127.0.0.1:7890 node --env-file=../../.env --import tsx \
 *     scripts/record-tool-call-stream-fixtures.ts gemini-direct
 *
 * 命令行参数只用来挑 key 重录；每跑一次都会产生真实调用费用。
 */
import type { ReasoningEffort } from '@agent/contracts'
import type { ModelStreamEvent, ModelToolSpec } from '../src/types.js'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { familyCompatOf } from '@agent/contracts'
// 解密格式只在 API 里维护一份；脚本不进包的发布面，直接复用。
import { createApiKeyCipher } from '../../../apps/api/src/llm/api-key-cipher.js'
import { OpenAICompatibleClient } from '../src/api/openai-completions.js'
import { resolveChatRequestConfig } from '../src/config.js'

// 库名跟 --env-file 载入的 DATABASE_URL 走（compose 默认 agent，本机可能另起名字）。
const DATABASE = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL).pathname.slice(1) : 'agent'
const PSQL = ['docker', 'exec', 'agent-postgres', 'psql', '-U', 'postgres', '-d', DATABASE]
const FIXTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../src/api/__fixtures__')
const REQUEST_TIMEOUT_MS = 120_000

/** 两个互不依赖的检索，引导支持并行调用的模型在同一轮发出多个 index。 */
const PROMPT = '请用 search_articles 工具分别检索「青柠」和「146」两个关键词。两次检索互不依赖，请在同一轮里同时发起；拿到结果前不要作答。'

const SEARCH_TOOL: ModelToolSpec = {
  name: 'search_articles',
  description: '按关键词检索站内文章，返回匹配文章的标题与摘要。',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '检索关键词' },
      limit: { type: 'integer', description: '最多返回几篇，默认 5' },
    },
    required: ['query'],
    additionalProperties: false,
  },
}

const SQL = `
with candidates as (
  select
    case when p.family = 'deepseek' and split_part(p."baseUrl", '/', 3) = 'api.deepseek.com'
      then 'deepseek-direct'
      else p.family
    end as fixture_key,
    p.family,
    p."baseUrl" as base_url,
    p."apiKeyEncrypted" as api_key_encrypted,
    m."wireName" as wire_name,
    m."contextWindowTokens" as context_window_tokens,
    m."maxOutputTokens" as max_output_tokens,
    m."reasoningEffort" as reasoning_effort,
    m."isDefault" as is_default,
    m."sortOrder" as sort_order
  from "LlmProvider" p
  join "LlmModel" m on m."providerId" = p.id
  where p.enabled and m.visible
),
ranked as (
  -- 同一 key 可能有多个服务商（中转站按组分 key），每个 key 只录一次。
  select *, row_number() over (
    partition by fixture_key order by is_default desc, sort_order, wire_name
  ) as rank
  from candidates
)
select coalesce(json_agg(json_build_object(
  'fixture_key', fixture_key,
  'family', family,
  'base_url', base_url,
  'api_key_encrypted', api_key_encrypted,
  'wire_name', wire_name,
  'context_window_tokens', context_window_tokens,
  'max_output_tokens', max_output_tokens,
  'reasoning_effort', reasoning_effort
) order by fixture_key), '[]')
from ranked
where rank = 1 and fixture_key in ('deepseek-direct', 'openai', 'grok', 'gemini')
`

interface ProviderModelRow {
  fixture_key: string
  family: string
  base_url: string
  api_key_encrypted: string
  wire_name: string
  context_window_tokens: number
  max_output_tokens: number
  reasoning_effort: ReasoningEffort | null
}

interface RecordTarget extends Omit<ProviderModelRow, 'api_key_encrypted'> {
  api_key: string
}

const secretKey = process.env.AGENT_SECRET_KEY

if (!secretKey) {
  console.error('缺少 AGENT_SECRET_KEY，用 --env-file 指向仓库根目录的 .env')
  process.exit(1)
}

const cipher = createApiKeyCipher(secretKey)
const wantedKeys = process.argv.slice(2)
const targets: RecordTarget[] = (JSON.parse(execFileSync(PSQL[0]!, [...PSQL.slice(1), '-Atc', SQL], { encoding: 'utf8' })) as ProviderModelRow[])
  .map(({ api_key_encrypted, ...row }) => ({ ...row, api_key: cipher.decrypt(api_key_encrypted) }))

if (process.env.GEMINI_API_KEY) {
  targets.push({
    fixture_key: 'gemini-direct',
    family: 'gemini',
    base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
    api_key: process.env.GEMINI_API_KEY,
    wire_name: 'gemini-3.8-flash',
    context_window_tokens: 1_048_576,
    max_output_tokens: 65_536,
    reasoning_effort: null,
  })
}

const unknownKeys = wantedKeys.filter(key => !targets.some(target => target.fixture_key === key))

if (unknownKeys.length > 0) {
  console.error(`没有可录制的 key：${unknownKeys.join(', ')}（可选 ${targets.map(target => target.fixture_key).join(', ')}；gemini-direct 需要 GEMINI_API_KEY）`)
  process.exit(1)
}

// SDK 在 createClient() 时取 globalThis.fetch：包一层，把 2xx 响应体读成原文存下，再原样交给 SDK 解析。
const realFetch = globalThis.fetch
let recordedBody: string | undefined

globalThis.fetch = async (input, init) => {
  const response = await realFetch(input, init)

  if (!response.ok)
    return response

  recordedBody = await response.text()

  return new Response(recordedBody, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

let failed = false

for (const target of targets.filter(target => wantedKeys.length === 0 || wantedKeys.includes(target.fixture_key))) {
  const apiKey = target.api_key
  const client = new OpenAICompatibleClient({ apiKey, baseUrl: target.base_url, captureModelIO: false })
  const request = resolveChatRequestConfig({
    wireName: target.wire_name,
    contextWindowTokens: target.context_window_tokens,
    maxOutputTokens: target.max_output_tokens,
    compat: familyCompatOf(target.family),
    reasoningEffort: target.reasoning_effort,
  })
  const events: ModelStreamEvent[] = []
  let adapterError: string | undefined

  recordedBody = undefined

  try {
    for await (const event of client.chatStream(
      [{ type: 'message', role: 'user', content: PROMPT }],
      { request, tools: [SEARCH_TOOL], signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
    )) {
      events.push(event)
    }
  }
  catch (error) {
    adapterError = error instanceof Error ? error.message : String(error)
  }

  const label = `${target.fixture_key.padEnd(16)} ${target.wire_name.padEnd(24)}`

  if (recordedBody === undefined) {
    failed = true
    console.error(`${label} 没拿到 2xx 响应体：${adapterError ?? '未知原因'}`)
    continue
  }
  if (recordedBody.includes(apiKey)) {
    failed = true
    console.error(`${label} 响应体里出现了 key，不写 fixture`)
    continue
  }

  // 适配失败也照样落盘：真实流与严格规则冲突正是要记录的证据。
  writeFileSync(resolve(FIXTURES_DIR, `${target.fixture_key}.tool-call.sse`), recordedBody)
  console.log(`${label} ${adapterError ? `适配失败：${adapterError}` : summarize(events)}`)
}

if (failed)
  process.exit(1)

function summarize(events: ModelStreamEvent[]): string {
  const toolCalls = events.flatMap(event => event.type === 'tool_call_completed'
    ? [`${event.toolCall.index}:${event.toolCall.name}(${event.toolCall.argumentsJson})`]
    : [])
  const finish = events.findLast(event => event.type === 'response_completed')

  return `finish=${finish?.type === 'response_completed' ? finish.finishReason : '无'} toolCalls=[${toolCalls.join(', ')}]`
}
