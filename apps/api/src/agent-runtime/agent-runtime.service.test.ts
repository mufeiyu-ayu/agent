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
  AgentStepStatus,
  MessageRole,
  MessageStatus,
} from '../generated/prisma/client.js'
import { buildSeoAgentChatMessages } from '../seo/prompts/seo-agent.prompt.js'
import { toChatStreamEvent } from '../seo/seo-chat-stream-event.mapper.js'
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
    assert.deepEqual(harness.recorder.steps.map(step => step.type), [
      'receive_user_message',
      'load_conversation_history',
      'model_sampling',
      'assistant_output',
    ])
    assert.deepEqual(harness.recorder.steps.map(step => step.sequence), [1, 2, 3, 4])
    assert.deepEqual(
      harness.recorder.steps.map(step => step.status),
      Array.from({ length: 4 }).fill(AgentStepStatus.COMPLETED),
    )
    assert.deepEqual(harness.recorder.steps[2]?.input, {
      samplingIndex: 1,
      samplingAttemptId: 'run-1:sampling-1',
      requestedModel: null,
      messageCount: 1,
      toolCount: 1,
    })
    assert.deepEqual(
      withoutDuration(harness.recorder.steps[2]?.output),
      {
        samplingAttemptId: 'run-1:sampling-1',
        finishReason: 'stop',
        usage: null,
        toolCallCount: 0,
        textChars: 2,
        intermediateTextChars: 0,
      },
    )
    assert.equal(
      typeof (harness.recorder.steps[2]?.output as Record<string, unknown>)?.durationMs,
      'number',
    )
    assertNoUnfinishedSteps(harness)
  })

  it('在 response_completed 前实时产出普通回答 delta', async () => {
    const completionGate = createDeferred()
    const harness = createHarness(() => delayedCompletionModelStream(
      '实时回答',
      completionGate.promise,
    ))
    const stream = harness.run()

    assert.equal((await stream.next()).value?.type, 'run_started')

    const deltaPromise = stream.next()
    const yieldedBeforeCompletion = await Promise.race([
      deltaPromise.then(() => true),
      new Promise<false>(resolve => setImmediate(() => resolve(false))),
    ])

    completionGate.resolve()
    const delta = await deltaPromise
    const remainingEvents = await collectEvents(stream)

    assert.equal(yieldedBeforeCompletion, true)
    assert.equal(delta.value?.type, 'assistant_delta')
    assert.equal(
      delta.value?.type === 'assistant_delta' ? delta.value.contentDelta : undefined,
      '实时回答',
    )
    assert.deepEqual(remainingEvents.map(event => event.type), ['run_completed'])
  })

  it('保持外部 ChatStreamEvent 为既有五类协议且不暴露运行记录', async () => {
    const harness = createHarness(() => toModelStream([
      { type: 'text_delta', delta: '稳定' },
      { type: 'response_completed', finishReason: 'stop' },
    ]))

    const events = (await collectEvents(harness.run())).map(toChatStreamEvent)

    assert.deepEqual(events, [
      {
        type: 'start',
        conversationId: 'conversation-1',
        userMessageId: 'message-1',
        assistantMessageId: 'message-2',
      },
      {
        type: 'delta',
        conversationId: 'conversation-1',
        assistantMessageId: 'message-2',
        contentDelta: '稳定',
      },
      {
        type: 'done',
        conversationId: 'conversation-1',
        assistantMessageId: 'message-2',
        content: '稳定',
        generatedAt: harness.assistantMessage()?.updatedAt.toISOString(),
      },
    ])
    assert.doesNotMatch(JSON.stringify(events), /AgentStep|runId|toolResult|rawArguments/)
  })

  it('执行一次工具并把 Observation 回填第二轮模型输入', async () => {
    const streams: ModelStreamEvent[][] = [
      [
        toolCallEvent('call-1', 'search_articles', '{"query":"SP Himeko"}'),
        {
          type: 'usage',
          usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
        },
        { type: 'response_completed', finishReason: 'tool_calls' },
      ],
      [
        { type: 'text_delta', delta: '找到' },
        { type: 'text_delta', delta: '相关文章。' },
        {
          type: 'usage',
          usage: { inputTokens: 20, outputTokens: 4, totalTokens: 24 },
        },
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
      rawArgumentsJson: '{"query":"SP Himeko"}',
      samplingAttemptId: 'run-1:sampling-1',
    }])
    assert.equal(harness.llmCalls.length, 2)
    assert.deepEqual(harness.llmCalls[1]?.messages.slice(-2), [
      {
        type: 'assistant_tool_call',
        callId: 'call-1',
        name: 'search_articles',
        rawArgumentsJson: '{"query":"SP Himeko"}',
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
    assert.deepEqual(harness.recorder.steps.map(step => step.type), [
      'receive_user_message',
      'load_conversation_history',
      'model_sampling',
      'tool_execution',
      'model_sampling',
      'assistant_output',
    ])
    assert.deepEqual(harness.recorder.steps.map(step => step.sequence), [1, 2, 3, 4, 5, 6])
    const samplingSteps = harness.recorder.steps.filter(
      step => step.type === 'model_sampling',
    )
    assert.notEqual(samplingSteps[0]?.id, samplingSteps[1]?.id)
    assert.deepEqual(samplingSteps.map(step => step.input), [
      {
        samplingIndex: 1,
        samplingAttemptId: 'run-1:sampling-1',
        requestedModel: null,
        messageCount: 1,
        toolCount: 1,
      },
      {
        samplingIndex: 2,
        samplingAttemptId: 'run-1:sampling-2',
        requestedModel: null,
        messageCount: 3,
        toolCount: 1,
      },
    ])
    assert.deepEqual(samplingSteps.map(step => withoutDuration(step.output)), [
      {
        samplingAttemptId: 'run-1:sampling-1',
        finishReason: 'tool_calls',
        usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
        toolCallCount: 1,
        textChars: 0,
        intermediateTextChars: 0,
      },
      {
        samplingAttemptId: 'run-1:sampling-2',
        finishReason: 'stop',
        usage: { inputTokens: 20, outputTokens: 4, totalTokens: 24 },
        toolCallCount: 0,
        textChars: 7,
        intermediateTextChars: 0,
      },
    ])
    assert.equal(
      samplingSteps.every(
        step => typeof (step.output as Record<string, unknown>)?.durationMs === 'number',
      ),
      true,
    )
    const toolStep = harness.recorder.steps[3]
    assert.deepEqual(toolStep?.input, {
      callId: 'call-1',
      toolName: 'search_articles',
      toolVersion: '1.0.0',
      samplingAttemptId: 'run-1:sampling-1',
      executionAttempt: 1,
      rawArgumentsChars: 21,
    })
    assert.deepEqual(withoutDuration(toolStep?.output), {
      ok: true,
      originalChars: 11,
      observationChars: 11,
      truncated: false,
    })
    assert.equal(typeof (toolStep?.output as Record<string, unknown>)?.durationMs, 'number')
    assertNoUnfinishedSteps(harness)
  })

  it('在 response_completed 前实时产出第二轮最终回答 delta', async () => {
    const completionGate = createDeferred()
    const harness = createHarness((_, __, callIndex) => callIndex === 0
      ? toModelStream([
          toolCallEvent(
            'call-1',
            'search_articles',
            '{"query":"Silver Wolf","languageCode":"zh-cn","limit":3}',
          ),
          { type: 'response_completed', finishReason: 'tool_calls' },
        ])
      : delayedCompletionModelStream('找到 1 篇文章。', completionGate.promise))
    const stream = harness.run()

    assert.equal((await stream.next()).value?.type, 'run_started')

    const deltaPromise = stream.next()
    const yieldedBeforeCompletion = await Promise.race([
      deltaPromise.then(() => true),
      new Promise<false>(resolve => setImmediate(() => resolve(false))),
    ])

    completionGate.resolve()
    const delta = await deltaPromise
    const remainingEvents = await collectEvents(stream)

    assert.equal(yieldedBeforeCompletion, true)
    assert.equal(delta.value?.type, 'assistant_delta')
    assert.equal(
      delta.value?.type === 'assistant_delta' ? delta.value.contentDelta : undefined,
      '找到 1 篇文章。',
    )
    assert.deepEqual(remainingEvents.map(event => event.type), ['run_completed'])
    assert.equal(harness.llmCalls.length, 2)
    assert.equal(harness.toolInvocations.length, 1)
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
    assert.equal(findStep(harness, 'tool_execution')?.status, AgentStepStatus.FAILED)
    assert.deepEqual(
      withoutDuration(findStep(harness, 'tool_execution')?.output),
      {
        ok: false,
        code: 'unknown_tool',
        retryable: false,
        originalChars: 20,
        observationChars: 20,
        truncated: false,
      },
    )
    assert.deepEqual(harness.recorder.completedRunIds, ['run-1'])
    assertNoUnfinishedSteps(harness)
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
    assert.equal(findStep(harness, 'tool_execution')?.status, AgentStepStatus.FAILED)
    assert.equal(
      (findStep(harness, 'tool_execution')?.output as Record<string, unknown>)?.code,
      'invalid_arguments',
    )
    assert.deepEqual(harness.recorder.completedRunIds, ['run-1'])
    assertNoUnfinishedSteps(harness)
  })

  it('记录 execution_failed 安全摘要并且不自动重试工具', async () => {
    const harness = createHarness(
      (_, __, callIndex) => toModelStream(callIndex === 0
        ? [
            toolCallEvent(
              'call-secret',
              'search_articles',
              '{"query":"seo","password":"db-secret","token":"sk-secret"}',
            ),
            { type: 'response_completed', finishReason: 'tool_calls' },
          ]
        : [
            { type: 'text_delta', delta: '查询暂时失败，请稍后重试。' },
            { type: 'response_completed', finishReason: 'stop' },
          ]),
      undefined,
      async () => ({
        ok: false,
        code: 'execution_failed',
        modelContent: '工具 search_articles 执行失败。',
        retryable: false,
      }),
    )

    await collectEvents(harness.run())

    const durableState = JSON.stringify(harness.recorder.steps)

    assert.equal(harness.toolInvocations.length, 1)
    assert.deepEqual(
      harness.toolExecutionContexts.map(context => context.executionAttempt),
      [1],
    )
    assert.equal(findStep(harness, 'tool_execution')?.status, AgentStepStatus.FAILED)
    assert.doesNotMatch(durableState, /db-secret|sk-secret|password|rawArgumentsJson/)
    assert.doesNotMatch(harness.assistantMessage()?.content ?? '', /db-secret|sk-secret/)
    assert.deepEqual(harness.recorder.completedRunIds, ['run-1'])
    assertNoUnfinishedSteps(harness)
  })

  it('把 timeout 记录为工具失败 Observation，第二轮回答后 Run 仍可完成', async () => {
    const harness = createHarness(
      (_, __, callIndex) => toModelStream(callIndex === 0
        ? [
            toolCallEvent('call-timeout', 'search_articles', '{"query":"seo"}'),
            { type: 'response_completed', finishReason: 'tool_calls' },
          ]
        : [
            { type: 'text_delta', delta: '查询超时，请稍后重试。' },
            { type: 'response_completed', finishReason: 'stop' },
          ]),
      undefined,
      async () => ({
        ok: false,
        code: 'timeout',
        modelContent: '工具 search_articles 执行超时。',
        retryable: false,
      }),
    )

    await collectEvents(harness.run())

    const toolStep = findStep(harness, 'tool_execution')

    assert.equal(toolStep?.status, AgentStepStatus.FAILED)
    assert.equal((toolStep?.output as Record<string, unknown>)?.code, 'timeout')
    assert.equal(harness.toolInvocations.length, 1)
    assert.deepEqual(harness.recorder.completedRunIds, ['run-1'])
    assert.deepEqual(harness.recorder.abortedRunIds, [])
    assertNoUnfinishedSteps(harness)
  })

  it('规范化超大 Unicode Observation，durable Step 不保存 ToolResult.data', async () => {
    const oversizedObservation = '🚀'.repeat(8_100)
    const fullArticle = {
      sourceId: 24,
      content: '完整 Article JSON 不应进入 AgentStep',
      secret: 'result-secret',
    }
    const harness = createHarness(
      (_, __, callIndex) => toModelStream(callIndex === 0
        ? [
            toolCallEvent('call-large', 'search_articles', '{"query":"seo"}'),
            { type: 'response_completed', finishReason: 'tool_calls' },
          ]
        : [
            { type: 'text_delta', delta: '已根据截断后的结果回答。' },
            { type: 'response_completed', finishReason: 'stop' },
          ]),
      undefined,
      async () => ({
        ok: true,
        data: { articles: [fullArticle] },
        modelContent: oversizedObservation,
      }),
    )

    await collectEvents(harness.run())

    const observation = harness.llmCalls[1]?.messages.at(-1)
    const observationContent = observation?.type === 'tool_result'
      ? observation.content
      : ''
    const toolOutput = findStep(harness, 'tool_execution')?.output as Record<string, unknown>
    const durableState = JSON.stringify(harness.recorder.steps)

    assert.ok([...observationContent].length <= 8_000)
    assert.match(observationContent, /truncated|截断/)
    assert.doesNotMatch(observationContent, /\uFFFD/)
    assert.equal(toolOutput.originalChars, 8_100)
    assert.equal(toolOutput.observationChars, [...observationContent].length)
    assert.equal(toolOutput.truncated, true)
    assert.doesNotMatch(durableState, /result-secret|完整 Article JSON|🚀/)
    assert.doesNotMatch(harness.assistantMessage()?.content ?? '', /result-secret|🚀/)
    assertNoUnfinishedSteps(harness)
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
    assertNoUnfinishedSteps(harness)
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
      assert.equal(findStep(harness, 'model_sampling')?.status, AgentStepStatus.FAILED)
      assertNoUnfinishedSteps(harness)
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
    const samplingSteps = harness.recorder.steps.filter(
      step => step.type === 'model_sampling',
    )
    assert.deepEqual(
      samplingSteps.map(step => step.status),
      [AgentStepStatus.COMPLETED, AgentStepStatus.COMPLETED],
    )
    assertNoUnfinishedSteps(harness)
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
    const samplingStep = findStep(harness, 'model_sampling')

    assert.equal(samplingStep?.status, AgentStepStatus.FAILED)
    assert.deepEqual(withoutDuration(samplingStep?.output), {
      samplingAttemptId: 'run-1:sampling-1',
      finishReason: null,
      usage: null,
      toolCallCount: 0,
      textChars: 2,
      intermediateTextChars: 0,
    })
    assert.equal(findStep(harness, 'assistant_output')?.status, AgentStepStatus.FAILED)
    assertNoUnfinishedSteps(harness)
  })

  it('Message 已进入 ABORTED 后拒绝迟到 completion 推进 Step 和 Run', async () => {
    const harness = createHarness(() => toModelStream([
      { type: 'text_delta', delta: '迟到回答' },
      { type: 'response_completed', finishReason: 'stop' },
    ]))
    const stream = harness.run()

    assert.equal((await stream.next()).value?.type, 'run_started')
    assert.equal((await stream.next()).value?.type, 'assistant_delta')

    const assistantMessage = harness.assistantMessage()

    assert.ok(assistantMessage)
    assistantMessage.status = MessageStatus.ABORTED
    assistantMessage.content = '已停止'

    const remainingEvents = await collectEvents(stream)

    assert.deepEqual(remainingEvents.map(event => event.type), ['run_failed'])
    assert.equal(harness.assistantMessage()?.status, MessageStatus.ABORTED)
    assert.equal(harness.assistantMessage()?.content, '已停止')
    assert.deepEqual(harness.recorder.completedRunIds, [])
    assert.deepEqual(harness.recorder.failedRunIds, ['run-1'])
    assert.equal(findStep(harness, 'assistant_output')?.status, AgentStepStatus.FAILED)
    assertNoUnfinishedSteps(harness)
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
      const samplingStep = findStep(harness, 'model_sampling')

      assert.equal(samplingStep?.status, AgentStepStatus.FAILED)
      assert.equal(
        (samplingStep?.output as Record<string, unknown>)?.finishReason,
        finishReason,
      )
      assertNoUnfinishedSteps(harness)
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
    assertNoUnfinishedSteps(harness)
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
    assert.equal(findStep(harness, 'tool_execution')?.status, AgentStepStatus.ABORTED)
    assertNoUnfinishedSteps(harness)
  })
})

