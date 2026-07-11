import type { AgentRun, Message } from '../generated/prisma/client.js'
import type { LLMService } from '../llm/llm.service.js'
import type {
  ModelFinishReason,
  ModelStreamEvent,
} from '../llm/model-stream.types.js'
import type { PrismaService } from '../prisma/prisma.service.js'
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
  })

  it('在 Tool Loop 未实现时明确失败，不产生成功终态', async () => {
    const harness = createHarness(() => toModelStream([
      {
        type: 'tool_call_completed',
        toolCall: {
          providerCallId: 'call-1',
          name: 'search_articles',
          argumentsJson: '{"query":"seo"}',
          index: 0,
        },
      },
      { type: 'response_completed', finishReason: 'tool_calls' },
    ]))

    const events = await collectEvents(harness.run())
    const terminalEvent = events.at(-1)

    assert.deepEqual(events.map(event => event.type), ['run_started', 'run_failed'])
    assert.match(
      terminalEvent?.type === 'run_failed' ? terminalEvent.message : '',
      /search_articles.*Tool Loop/,
    )
    assert.equal(harness.assistantMessage()?.status, MessageStatus.FAILED)
    assert.deepEqual(harness.recorder.failedRunIds, ['run-1'])
    assert.deepEqual(harness.recorder.completedRunIds, [])
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
})

function createHarness(
  createModelStream: () => AsyncGenerator<ModelStreamEvent>,
  signal?: AbortSignal,
) {
  const prisma = new FakePrismaService()
  const recorder = new FakeAgentRunRecorderService()
  const llmService = {
    chatStream: createModelStream,
  } as unknown as LLMService
  const service = new AgentRuntimeService(
    llmService,
    prisma as unknown as PrismaService,
    recorder as unknown as AgentRunRecorderService,
  )

  return {
    recorder,
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

async function collectEvents(
  source: AsyncIterable<AgentRuntimeEvent>,
): Promise<AgentRuntimeEvent[]> {
  const events: AgentRuntimeEvent[] = []

  for await (const event of source)
    events.push(event)

  return events
}
