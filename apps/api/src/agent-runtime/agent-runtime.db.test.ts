import type { AgentRuntimeEvent } from '@agent/agent'
import type {
  ChatStreamOptions,
  ModelInputItem,
  ModelStreamEvent,
} from '@agent/ai'
import type { Prisma } from '../generated/prisma/client.js'
import type { LLMService } from '../llm/llm.service.js'
import type { SerperApiKey } from '../runtime-config/runtime-config.service.js'
import type { RegisteredTool, ToolDefinition, ToolResult } from '../tools/core/tool.types.js'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import process from 'node:process'
import { Logger } from '@nestjs/common'
import { afterAll, beforeAll, describe, it, onTestFinished, vi } from 'vitest'
import { WORKSPACE_DEVELOPMENT_INSTRUCTION } from '../chat/prompts/workspace-development.prompt.js'
import { ConversationsService } from '../conversations/conversations.service.js'
import { MessagesService } from '../conversations/messages.service.js'
import {
  AgentRunStatus,
  AgentStepStatus,
  MessageRole,
  MessageStatus,
} from '../generated/prisma/client.js'
import { createResolvedLlmModel } from '../llm/__fixtures__.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { createRuntimeConfigSnapshot } from '../runtime-config/__fixtures__.js'
import { ToolInvocationService } from '../tools/core/tool-invocation.service.js'
import { ToolRegistryService } from '../tools/core/tool-registry.service.js'
import { webFetchDefinition } from '../tools/web/web-fetch.tool.js'
import { webSearchDefinition, WebSearchTool } from '../tools/web/web-search.tool.js'
import { writeDefinition } from '../tools/workspace/workspace-tools.js'
import { AgentRuntimeService } from './agent-runtime.service.js'
import { ContextCompactionService } from './context/context-compaction.service.js'
import { AgentRunRecorderService } from './lifecycle/agent-run-recorder.service.js'

// 本入口不允许 skip：缺少隔离数据库时必须显式失败，而不是假装通过。
const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim()

if (!testDatabaseUrl) {
  throw new Error(
    '缺少 TEST_DATABASE_URL：先 docker compose --profile integration up -d postgres-test，再按 .env.example 在根目录 .env 配置',
  )
}