describe('SEO Agent tool guidance', () => {
  it('明确站内文章查询和无结果回答边界', () => {
    const systemMessage = buildSeoAgentChatMessages([])[0]

    assert.equal(systemMessage?.role, 'system')
    for (const instruction of [
      'search_articles',
      '不要先输出说明文字',
      '只解释能力，不调用 search_articles',
      '不要为了举例自动执行查询',
      '关键词查询',
      '不是 RAG',
      'Observation',
      '不要编造文章',
    ]) {
      assert.match(systemMessage?.content ?? '', new RegExp(instruction))
    }
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
    toolExecutionContexts: toolInvocationService.contexts,
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
  readonly contexts: ToolExecutionContext[] = []

  constructor(private readonly invokeTool: InvokeTool) {}

  async invoke(
    envelope: UnvalidatedToolCallEnvelope,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    this.invocations.push(envelope)
    this.contexts.push(context)
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
    findUniqueOrThrow: async ({ where }: { where: Pick<Message, 'id'> }): Promise<Message> => {
      const message = this.messages.find(candidate => candidate.id === where.id)

      if (!message)
        throw new Error(`message ${where.id} not found`)

      return message
    },
    updateMany: async ({
      where,
      data,
    }: {
      where: Pick<Message, 'id'> & { status: { in: Message['status'][] } }
      data: Pick<Message, 'content' | 'status'>
    }): Promise<{ count: number }> => {
      const message = this.messages.find(candidate =>
        candidate.id === where.id && where.status.in.includes(candidate.status))

      if (!message)
        return { count: 0 }

      message.content = data.content
      message.status = data.status
      message.updatedAt = new Date()
      return { count: 1 }
    },
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
  readonly steps: RecordedAgentStep[] = []

  async createRun(input: {
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

  async startStep(input: {
    runId: string
    type: string
    input?: unknown
  }): Promise<RecordedAgentStep> {
    const now = new Date()
    const step: RecordedAgentStep = {
      id: `step-${this.steps.length + 1}`,
      runId: input.runId,
      sequence: this.steps.filter(candidate => candidate.runId === input.runId).length + 1,
      type: input.type,
      status: AgentStepStatus.RUNNING,
      input: input.input ?? null,
      output: null,
      errorMessage: null,
      startedAt: now,
      endedAt: null,
    }

    this.steps.push(step)
    return step
  }

  async completeStep(stepId: string, input: { output?: unknown } = {}): Promise<void> {
    this.transitionStep(stepId, AgentStepStatus.COMPLETED, input)
  }

  async failStep(
    stepId: string,
    input: { errorMessage: string, output?: unknown },
  ): Promise<void> {
    this.transitionStep(stepId, AgentStepStatus.FAILED, input)
  }

  async abortStep(
    stepId: string,
    input: { errorMessage?: string, output?: unknown } = {},
  ): Promise<void> {
    this.transitionStep(stepId, AgentStepStatus.ABORTED, input)
  }

  async completeRun(runId: string): Promise<void> {
    assert.equal(
      this.steps.some(step => step.runId === runId && isUnfinishedStep(step)),
      false,
    )
    this.completedRunIds.push(runId)
  }

  async failRun(runId: string, errorMessage: string): Promise<void> {
    this.closeUnfinishedSteps(runId, AgentStepStatus.FAILED, errorMessage)
    this.failedRunIds.push(runId)
  }

  async abortRun(runId: string): Promise<void> {
    this.closeUnfinishedSteps(runId, AgentStepStatus.ABORTED)
    this.abortedRunIds.push(runId)
  }

  private transitionStep(
    stepId: string,
    status: RecordedAgentStep['status'],
    input: { errorMessage?: string, output?: unknown },
  ): void {
    const step = this.steps.find(candidate => candidate.id === stepId)

    assert.ok(step)
    assert.equal(step.status, AgentStepStatus.RUNNING)
    step.status = status
    step.output = input.output ?? null
    step.errorMessage = input.errorMessage ?? null
    step.endedAt = new Date()
  }

  private closeUnfinishedSteps(
    runId: string,
    status: RecordedAgentStep['status'],
    errorMessage?: string,
  ): void {
    for (const step of this.steps) {
      if (step.runId !== runId || !isUnfinishedStep(step))
        continue

      step.status = status
      step.errorMessage = errorMessage ?? null
      step.endedAt = new Date()
    }
  }
}

interface RecordedAgentStep {
  id: string
  runId: string
  sequence: number
  type: string
  status: typeof AgentStepStatus[keyof typeof AgentStepStatus]
  input: unknown
  output: unknown
  errorMessage: string | null
  startedAt: Date
  endedAt: Date | null
}

function findStep(
  harness: ReturnType<typeof createHarness>,
  type: string,
): RecordedAgentStep | undefined {
  return harness.recorder.steps.find(step => step.type === type)
}

function assertNoUnfinishedSteps(harness: ReturnType<typeof createHarness>): void {
  assert.equal(harness.recorder.steps.some(isUnfinishedStep), false)
}

function isUnfinishedStep(step: RecordedAgentStep): boolean {
  return step.status === AgentStepStatus.PENDING
    || step.status === AgentStepStatus.RUNNING
}

function withoutDuration(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return value

  const { durationMs: _, ...rest } = value as Record<string, unknown>
  return rest
}

async function* toModelStream(
  events: ModelStreamEvent[],
): AsyncGenerator<ModelStreamEvent> {
  yield* events
}

async function* delayedCompletionModelStream(
  content: string,
  completionGate: Promise<void>,
): AsyncGenerator<ModelStreamEvent> {
  yield { type: 'text_delta', delta: content }
  await completionGate
  yield { type: 'response_completed', finishReason: 'stop' }
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

function createDeferred(): {
  promise: Promise<void>
  resolve: () => void
} {
  let resolve!: () => void
  const promise = new Promise<void>((done) => {
    resolve = done
  })

  return { promise, resolve }
}
