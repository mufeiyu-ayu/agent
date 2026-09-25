import type { MessageGroundingV1 } from '@agent/contracts'
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

import { toConversationMessageResponse } from '../conversations/messages.service.js'
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

describe('ChatService grounding 投影', () => {
  const grounding: MessageGroundingV1 = {
    schemaVersion: 1,
    evidenceAvailability: 'available',
    outcome: 'answered',
    citationIntegrity: 'validated',
    faithfulnessStatus: 'not_evaluated',
    citations: [{
      citationId: 'cit_0123456789abcdef0123456789abcdef',
      sourceId: 301,
      chunkId: 'article-301-chunk-0',
      granularity: 'chunk',
      title: 'SEO 基础',
      slug: 'seo-basics',
      languageCode: 'zh-cn',
      sectionPath: 'Section 0',
      excerpt: '候选片段',
      rank: 1,
      href: null,
      strategy: { name: 'hybrid_rrf', version: '1' },
    }],
  }

  it('done 事件携带 grounding，且与 Messages API 的 durable 投影完全一致', async () => {
    const harness = createHarness([
      runStartedEvent(),
      runCompletedEvent('基于站内资料的回答。', grounding),
    ])

    const events = await collectEvents(await harness.service.chatStream(createInput()))
    const doneEvent = events.at(-1)!

    assert.equal(doneEvent.type, 'done')

    const streamedGrounding = doneEvent.type === 'done'
      ? doneEvent.grounding
      : undefined
    // 同一条持久化记录经 Messages API 投影后必须给出同一份事实。
    const persistedProjection = toConversationMessageResponse({
      id: 'assistant-message-1',
      conversationId: 'conversation-1',
      role: 'ASSISTANT',
      content: '基于站内资料的回答。',
      status: 'COMPLETED',
      createdAt: new Date(GENERATED_AT),
      updatedAt: new Date(GENERATED_AT),
      grounding: {
        messageId: 'assistant-message-1',
        schemaVersion: 1,
        evidenceAvailability: 'available',
        outcome: 'answered',
        citationIntegrity: 'validated',
        faithfulnessStatus: 'not_evaluated',
        citations: grounding.citations,
        createdAt: new Date(GENERATED_AT),
        updatedAt: new Date(GENERATED_AT),
      },
    } as never)

    assert.deepEqual(streamedGrounding, persistedProjection.grounding)
    assert.doesNotMatch(JSON.stringify(events), /evk_/)
  })

  it('普通回答的 done 事件不携带 grounding，legacy Message 投影为 null', async () => {
    const harness = createHarness([
      runStartedEvent(),
      runCompletedEvent('普通回答'),
    ])

    const events = await collectEvents(await harness.service.chatStream(createInput()))
    const doneEvent = events.at(-1)!

    assert.equal(doneEvent.type, 'done')
    assert.equal(
      doneEvent.type === 'done' ? Object.hasOwn(doneEvent, 'grounding') : true,
      false,
    )

    const legacyProjection = toConversationMessageResponse({
      id: 'assistant-message-1',
      conversationId: 'conversation-1',
      role: 'ASSISTANT',
      content: '普通回答',
      status: 'COMPLETED',
      createdAt: new Date(GENERATED_AT),
      updatedAt: new Date(GENERATED_AT),
      grounding: null,
    } as never)

    assert.equal(legacyProjection.grounding, null)
  })

  it('Messages API 只为 COMPLETED assistant Message 投影 Grounding', () => {
    const persistedGrounding = {
      messageId: 'assistant-message-1',
      schemaVersion: 1,
      evidenceAvailability: 'available',
      outcome: 'answered',
      citationIntegrity: 'validated',
      faithfulnessStatus: 'not_evaluated',
      citations: grounding.citations,
      createdAt: new Date(GENERATED_AT),
      updatedAt: new Date(GENERATED_AT),
    }
    const project = (role: string, status: string) =>
      toConversationMessageResponse({
        id: 'assistant-message-1',
        conversationId: 'conversation-1',
        role,
        content: '回答',
        status,
        createdAt: new Date(GENERATED_AT),
        updatedAt: new Date(GENERATED_AT),
        grounding: persistedGrounding,
      } as never)

    assert.ok(project('ASSISTANT', 'COMPLETED').grounding, 'project(\'ASSISTANT\', \'COMPLETED\').grounding')

    // 绕过 Runtime 写到非终态 / 失败消息或用户消息上的 Grounding 不得外泄。
    for (const status of ['PENDING', 'STREAMING', 'FAILED', 'ABORTED']) {
      assert.equal(project('ASSISTANT', status).grounding, null, status)
    }
    assert.equal(project('USER', 'COMPLETED').grounding, null)
  })

  it('语义非法的持久化 Grounding 在 Messages API fail closed', () => {
    const project = (overrides: Record<string, unknown>) =>
      toConversationMessageResponse({
        id: 'assistant-message-1',
        conversationId: 'conversation-1',
        role: 'ASSISTANT',
        content: '回答',
        status: 'COMPLETED',
        createdAt: new Date(GENERATED_AT),
        updatedAt: new Date(GENERATED_AT),
        grounding: {
          messageId: 'assistant-message-1',
          schemaVersion: 1,
          evidenceAvailability: 'available',
          outcome: 'answered',
          citationIntegrity: 'validated',
          faithfulnessStatus: 'not_evaluated',
          citations: grounding.citations,
          createdAt: new Date(GENERATED_AT),
          updatedAt: new Date(GENERATED_AT),
          ...overrides,
        },
      } as never)

    // none / unavailable 不允许 answered，也不允许挂引用。
    assert.equal(
      project({ evidenceAvailability: 'none', citations: [] }).grounding,
      null,
    )
    assert.equal(
      project({ evidenceAvailability: 'unavailable', outcome: 'insufficient_evidence' }).grounding,
      null,
    )
    // answered 必须至少一条引用。
    assert.equal(project({ citations: [] }).grounding, null)
    // v1 的 href 必须为 null。
    assert.equal(
      project({
        citations: [{ ...grounding.citations[0], href: '/articles/seo-basics' }],
      }).grounding,
      null,
    )
  })

  it('持久化 Grounding 损坏时 Messages API fail closed，不透传原始 JSON', () => {
    const projection = toConversationMessageResponse({
      id: 'assistant-message-1',
      conversationId: 'conversation-1',
      role: 'ASSISTANT',
      content: '基于站内资料的回答。',
      status: 'COMPLETED',
      createdAt: new Date(GENERATED_AT),
      updatedAt: new Date(GENERATED_AT),
      grounding: {
        messageId: 'assistant-message-1',
        schemaVersion: 1,
        evidenceAvailability: 'available',
        outcome: 'answered',
        citationIntegrity: 'validated',
        faithfulnessStatus: 'not_evaluated',
        citations: [{ leaked: 'SELECT * FROM "ArticleChunk"' }],
        createdAt: new Date(GENERATED_AT),
        updatedAt: new Date(GENERATED_AT),
      },
    } as never)

    assert.equal(projection.grounding, null)
    assert.doesNotMatch(JSON.stringify(projection), /SELECT|leaked/)
  })
})

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

function runCompletedEvent(
  content: string,
  grounding?: MessageGroundingV1,
): AgentRuntimeEvent {
  return {
    type: 'run_completed',
    runId: 'run-1',
    conversationId: 'conversation-1',
    assistantMessageId: 'assistant-message-1',
    content,
    generatedAt: GENERATED_AT,
    ...(grounding ? { grounding } : {}),
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
