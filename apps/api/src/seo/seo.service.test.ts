import type { AgentRuntimeService } from '../agent-runtime/agent-runtime.service.js'
import type {
  AgentRuntimeEvent,
  RunTurnStreamInput,
} from '../agent-runtime/agent-runtime.types.js'
import type { ChatMessage } from '../llm/llm.types.js'
import type { SeoContextBuilder } from './seo-context-builder.service.js'
import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，不引入新测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import {
  HttpStatus,
  InternalServerErrorException,
  RequestTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common'

import { SeoService } from './seo.service.js'

const GENERATED_AT = '2026-07-18T08:00:00.000Z'

describe('SeoService', () => {
  it('非流式入口忽略过程事件，只投影 run_completed 终态', async () => {
    const harness = createHarness([
      runStartedEvent(),
      assistantDeltaEvent('不应作为最终答案'),
      runCompletedEvent('最终回答'),
    ])

    const result = await harness.service.chat(createInput())

    assert.deepEqual(result, {
      reply: '最终回答',
      generatedAt: GENERATED_AT,
    })
    assert.equal(harness.runtime.inputs.length, 1)
  })

  it('非流式 Tool Loop 只使用 Runtime 的最终回答，不拼接 delta 或工具数据', async () => {
    const harness = createHarness([
      runStartedEvent(),
      assistantDeltaEvent('{"rawArgumentsJson":"secret"}'),
      assistantDeltaEvent('{"ToolResult":{"data":"article-json"}}'),
      runCompletedEvent('找到 1 篇相关文章。'),
    ])

    const result = await harness.service.chat(createInput())

    assert.equal(result.reply, '找到 1 篇相关文章。')
    assert.doesNotMatch(result.reply, /rawArgumentsJson|ToolResult|article-json|secret/)
  })

  it('run_failed 映射为稳定的安全 HTTP 异常', async () => {
    const harness = createHarness([runFailedEvent('provider password=secret')])

    await assert.rejects(
      harness.service.chat(createInput()),
      (error: unknown) => {
        assert.ok(error instanceof ServiceUnavailableException)
        assert.equal(error.getStatus(), HttpStatus.SERVICE_UNAVAILABLE)
        assert.equal(error.message, '模型服务暂时没有返回结果，请稍后重试。')
        assert.doesNotMatch(JSON.stringify(error.getResponse()), /provider|password|secret/)
        return true
      },
    )
  })

  it('run_aborted 映射为失败，不返回 SeoChatResponse 伪成功', async () => {
    const harness = createHarness([runAbortedEvent('部分回答')])

    await assert.rejects(
      harness.service.chat(createInput()),
      (error: unknown) => {
        assert.ok(error instanceof RequestTimeoutException)
        assert.equal(error.getStatus(), HttpStatus.REQUEST_TIMEOUT)
        assert.equal(error.message, '请求已中止，请重新发起。')
        assert.doesNotMatch(JSON.stringify(error.getResponse()), /部分回答/)
        return true
      },
    )
  })

  it('Runtime generator 无 terminal 时明确失败', async () => {
    const harness = createHarness([
      runStartedEvent(),
      assistantDeltaEvent('未完成'),
    ])

    await assert.rejects(
      harness.service.chat(createInput()),
      (error: unknown) => {
        assert.ok(error instanceof InternalServerErrorException)
        assert.equal(error.getStatus(), HttpStatus.INTERNAL_SERVER_ERROR)
        assert.equal(error.message, '请求未能完成，请稍后重试。')
        assert.doesNotMatch(JSON.stringify(error.getResponse()), /未完成/)
        return true
      },
    )
  })

  it('同步与流式入口共享同一 RunTurnStreamInput 配置，只有流式透传 signal', async () => {
    const abortController = new AbortController()
    const harness = createHarness(
      [runCompletedEvent('同步回答')],
      [runCompletedEvent('流式回答')],
    )
    const input = createInput('deepseek-chat')

    await harness.service.chat(input)
    await collectEvents(harness.service.chatStream(input, {
      signal: abortController.signal,
    }))

    assert.equal(harness.runtime.inputs.length, 2)
    const [chatInput, streamInput] = harness.runtime.inputs

    assert.ok(chatInput)
    assert.ok(streamInput)
    assert.deepEqual(withoutFunctionsAndSignal(chatInput), {
      conversationId: 'conversation-1',
      userContent: '用户问题',
      model: 'deepseek-chat',
      historyLimit: 12,
      temperature: 0.4,
      maxTokens: 1200,
    })
    assert.deepEqual(
      withoutFunctionsAndSignal(streamInput),
      withoutFunctionsAndSignal(chatInput),
    )
    assert.equal(Object.hasOwn(chatInput, 'signal'), false)
    assert.equal(streamInput.signal, abortController.signal)

    const historyMessages: ChatMessage[] = [{ role: 'user', content: '历史消息' }]

    assert.deepEqual(
      chatInput.buildModelMessages(historyMessages),
      streamInput.buildModelMessages(historyMessages),
    )
    assert.deepEqual(harness.contextBuilder.historyCalls, [
      historyMessages,
      historyMessages,
    ])
  })

  it('流式入口保持既有五类 ChatStreamEvent 且不暴露 Runtime 字段', async () => {
    const harness = createHarness([
      runStartedEvent(),
      assistantDeltaEvent('增量'),
      runCompletedEvent('最终回答'),
      runFailedEvent('安全错误'),
      runAbortedEvent('部分回答'),
    ])

    const events = await collectEvents(harness.service.chatStream(createInput()))

    assert.deepEqual(events, [
      {
        type: 'start',
        conversationId: 'conversation-1',
        userMessageId: 'user-message-1',
        assistantMessageId: 'assistant-message-1',
      },
      {
        type: 'delta',
        conversationId: 'conversation-1',
        assistantMessageId: 'assistant-message-1',
        contentDelta: '增量',
      },
      {
        type: 'done',
        conversationId: 'conversation-1',
        assistantMessageId: 'assistant-message-1',
        content: '最终回答',
        generatedAt: GENERATED_AT,
      },
      {
        type: 'error',
        conversationId: 'conversation-1',
        assistantMessageId: 'assistant-message-1',
        message: '安全错误',
      },
      {
        type: 'aborted',
        conversationId: 'conversation-1',
        assistantMessageId: 'assistant-message-1',
        content: '部分回答',
      },
    ])
    assert.doesNotMatch(
      JSON.stringify(events),
      /runId|AgentStep|ToolResult|rawArgumentsJson/,
    )
  })
})

class FakeAgentRuntimeService {
  readonly inputs: RunTurnStreamInput[] = []
  private readonly eventSequences: AgentRuntimeEvent[][]

  constructor(...eventSequences: AgentRuntimeEvent[][]) {
    this.eventSequences = eventSequences
  }

  async* runTurnStream(input: RunTurnStreamInput): AsyncGenerator<AgentRuntimeEvent> {
    this.inputs.push(input)

    for (const event of this.eventSequences.shift() ?? [])
      yield event
  }
}

class FakeSeoContextBuilder {
  readonly historyCalls: ChatMessage[][] = []

  buildModelMessages(input: { historyMessages: ChatMessage[] }): ChatMessage[] {
    this.historyCalls.push(input.historyMessages)

    return [
      { role: 'system', content: 'SEO Agent' },
      ...input.historyMessages,
    ]
  }
}

function createHarness(...eventSequences: AgentRuntimeEvent[][]) {
  const runtime = new FakeAgentRuntimeService(...eventSequences)
  const contextBuilder = new FakeSeoContextBuilder()
  const service = new SeoService(
    runtime as unknown as AgentRuntimeService,
    contextBuilder as unknown as SeoContextBuilder,
  )

  return { contextBuilder, runtime, service }
}

function createInput(model?: string) {
  return {
    conversationId: 'conversation-1',
    message: '用户问题',
    ...(model ? { model } : {}),
  }
}

function withoutFunctionsAndSignal(input: RunTurnStreamInput) {
  return {
    conversationId: input.conversationId,
    userContent: input.userContent,
    ...(input.model ? { model: input.model } : {}),
    historyLimit: input.historyLimit,
    temperature: input.temperature,
    maxTokens: input.maxTokens,
  }
}

async function collectEvents<T>(events: AsyncGenerator<T>): Promise<T[]> {
  const collectedEvents: T[] = []

  for await (const event of events)
    collectedEvents.push(event)

  return collectedEvents
}

function runStartedEvent(): AgentRuntimeEvent {
  return {
    type: 'run_started',
    runId: 'run-1',
    conversationId: 'conversation-1',
    userMessageId: 'user-message-1',
    assistantMessageId: 'assistant-message-1',
  }
}

function assistantDeltaEvent(contentDelta: string): AgentRuntimeEvent {
  return {
    type: 'assistant_delta',
    runId: 'run-1',
    conversationId: 'conversation-1',
    assistantMessageId: 'assistant-message-1',
    contentDelta,
  }
}

function runCompletedEvent(content: string): AgentRuntimeEvent {
  return {
    type: 'run_completed',
    runId: 'run-1',
    conversationId: 'conversation-1',
    assistantMessageId: 'assistant-message-1',
    content,
    generatedAt: GENERATED_AT,
  }
}

function runFailedEvent(message: string): AgentRuntimeEvent {
  return {
    type: 'run_failed',
    runId: 'run-1',
    conversationId: 'conversation-1',
    assistantMessageId: 'assistant-message-1',
    message,
  }
}

function runAbortedEvent(content: string): AgentRuntimeEvent {
  return {
    type: 'run_aborted',
    runId: 'run-1',
    conversationId: 'conversation-1',
    assistantMessageId: 'assistant-message-1',
    content,
  }
}
