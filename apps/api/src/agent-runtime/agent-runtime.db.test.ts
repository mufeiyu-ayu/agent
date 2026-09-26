import type {
  ChatStreamOptions,
  ModelInputItem,
  ModelStreamEvent,
} from '@agent/ai'
import type { LLMService } from '../llm/llm.service.js'
import type { AgentRuntimeEvent } from './agent-runtime.types.js'
import type { AgentRuntimePolicyService } from './configuration/agent-runtime.policy.js'
import type {
  TokenEstimator,
  TokenEstimatorInput,
} from './context/deepseek-v4-token-estimator.js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import process from 'node:process'
// 项目使用 Node 原生测试运行器，不为 DB integration 引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { after, before, describe, it } from 'node:test'
import {
  AgentRunStatus,
  AgentStepStatus,
  MessageRole,
  MessageStatus,
} from '../generated/prisma/client.js'
import { createResolvedLlmModel } from '../llm/__fixtures__.js'
import { PrismaService } from '../prisma/prisma.service.js'
import {
  searchArticlesDefinition,
  SearchArticlesTool,
} from '../tools/articles/search-articles.tool.js'
import { ToolInvocationService } from '../tools/core/tool-invocation.service.js'
import { ToolRegistryService } from '../tools/core/tool-registry.service.js'
import { AgentRuntimeService } from './agent-runtime.service.js'
import { SamplingContextPlanner } from './context/sampling-context-planner.js'
import { AgentRunRecorderService } from './lifecycle/agent-run-recorder.service.js'

// 本入口不允许 skip：缺少隔离数据库时必须显式失败，而不是假装通过。
const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim()

if (!testDatabaseUrl) {
  throw new Error(
    'agent runtime DB integration 需要 TEST_DATABASE_URL 指向隔离数据库',
  )
}

if (testDatabaseUrl === process.env.DATABASE_URL?.trim()) {
  throw new Error(
    'TEST_DATABASE_URL 不得与 DATABASE_URL 相同，禁止在开发库上运行 DB integration',
  )
}

const MIGRATIONS_DIR = new URL('../../../../prisma/migrations/', import.meta.url)

const require = createRequire(import.meta.url)
const { Pool: PgPool } = require('pg') as {
  Pool: new (options: {
    connectionString: string
    max: number
    connectionTimeoutMillis: number
  }) => AdminPool
}

interface AdminPool {
  connect: () => Promise<AdminClient>
  query: (text: string, values?: unknown[]) => Promise<unknown>
  end: () => Promise<void>
}

interface AdminClient {
  query: (text: string, values?: unknown[]) => Promise<unknown>
  release: (error?: Error) => void
}

