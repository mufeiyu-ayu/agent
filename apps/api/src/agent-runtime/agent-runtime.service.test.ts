import type { AgentRun, Message } from '../generated/prisma/client.js'
import type { LLMService } from '../llm/llm.service.js'
import type { ChatStreamOptions } from '../llm/llm.types.js'
import type { ModelInputItem } from '../llm/model-input.types.js'
import type {
  ModelFinishReason,
  ModelStreamEvent,
} from '../llm/model-stream.types.js'
import type { PrismaService } from '../prisma/prisma.service.js'
import type { ToolInvocationService } from '../tools/tool-invocation.service.js'
import type { ToolRegistryService } from '../tools/tool-registry.service.js'
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolResult,
  UnvalidatedToolCallEnvelope,
} from '../tools/tool.types.js'
import type { AgentRunRecorderService } from './agent-run-recorder.service.js'
import type { AgentRuntimeEvent } from './agent-runtime.types.js'
import assert from 'node:assert/strict'
// 项目本轮使用 Node 原生测试运行器，不引入 Vitest。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import {
  AgentRunStatus,
  MessageRole,
  MessageStatus,
} from '../generated/prisma/client.js'
import { AgentRuntimeService } from './agent-runtime.service.js'

describe('AgentRuntimeService model stream', () => {
  it('保持普通文本流的现有完成行为', async () => {
    const harness = createHarness(() => toModelStream([
      { type: 'text_delta', delta: '你' },
      { type: 'text_delta', delta: '好' },
      { type: 'response_completed', finishReason: 'stop' },
    ]))

    const events = await collectEvents(harness.run())

    assert.deepEqual(events.map(event => event.type), [
      'run_started',
      'assistant_delta',
      'assistant_delta',
      'run_completed',
    ])
    assert.equal(events.at(-1)?.type, 'run_completed')
    assert.equal(harness.assistantMessage()?.content, '你好')
    assert.equal(harness.assistantMessage()?.status, MessageStatus.COMPLETED)
    assert.deepEqual(harness.recorder.completedRunIds, ['run-1'])
    assert.equal(harness.llmCalls.length, 1)
    assert.equal(harness.toolInvocations.length, 0)
    assert.deepEqual(
      harness.llmCalls[0]?.options?.tools?.map(tool => tool.name),
      ['search_articles'],
    )
  })

  it('执行一次工具并把 Observation 回填第二轮模型输入', async () => {
    const streams: ModelStreamEvent[][] = [
      [
        { type: 'text_delta', delta: '我先查一下。' },
        toolCallEvent('call-1', 'search_articles', '{"query":"seo"}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ],
      [
        { type: 'text_delta', delta: '找到' },
        { type: 'text_delta', delta: '相关文章。' },
        { type: 'response_completed', finishReason: 'stop' },
      ],
    ]
    const harness = createHarness((_, __, callIndex) =>
      toModelStream(streams[callIndex] ?? []))

    const events = await collectEvents(harness.run())

    assert.deepEqual(events.map(event => event.type), [
      'run_started',
      'assistant_delta',
      'assistant_delta',
      'run_completed',
    ])
    assert.deepEqual(harness.toolInvocations, [{
      callId: 'call-1',
      toolName: 'search_articles',
      rawArgumentsJson: '{"query":"seo"}',
      samplingAttemptId: 'run-1:sampling-1',
    }])
    assert.equal(harness.llmCalls.length, 2)
    assert.deepEqual(harness.llmCalls[1]?.messages.slice(-2), [
      {
        type: 'assistant_tool_call',
        callId: 'call-1',
        name: 'search_articles',
        rawArgumentsJson: '{"query":"seo"}',
        content: '我先查一下。',
      },
      {
        type: 'tool_result',
        callId: 'call-1',
        name: 'search_articles',
        content: '找到 1 篇相关文章。',
        ok: true,
      },
    ])
    assert.equal(harness.assistantMessage()?.content, '找到相关文章。')
    assert.equal(harness.assistantMessage()?.status, MessageStatus.COMPLETED)
    assert.doesNotMatch(harness.assistantMessage()?.content ?? '', /sourceId|article-1/)
  })

  it('把工具安全失败作为 Observation 交给第二轮解释', async () => {
    const streams: ModelStreamEvent[][] = [
      [
        toolCallEvent('call-1', 'unknown_tool', '{}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ],
      [
        { type: 'text_delta', delta: '当前无法使用该工具。' },
        { type: 'response_completed', finishReason: 'stop' },
      ],
    ]
    const harness = createHarness(
      (_, __, callIndex) => toModelStream(streams[callIndex] ?? []),
      undefined,
      async envelope => ({
        ok: false,
        code: 'unknown_tool',
        modelContent: `工具 ${envelope.toolName} 不存在。`,
        retryable: false,
      }),
    )

    await collectEvents(harness.run())

    assert.deepEqual(harness.llmCalls[1]?.messages.at(-1), {
      type: 'tool_result',
      callId: 'call-1',
      name: 'unknown_tool',
      content: '工具 unknown_tool 不存在。',
      ok: false,
    })
    assert.equal(harness.assistantMessage()?.content, '当前无法使用该工具。')
  })

  it('把无效参数结果作为脱敏 Observation 交给第二轮解释', async () => {
    const streams: ModelStreamEvent[][] = [
      [
        toolCallEvent('call-1', 'search_articles', '{'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ],
      [
        { type: 'text_delta', delta: '查询参数无效，请换个说法。' },
        { type: 'response_completed', finishReason: 'stop' },
      ],
    ]
    const harness = createHarness(
      (_, __, callIndex) => toModelStream(streams[callIndex] ?? []),
      undefined,
      async envelope => ({
        ok: false,
        code: 'invalid_arguments',
        modelContent: `工具 ${envelope.toolName} 的参数无效。`,
        retryable: false,
      }),
    )

    await collectEvents(harness.run())

    assert.deepEqual(harness.llmCalls[1]?.messages.at(-1), {
      type: 'tool_result',
      callId: 'call-1',
      name: 'search_articles',
      content: '工具 search_articles 的参数无效。',
      ok: false,
    })
    assert.equal(harness.assistantMessage()?.content, '查询参数无效，请换个说法。')
  })

  it('拒绝同轮多个 Tool Call，不执行并行工具', async () => {
    const harness = createHarness(() => toModelStream([
      toolCallEvent('call-1', 'search_articles', '{"query":"seo"}'),
      toolCallEvent('call-2', 'search_articles', '{"query":"vue"}'),
      { type: 'response_completed', finishReason: 'tool_calls' },
    ]))

    const events = await collectEvents(harness.run())

    assert.equal(events.at(-1)?.type, 'run_failed')
    assert.equal(harness.toolInvocations.length, 0)
    assert.equal(harness.llmCalls.length, 1)
  })

  it('拒绝不完整或结束原因冲突的 sampling', async () => {
    const invalidStreams: ModelStreamEvent[][] = [
      [
        toolCallEvent('call-1', 'search_articles', '{"query":"seo"}'),
        { type: 'response_completed', finishReason: 'stop' },
      ],
      [{ type: 'response_completed', finishReason: 'tool_calls' }],
      [{ type: 'text_delta', delta: '未完成' }],
    ]

    for (const stream of invalidStreams) {
      const harness = createHarness(() => toModelStream(stream))
      const events = await collectEvents(harness.run())

      assert.equal(events.at(-1)?.type, 'run_failed')
      assert.equal(harness.toolInvocations.length, 0)
      assert.deepEqual(harness.recorder.completedRunIds, [])
    }
  })

  it('第二轮再次请求工具时按 loop limit 失败', async () => {
    const streams: ModelStreamEvent[][] = [
      [
        toolCallEvent('call-1', 'search_articles', '{"query":"seo"}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ],
      [
        toolCallEvent('call-2', 'search_articles', '{"query":"vue"}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ],
    ]
    const harness = createHarness((_, __, callIndex) =>
      toModelStream(streams[callIndex] ?? []))

    const events = await collectEvents(harness.run())

    assert.equal(events.at(-1)?.type, 'run_failed')
    assert.equal(harness.toolInvocations.length, 1)
    assert.equal(harness.llmCalls.length, 2)
  })

  it('Provider iterator 抛错时收口为 FAILED', async () => {
    const harness = createHarness(() => failingModelStream())

    const events = await collectEvents(harness.run())

    assert.deepEqual(events.map(event => event.type), [
      'run_started',
      'assistant_delta',
      'run_failed',
    ])
    assert.equal(harness.assistantMessage()?.content, '部分')
    assert.equal(harness.assistantMessage()?.status, MessageStatus.FAILED)
    assert.deepEqual(harness.recorder.failedRunIds, ['run-1'])
  })

  it('不把 length、content_filter 或 unknown 当作完整回答', async () => {
    const finishReasons: ModelFinishReason[] = [
      'length',
      'content_filter',
      'unknown',
    ]

    for (const finishReason of finishReasons) {
      const harness = createHarness(() => toModelStream([
        { type: 'response_completed', finishReason },
      ]))

      const events = await collectEvents(harness.run())

      assert.deepEqual(events.map(event => event.type), ['run_started', 'run_failed'])
      assert.equal(harness.assistantMessage()?.status, MessageStatus.FAILED)
      assert.deepEqual(harness.recorder.completedRunIds, [])
    }
  })

  it('AbortSignal 触发后只收口为 ABORTED', async () => {
    const abortController = new AbortController()
    const harness = createHarness(
      () => abortingModelStream(abortController),
      abortController.signal,
    )

    const events = await collectEvents(harness.run())

    assert.deepEqual(events.map(event => event.type), [
      'run_started',
      'assistant_delta',
      'run_aborted',
    ])
    assert.equal(harness.assistantMessage()?.content, '部分')
    assert.equal(harness.assistantMessage()?.status, MessageStatus.ABORTED)
    assert.deepEqual(harness.recorder.abortedRunIds, ['run-1'])
    assert.deepEqual(harness.recorder.failedRunIds, [])
  })

  it('工具执行期间 abort 后不启动第二轮 sampling', async () => {
    const abortController = new AbortController()
    const harness = createHarness(
      () => toModelStream([
        toolCallEvent('call-1', 'search_articles', '{"query":"seo"}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]),
      abortController.signal,
      async (_, context) => {
        abortController.abort()
        context.signal.throwIfAborted()
        return {
          ok: true,
          data: null,
          modelContent: '不会进入第二轮。',
        }
      },
    )

    const events = await collectEvents(harness.run())

    assert.equal(events.at(-1)?.type, 'run_aborted')
    assert.equal(harness.llmCalls.length, 1)
    assert.equal(harness.assistantMessage()?.status, MessageStatus.ABORTED)
    assert.deepEqual(harness.recorder.abortedRunIds, ['run-1'])
  })
})

type CreateModelStream = (
  messages: ModelInputItem[],
  options: ChatStreamOptions | undefined,
  callIndex: number,
) => AsyncGenerator<ModelStreamEvent>

type InvokeTool = (
  envelope: UnvalidatedToolCallEnvelope,
  context: ToolExecutionContext,
) => Promise<ToolResult>

const searchArticlesDefinition: ToolDefinition = {
  name: 'search_articles',
  version: '1.0.0',
  description: '按关键词搜索文章。',
  input: {
    schema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    parse: value => value,
  },
  timeoutMs: 1_000,
  requiresApproval: false,
  idempotent: true,
  risk: {
    level: 'low',
    sideEffect: 'none',
    network: false,
  },
}

const successfulToolResult: ToolResult = {
  ok: true,
  data: {
    results: [{ sourceId: 'article-1' }],
  },
  modelContent: '找到 1 篇相关文章。',
}

function createHarness(
  createModelStream: CreateModelStream,
  signal?: AbortSignal,
  invokeTool: InvokeTool = async () => successfulToolResult,
) {
  const prisma = new FakePrismaService()
  const recorder = new FakeAgentRunRecorderService()
  const llmCalls: Array<{
    messages: ModelInputItem[]
    options: ChatStreamOptions | undefined
  }> = []
  const llmService = {
    chatStream: (messages: ModelInputItem[], options?: ChatStreamOptions) => {
      const callIndex = llmCalls.length

      llmCalls.push({
        messages: structuredClone(messages),
        options,
      })

      return createModelStream(messages, options, callIndex)
    },
  } as unknown as LLMService
  const toolRegistryService = new FakeToolRegistryService()
  const toolInvocationService = new FakeToolInvocationService(invokeTool)
  const service = new AgentRuntimeService(
    llmService,
    prisma as unknown as PrismaService,
    recorder as unknown as AgentRunRecorderService,
    toolRegistryService as unknown as ToolRegistryService,
    toolInvocationService as unknown as ToolInvocationService,
  )

  return {
    llmCalls,
    recorder,
    toolInvocations: toolInvocationService.invocations,
    assistantMessage: () => prisma.messages.find(
      message => message.role === MessageRole.ASSISTANT,
    ),
    run: () => service.runTurnStream({
      conversationId: 'conversation-1',
      userContent: '问题',
      historyLimit: 12,
      temperature: 0.4,
      maxTokens: 1200,
      ...(signal ? { signal } : {}),
      buildModelMessages: historyMessages => historyMessages,
    }),
  }
}

class FakeToolRegistryService {
  listDefinitions(): ToolDefinition[] {
    return [searchArticlesDefinition]
  }
}

class FakeToolInvocationService {
  readonly invocations: UnvalidatedToolCallEnvelope[] = []

  constructor(private readonly invokeTool: InvokeTool) {}

  async invoke(
    envelope: UnvalidatedToolCallEnvelope,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    this.invocations.push(envelope)
    return await this.invokeTool(envelope, context)
  }
}

class FakePrismaService {
  readonly messages: Message[] = []

  readonly conversation = {
    findUnique: async () => ({ id: 'conversation-1' }),
    update: async () => ({ id: 'conversation-1' }),
  }

  readonly message = {
    create: async ({ data }: {
      data: Pick<Message, 'conversationId' | 'role' | 'content'> & Partial<Pick<Message, 'status'>>
    }): Promise<Message> => {
      const now = new Date()
      const message: Message = {
        id: `message-${this.messages.length + 1}`,
        conversationId: data.conversationId,
        role: data.role,
        content: data.content,
        status: data.status ?? MessageStatus.COMPLETED,
        createdAt: now,
        updatedAt: now,
      }

      this.messages.push(message)
      return message
    },
    findMany: async (): Promise<Message[]> => [...this.messages].reverse(),
    update: async ({
      where,
      data,
    }: {
      where: Pick<Message, 'id'>
      data: Pick<Message, 'content' | 'status'>
    }): Promise<Message> => {
      const message = this.messages.find(candidate => candidate.id === where.id)

      if (!message)
        throw new Error(`message ${where.id} not found`)

      message.content = data.content
      message.status = data.status
      message.updatedAt = new Date()
      return message
    },
  }

  async $transaction<T>(operation: (prisma: FakePrismaService) => Promise<T>): Promise<T> {
    return await operation(this)
  }
}

class FakeAgentRunRecorderService {
  readonly completedRunIds: string[] = []
  readonly failedRunIds: string[] = []
  readonly abortedRunIds: string[] = []

  async createRunWithInitialSteps(input: {
    conversationId: string
    userMessageId: string
  }): Promise<AgentRun> {
    const now = new Date()

    return {
      id: 'run-1',
      conversationId: input.conversationId,
      userMessageId: input.userMessageId,
      assistantMessageId: null,
      status: AgentRunStatus.RUNNING,
      startedAt: now,
      endedAt: null,
      createdAt: now,
      updatedAt: now,
    }
  }

  async attachAssistantMessage(): Promise<void> {}

  async startStep(): Promise<void> {}

  async completeStep(): Promise<void> {}

  async completeRun(runId: string): Promise<void> {
    this.completedRunIds.push(runId)
  }

  async failRun(runId: string): Promise<void> {
    this.failedRunIds.push(runId)
  }

  async abortRun(runId: string): Promise<void> {
    this.abortedRunIds.push(runId)
  }
}

async function* toModelStream(
  events: ModelStreamEvent[],
): AsyncGenerator<ModelStreamEvent> {
  yield* events
}

async function* failingModelStream(): AsyncGenerator<ModelStreamEvent> {
  yield { type: 'text_delta', delta: '部分' }
  throw new Error('provider unavailable')
}

async function* abortingModelStream(
  abortController: AbortController,
): AsyncGenerator<ModelStreamEvent> {
  yield { type: 'text_delta', delta: '部分' }
  abortController.abort()
  throw new Error('aborted')
}

function toolCallEvent(
  callId: string,
  name: string,
  argumentsJson: string,
): ModelStreamEvent {
  return {
    type: 'tool_call_completed',
    toolCall: {
      providerCallId: callId,
      name,
      argumentsJson,
      index: 0,
    },
  }
}

async function collectEvents(
  source: AsyncIterable<AgentRuntimeEvent>,
): Promise<AgentRuntimeEvent[]> {
  const events: AgentRuntimeEvent[] = []

  for await (const event of source)
    events.push(event)

  return events
}
