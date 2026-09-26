import type { AgentRuntimeService } from '../agent-runtime/agent-runtime.service.js'
import type {
  AgentRuntimeEvent,
  AgentRuntimeRunFailedEvent,
  RunTurnStreamInput,
} from '../agent-runtime/agent-runtime.types.js'
import type { LlmModelConfigService } from '../llm/llm-model-config.service.js'
import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，不引入新测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { BadRequestException } from '@nestjs/common'

import { createResolvedLlmModel } from '../llm/__fixtures__.js'
import { LlmModelUnavailableError } from '../llm/llm.errors.js'
import { ChatService } from './chat.service.js'
import { AGENT_INSTRUCTIONS } from './prompts/agent.prompt.js'

const GENERATED_AT = '2026-07-18T08:00:00.000Z'
const RESOLVED_MODEL = createResolvedLlmModel()

describe('ChatService', () => {
  it('流式入口把 DTO 映射为 RunTurnStreamInput，透传 signal，只注入系统提示词', async () => {
    const abortController = new AbortController()
    const harness = createHarness([runCompletedEvent('流式回答')])
    const input = createInput('model-deepseek-v4-flash', 'max')

    await collectEvents(await harness.service.chatStream(input, {
      signal: abortController.signal,
    }))

    assert.equal(harness.runtime.inputs.length, 1)
    const [streamInput] = harness.runtime.inputs

    assert.ok(streamInput, 'streamInput')
    // 模型行 id 在进入 Runtime 之前就解析成快照：Run 开始后后台改配置不影响本次。
    assert.deepEqual(harness.modelConfig.resolvedIds, ['model-deepseek-v4-flash'])
    assert.deepEqual(withoutSignal(streamInput), {
      conversationId: 'conversation-1',
      userContent: '用户问题',
      model: RESOLVED_MODEL,
      reasoningEffort: 'max',
      instructions: AGENT_INSTRUCTIONS,
    })
    assert.equal(streamInput.signal, abortController.signal)

    // 只传系统提示词；历史与当前消息由 Runtime 自行拼接。
    assert.equal(streamInput.instructions.length, 1)
    assert.equal(streamInput.instructions[0]?.role, 'system')
  })

  it('省略 model / reasoningEffort / signal 时解析默认模型，不向 Runtime 传 undefined 键', async () => {
    const harness = createHarness([runCompletedEvent('回答')])

    await collectEvents(await harness.service.chatStream(createInput()))

    const [streamInput] = harness.runtime.inputs

    assert.ok(streamInput, 'streamInput')
    assert.deepEqual(harness.modelConfig.resolvedIds, [undefined])
    assert.deepEqual(Object.keys(streamInput).sort(), [
      'conversationId',
      'instructions',
      'model',
      'userContent',
    ])
  })

  it('模型不可用时在返回事件流之前抛 400，Runtime 不会启动', async () => {
    const harness = createHarness([runCompletedEvent('回答')])

    await assert.rejects(
      harness.service.chatStream(createInput('model-hidden')),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException, 'error instanceof BadRequestException')
        assert.equal(error.message, '请求的模型未对前台开放')
        return true
      },
    )
    assert.equal(harness.runtime.inputs.length, 0)
  })

  it('流式入口保持既有五类 ChatStreamEvent 且不暴露 Runtime 字段', async () => {
    const harness = createHarness([
      runStartedEvent(),
      assistantDeltaEvent('增量'),
      runCompletedEvent('最终回答'),
      runFailedEvent('安全错误', 'conversation_not_found'),
      runAbortedEvent('部分回答'),
    ])

    const events = await collectEvents(await harness.service.chatStream(createInput()))

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
        userMessagePersisted: true,
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
      /runId|failureReason|conversation_not_found|AgentStep|ToolResult|rawArgumentsJson/,
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

function createHarness(...eventSequences: AgentRuntimeEvent[][]) {
  const runtime = new FakeAgentRuntimeService(...eventSequences)
  const modelConfig = {
    resolvedIds: [] as Array<string | undefined>,
    resolveModel: async (modelId?: string) => {
      modelConfig.resolvedIds.push(modelId)

      if (modelId === 'model-hidden')
        throw new LlmModelUnavailableError('请求的模型未对前台开放')

      return RESOLVED_MODEL
    },
  }
  const service = new ChatService(
    runtime as unknown as AgentRuntimeService,
    modelConfig as unknown as LlmModelConfigService,
  )

  return { runtime, modelConfig, service }
}

function createInput(model?: string, reasoningEffort?: 'low' | 'high' | 'max') {
  return {
    conversationId: 'conversation-1',
    message: '用户问题',
    ...(model ? { model } : {}),
    ...(reasoningEffort ? { reasoningEffort } : {}),
  }
}

function withoutSignal(input: RunTurnStreamInput) {
  const { signal: _, ...rest } = input

  return rest
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

function runFailedEvent(
  message: string,
  failureReason?: AgentRuntimeRunFailedEvent['failureReason'],
): AgentRuntimeRunFailedEvent {
  return {
    type: 'run_failed',
    runId: 'run-1',
    conversationId: 'conversation-1',
    assistantMessageId: 'assistant-message-1',
    ...(failureReason ? { failureReason } : {}),
    message,
    userMessagePersisted: true,
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