describe('AgentRuntime PostgreSQL integration', { concurrency: 1 }, () => {
  const schema = `runtime_test_${randomUUID().replaceAll('-', '')}`
  let adminPool: AdminPool
  let prisma: PrismaService

  before(async () => {
    assert.ok(testDatabaseUrl, 'testDatabaseUrl')
    assert.match(schema, /^runtime_test_[a-f\d]+$/)
    adminPool = new PgPool({
      connectionString: testDatabaseUrl,
      max: 2,
      connectionTimeoutMillis: 2_000,
    })

    const migrationClient = await adminPool.connect()

    try {
      // identifier 来自上面的 UUID 且经过 regex 复核；PostgreSQL 不支持参数化 identifier。
      await migrationClient.query(`CREATE SCHEMA "${schema}"`)
      await migrationClient.query(
        'SELECT set_config(\'search_path\', $1, false)',
        [`${schema},public`],
      )
      // 按目录顺序应用全部迁移，与 prisma migrate deploy 得到同一份表结构。
      const migrations = (await readdir(MIGRATIONS_DIR, { withFileTypes: true }))
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name)
        .sort()

      for (const migration of migrations) {
        await migrationClient.query(await readFile(
          new URL(`${migration}/migration.sql`, MIGRATIONS_DIR),
          'utf8',
        ))
      }
    }
    finally {
      migrationClient.release()
    }

    prisma = new PrismaService(withSearchPath(testDatabaseUrl, schema))
    await prisma.$connect()
  })

  after(async () => {
    await prisma?.$disconnect()
    if (adminPool) {
      assert.match(schema, /^runtime_test_[a-f\d]+$/)
      await adminPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
      await adminPool.end()
    }
  })

  // ── #167 U+0000：PostgreSQL text / jsonb 都拒收，写进落库副本前必须换掉 ──

  it('#167 AC-01 可见文本含 U+0000：Run COMPLETED，delta 拼接、done 与 Message.content 逐字相等', async () => {
    const conversationId = await createConversation()
    const harness = createHarness(conversationId, [
      () => toModelStream([
        { type: 'text_delta', delta: '先说\u0000结论' },
        { type: 'text_delta', delta: '，再补一句\u0000。' },
        { type: 'response_completed', finishReason: 'stop' },
      ]),
    ])

    const events = await collectEvents(harness.run())
    const completed = events.at(-1)

    assert.ok(completed?.type === 'run_completed', 'completed?.type === \'run_completed\'')
    const streamed = joinDeltas(events)

    assert.equal(streamed, '先说�结论，再补一句�。')
    assert.equal(completed.content, streamed)

    const message = await requireAssistantMessage(conversationId)

    assert.equal(message.status, MessageStatus.COMPLETED)
    assert.equal(message.content, streamed)
    assert.equal((await requireRun(conversationId)).status, AgentRunStatus.COMPLETED)
  })

  it('#167 AC-03 模型给的工具名 / callId 含 U+0000 与孤立代理项：按 unknown_tool 回喂并继续，tool Step 正常收口', async () => {
    const conversationId = await createConversation()
    const harness = createHarness(conversationId, [
      () => toModelStream([
        toolCallEvent('call\u0000-1', 'lookup\u0000\uD83D', '{}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]),
      () => toModelStream([
        { type: 'text_delta', delta: '没有这个工具，直接回答。' },
        { type: 'response_completed', finishReason: 'stop' },
      ]),
    ])

    const events = await collectEvents(harness.run())

    assert.equal(events.at(-1)?.type, 'run_completed')
    // 模型看到的 observation 仍是原文工具名。
    assert.equal(
      harness.llmCalls[1]?.some(item => item.type === 'tool_result' && item.content.includes('lookup\u0000\uD83D')),
      true,
    )

    const run = await requireRun(conversationId)

    assert.equal(run.status, AgentRunStatus.COMPLETED)

    const steps = await listSteps(run.id)
    const toolStep = steps.find(step => step.type === 'tool_execution')

    assert.ok(toolStep, 'toolStep')
    assert.equal(toolStep.status, AgentStepStatus.FAILED)
    assert.deepEqual(
      [(toolStep.input as Record<string, unknown>).callId, (toolStep.input as Record<string, unknown>).toolName],
      ['call�-1', 'lookup��'],
    )
    assert.equal(toolStep.errorMessage, '工具 lookup�� 返回 unknown_tool。')
    assert.equal(steps.some(step => step.status === AgentStepStatus.RUNNING), false)
  })

  it('#167 AC-04 用户消息含 U+0000：落库与模型收到的都是替换后的文本，Run COMPLETED', async () => {
    const conversationId = await createConversation()
    const harness = createHarness(
      conversationId,
      [
        () => toModelStream([
          { type: 'text_delta', delta: '收到。' },
          { type: 'response_completed', finishReason: 'stop' },
        ]),
      ],
      undefined,
      { userContent: 'SEO\u0000 是什么' },
    )

    const events = await collectEvents(harness.run())

    assert.equal(events.at(-1)?.type, 'run_completed')

    const userMessage = await prisma.message.findFirst({
      where: { conversationId, role: MessageRole.USER },
    })

    assert.equal(userMessage?.content, 'SEO� 是什么')
    assert.equal(
      harness.llmCalls[0]?.some(item => item.type === 'message' && item.role === 'user' && item.content === 'SEO� 是什么'),
      true,
    )
    assert.doesNotMatch(JSON.stringify(harness.llmCalls), /\\u0000/)
    assert.equal((await requireRun(conversationId)).status, AgentRunStatus.COMPLETED)
  })

  it('#167 AC-05 已推出含 U+0000 的文本后用户停止：Run / Message 以 ABORTED 收口，不停在 RUNNING', async () => {
    const conversationId = await createConversation()
    const abortController = new AbortController()
    const harness = createHarness(
      conversationId,
      [
        () => toModelStream([
          { type: 'text_delta', delta: '前半段\u0000' },
          { type: 'text_delta', delta: '后半段' },
          { type: 'response_completed', finishReason: 'stop' },
        ]),
      ],
      abortController.signal,
    )

    const events = await collectEvents(harness.run(), (_delta, index) => {
      if (index === 0)
        abortController.abort()
    })

    assert.equal(events.at(-1)?.type, 'run_aborted')

    const message = await requireAssistantMessage(conversationId)

    assert.equal(message.status, MessageStatus.ABORTED)
    assert.equal(joinDeltas(events), '前半段�')
    assert.equal(message.content, '前半段�')

    const run = await requireRun(conversationId)

    assert.equal(run.status, AgentRunStatus.ABORTED)
    assert.equal((await listSteps(run.id)).some(step => step.status === AgentStepStatus.RUNNING), false)
  })

  it('#167 AC-05 已推出含 U+0000 的文本后 deadline 到期：Run / Message 以 FAILED 收口，不停在 RUNNING', async () => {
    const conversationId = await createConversation()
    const harness = createHarness(
      conversationId,
      [
        // 推出第一段后挂住，直到 deadline 中止 Run 信号；之后的 yield 由 runtime 的取消检查接管。
        runSignal => (async function* (): AsyncGenerator<ModelStreamEvent> {
          yield { type: 'text_delta', delta: '先说\u0000一半' }
          await new Promise(resolve => runSignal?.addEventListener('abort', resolve, { once: true }))
          yield { type: 'text_delta', delta: '不会进正文' }
          yield { type: 'response_completed', finishReason: 'stop' }
        })(),
      ],
      undefined,
      // deadline 从 Run 创建时计时，前面还有几次真实 DB 写，留足余量。
      { runDeadlineMs: 2_000 },
    )

    const events = await collectEvents(harness.run())

    assert.equal(events.at(-1)?.type, 'run_failed')

    const message = await requireAssistantMessage(conversationId)

    assert.equal(message.status, MessageStatus.FAILED)
    assert.equal(message.content, '先说�一半')

    const run = await requireRun(conversationId)

    assert.equal(run.status, AgentRunStatus.FAILED)
    assert.equal(run.errorCode, 'deadline')
    assert.equal((await listSteps(run.id)).some(step => step.status === AgentStepStatus.RUNNING), false)
  })

  it('#167 AC-05b 开启 debug 抓取时模型文本含 U+0000：Run COMPLETED，两轮采样 Step 的请求与响应信封都已替换', async () => {
    const conversationId = await createConversation()
    const harness = createHarness(
      conversationId,
      [
        // 第一轮的中间文本原样回填给模型（模型可见保持原文），所以第二轮的请求体里也带着 U+0000。
        () => toModelStream([
          { type: 'text_delta', delta: '先查\u0000一下' },
          toolCallEvent('call-1', 'noop', '{}'),
          { type: 'response_completed', finishReason: 'tool_calls' },
        ]),
        () => toModelStream([
          { type: 'text_delta', delta: '查完了\u0000。' },
          { type: 'response_completed', finishReason: 'stop' },
        ]),
      ],
      undefined,
      { captureModelIO: true },
    )

    const events = await collectEvents(harness.run())

    assert.equal(events.at(-1)?.type, 'run_completed')
    assert.equal(
      harness.llmCalls[1]?.some(item => item.type === 'assistant_tool_call' && item.content === '先查\u0000一下'),
      true,
    )

    const run = await requireRun(conversationId)

    assert.equal(run.status, AgentRunStatus.COMPLETED)

    const samplingSteps = (await listSteps(run.id)).filter(step => step.type === 'model_sampling')
    const outputs = samplingSteps.map(step => step.output as {
      debugRequestBody?: { value?: unknown }
      debugRawResponse?: { value?: { choices?: Array<{ message?: { content?: string } }> } }
    })

    assert.deepEqual(samplingSteps.map(step => step.status), [AgentStepStatus.COMPLETED, AgentStepStatus.COMPLETED])
    assert.equal(outputs[0]?.debugRawResponse?.value?.choices?.[0]?.message?.content, '先查�一下')
    assert.equal(outputs[1]?.debugRawResponse?.value?.choices?.[0]?.message?.content, '查完了�。')
    assert.match(JSON.stringify(outputs[1]?.debugRequestBody), /先查�一下/)
  })

  // ── 脚手架 ──────────────────────────────────────────────

  function createHarness(
    conversationId: string,
    modelStreams: Array<(runSignal?: AbortSignal) => AsyncGenerator<ModelStreamEvent>>,
    signal?: AbortSignal,
    options: {
      userContent?: string
      runDeadlineMs?: number
      /** 模拟开启 AGENT_DEBUG_CAPTURE_MODEL_IO：把请求与拼好的正文交给 debugCapture 回调。 */
      captureModelIO?: boolean
    } = {},
  ) {
    const registry = new ToolRegistryService()

    // 与生产装配一致：allowlist 里的 search_articles 已注册，本文件的用例不调用它。
    registry.register({
      definition: searchArticlesDefinition,
      executor: new SearchArticlesTool(prisma),
    })

    let callIndex = 0
    const llmCalls: ModelInputItem[][] = []
    const llmService = {
      chatStream: (_provider: unknown, messages: ModelInputItem[], chatOptions?: ChatStreamOptions) => {
        const createStream = modelStreams[callIndex]

        callIndex += 1
        llmCalls.push(structuredClone(messages))

        if (!createStream)
          throw new Error(`测试未提供第 ${callIndex} 次模型流`)

        const stream = createStream(chatOptions?.signal)

        return options.captureModelIO && chatOptions?.debugCapture
          ? withDebugCapture(stream, messages, chatOptions.debugCapture)
          : stream
      },
    } as unknown as LLMService
    const tokenEstimator = new TestTokenEstimator()
    const service = new AgentRuntimeService(
      llmService,
      prisma,
      new AgentRunRecorderService(prisma),
      new ToolInvocationService(registry),
      {
        value: {
          historyCandidateHardLimit: 1_000,
          maxSamplingRounds: 3,
          maxToolCalls: 1,
          runDeadlineMs: options.runDeadlineMs ?? 60_000,
        },
      } as AgentRuntimePolicyService,
      registry,
      tokenEstimator,
      new SamplingContextPlanner(tokenEstimator),
    )

    return {
      llmCalls,
      run: () => service.runTurnStream({
        conversationId,
        userContent: options.userContent ?? 'SEO 是什么',
        model: createResolvedLlmModel(),
        reasoningEffort: 'high',
        ...(signal ? { signal } : {}),
        instructions: [],
      }),
    }
  }

  async function createConversation(): Promise<string> {
    const conversation = await prisma.conversation.create({
      data: { title: 'runtime integration' },
    })

    return conversation.id
  }

  async function requireAssistantMessage(conversationId: string) {
    const message = await prisma.message.findFirst({
      where: { conversationId, role: MessageRole.ASSISTANT },
      orderBy: { createdAt: 'desc' },
    })

    assert.ok(message, 'message')
    return message
  }

  async function requireRun(conversationId: string) {
    const run = await prisma.agentRun.findFirst({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
    })

    assert.ok(run, 'run')
    return run
  }

  async function listSteps(runId: string) {
    return await prisma.agentStep.findMany({
      where: { runId },
      orderBy: { sequence: 'asc' },
    })
  }
})

async function collectEvents(
  events: AsyncGenerator<AgentRuntimeEvent>,
  onDelta?: (delta: string, index: number) => void,
): Promise<AgentRuntimeEvent[]> {
  const collected: AgentRuntimeEvent[] = []
  let deltaIndex = 0

  for await (const event of events) {
    collected.push(event)

    if (event.type === 'assistant_delta') {
      onDelta?.(event.contentDelta, deltaIndex)
      deltaIndex += 1
    }
  }

  return collected
}

function joinDeltas(events: AgentRuntimeEvent[]): string {
  return events
    .map(event => event.type === 'assistant_delta' ? event.contentDelta : '')
    .join('')
}

/** 与真实 client 相同的时机：请求发出前交出请求体，流结束后交出拼好的响应。 */
async function* withDebugCapture(
  events: AsyncGenerator<ModelStreamEvent>,
  messages: ModelInputItem[],
  capture: NonNullable<ChatStreamOptions['debugCapture']>,
): AsyncGenerator<ModelStreamEvent> {
  capture.onRequest({ messages })

  let text = ''

  for await (const event of events) {
    if (event.type === 'text_delta')
      text += event.delta
    yield event
  }

  capture.onResponse({
    state: 'complete',
    lastEvent: 'text_delta',
    textChars: text.length,
    toolCallCount: 0,
    rawResponse: { choices: [{ message: { content: text }, finish_reason: 'stop' }] },
  })
}

class TestTokenEstimator implements TokenEstimator {
  estimateRequest(input: TokenEstimatorInput): number {
    return input.items.length + input.tools.length
  }
}

function withSearchPath(connectionString: string, schema: string): string {
  const url = new URL(connectionString)

  url.searchParams.set('schema', schema)
  url.searchParams.set('options', `-c search_path=${schema},public`)
  return url.toString()
}

async function* toModelStream(
  events: ModelStreamEvent[],
): AsyncGenerator<ModelStreamEvent> {
  for (const event of events)
    yield event
}

function toolCallEvent(
  callId: string,
  name: string,
  argumentsJson: string,
): ModelStreamEvent {
  return {
    type: 'tool_call_completed',
    toolCall: { providerCallId: callId, name, argumentsJson, index: 0 },
    reasoningContent: '需要调用工具。',
  }
}