if (testDatabaseUrl === process.env.DATABASE_URL?.trim()) {
  throw new Error(
    'TEST_DATABASE_URL 不得与 DATABASE_URL 相同，禁止在开发库上运行真实库测试',
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

describe('AgentRuntime PostgreSQL integration', () => {
  const schema = `runtime_test_${randomUUID().replaceAll('-', '')}`
  let adminPool: AdminPool
  let prisma: PrismaService

  beforeAll(async () => {
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

  afterAll(async () => {
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

  // ── #212 刷新后还原：runtime 真实落库 → listMessages 读回 activity ──

  it('#212 AC-10 真实写入一轮带搜索、读网页与思考的运行后，listMessages 的 activity 正确且不带 observation', async () => {
    const { userId, conversationId } = await createOwnedConversation()
    // 2 万字的网页正文：必须进 observation，不能出现在接口返回里。
    const pageText = `网页正文标记${'长'.repeat(20_000)}`
    const harness = createHarness(
      conversationId,
      [
        () => toModelStream([
          { type: 'reasoning_started' },
          { type: 'reasoning_delta', delta: '先搜一下。' },
          toolCallEvent('call-search', 'web_search', '{"query":"seo"}', '先搜一下。', 0),
          toolCallEvent('call-fetch', 'web_fetch', '{"url":"https://b.example/"}', '先搜一下。', 1),
          { type: 'response_completed', finishReason: 'tool_calls' },
        ]),
        () => toModelStream([
          { type: 'reasoning_started' },
          { type: 'reasoning_delta', delta: '整理\u0000结果。' },
          { type: 'text_delta', delta: '结论。' },
          { type: 'response_completed', finishReason: 'stop' },
        ]),
      ],
      undefined,
      {
        tools: [
          fakeTool(webSearchDefinition, { ok: true, modelContent: '搜索结果', display: { results: [{ title: '来源', url: 'https://a.example/' }] } }),
          fakeTool(webFetchDefinition, { ok: true, modelContent: pageText, display: { finalUrl: 'https://b.example/final', title: '网页标题', chars: pageText.length } }),
        ],
      },
    )

    assert.equal((await collectEvents(harness.run())).at(-1)?.type, 'run_completed')

    const messages = await new MessagesService(prisma, new ConversationsService(prisma)).listMessages(userId, conversationId)
    const [userMessage, assistantMessage] = messages
    const activity = assistantMessage?.activity

    assert.equal(Object.hasOwn(userMessage!, 'activity'), false)
    assert.ok(activity, 'activity')
    assert.ok(Number.isSafeInteger(activity.answerStartedMs) && activity.answerStartedMs! >= 0)
    assert.equal(activity.toolBeforeAnswer, true)
    assert.deepEqual(activity.items.map(item => item.kind === 'tool' ? { ...item, durationMs: typeof item.durationMs } : item), [
      { kind: 'thought', text: '先搜一下。' },
      { kind: 'tool', callId: 'call-search', toolName: 'web_search', query: 'seo', ok: true, durationMs: 'number', results: [{ title: '来源', url: 'https://a.example/' }] },
      { kind: 'tool', callId: 'call-fetch', toolName: 'web_fetch', url: 'https://b.example/', ok: true, durationMs: 'number', finalUrl: 'https://b.example/final', title: '网页标题', chars: pageText.length },
      // 最后一轮的思考经 jsonb 落库，U+0000 换成 U+FFFD。
      { kind: 'thought', text: '整理�结果。' },
    ])
    assert.doesNotMatch(JSON.stringify(messages), /网页正文标记|搜索结果/)
  })

  it('#218 AC-03 同一对话连问两次：第二次首轮采样的输入里带着第一次的工具调用与结果，与第一次当时回喂的逐字相同', async () => {
    const conversationId = await createConversation()
    const question = 'react19 有哪些新特性呀'
    const tools = () => [
      fakeTool(webSearchDefinition, { ok: true, modelContent: '搜索结果：React 19 发布' }),
      fakeTool(webFetchDefinition, { ok: true, modelContent: '网页正文：Actions、use()' }),
    ]
    const first = createHarness(
      conversationId,
      [
        () => toModelStream([
          { type: 'text_delta', delta: '先查一下。' },
          toolCallEvent('call-search', 'web_search', '{"query":"react 19"}', '要搜。', 0),
          toolCallEvent('call-fetch', 'web_fetch', '{"url":"https://react.dev/blog"}', '要搜。', 1),
          { type: 'response_completed', finishReason: 'tool_calls' },
        ]),
        () => toModelStream([
          { type: 'text_delta', delta: 'React 19 新增了 Actions。' },
          { type: 'response_completed', finishReason: 'stop' },
        ]),
      ],
      undefined,
      { userContent: question, tools: tools() },
    )

    assert.equal((await collectEvents(first.run())).at(-1)?.type, 'run_completed')
    assert.equal((await requireAssistantMessage(conversationId)).content, '先查一下。\n\nReact 19 新增了 Actions。')

    const second = createHarness(
      conversationId,
      [() => toModelStream([
        { type: 'text_delta', delta: '上面查过了：React 19 新增了 Actions。' },
        { type: 'response_completed', finishReason: 'stop' },
      ])],
      undefined,
      { userContent: question, tools: tools() },
    )

    assert.equal((await collectEvents(second.run())).at(-1)?.type, 'run_completed')
    assert.deepEqual(second.llmCalls[0], [
      { type: 'message', role: 'user', content: question },
      {
        type: 'assistant_tool_call',
        calls: [
          { callId: 'call-search', name: 'web_search', rawArgumentsJson: '{"query":"react 19"}' },
          { callId: 'call-fetch', name: 'web_fetch', rawArgumentsJson: '{"url":"https://react.dev/blog"}' },
        ],
        // 之前问答的思考不回放。
        reasoningContent: '',
        content: '先查一下。',
      },
      { type: 'tool_result', callId: 'call-search', name: 'web_search', content: '搜索结果：React 19 发布', ok: true },
      { type: 'tool_result', callId: 'call-fetch', name: 'web_fetch', content: '网页正文：Actions、use()', ok: true },
      // 中间文本已在上面的 tool_calls 消息里，最终回答不再重复。
      { type: 'message', role: 'assistant', content: 'React 19 新增了 Actions。' },
      { type: 'message', role: 'user', content: question },
    ])
    // 与第一次问答第二轮请求里回喂的工具来回逐字相同（除 reasoning 外）。
    const replayed = first.llmCalls[1]!.slice(1).map(item => item.type === 'assistant_tool_call' ? { ...item, reasoningContent: '' } : item)

    assert.deepEqual(second.llmCalls[0]!.slice(1, 4), replayed)

    const [, secondRun] = await prisma.agentRun.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } })
    const samplingStep = (await listSteps(secondRun!.id)).find(step => step.type === 'model_sampling')

    // 候选与选入仍按 Message 条数记：一问一答两条。
    assert.equal((samplingStep?.output as { contextPlan?: { historyIncludedCount?: number } }).contextPlan?.historyIncludedCount, 2)
  })

  it('#216 AC-08(c) Serper Key 解不开：web_search 失败并在日志写明原因，同一轮的其他工具与整次对话正常完成', async () => {
    const logs: string[] = []

    vi.spyOn(Logger.prototype, 'error').mockImplementation((...args: unknown[]) => void logs.push(args.join(' ')))
    onTestFinished(() => void vi.restoreAllMocks())

    const conversationId = await createConversation()
    const harness = createHarness(
      conversationId,
      [
        () => toModelStream([
          toolCallEvent('call-search', 'web_search', '{"query":"seo"}', undefined, 0),
          toolCallEvent('call-fetch', 'web_fetch', '{"url":"https://b.example/"}', undefined, 1),
          { type: 'response_completed', finishReason: 'tool_calls' },
        ]),
        () => toModelStream([
          { type: 'text_delta', delta: '搜索暂时不可用，按网页内容回答。' },
          { type: 'response_completed', finishReason: 'stop' },
        ]),
      ],
      undefined,
      {
        tools: [
          { definition: webSearchDefinition, executor: new WebSearchTool() } as unknown as RegisteredTool,
          fakeTool(webFetchDefinition, { ok: true, modelContent: '网页正文', display: { finalUrl: 'https://b.example/', title: '网页', chars: 4 } }),
        ],
        serperApiKey: { status: 'undecryptable' },
      },
    )

    assert.equal((await collectEvents(harness.run())).at(-1)?.type, 'run_completed')

    const toolSteps = await prisma.agentStep.findMany({
      where: { run: { conversationId }, type: 'tool_execution' },
      orderBy: { sequence: 'asc' },
    })

    assert.deepEqual(toolSteps.map(step => (step.output as { ok?: boolean, code?: string }).code ?? 'ok'), ['execution_failed', 'ok'])
    assert.ok(logs.some(log => log.includes('Serper API Key 无法解密')), '日志写明原因')
    assert.equal((await requireAssistantMessage(conversationId)).content, '搜索暂时不可用，按网页内容回答。')
  })

  it('#212 AC-05 / AC-10 旧格式与损坏数据、RUNNING 遗留、FAILED / ABORTED 运行：接口不抛错，按降级规则给出，其余消息照常', async () => {
    const { userId, conversationId } = await createOwnedConversation()
    const at = (seconds: number) => new Date(Date.UTC(2026, 8, 28, 8, 0, seconds))
    const createTurn = async (
      second: number,
      run: { status: AgentRunStatus, messageStatus: MessageStatus },
      steps: Array<{ type: string, status: AgentStepStatus, input?: Prisma.InputJsonValue, output?: Prisma.InputJsonValue }>,
    ) => {
      const user = await prisma.message.create({ data: { conversationId, role: MessageRole.USER, content: `问题 ${second}`, createdAt: at(second) } })
      const assistant = await prisma.message.create({
        data: { conversationId, role: MessageRole.ASSISTANT, content: `回答 ${second}`, status: run.messageStatus, createdAt: at(second + 1) },
      })

      await prisma.agentRun.create({
        data: {
          conversationId,
          userMessageId: user.id,
          assistantMessageId: assistant.id,
          status: run.status,
          createdAt: at(second),
          steps: {
            create: steps.map((step, index) => ({
              sequence: index + 1,
              type: step.type,
              title: step.type,
              status: step.status,
              ...(step.input === undefined ? {} : { input: step.input }),
              ...(step.output === undefined ? {} : { output: step.output }),
              startedAt: at(second),
              ...(step.status === AgentStepStatus.RUNNING ? {} : { endedAt: at(second + 1) }),
            })),
          },
        },
      })

      return assistant.id
    }
    const sampling = 'model_sampling'
    const tool = 'tool_execution'
    const done = AgentStepStatus.COMPLETED

    // C2 之前完成的运行：tool Step 没有 display，采样 Step 没有 answerStartedMs 与最后一轮思考。
    const oldRun = await createTurn(0, { status: AgentRunStatus.COMPLETED, messageStatus: MessageStatus.COMPLETED }, [
      { type: sampling, status: done, output: { toolCallCount: 1, reasoningContent: '旧的思考' } },
      { type: tool, status: done, input: { callId: 'c1', toolName: 'web_search', arguments: '{"query":"seo"}' }, output: { ok: true, observation: '旧 observation' } },
      { type: sampling, status: done, output: { toolCallCount: 0 } },
    ])
    // 损坏数据：output 为字符串、input 为数组、没有 output；tool Step 连工具名都没有，整条回答不出 activity。
    const broken = await createTurn(10, { status: AgentRunStatus.COMPLETED, messageStatus: MessageStatus.COMPLETED }, [
      { type: sampling, status: done, output: 'not-an-object' },
      { type: tool, status: done, input: ['bad'], output: { ok: true, display: { results: 'bad', chars: 'many' } } },
      { type: tool, status: done },
    ])
    // 进程中断遗留：Run / tool Step 停在 RUNNING。
    const orphan = await createTurn(20, { status: AgentRunStatus.RUNNING, messageStatus: MessageStatus.STREAMING }, [
      { type: sampling, status: done, output: { toolCallCount: 1 } },
      { type: tool, status: AgentStepStatus.RUNNING, input: { callId: 'c2', toolName: 'web_fetch' } },
    ])
    // 工具执行中失败 / 停止：被打断的 Step 没有结果。
    const failed = await createTurn(30, { status: AgentRunStatus.FAILED, messageStatus: MessageStatus.FAILED }, [
      { type: sampling, status: done, output: { toolCallCount: 1 } },
      { type: tool, status: AgentStepStatus.FAILED, input: { callId: 'c3', toolName: 'web_search' } },
    ])
    const aborted = await createTurn(40, { status: AgentRunStatus.ABORTED, messageStatus: MessageStatus.ABORTED }, [
      { type: sampling, status: AgentStepStatus.ABORTED, output: { errorCode: 'aborted', answerStartedMs: 1_500 } },
    ])

    const messages = await new MessagesService(prisma, new ConversationsService(prisma)).listMessages(userId, conversationId)
    const activityOf = (id: string) => messages.find(message => message.id === id)?.activity

    assert.equal(messages.length, 10)
    assert.deepEqual(activityOf(oldRun), {
      toolBeforeAnswer: true,
      items: [
        { kind: 'thought', text: '旧的思考' },
        { kind: 'tool', callId: 'c1', toolName: 'web_search', query: 'seo', ok: true, durationMs: 1_000 },
      ],
    })
    assert.equal(activityOf(broken), undefined)
    assert.equal(messages.find(message => message.id === broken)?.content, '回答 10')
    assert.deepEqual(activityOf(orphan)?.items, [{ kind: 'tool', callId: 'c2', toolName: 'web_fetch', ok: false }])
    assert.deepEqual(activityOf(failed)?.items, [{ kind: 'tool', callId: 'c3', toolName: 'web_search', ok: false, durationMs: 1_000 }])
    assert.deepEqual(activityOf(aborted), { answerStartedMs: 1_500, toolBeforeAnswer: false, items: [] })
    assert.doesNotMatch(JSON.stringify(messages), /旧 observation/)
  })

  it('#212 AC-04 一条回答对应多个运行时取最新的一个', async () => {
    const { userId, conversationId } = await createOwnedConversation()
    const user = await prisma.message.create({ data: { conversationId, role: MessageRole.USER, content: '问题' } })
    const assistant = await prisma.message.create({ data: { conversationId, role: MessageRole.ASSISTANT, content: '回答' } })
    const createRun = (createdAt: Date, query: string) => prisma.agentRun.create({
      data: {
        conversationId,
        userMessageId: user.id,
        assistantMessageId: assistant.id,
        status: AgentRunStatus.COMPLETED,
        createdAt,
        steps: {
          create: [{
            sequence: 1,
            type: 'tool_execution',
            title: 'tool_execution',
            status: AgentStepStatus.COMPLETED,
            input: { callId: 'c', toolName: 'web_search', arguments: JSON.stringify({ query }) },
            output: { ok: true },
          }],
        },
      },
    })

    await createRun(new Date(Date.UTC(2026, 8, 28, 9)), '新的')
    await createRun(new Date(Date.UTC(2026, 8, 28, 8)), '旧的')

    const messages = await new MessagesService(prisma, new ConversationsService(prisma)).listMessages(userId, conversationId)
    const item = messages[1]?.activity?.items[0]

    assert.equal(item?.kind === 'tool' && item.query, '新的')
  })

  it('指南重新规划的正常开发 Run：工具只执行一次，流与数据库历史均不制造失败', async () => {
    const { userId, conversationId } = await createOwnedConversation()
    const execute = vi.fn(async () => ({ ok: true as const, modelContent: '已执行' }))
    const plan = () => toModelStream([toolCallEvent('write', 'write', '{"path":"a.txt","content":"ok"}'), { type: 'response_completed', finishReason: 'tool_calls' }])
    const harness = createHarness(conversationId, [plan, plan, () => toModelStream([{ type: 'text_delta', delta: '完成' }, { type: 'response_completed', finishReason: 'stop' }])], undefined, { tools: [{ definition: writeDefinition, executor: { execute } }] })
    const events = await collectEvents(harness.run())
    assert.equal(events.at(-1)?.type, 'run_completed')
    assert.equal(execute.mock.calls.length, 1)
    const steps = await listSteps((await requireRun(conversationId)).id)
    const tools = steps.filter(step => step.type === 'tool_execution')
    assert.deepEqual(tools.map(step => step.status), [AgentStepStatus.COMPLETED, AgentStepStatus.COMPLETED])
    assert.deepEqual(tools.map(step => (step.output as { code?: string }).code ?? 'ok'), ['workspace_replan', 'ok'])
    const guide = steps.find(step => step.type === 'workspace_development')!
    assert.deepEqual(guide.output, { instruction: WORKSPACE_DEVELOPMENT_INSTRUCTION })
    assert.equal(((steps.filter(step => step.type === 'model_sampling')[1]!.input as { workspaceDevelopment: { stepId: string } }).workspaceDevelopment).stepId, guide.id)
    const activity = (await new MessagesService(prisma, new ConversationsService(prisma)).listMessages(userId, conversationId)).at(-1)!.activity!
    const history = activity.items.filter(item => item.kind === 'tool')
    const live = events.filter(event => event.type === 'tool_finished')
    assert.deepEqual(history.map(item => [item.ok, item.failure, item.skipped]), live.map(event => [event.ok, event.failure, event.skipped]))
  })

  // ── 脚手架 ──────────────────────────────────────────────

  function createHarness(
    conversationId: string,
    modelStreams: Array<(runSignal?: AbortSignal) => AsyncGenerator<ModelStreamEvent>>,
    signal?: AbortSignal,
    options: {
      userContent?: string
      runDeadlineMs?: number
      /** 模拟运行配置打开「抓取模型原始请求」：把请求与拼好的正文交给 debugCapture 回调。 */
      captureModelIO?: boolean
      /** 注册进 Registry 的工具；不给时 Registry 为空，调用一律走 unknown_tool。 */
      tools?: RegisteredTool[]
      /** 运行配置快照里的 Serper Key；不给时为没配。 */
      serperApiKey?: SerperApiKey
    } = {},
  ) {
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
    const registry = new ToolRegistryService()

    for (const tool of options.tools ?? [])
      registry.register(tool)

    const recorder = new AgentRunRecorderService(prisma)
    const service = new AgentRuntimeService(
      llmService,
      prisma,
      recorder,
      new ToolInvocationService(registry),
      new ContextCompactionService(llmService, prisma, recorder),
    )

    return {
      llmCalls,
      run: () => service.runTurnStream({
        conversationId,
        userContent: options.userContent ?? 'SEO 是什么',
        model: createResolvedLlmModel(),
        runtimeConfig: createRuntimeConfigSnapshot({
          limits: {
            runDeadlineMs: options.runDeadlineMs ?? 60_000,
          },
          debugCaptureModelIo: options.captureModelIO ?? false,
          ...(options.serperApiKey ? { serperApiKey: options.serperApiKey } : {}),
        }),
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

  /** listMessages 按归属校验：会话挂在一个真实用户名下。 */
  async function createOwnedConversation(): Promise<{ userId: string, conversationId: string }> {
    const user = await prisma.user.create({ data: { email: `${randomUUID()}@example.com` } })
    const conversation = await prisma.conversation.create({
      data: { title: 'activity integration', userId: user.id },
    })

    return { userId: user.id, conversationId: conversation.id }
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
  reasoningContent = '需要调用工具。',
  index = 0,
): ModelStreamEvent {
  return {
    type: 'tool_call_completed',
    toolCall: { providerCallId: callId, name, argumentsJson, index },
    reasoningContent,
  }
}

/** 真实定义（参数校验、Observation 上限）+ 固定结局的执行器：不发网络请求。 */
function fakeTool<TInput>(definition: ToolDefinition<TInput>, result: ToolResult): RegisteredTool {
  return { definition, executor: { execute: async () => result } } as unknown as RegisteredTool
}
