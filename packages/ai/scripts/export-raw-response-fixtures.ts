/**
 * 一次性、只读：从本机 dev 库的 `AgentStep.debugRawResponse`（AGENT_DEBUG_CAPTURE_MODEL_IO 开启时
 * 由 `teeRawResponseCapture` 聚合出的非流式响应）为每个家族导出一份真实响应 fixture，
 * 落在 `src/api/__fixtures__/<key>.response.json`，供 `openai-completions-fixtures.test.ts` 回归。
 *
 * 取样规则：按 (family, 直连 / 中转) 分组，每组取最新一条 `state = complete` 的响应，
 * 有 Tool Call 的优先（多覆盖一份 Tool Call 身份）；`deepseek` 按 baseUrl 是否为
 * `api.deepseek.com` 拆成 `deepseek-direct` / `deepseek-relay`，其他家族一律经中转站。
 * 输出只带 key / family / wireName / response 与本机 Step 定位，不带服务商地址。
 *
 * 落库时 `toModelIODebugCaptureEnvelope` 已剥掉所有 `reasoning_content`，导出的响应永远不含它；
 * reasoning_content 不变量由手工 `*.chunks.json` 覆盖，本脚本只负责 usage 与 Tool Call 身份的真实样本。
 *
 * 本包零 Prisma、零 pg 依赖，SQL 通过 `psql` 执行：默认走 compose 里的 dev 容器，
 * 命令行参数可整体替换 psql 命令（不要带引号，参数原样传给 execFile）：
 *
 *   pnpm --filter @agent/ai exec tsx scripts/export-raw-response-fixtures.ts
 *   pnpm --filter @agent/ai exec tsx scripts/export-raw-response-fixtures.ts psql postgresql://postgres:postgres@localhost:5432/agent
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const DEFAULT_PSQL = ['docker', 'exec', 'agent-postgres', 'psql', '-U', 'postgres', '-d', 'agent']
const FIXTURES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../src/api/__fixtures__')

const SQL = `
with sampling as (
  select
    s.id as step_id,
    s."createdAt" as captured_at,
    p.family,
    split_part(p."baseUrl", '/', 3) as host,
    m."wireName" as wire_name,
    s.output -> 'debugRawResponse' -> 'value' as response,
    coalesce(s.output -> 'debugRawResponse' -> 'value' -> 'choices' -> 0 -> 'message' ? 'tool_calls', false) as has_tool_calls
  from "AgentStep" s
  -- 按 Run 快照里的模型行 id 精确 join；wireName 只在 Provider 内唯一，同名模型跨 Provider 会错配 host。
  join "LlmModel" m on m.id = s.input -> 'initialContext' ->> 'modelId'
  join "LlmProvider" p on p.id = m."providerId"
  where s.type = 'model_sampling'
    and s.output -> 'debugRawResponse' ->> 'state' = 'complete'
    and s.output -> 'debugRawResponse' -> 'value' -> 'usage' is not null
),
keyed as (
  select *,
    case when family = 'deepseek'
      then case when host = 'api.deepseek.com' then 'deepseek-direct' else 'deepseek-relay' end
      else family
    end as fixture_key
  from sampling
),
ranked as (
  select *, row_number() over (partition by fixture_key order by has_tool_calls desc, captured_at desc) as rank
  from keyed
)
select json_agg(json_build_object(
  'key', fixture_key,
  'stepId', step_id,
  'capturedAt', captured_at,
  'family', family,
  'wireName', wire_name,
  'response', response
) order by fixture_key)
from ranked where rank = 1
`

interface ExportedFixture {
  key: string
  stepId: string
  capturedAt: string
  family: string
  wireName: string
  response: unknown
}

const [command, ...commandArgs] = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_PSQL
const raw = execFileSync(command!, [...commandArgs, '-Atc', SQL], { encoding: 'utf8' }).trim()

// 没有任何可导出的 Step 时 json_agg 为 NULL，psql -At 输出空串。
if (raw === '') {
  console.error('库里没有 state = complete 的 debugRawResponse，先开启 AGENT_DEBUG_CAPTURE_MODEL_IO 跑几轮对话')
  process.exit(1)
}

const fixtures = JSON.parse(raw) as ExportedFixture[]

mkdirSync(FIXTURES_DIR, { recursive: true })

for (const fixture of fixtures) {
  const file = resolve(FIXTURES_DIR, `${fixture.key}.response.json`)

  writeFileSync(file, `${JSON.stringify(fixture, null, 2)}\n`)
  console.log(`${fixture.key.padEnd(16)} ${fixture.wireName.padEnd(20)} step ${fixture.stepId}`)
}
