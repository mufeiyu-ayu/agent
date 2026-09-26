import type {
  ChatStreamOptions,
  ModelFinishReason,
  ModelInputItem,
  ModelStreamEvent,
} from '@agent/ai'
import type { AgentRunErrorCode } from '@agent/contracts'
import type { ChatCompletionChunk } from 'openai/resources/chat/completions'
import type { AgentRun, Message, Prisma } from '../generated/prisma/client.js'
import type { ResolvedLlmModel } from '../llm/llm-model-config.service.js'
import type { LLMService } from '../llm/llm.service.js'
import type {
  DatabaseOperationDeadline,
  DeadlineTransaction,
  PrismaService,
} from '../prisma/prisma.service.js'
import type { ToolInvocationService } from '../tools/core/tool-invocation.service.js'
import type { ToolRegistryService } from '../tools/core/tool-registry.service.js'
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolResult,
  UnvalidatedToolCallEnvelope,
} from '../tools/core/tool.types.js'
import type { AgentRuntimeEvent, RunTurnStreamInput } from './agent-runtime.types.js'
import type {
  AgentRuntimePolicy,
  AgentRuntimePolicyService,
} from './configuration/agent-runtime.policy.js'
import type {
  TokenEstimator,
  TokenEstimatorInput,
} from './context/deepseek-v4-token-estimator.js'
import type { AgentRunRecorderService } from './lifecycle/agent-run-recorder.service.js'
import assert from 'node:assert/strict'
// 项目本轮使用 Node 原生测试运行器，不引入 Vitest。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { setTimeout as sleep } from 'node:timers/promises'
import {
  adaptOpenAICompatibleStream,
  LLMApiError,
  LLMAuthError,
  LLMBalanceError,
  LLMNetworkError,
  LLMRateLimitError,
  LLMServerError,
  OpenAICompatibleClient,
  teeRawResponseCapture,
} from '@agent/ai'
import { familyCompatOf } from '@agent/contracts'

import { projectAdminRunDetail } from '../admin-runs/projection/admin-run.projector.js'
import { toChatStreamEvent } from '../chat/chat-stream-event.mapper.js'
import { getAiExceptionMessage } from '../common/utils/llm-error-message.util.js'
import {
  AgentRunStatus,
  AgentStepStatus,
  MessageRole,
  MessageStatus,
} from '../generated/prisma/client.js'
import { createResolvedLlmModel } from '../llm/__fixtures__.js'
import {
  DatabaseCommitOutcomeUnknownError,
  DatabaseOperationDeadlineExceededError,
} from '../prisma/prisma.service.js'
import {
  AgentRunTerminalizationError,
  ContextTokenEstimationError,
} from './agent-runtime.errors.js'
import { AgentRuntimeService } from './agent-runtime.service.js'
import { DeepSeekV4TokenEstimator } from './context/deepseek-v4-token-estimator.js'
import {
  flattenPlanningState,
  ModelContext,
  toFeedbackArgumentsJson,
} from './context/model-context.js'
import { SamplingContextPlanner } from './context/sampling-context-planner.js'

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
    assert.deepEqual(harness.llmCalls[0]?.messages, [{
      type: 'message',
      role: 'user',
      content: '问题',
    }])
    assert.equal(harness.toolInvocations.length, 0)
    assert.deepEqual(
      harness.llmCalls[0]?.options?.tools?.map(tool => tool.name),
      ['search_articles'],
    )
    assert.equal(harness.llmCalls[0]?.options?.request.model, 'deepseek-v4-flash')
    assert.equal(harness.llmCalls[0]?.options?.request.maxOutputTokens, 65_536)
    assert.deepEqual(harness.recorder.steps.map(step => step.type), [
      'load_conversation_history',
      'model_sampling',
      'assistant_output',
    ])
    assert.deepEqual(harness.recorder.steps.map(step => step.sequence), [1, 2, 3])
    assert.deepEqual(
      harness.recorder.steps.map(step => step.status),
      Array.from({ length: 3 }).fill(AgentStepStatus.COMPLETED),
    )
    const {
      initialContext,
      ...samplingInput
    } = harness.recorder.steps[1]?.input as Record<string, unknown>

    assert.deepEqual(samplingInput, {
      samplingIndex: 1,
      samplingAttemptId: 'run-1:sampling-1',
    })
    assert.deepEqual(initialContext, {
      resolvedModel: 'deepseek-v4-flash',
      providerId: 'provider-deepseek',
      modelId: 'model-deepseek-v4-flash',
      resolvedInputBudgetTokens: 262_144,
    })
    assert.deepEqual(
      withoutVolatileSamplingFields(harness.recorder.steps[1]?.output),
      {
        samplingAttemptId: 'run-1:sampling-1',
        finishReason: 'stop',
        usage: null,
        toolCallCount: 0,
      },
    )
    assertNoUnfinishedSteps(harness)
  })

  it('模型行快照与请求级 reasoningEffort 解析后，Initial Context 与 Provider 请求使用同一份 resolved 配置', async () => {
    const harness = createHarness(() => toModelStream([
      { type: 'text_delta', delta: '好' },
      { type: 'response_completed', finishReason: 'stop' },
    ]))

    const events = await collectEvents(harness.service.runTurnStream({
      conversationId: 'conversation-1',
      userContent: '问题',
      model: createResolvedLlmModel({ maxOutputTokens: 4_096 }),
      reasoningEffort: 'max',
      instructions: [],
    }))

    assert.equal(events.at(-1)?.type, 'run_completed')

    const initialContext = (
      harness.recorder.steps[1]?.input as Record<string, unknown>
    ).initialContext as Record<string, unknown>

    assert.equal(initialContext.resolvedModel, 'deepseek-v4-flash')
    // 快照的 Provider / 模型行 id 落进 sampling Step，Admin 据此追溯这轮打的是谁。
    assert.equal(initialContext.providerId, 'provider-deepseek')
    assert.equal(initialContext.modelId, 'model-deepseek-v4-flash')
    assert.equal(harness.llmCalls[0]?.options?.request.model, initialContext.resolvedModel)
    assert.equal(harness.llmCalls[0]?.options?.request.maxOutputTokens, 4_096)
    // 输出预留从窗口扣除后才是落库的输入预算：与 Provider 请求同一份 resolved 配置。
    assert.equal(
      initialContext.resolvedInputBudgetTokens,
      Math.min(262_144, 1_000_000 - 4_096 - 16_384),
    )
    assert.equal(harness.llmCalls[0]?.options?.request.reasoningEffort, 'max')
    // Provider 凭据随快照传给 LLMService：整个 Run 用同一把 key。
    assert.equal(harness.llmCalls[0]?.provider.providerId, 'provider-deepseek')
  })

  it('零 Tool Budget 时不向模型暴露 Tool 并正常完成', async () => {
    const harness = createHarness(
      () => toModelStream([
        { type: 'text_delta', delta: '纯模型回答' },
        { type: 'response_completed', finishReason: 'stop' },
      ]),
      undefined,
      undefined,
      {
        maxSamplingRounds: 1,
        maxToolCalls: 0,
      },
    )

    const events = await collectEvents(harness.run())

    assert.deepEqual(events.map(event => event.type), [
      'run_started',
      'assistant_delta',
      'run_completed',
    ])
    assert.equal(harness.llmCalls.length, 1)
    assert.deepEqual(harness.llmCalls[0]?.options?.tools, [])
    assert.equal(harness.toolInvocations.length, 0)
    assert.equal(harness.assistantMessage()?.content, '纯模型回答')
    assert.equal(harness.assistantMessage()?.status, MessageStatus.COMPLETED)
    assert.deepEqual(harness.recorder.completedRunIds, ['run-1'])
    assert.deepEqual(harness.recorder.failedRunIds, [])
    assert.deepEqual(harness.recorder.abortedRunIds, [])
    assertNoUnfinishedSteps(harness)
  })

  it('Registry 缺少 allowlist 工具时跳过该工具，不伪造定义', async () => {
    const harness = createHarness(
      () => toModelStream([
        { type: 'text_delta', delta: '好' },
        { type: 'response_completed', finishReason: 'stop' },
      ]),
      undefined,
      undefined,
      undefined,
      undefined,
      [],
    )

    const events = await collectEvents(harness.run())

    assert.equal(events.at(-1)?.type, 'run_completed')
    assert.deepEqual(harness.llmCalls[0]?.options?.tools, [])
  })

  it('会话不存在时产出稳定失败分类且不创建 Message 或 Run', async () => {
    const harness = createHarness(() => toModelStream([]))

    harness.prisma.conversationExists = false

    const events = await collectEvents(harness.run())

    assert.deepEqual(events, [{
      type: 'run_failed',
      conversationId: 'conversation-1',
      failureReason: 'conversation_not_found',
      message: '会话不存在或已被删除',
    }])
    assert.equal(harness.prisma.messages.length, 0)
    assert.equal(harness.recorder.steps.length, 0)
    assert.equal(harness.llmCalls.length, 0)
  })

  it('一次读取 previous COMPLETED 历史到硬上限，允许超过 40 条且当前输入恰好一次', async () => {
    const harness = createHarness(() => toModelStream([
      { type: 'response_completed', finishReason: 'stop' },
    ]))

    for (let index = 1; index <= 45; index += 1) {
      harness.prisma.seedMessage({
        id: `history-${String(index).padStart(2, '0')}`,
        content: `历史消息 ${index}`,
        status: MessageStatus.COMPLETED,
        createdAt: new Date(`2026-01-01T00:00:${String(index).padStart(2, '0')}.000Z`),
      })
    }
    for (const status of [
      MessageStatus.PENDING,
      MessageStatus.STREAMING,
      MessageStatus.FAILED,
      MessageStatus.ABORTED,
    ]) {
      harness.prisma.seedMessage({
        id: `excluded-${status.toLowerCase()}`,
        content: `不应进入模型历史 ${status}`,
        status,
        createdAt: new Date('2026-12-31T23:59:59.000Z'),
      })
    }

    await collectEvents(harness.run())

    const currentUser = harness.prisma.messages.find(
      message => message.content === '问题',
    )!

    assert.deepEqual(harness.prisma.findManyArguments, [{
      where: {
        conversationId: 'conversation-1',
        status: MessageStatus.COMPLETED,
        OR: [
          { createdAt: { lt: currentUser.createdAt } },
          {
            createdAt: currentUser.createdAt,
            id: { lt: currentUser.id },
          },
        ],
      },
      orderBy: [
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      take: 1_000,
    }])
    const firstSamplingMessages = harness.llmCalls[0]?.messages ?? []
    const contents = firstSamplingMessages
      .filter(item => item.type === 'message')
      .map(item => item.content)

    assert.equal(contents.length, 46)
    assert.equal(contents.filter(content => content === '问题').length, 1)
    assert.equal(contents[0], '历史消息 1')
    assert.equal(contents.at(-1), '问题')
    assert.equal(
      contents.some(content => content.startsWith('不应进入模型历史')),
      false,
    )
    const loadHistoryStep = findStep(harness, 'load_conversation_history')

    assert.equal(loadHistoryStep?.input, null)
    // 读取阶段不裁剪：messageCount 就是读取条数。
    assert.deepEqual(loadHistoryStep?.output, { messageCount: 45 })
  })

  it('只加载严格早于当前 User 上界的 History', async () => {
    const harness = createHarness(() => toModelStream([
      { type: 'response_completed', finishReason: 'stop' },
    ]))
    const currentCreatedAt = new Date('2030-01-01T00:00:00.000Z')

    harness.prisma.nextMessageCreatedAt = currentCreatedAt
    harness.prisma.seedMessage({
      id: 'history-past',
      content: 'past-user',
      status: MessageStatus.COMPLETED,
      createdAt: new Date('2029-12-31T23:59:59.000Z'),
    })
    harness.prisma.seedMessage({
      id: 'message-000',
      content: 'same-time-before',
      status: MessageStatus.COMPLETED,
      createdAt: currentCreatedAt,
    })
    harness.prisma.seedMessage({
      id: 'message-zzz',
      content: 'same-time-after',
      status: MessageStatus.COMPLETED,
      createdAt: currentCreatedAt,
    })
    harness.prisma.seedMessage({
      id: 'future-user',
      content: 'future-user',
      status: MessageStatus.COMPLETED,
      createdAt: new Date('2030-01-01T00:00:01.000Z'),
    })
    harness.prisma.seedMessage({
      id: 'future-assistant',
      content: 'future-assistant',
      role: MessageRole.ASSISTANT,
      status: MessageStatus.COMPLETED,
      createdAt: new Date('2030-01-01T00:00:02.000Z'),
    })

    await collectEvents(harness.run())

    const currentUser = harness.prisma.messages.find(
      message => message.content === '问题',
    )!
    const contents = (harness.llmCalls[0]?.messages ?? [])
      .filter(item => item.type === 'message')
      .map(item => item.content)

    assert.equal(currentUser.id, 'message-6')
    assert.deepEqual(contents, ['past-user', 'same-time-before', '问题'])
    assert.equal(contents.filter(content => content === '问题').length, 1)
    assert.deepEqual(harness.prisma.findManyArguments[0]?.where.OR, [
      { createdAt: { lt: currentCreatedAt } },
      { createdAt: currentCreatedAt, id: { lt: 'message-6' } },
    ])
  })

  it('createdAt 相同时按 id 倒序一次读取，并恢复稳定时间顺序', async () => {
    const harness = createHarness(() => toModelStream([
      { type: 'response_completed', finishReason: 'stop' },
    ]))
    const createdAt = new Date('2026-01-01T00:00:00.000Z')

    for (let index = 1; index <= 60; index += 1) {
      harness.prisma.seedMessage({
        id: `history-${String(index).padStart(3, '0')}`,
        content: `历史消息 ${index}`,
        status: MessageStatus.COMPLETED,
        createdAt,
      })
    }

    await collectEvents(harness.run())

    // 不再 keyset 翻页：整段历史只有一次 findMany，且只带当前用户消息上界。
    assert.equal(harness.prisma.findManyArguments.length, 1)
    const contents = (harness.llmCalls[0]?.messages ?? [])
      .filter(item => item.type === 'message')
      .map(item => item.content)

    assert.deepEqual(contents, [
      ...Array.from({ length: 60 }, (_, index) => `历史消息 ${index + 1}`),
      '问题',
    ])
  })

  it('读取条数触到硬上限时只保留最新的候选，load_conversation_history 记读入条数', async () => {
    const harness = createHarness(
      () => toModelStream([{ type: 'response_completed', finishReason: 'stop' }]),
      undefined,
      undefined,
      { historyCandidateHardLimit: 50 },
    )

    for (let index = 1; index <= 60; index += 1) {
      harness.prisma.seedMessage({
        id: `history-${String(index).padStart(3, '0')}`,
        content: `历史消息 ${index}`,
        status: MessageStatus.COMPLETED,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
      })
    }

    const events = await collectEvents(harness.run())

    assert.equal(events.at(-1)?.type, 'run_completed')
    assert.equal(harness.prisma.findManyArguments.length, 1)
    assert.equal(harness.prisma.findManyArguments[0]?.take, 50)
    const contents = (harness.llmCalls[0]?.messages ?? [])
      .filter(item => item.type === 'message')
      .map(item => item.content)

    assert.deepEqual(contents, [
      ...Array.from({ length: 50 }, (_, index) => `历史消息 ${index + 11}`),
      '问题',
    ])
    const loadHistoryStep = findStep(harness, 'load_conversation_history')

    assert.equal(loadHistoryStep?.input, null)
    assert.deepEqual(loadHistoryStep?.output, { messageCount: 50 })
    assertNoUnfinishedSteps(harness)
  })

  it('首轮超预算时由 planner 删最旧历史：initialContext 保持裁剪前值，contextPlan 记录删减数，Admin 投影不降级', async () => {
    const harness = createHarness(
      (_, __, callIndex) => toModelStream(callIndex === 0
        ? [
            toolCallEvent('call-history', 'search_articles', '{"query":"seo"}'),
            { type: 'response_completed', finishReason: 'tool_calls' },
          ]
        : [
            { type: 'text_delta', delta: '完成。' },
            { type: 'response_completed', finishReason: 'stop' },
          ]),
      undefined,
      async () => ({
        ok: true,
        modelContent: '短 Observation',
      }),
      {},
      new BaseCostTokenEstimator(250_000),
    )
    // 预算 262_144 − 基础 250_000 只容得下 2 条 5_000 字历史 + 当前消息 + 工具。
    const historyContents = [1, 2, 3].map(
      index => String(index).padEnd(5_000, '旧'),
    )

    for (const [index, content] of historyContents.entries()) {
      harness.prisma.seedMessage({
        id: `history-${index + 1}`,
        content,
        status: MessageStatus.COMPLETED,
        createdAt: new Date(`2026-01-01T00:00:0${index + 1}.000Z`),
      })
    }

    const events = await collectEvents(harness.run())

    assert.equal(events.at(-1)?.type, 'run_completed')
    assert.equal(harness.llmCalls.length, 2)
    // 首轮模型输入只保留最新的连续 2 条，顺序不变。
    assert.deepEqual(
      (harness.llmCalls[0]?.messages ?? [])
        .filter(item => item.type === 'message')
        .map(item => item.content),
      [historyContents[1], historyContents[2], '问题'],
    )
    // 读取阶段全部候选进入 ModelContext，不做预算排除。
    assert.deepEqual(findStep(harness, 'load_conversation_history')?.output, {
      messageCount: 3,
    })
    const [firstSampling, secondSampling] = harness.recorder.steps.filter(
      step => step.type === 'model_sampling',
    )
    const firstInput = firstSampling?.input as Record<string, unknown>
    const firstInitialContext = firstInput.initialContext as Record<string, unknown>
    const firstContextPlan = (firstSampling?.output as Record<string, unknown>)
      .contextPlan as Record<string, unknown>

    // 预算删减体现在模型输入与 contextPlan；选入条数与请求的一致性见「Run 轨迹补齐模型可见内容」AC-02。
    assert.equal(firstContextPlan.historyIncludedCount, 2)
    assert.equal(firstContextPlan.resolvedInputBudgetTokens, firstInitialContext.resolvedInputBudgetTokens)
    assert.ok(Number(firstContextPlan.estimatedInputTokens) <= Number(firstContextPlan.resolvedInputBudgetTokens), 'Number(firstContextPlan.estimatedInputTokens) <= Number(firstContextPlan.resolvedInputBudgetTokens)')
    // 第二轮：initialContext 快照不变，Tool Exchange 成对进入输入。
    const secondInput = secondSampling?.input as Record<string, unknown>

    assert.deepEqual(secondInput.initialContext, firstInitialContext)
    assert.deepEqual(
      (harness.llmCalls[1]?.messages ?? [])
        .filter(item => item.type === 'message')
        .map(item => item.content),
      [historyContents[1], historyContents[2], '问题'],
    )
    assertNoUnfinishedSteps(harness)

    // AC-04 跨层：runtime 真实写出的 Step 经 Admin projector 投影。
    const detail = projectHarnessRunDetail(harness, 'COMPLETED')
    const inspectors = detail.timeline.flatMap(item => (
      item.kind === 'known' && item.type === 'model_sampling'
        ? [item.contextInspector]
        : []
    ))

    assert.deepEqual(
      inspectors.map(inspector => inspector.outcome),
      ['success', 'success'],
    )
  })

  it('首轮 plan 内估算失败时 sampling Step 记 estimator_failure，Admin 投影为 partial', async () => {
    // 前置快照用正常 estimator，只让 planner 的 plan() 内估算失败。
    const harness = createHarness(
      () => toModelStream([{ type: 'response_completed', finishReason: 'stop' }]),
      undefined,
      undefined,
      {},
      new TestTokenEstimator(),
      undefined,
      new AlwaysFailingTokenEstimator(),
    )

    harness.prisma.seedMessage({
      id: 'history-1',
      content: '历史消息 1',
      status: MessageStatus.COMPLETED,
      createdAt: new Date('2026-01-01T00:00:01.000Z'),
    })

    const events = await collectEvents(harness.run())
    const serialized = JSON.stringify({ events, steps: harness.recorder.steps })

    assert.deepEqual(events.map(event => event.type), ['run_started', 'run_failed'])
    assert.equal(harness.llmCalls.length, 0)
    assert.equal(
      findStep(harness, 'load_conversation_history')?.status,
      AgentStepStatus.COMPLETED,
    )
    const samplingStep = findStep(harness, 'model_sampling')
    const samplingOutput = samplingStep?.output as Record<string, unknown>
    const initialContext = (samplingStep?.input as Record<string, unknown>)
      .initialContext as Record<string, unknown>

    assert.equal(samplingStep?.status, AgentStepStatus.FAILED)
    assert.deepEqual(samplingOutput, {
      contextFailureReason: 'estimator_failure',
      errorCode: 'estimator_failure',
    })
    assert.equal(harness.recorder.runErrorCode, 'estimator_failure')
    assert.equal(Object.hasOwn(samplingOutput, 'contextPlan'), false)
    assert.equal(initialContext.resolvedInputBudgetTokens, 262_144)
    assert.doesNotMatch(serialized, /initial-estimator-secret/)
    assert.match(serialized, /TokenEstimator/)
    assertNoUnfinishedSteps(harness)

    const samplingItem = projectHarnessRunDetail(harness, 'FAILED').timeline.find(
      item => item.type === 'model_sampling',
    )

    assert.equal(samplingItem?.kind, 'known')
    assert.deepEqual(
      samplingItem?.kind === 'known' && samplingItem.type === 'model_sampling'
        ? [
            samplingItem.contextInspector.outcome,
            samplingItem.contextInspector.resolvedModel,
          ]
        : null,
      ['estimator_failure', 'deepseek-v4-flash'],
    )
  })

  it('mandatory Context 超预算时不调用 Provider', async () => {
    const harness = createHarness(
      () => toModelStream([{ type: 'response_completed', finishReason: 'stop' }]),
      undefined,
      undefined,
      {},
      new OverflowTokenEstimator(),
    )

    const events = await collectEvents(harness.run())

    assert.deepEqual(events.map(event => event.type), ['run_failed'])
    assert.equal(events[0]?.type, 'run_failed')
    if (events[0]?.type !== 'run_failed')
      assert.fail('expected run_failed')
    assert.match(events[0].message, /Mandatory Context/)
    // 用户消息已落库、会话 updatedAt 已变：前台要据此同步侧栏（#169）。
    assert.equal(events[0].userMessagePersisted, true)
    assert.equal(harness.llmCalls.length, 0)
    assert.equal(harness.assistantMessage(), undefined)
    assert.equal(
      findStep(harness, 'load_conversation_history')?.status,
      AgentStepStatus.FAILED,
    )
  })

  it('initial Context estimator 失败时不伪造 model_sampling Step', async () => {
    const harness = createHarness(
      () => toModelStream([{ type: 'response_completed', finishReason: 'stop' }]),
      undefined,
      undefined,
      {},
      new AlwaysFailingTokenEstimator(),
    )

    const events = await collectEvents(harness.run())
    const serialized = JSON.stringify({ events, steps: harness.recorder.steps })

    assert.deepEqual(events.map(event => event.type), ['run_failed'])
    assert.equal(harness.llmCalls.length, 0)
    assert.equal(harness.assistantMessage(), undefined)
    assert.equal(
      harness.recorder.steps.some(step => step.type === 'model_sampling'),
      false,
    )
    assert.equal(
      findStep(harness, 'load_conversation_history')?.status,
      AgentStepStatus.FAILED,
    )
    assert.match(serialized, /TokenEstimator/)
    assert.doesNotMatch(serialized, /initial-estimator-secret/)
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
    }])
    assert.equal(harness.llmCalls.length, 2)
    assert.deepEqual(
      harness.llmCalls.map(call => call.options?.tools?.map(tool => tool.name)),
      [['search_articles'], ['search_articles']],
    )
    assert.deepEqual(
      harness.llmCalls.map(call => call.options?.request.reasoningEffort),
      ['high', 'high'],
    )
    assert.deepEqual(harness.llmCalls[1]?.messages, [
      {
        type: 'message',
        role: 'user',
        content: '问题',
      },
      {
        type: 'assistant_tool_call',
        calls: [{ callId: 'call-1', name: 'search_articles', rawArgumentsJson: '{"query":"SP Himeko"}' }],
        reasoningContent: 'reasoning for call-1',
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
      'load_conversation_history',
      'model_sampling',
      'tool_execution',
      'model_sampling',
      'assistant_output',
    ])
    assert.deepEqual(harness.recorder.steps.map(step => step.sequence), [1, 2, 3, 4, 5])
    const samplingSteps = harness.recorder.steps.filter(
      step => step.type === 'model_sampling',
    )
    assert.notEqual(samplingSteps[0]?.id, samplingSteps[1]?.id)
    assert.deepEqual(samplingSteps.map((step) => {
      const { initialContext: _, ...input } = step.input as Record<string, unknown>

      return input
    }), [
      {
        samplingIndex: 1,
        samplingAttemptId: 'run-1:sampling-1',
      },
      {
        samplingIndex: 2,
        samplingAttemptId: 'run-1:sampling-2',
      },
    ])
    assert.deepEqual(samplingSteps.map(step => withoutVolatileSamplingFields(step.output)), [
      {
        samplingAttemptId: 'run-1:sampling-1',
        finishReason: 'tool_calls',
        usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
        toolCallCount: 1,
        // 本轮没有文本：不写 intermediateText；reasoning 随 assistant 消息回填，照原文落库。
        reasoningContent: 'reasoning for call-1',
      },
      {
        samplingAttemptId: 'run-1:sampling-2',
        finishReason: 'stop',
        usage: { inputTokens: 20, outputTokens: 4, totalTokens: 24 },
        toolCallCount: 0,
      },
    ])
    // contextPlan：预算、估算之外只落两项 planner 决策。
    assert.deepEqual(
      samplingSteps.map((step) => {
        const {
          estimatedInputTokens: _,
          resolvedInputBudgetTokens: __,
          ...plan
        } = (step.output as Record<string, unknown>).contextPlan as Record<string, unknown>

        return plan
      }),
      [
        { overflowReason: null, historyIncludedCount: 0, observationPreviewChars: [] },
        { overflowReason: null, historyIncludedCount: 0, observationPreviewChars: [11] },
      ],
    )
    const toolStep = harness.recorder.steps[2]
    assert.deepEqual(toolStep?.input, {
      callId: 'call-1',
      toolName: 'search_articles',
      samplingAttemptId: 'run-1:sampling-1',
      arguments: '{"query":"SP Himeko"}',
    })
    assert.deepEqual(toolStep?.output, {
      ok: true,
      originalChars: 11,
      observationChars: 11,
      truncated: false,
      observation: '找到 1 篇相关文章。',
    })
    assertNoUnfinishedSteps(harness)
  })

  it('runtime 写出的 tool_execution Step 可被 Admin 投影为已知 Step', async () => {
    const harness = createHarness((_, __, callIndex) => toModelStream(callIndex === 0
      ? [
          toolCallEvent('call-1', 'search_articles', '{"query":"seo"}'),
          { type: 'response_completed', finishReason: 'tool_calls' },
        ]
      : [
          { type: 'text_delta', delta: '找到相关文章。' },
          { type: 'response_completed', finishReason: 'stop' },
        ]))

    await collectEvents(harness.run())

    const detail = projectHarnessRunDetail(harness, 'COMPLETED')
    const toolItem = detail.timeline.find(item => item.type === 'tool_execution')

    assert.equal(toolItem?.kind, 'known')
    assert.equal(
      toolItem?.kind === 'known' && toolItem.type === 'tool_execution'
        ? toolItem.toolName
        : undefined,
      'search_articles',
    )
  })

  it('第二轮 sampling 重新估算完整请求，并按 Context Budget 缩减 Observation', async () => {
    const observation = '🚀'.repeat(16_000)
    const estimator = new BaseCostTokenEstimator(250_000)
    const harness = createHarness(
      (_, __, callIndex) => toModelStream(callIndex === 0
        ? [
            toolCallEvent('call-budget', 'search_articles', '{"query":"seo"}'),
            { type: 'response_completed', finishReason: 'tool_calls' },
          ]
        : [
            { type: 'text_delta', delta: '已按预算处理。' },
            { type: 'response_completed', finishReason: 'stop' },
          ]),
      undefined,
      async () => ({
        ok: true,
        modelContent: observation,
      }),
      {},
      estimator,
    )

    const events = await collectEvents(harness.run())
    const followUpItems = harness.llmCalls[1]?.messages ?? []
    const plannedObservation = followUpItems.find(
      item => item.type === 'tool_result',
    )

    assert.equal(events.at(-1)?.type, 'run_completed')
    assert.equal(harness.llmCalls.length, 2)
    assert.equal(plannedObservation?.type, 'tool_result')
    if (plannedObservation?.type !== 'tool_result')
      assert.fail('expected tool_result')
    assert.ok([...plannedObservation.content].length < [...observation].length, '[...plannedObservation.content].length < [...observation].length')
    assert.ok([...plannedObservation.content].length <= 16_000, '[...plannedObservation.content].length <= 16_000')
    assert.match(plannedObservation.content, /Context Budget|context_budget|上下文预算/i)
    assert.ok(estimator.estimateRequest({
      items: followUpItems,
      tools: harness.llmCalls[1]?.options?.tools ?? [],
    }) <= 262_144, 'estimator.estimateRequest({ items: followUpItems, tools: harness.llmCalls[1]?.options?.tools ?? [], }) <= 262_144')
    assert.ok(estimator.inputs.some(input => input.items.some(
      item => item.type === 'tool_result',
    )), 'estimator.inputs.some(input => input.items.some( item => item.type === \'tool_result\', ))')
    const contextPlan = harness.recorder.steps
      .filter(step => step.type === 'model_sampling')[1]
      ?.output as Record<string, unknown>

    assert.deepEqual(
      Object.keys(contextPlan.contextPlan as Record<string, unknown>),
      [
        'resolvedInputBudgetTokens',
        'estimatedInputTokens',
        'overflowReason',
        'historyIncludedCount',
        'observationPreviewChars',
      ],
    )
    // 压缩后实际送入的字符数；tool Step 里的 observation 仍是压缩前、受工具上限约束的正文。
    assert.deepEqual(
      (contextPlan.contextPlan as Record<string, unknown>).observationPreviewChars,
      [[...plannedObservation.content].length],
    )
    assert.equal(
      (findStep(harness, 'tool_execution')?.output as Record<string, unknown>).observation,
      observation,
    )
    assert.doesNotMatch(JSON.stringify(contextPlan.contextPlan), /🚀/)
    assertNoUnfinishedSteps(harness)
  })

  it('follow-up 超预算时先排除最旧 initial History，且不修改数据库 Message', async () => {
    const historyContent = '旧'.repeat(8_000)
    const observationContent = '新'.repeat(8_000)
    const harness = createHarness(
      (_, __, callIndex) => toModelStream(callIndex === 0
        ? [
            toolCallEvent('call-history', 'search_articles', '{"query":"seo"}'),
            { type: 'response_completed', finishReason: 'tool_calls' },
          ]
        : [
            { type: 'text_delta', delta: '完成。' },
            { type: 'response_completed', finishReason: 'stop' },
          ]),
      undefined,
      async () => ({
        ok: true,
        modelContent: observationContent,
      }),
      {},
      new BaseCostTokenEstimator(250_000),
    )
    const createdAt = new Date('2026-01-01T00:00:00.000Z')

    harness.prisma.seedMessage({
      id: 'history-oldest',
      content: historyContent,
      status: MessageStatus.COMPLETED,
      createdAt,
    })

    await collectEvents(harness.run())

    assert.equal(harness.llmCalls[0]?.messages.some(
      item => item.type === 'message' && item.content === historyContent,
    ), true)
    assert.equal(harness.llmCalls[1]?.messages.some(
      item => item.type === 'message' && item.content === historyContent,
    ), false)
    assert.equal(harness.llmCalls[1]?.messages.some(
      item => item.type === 'tool_result' && item.content === observationContent,
    ), true)
    assert.equal(
      harness.prisma.messages.find(message => message.id === 'history-oldest')?.content,
      historyContent,
    )
    // 第二轮输入：最旧历史已被排除，只剩当前问题 + Tool Call + Tool Result。
    assert.equal(harness.llmCalls[1]?.messages.length, 3)
    assert.equal(harness.llmCalls[1]?.messages.some(
      item => item.type === 'message' && item.content === historyContent,
    ), false)
    assertNoUnfinishedSteps(harness)
  })

  it('第三轮超预算时优先缩减较旧 Observation，保留最新 Observation', async () => {
    const olderObservation = '旧'.repeat(8_000)
    const latestObservation = '新'.repeat(8_000)
    const streams: ModelStreamEvent[][] = [
      [
        toolCallEvent('call-old', 'search_articles', '{"query":"seo"}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ],
      [
        toolCallEvent('call-new', 'search_articles', '{"query":"sitemap"}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ],
      [
        { type: 'text_delta', delta: '完成。' },
        { type: 'response_completed', finishReason: 'stop' },
      ],
    ]
    const estimator = new BaseCostTokenEstimator(249_000)
    const harness = createHarness(
      (_, __, callIndex) => toModelStream(streams[callIndex] ?? []),
      undefined,
      async envelope => ({
        ok: true,
        modelContent: envelope.callId === 'call-old'
          ? olderObservation
          : latestObservation,
      }),
      {},
      estimator,
    )

    await collectEvents(harness.run())

    const thirdRoundResults = (harness.llmCalls[2]?.messages ?? []).filter(
      item => item.type === 'tool_result',
    )

    assert.equal(harness.llmCalls.length, 3)
    assert.deepEqual(
      harness.llmCalls.map(call => call.options?.request.reasoningEffort),
      ['high', 'high', 'high'],
    )
    assert.equal(thirdRoundResults.length, 2)
    assert.equal(thirdRoundResults[0]?.type, 'tool_result')
    assert.equal(thirdRoundResults[1]?.type, 'tool_result')
    if (
      thirdRoundResults[0]?.type !== 'tool_result'
      || thirdRoundResults[1]?.type !== 'tool_result'
    ) {
      assert.fail('expected paired tool results')
    }
    assert.ok([...thirdRoundResults[0].content].length < [...olderObservation].length, '[...thirdRoundResults[0].content].length < [...olderObservation].length')
    assert.equal(thirdRoundResults[1].content, latestObservation)
    assert.deepEqual(thirdRoundResults.map(item => item.callId), [
      'call-old',
      'call-new',
    ])
    assert.equal(harness.llmCalls.every(call => estimator.estimateRequest({
      items: call.messages,
      tools: call.options?.tools ?? [],
    }) <= 262_144), true)
    assertNoUnfinishedSteps(harness)
  })

  it('最小 Tool Exchange 仍超预算时阻止对应轮次 Provider 调用并稳定失败', async () => {
    const observationSecret = 'overflow-observation-secret'
    const harness = createHarness(
      (_, __, callIndex) => toModelStream(callIndex === 0
        ? [
            toolCallEvent('call-overflow', 'search_articles', '{"query":"seo"}'),
            { type: 'response_completed', finishReason: 'tool_calls' },
          ]
        : [
            { type: 'text_delta', delta: '不应调用' },
            { type: 'response_completed', finishReason: 'stop' },
          ]),
      undefined,
      async () => ({
        ok: true,
        modelContent: `无法容纳的 Observation ${observationSecret}`,
      }),
      {},
      new FollowUpOverflowTokenEstimator(),
    )

    const events = await collectEvents(harness.run())
    const failedEvent = events.at(-1)
    const samplingSteps = harness.recorder.steps.filter(
      step => step.type === 'model_sampling',
    )

    assert.equal(failedEvent?.type, 'run_failed')
    assert.match(
      failedEvent?.type === 'run_failed' ? failedEvent.message : '',
      /Context|上下文|预算/,
    )
    assert.equal(harness.llmCalls.length, 1)
    assert.equal(samplingSteps.length, 2)
    assert.equal(samplingSteps[1]?.status, AgentStepStatus.FAILED)
    assert.equal(
      ((samplingSteps[1]?.output as Record<string, unknown>)
        ?.contextPlan as Record<string, unknown>)?.overflowReason,
      'minimum_context',
    )
    assert.equal(harness.assistantMessage()?.status, MessageStatus.FAILED)
    assert.deepEqual(harness.recorder.failedRunIds, ['run-1'])
    assert.equal(
      (findStep(harness, 'tool_execution')?.output as Record<string, unknown>).observation,
      `无法容纳的 Observation ${observationSecret}`,
    )
    // 正文只落在 tool Step 的 observation：事件、Message 与采样 Step（含 overflow 的 contextPlan）都不带。
    assert.doesNotMatch(JSON.stringify({
      events,
      steps: harness.recorder.steps.filter(step => step.type !== 'tool_execution'),
      message: harness.assistantMessage(),
    }), new RegExp(observationSecret))
    assertNoUnfinishedSteps(harness)
  })

  it('follow-up estimator 失败时不调用对应轮次 Provider，且不泄露 cause', async () => {
    const harness = createHarness(
      (_, __, callIndex) => toModelStream(callIndex === 0
        ? [
            toolCallEvent('call-estimator', 'search_articles', '{"query":"seo"}'),
            { type: 'response_completed', finishReason: 'tool_calls' },
          ]
        : [
            { type: 'text_delta', delta: '不应调用' },
            { type: 'response_completed', finishReason: 'stop' },
          ]),
      undefined,
      async () => ({
        ok: true,
        modelContent: '普通 Observation',
      }),
      {},
      new FollowUpFailingTokenEstimator(),
    )

    const events = await collectEvents(harness.run())
    const serialized = JSON.stringify({
      events,
      steps: harness.recorder.steps,
      message: harness.assistantMessage(),
    })

    assert.equal(events.at(-1)?.type, 'run_failed')
    assert.equal(harness.llmCalls.length, 1)
    assert.equal(
      harness.recorder.steps.filter(step => step.type === 'model_sampling')[1]?.status,
      AgentStepStatus.FAILED,
    )
    assert.equal(
      (harness.recorder.steps.filter(
        step => step.type === 'model_sampling',
      )[1]?.output as Record<string, unknown>)?.contextFailureReason,
      'estimator_failure',
    )
    assert.doesNotMatch(serialized, /estimator-secret/)
    assert.match(serialized, /TokenEstimator/)
    assertNoUnfinishedSteps(harness)
  })

  it('按模型决策执行 search -> search -> final 三轮路径', async () => {
    const firstReasoning = 'secret-first-reasoning'
    const secondReasoning = 'secret-second-reasoning'
    const streams: ModelStreamEvent[][] = [
      [
        toolCallEvent(
          'call-search',
          'search_articles',
          '{"query":"seo"}',
          firstReasoning,
        ),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ],
      [
        toolCallEvent(
          'call-search-2',
          'search_articles',
          '{"query":"sitemap"}',
          secondReasoning,
        ),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ],
      [
        { type: 'text_delta', delta: '已基于两次查询生成 SEO 建议。' },
        { type: 'response_completed', finishReason: 'stop' },
      ],
    ]
    const harness = createHarness(
      (_, __, callIndex) => toModelStream(streams[callIndex] ?? []),
      undefined,
      async envelope => envelope.callId === 'call-search'
        ? {
            ok: true,
            modelContent: '搜索到 sourceId=24。',
          }
        : {
            ok: true,
            modelContent: '搜索到 sourceId=31。',
          },
    )

    const events = await collectEvents(harness.run())
    const chatEvents = events.map(toChatStreamEvent)

    assert.equal(harness.llmCalls.length, 3)
    assert.deepEqual(
      harness.llmCalls.map(call => call.options?.request.reasoningEffort),
      ['high', 'high', 'high'],
    )
    assert.deepEqual(
      harness.llmCalls.map(call => call.options?.tools?.map(tool => tool.name)),
      Array.from({ length: 3 }, () => ['search_articles']),
    )
    assert.deepEqual(harness.toolInvocations, [
      {
        callId: 'call-search',
        toolName: 'search_articles',
        rawArgumentsJson: '{"query":"seo"}',
      },
      {
        callId: 'call-search-2',
        toolName: 'search_articles',
        rawArgumentsJson: '{"query":"sitemap"}',
      },
    ])
    assert.deepEqual(harness.llmCalls[2]?.messages, [
      {
        type: 'message',
        role: 'user',
        content: '问题',
      },
      {
        type: 'assistant_tool_call',
        calls: [{ callId: 'call-search', name: 'search_articles', rawArgumentsJson: '{"query":"seo"}' }],
        reasoningContent: firstReasoning,
      },
      {
        type: 'tool_result',
        callId: 'call-search',
        name: 'search_articles',
        content: '搜索到 sourceId=24。',
        ok: true,
      },
      {
        type: 'assistant_tool_call',
        calls: [{ callId: 'call-search-2', name: 'search_articles', rawArgumentsJson: '{"query":"sitemap"}' }],
        reasoningContent: secondReasoning,
      },
      {
        type: 'tool_result',
        callId: 'call-search-2',
        name: 'search_articles',
        content: '搜索到 sourceId=31。',
        ok: true,
      },
    ])
    assert.deepEqual(harness.recorder.steps.map(step => step.type), [
      'load_conversation_history',
      'model_sampling',
      'tool_execution',
      'model_sampling',
      'tool_execution',
      'model_sampling',
      'assistant_output',
    ])
    assert.deepEqual(
      harness.recorder.steps.map(step => step.sequence),
      [1, 2, 3, 4, 5, 6, 7],
    )
    // 每轮模型输入里的 Tool Result 数逐轮累加。
    assert.deepEqual(
      harness.llmCalls.map(call => call.messages.filter(item => item.type === 'tool_result').length),
      [0, 1, 2],
    )
    assert.equal(harness.assistantMessage()?.content, '已基于两次查询生成 SEO 建议。')
    assert.equal(events.at(-1)?.type, 'run_completed')
    // reasoning 只随 assistant 消息回填模型，前台事件与 Message 都不带。
    assert.doesNotMatch(
      JSON.stringify({
        events,
        chatEvents,
        message: harness.assistantMessage(),
      }),
      /secret-(?:first|second)-reasoning/,
    )
    // 模型可见即落库：两轮 Tool Call 的 reasoning 各自记在本轮采样 Step 上。
    assert.deepEqual(
      harness.recorder.steps
        .filter(step => step.type === 'model_sampling')
        .map(step => (step.output as Record<string, unknown>).reasoningContent),
      [firstReasoning, secondReasoning, undefined],
    )
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
      findStep(harness, 'tool_execution')?.output,
      {
        ok: false,
        code: 'unknown_tool',
        originalChars: 20,
        observationChars: 20,
        truncated: false,
        observation: '工具 unknown_tool 不存在。',
      },
    )
    assert.deepEqual(harness.recorder.completedRunIds, ['run-1'])
    assertNoUnfinishedSteps(harness)
  })

  it('拒绝执行全局已注册但本 Run 未开放的工具', async () => {
    const secretContent = '不应回填给模型的未授权结果'
    let hiddenExecutorCalls = 0
    const streams: ModelStreamEvent[][] = [
      [
        toolCallEvent('call-hidden', 'hidden_admin_tool', '{}'),
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
      async () => {
        hiddenExecutorCalls += 1

        return {
          ok: true,
          modelContent: secretContent,
        }
      },
    )

    const runtimeEvents = await collectEvents(harness.run())
    const chatEvents = runtimeEvents.map(toChatStreamEvent)

    assert.deepEqual(
      harness.llmCalls.map(call => call.options?.tools?.map(tool => tool.name)),
      [['search_articles'], ['search_articles']],
    )
    assert.equal(harness.toolInvocations.length, 0)
    assert.equal(hiddenExecutorCalls, 0)
    assert.deepEqual(harness.llmCalls[1]?.messages.slice(-2), [
      {
        type: 'assistant_tool_call',
        calls: [{ callId: 'call-hidden', name: 'hidden_admin_tool', rawArgumentsJson: '{"arguments":"{}"}' }],
        reasoningContent: 'reasoning for call-hidden',
      },
      {
        type: 'tool_result',
        callId: 'call-hidden',
        name: 'hidden_admin_tool',
        content: '工具 hidden_admin_tool 不存在。',
        ok: false,
      },
    ])
    assert.doesNotMatch(
      JSON.stringify({ runtimeEvents, chatEvents, llmCalls: harness.llmCalls }),
      new RegExp(secretContent),
    )
    assert.deepEqual(runtimeEvents.map(event => event.type), [
      'run_started',
      'assistant_delta',
      'run_completed',
    ])
    assert.deepEqual(chatEvents.map(event => event.type), ['start', 'delta', 'done'])
    assert.equal(harness.assistantMessage()?.status, MessageStatus.COMPLETED)
    assert.deepEqual(harness.recorder.completedRunIds, ['run-1'])
    assert.deepEqual(harness.recorder.failedRunIds, [])
    assert.deepEqual(harness.recorder.steps.map(step => step.type), [
      'load_conversation_history',
      'model_sampling',
      'tool_execution',
      'model_sampling',
      'assistant_output',
    ])
    assert.deepEqual(harness.recorder.steps.map(step => step.status), [
      AgentStepStatus.COMPLETED,
      AgentStepStatus.COMPLETED,
      AgentStepStatus.FAILED,
      AgentStepStatus.COMPLETED,
      AgentStepStatus.COMPLETED,
    ])
    const toolStep = findStep(harness, 'tool_execution')

    assert.equal(toolStep?.status, AgentStepStatus.FAILED)
    // 未开放工具的参数没有经过校验：落库的是回喂给模型的 `{"arguments": raw}` 形状。
    assert.deepEqual(toolStep?.input, {
      callId: 'call-hidden',
      toolName: 'hidden_admin_tool',
      samplingAttemptId: 'run-1:sampling-1',
      arguments: '{"arguments":"{}"}',
    })
    assert.deepEqual(toolStep?.output, {
      ok: false,
      code: 'unknown_tool',
      originalChars: 25,
      observationChars: 25,
      truncated: false,
      observation: '工具 hidden_admin_tool 不存在。',
    })
    assertNoUnfinishedSteps(harness)
  })

  it('模型调用已删除的工具名时按 unknown_tool 回喂，下一轮直接回答，Run 以 COMPLETED 收口', async () => {
    const streams: ModelStreamEvent[][] = [
      [
        toolCallEvent('call-removed', 'retrieve_article_context', '{"query":"seo"}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ],
      [
        { type: 'text_delta', delta: '这个工具已不可用，直接回答。' },
        { type: 'response_completed', finishReason: 'stop' },
      ],
    ]
    const harness = createHarness((_, __, callIndex) => toModelStream(streams[callIndex] ?? []))

    const events = await collectEvents(harness.run())

    assert.equal(events.at(-1)?.type, 'run_completed')
    assert.equal(harness.toolInvocations.length, 0)
    assert.equal(harness.llmCalls.length, 2)
    assert.deepEqual(harness.llmCalls[1]?.messages.at(-1), {
      type: 'tool_result',
      callId: 'call-removed',
      name: 'retrieve_article_context',
      content: '工具 retrieve_article_context 不存在。',
      ok: false,
    })
    assert.equal(harness.assistantMessage()?.status, MessageStatus.COMPLETED)
    assert.equal(harness.assistantMessage()?.content, '这个工具已不可用，直接回答。')
    assert.deepEqual(harness.recorder.completedRunIds, ['run-1'])
    assert.deepEqual(harness.recorder.failedRunIds, [])
    assert.equal(harness.recorder.runErrorCode, null)
    const toolStep = findStep(harness, 'tool_execution')

    assert.equal(toolStep?.status, AgentStepStatus.FAILED)
    assert.equal((toolStep?.output as Record<string, unknown>).code, 'unknown_tool')
    assertNoUnfinishedSteps(harness)
  })

  it('把无效参数结果作为脱敏 Observation 交给第二轮解释', async () => {
    const streams: ModelStreamEvent[][] = [
      [
        toolCallEvent('call-1', 'search_articles', '{"sourceId":1.5}'),
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
      }),
    )

    await collectEvents(harness.run())

    // 未通过 input.parse 的原始参数不可信，续轮以官方回退形状承载。
    assert.deepEqual(harness.llmCalls[1]?.messages.at(-2), {
      type: 'assistant_tool_call',
      calls: [{ callId: 'call-1', name: 'search_articles', rawArgumentsJson: '{"arguments":"{\\"sourceId\\":1.5}"}' }],
      reasoningContent: 'reasoning for call-1',
    })
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

  it('execution_failed 按模型原参数落库、不自动重试，参数不进用户可见 Message', async () => {
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
      }),
    )

    await collectEvents(harness.run())

    const toolStep = findStep(harness, 'tool_execution')

    assert.equal(harness.toolInvocations.length, 1)
    assert.equal(toolStep?.status, AgentStepStatus.FAILED)
    // execution_failed 发生在参数校验之后：回喂给模型的是原参数，落库也是原参数（不做脱敏）。
    assert.equal(
      (toolStep?.input as Record<string, unknown>).arguments,
      '{"query":"seo","password":"db-secret","token":"sk-secret"}',
    )
    assert.doesNotMatch(JSON.stringify(toolStep), /rawArgumentsJson/)
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

  it('规范化超大 Unicode Observation，durable Step 只保存受工具上限约束的正文', async () => {
    const oversizedObservation = '🚀'.repeat(16_100)
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
        modelContent: oversizedObservation,
      }),
    )

    await collectEvents(harness.run())

    const observation = harness.llmCalls[1]?.messages.at(-1)
    const observationContent = observation?.type === 'tool_result'
      ? observation.content
      : ''
    const toolOutput = findStep(harness, 'tool_execution')?.output as Record<string, unknown>

    assert.ok([...observationContent].length <= 16_000, '[...observationContent].length <= 16_000')
    assert.match(observationContent, /truncated|截断/)
    assert.doesNotMatch(observationContent, /\uFFFD/)
    assert.equal(toolOutput.originalChars, 16_100)
    assert.equal(toolOutput.observationChars, [...observationContent].length)
    assert.equal(toolOutput.truncated, true)
    // 落库的是回喂给模型的截断预览，不是工具原文。
    assert.equal(toolOutput.observation, observationContent)
    assert.notEqual(toolOutput.observation, oversizedObservation)
    assert.doesNotMatch(harness.assistantMessage()?.content ?? '', /result-secret|🚀/)
    assertNoUnfinishedSteps(harness)
  })

  it('同轮「文本 + 两个 Tool Call」按 index 顺序执行，文本保留并随 tool_calls 回填', async () => {
    const streams: ModelStreamEvent[][] = [
      [
        { type: 'text_delta', delta: '先查两篇。' },
        { type: 'tool_call_started' },
        toolCallEvent('call-1', 'search_articles', '{"query":"seo"}', '两个都查。', 0),
        toolCallEvent('call-2', 'search_articles', '{"query":"sitemap"}', '两个都查。', 1),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ],
      [
        { type: 'text_delta', delta: '最终回答。' },
        { type: 'response_completed', finishReason: 'stop' },
      ],
    ]
    const harness = createHarness(
      (_, __, callIndex) => toModelStream(streams[callIndex] ?? []),
      undefined,
      async envelope => ({
        ok: true,
        modelContent: `结果 ${envelope.callId}`,
      }),
    )

    const events = await collectEvents(harness.run())

    assert.deepEqual(events.map(event => event.type), [
      'run_started',
      'assistant_delta',
      'assistant_delta',
      'run_completed',
    ])
    // 已推出的中间文本保留，最终 Message = 中间文本 + 空行 + 最终回答。
    assert.equal(harness.assistantMessage()?.content, '先查两篇。\n\n最终回答。')
    const completedEvent = events.at(-1)

    assert.equal(
      completedEvent?.type === 'run_completed' ? completedEvent.content : undefined,
      '先查两篇。\n\n最终回答。',
    )
    assert.deepEqual(
      harness.toolInvocations.map(invocation => invocation.callId),
      ['call-1', 'call-2'],
    )
    // assistant_output Step 在首个 delta 推出时就已开始，早于本轮的 tool_execution。
    assert.deepEqual(harness.recorder.steps.map(step => step.type), [
      'load_conversation_history',
      'model_sampling',
      'assistant_output',
      'tool_execution',
      'tool_execution',
      'model_sampling',
    ])
    assert.deepEqual(
      harness.recorder.steps
        .filter(step => step.type === 'tool_execution')
        .map(step => (step.input as { callId: string }).callId),
      ['call-1', 'call-2'],
    )
    // 第二轮请求：一条带 content 与 tool_calls[] 的 assistant 消息，后接两条一一对应的 tool 消息。
    assert.deepEqual(harness.llmCalls[1]?.messages.slice(1), [
      {
        type: 'assistant_tool_call',
        calls: [
          { callId: 'call-1', name: 'search_articles', rawArgumentsJson: '{"query":"seo"}' },
          { callId: 'call-2', name: 'search_articles', rawArgumentsJson: '{"query":"sitemap"}' },
        ],
        reasoningContent: '两个都查。',
        content: '先查两篇。',
      },
      { type: 'tool_result', callId: 'call-1', name: 'search_articles', content: '结果 call-1', ok: true },
      { type: 'tool_result', callId: 'call-2', name: 'search_articles', content: '结果 call-2', ok: true },
    ])
    assert.equal(
      (findStep(harness, 'model_sampling')?.output as { toolCallCount: number }).toolCallCount,
      2,
    )
    assertNoUnfinishedSteps(harness)
  })

  it('AC-02 中间文本与以 ## 标题开头的最终回答之间补空行，delta、done 与落库一致', async () => {
    const streams: ModelStreamEvent[][] = [
      [
        { type: 'text_delta', delta: '先查' },
        { type: 'text_delta', delta: '一下。' },
        toolCallEvent('call-1', 'search_articles', '{"query":"seo"}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ],
      // 没有文本的工具轮不推 delta，也不产生分隔。
      [
        toolCallEvent('call-2', 'search_articles', '{"query":"sitemap"}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ],
      [
        { type: 'text_delta', delta: '## 标题' },
        { type: 'text_delta', delta: '\n正文。' },
        { type: 'response_completed', finishReason: 'stop' },
      ],
    ]
    const harness = createHarness((_, __, callIndex) => toModelStream(streams[callIndex] ?? []))

    const events = await collectEvents(harness.run())
    const deltas = events.flatMap(event => event.type === 'assistant_delta' ? [event.contentDelta] : [])
    const completedEvent = events.at(-1)
    const expected = '先查一下。\n\n## 标题\n正文。'

    // 分隔只加在新一轮的第一个 delta 前，同一轮的后续 delta 原样推出。
    assert.deepEqual(deltas, ['先查', '一下。', '\n\n## 标题', '\n正文。'])
    assert.equal(deltas.join(''), expected)
    assert.equal(completedEvent?.type === 'run_completed' ? completedEvent.content : undefined, expected)
    assert.equal(harness.assistantMessage()?.content, expected)
    // 回填模型的中间文本仍是该轮原文，不带分隔。
    assert.equal(
      (harness.llmCalls[1]?.messages.find(item => item.type === 'assistant_tool_call') as { content?: string } | undefined)?.content,
      '先查一下。',
    )
    assertNoUnfinishedSteps(harness)
  })

  it('中间文本以单个换行结尾时只补一个换行，已有空行时不再补', async () => {
    // 单个换行只是段内软换行，不以列表或标题开头的回答仍会被并进上一段。
    const cases: Array<[string, string]> = [
      ['先查一下。\n', '先查一下。\n\n找到了三篇。'],
      ['先查一下。\n\n', '先查一下。\n\n找到了三篇。'],
    ]

    for (const [intermediate, expected] of cases) {
      const streams: ModelStreamEvent[][] = [
        [
          { type: 'text_delta', delta: intermediate },
          toolCallEvent('call-1', 'search_articles', '{"query":"seo"}'),
          { type: 'response_completed', finishReason: 'tool_calls' },
        ],
        [
          { type: 'text_delta', delta: '找到了三篇。' },
          { type: 'response_completed', finishReason: 'stop' },
        ],
      ]
      const harness = createHarness((_, __, callIndex) => toModelStream(streams[callIndex] ?? []))

      await collectEvents(harness.run())

      assert.equal(harness.assistantMessage()?.content, expected, JSON.stringify(intermediate))
    }
  })

  it('本轮 call 数超过剩余预算时整体拒绝，任何 call 都不执行', async () => {
    const harness = createHarness(() => toModelStream([
      toolCallEvent('call-1', 'search_articles', '{"query":"a"}', 'reason', 0),
      toolCallEvent('call-2', 'search_articles', '{"query":"b"}', 'reason', 1),
      toolCallEvent('call-3', 'search_articles', '{"query":"c"}', 'reason', 2),
      { type: 'response_completed', finishReason: 'tool_calls' },
    ]))

    const events = await collectEvents(harness.run())
    const finalEvent = events.at(-1)

    assert.equal(finalEvent?.type, 'run_failed')
    assert.match(
      finalEvent?.type === 'run_failed' ? finalEvent.message : '',
      /执行上限/,
    )
    assert.equal(harness.toolInvocations.length, 0)
    assert.equal(harness.llmCalls.length, 1)
    assert.deepEqual(harness.recorder.steps.map(step => step.type), [
      'load_conversation_history',
      'model_sampling',
    ])
    assert.equal(findStep(harness, 'model_sampling')?.status, AgentStepStatus.COMPLETED)
    assert.equal(
      (findStep(harness, 'model_sampling')?.output as { toolCallCount: number }).toolCallCount,
      3,
    )
    assert.deepEqual(harness.recorder.failedRunIds, ['run-1'])
    assert.equal(harness.assistantMessage()?.status, MessageStatus.FAILED)
    assertNoUnfinishedSteps(harness)
  })

  it('length 截断的 Tool Call 整批不执行，逐个记 truncated_arguments 并回喂，Run 继续', async () => {
    const streams: Array<() => AsyncGenerator<ModelStreamEvent>> = [
      // 原始 provider chunk 经真实 adapter：arguments 为空、不完整，以及无 id 分片各一。
      () => adaptDeepSeekStream(toProviderStream([
        providerChunk({ reasoning_content: '需要查两篇。' } as ChatCompletionChunk.Choice.Delta),
        providerChunk({
          tool_calls: [
            { index: 0, id: 'call-empty', type: 'function', function: { name: 'search_articles' } },
            { index: 1, id: 'call-partial', type: 'function', function: { name: 'search_articles', arguments: '{"query":' } },
            { index: 2, type: 'function', function: { name: 'search_', arguments: '{"q' } },
          ],
        } as ChatCompletionChunk.Choice.Delta),
        providerChunk({}, 'length'),
      ])),
      () => toModelStream([
        toolCallEvent('call-retry', 'search_articles', '{"query":"seo"}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]),
      () => toModelStream([
        { type: 'text_delta', delta: '重发后完成。' },
        { type: 'response_completed', finishReason: 'stop' },
      ]),
    ]
    const harness = createHarness(
      (_, __, callIndex) => streams[callIndex]!(),
      undefined,
      undefined,
      { maxToolCalls: 3 },
    )

    const events = await collectEvents(harness.run())

    assert.equal(events.at(-1)?.type, 'run_completed')
    assert.equal(harness.assistantMessage()?.content, '重发后完成。')
    // 截断批次一个都没执行，只有模型重发的调用真正执行。
    assert.deepEqual(
      harness.toolInvocations.map(invocation => invocation.callId),
      ['call-retry'],
    )
    const toolSteps = harness.recorder.steps.filter(step => step.type === 'tool_execution')

    assert.deepEqual(toolSteps.map(step => [
      (step.input as { callId: string }).callId,
      step.status,
      (step.output as { ok: boolean, code?: string }).ok,
      (step.output as { ok: boolean, code?: string }).code,
    ]), [
      ['call-empty', AgentStepStatus.FAILED, false, 'truncated_arguments'],
      ['call-partial', AgentStepStatus.FAILED, false, 'truncated_arguments'],
      ['call-retry', AgentStepStatus.COMPLETED, true, undefined],
    ])
    assert.equal(
      (findStep(harness, 'model_sampling')?.output as { finishReason: string }).finishReason,
      'length',
    )
    // 第二轮模型输入：截断的两个 call 与各自的失败 tool 消息成对回填，无 id 分片不出现。
    assert.deepEqual(harness.llmCalls[1]?.messages.slice(1, 4), [
      {
        type: 'assistant_tool_call',
        calls: [
          { callId: 'call-empty', name: 'search_articles', rawArgumentsJson: '{"arguments":""}' },
          { callId: 'call-partial', name: 'search_articles', rawArgumentsJson: '{"arguments":"{\\"query\\":"}' },
        ],
        reasoningContent: '需要查两篇。',
      },
      {
        type: 'tool_result',
        callId: 'call-empty',
        name: 'search_articles',
        content: '工具 search_articles 的参数因模型输出达到长度限制而不完整，本次未执行；仍需要时请重新发起调用。',
        ok: false,
      },
      {
        type: 'tool_result',
        callId: 'call-partial',
        name: 'search_articles',
        content: '工具 search_articles 的参数因模型输出达到长度限制而不完整，本次未执行；仍需要时请重新发起调用。',
        ok: false,
      },
    ])
    assert.equal(harness.llmCalls[1]?.messages.length, 4)
    // Admin 投影接受新的 code。
    const detail = projectHarnessRunDetail(harness, 'COMPLETED')

    assert.deepEqual(
      detail.timeline
        .filter(item => item.kind === 'known' && item.type === 'tool_execution')
        .map(item => (item as { code: string | null }).code),
      ['truncated_arguments', 'truncated_arguments', null],
    )
    assertNoUnfinishedSteps(harness)
  })

  it('length 截断的原始参数经生产 estimator 仍能续轮：未校验参数以官方回退形状回喂，estimator 输入与实际请求一致', async () => {
    const productionEstimator = new DeepSeekV4TokenEstimator()
    // 同一根因的全部边界：空、半截对象、非对象 JSON、生产 renderer 已知拒绝的合法对象，以及完整对象对照。
    const rawArgumentsSamples = [
      '',
      '{"sourceId":',
      '[]',
      'null',
      '1',
      '1.5',
      'true',
      '"abc"',
      '{"x":NaN}',
      '{"x":1e999}',
      '{"0":"x"}',
      '{"nested":[1.5]}',
      '{"query":"seo"}',
    ]

    for (const rawArguments of rawArgumentsSamples) {
      const label = `raw=${JSON.stringify(rawArguments)}`
      const estimatedInputs: ModelInputItem[][] = []
      // 只旁路记录，渲染与 tokenizer 仍是生产实现。
      const recordingEstimator: TokenEstimator = {
        estimateRequest: (input) => {
          estimatedInputs.push(structuredClone(input.items))

          return productionEstimator.estimateRequest(input)
        },
      }
      // 每次真正发请求时，estimator 最后一次看到的输入。
      const estimatedAtRequest: Array<ModelInputItem[] | undefined> = []
      const streams: Array<() => AsyncGenerator<ModelStreamEvent>> = [
        () => adaptDeepSeekStream(toProviderStream([
          providerChunk({ reasoning_content: '需要查。' } as ChatCompletionChunk.Choice.Delta),
          providerChunk({
            tool_calls: [{
              index: 0,
              id: 'call-truncated',
              type: 'function',
              function: {
                name: 'search_articles',
                ...(rawArguments ? { arguments: rawArguments } : {}),
              },
            }],
          } as ChatCompletionChunk.Choice.Delta),
          providerChunk({}, 'length'),
        ])),
        () => toModelStream([
          toolCallEvent('call-retry', 'search_articles', '{"query":"seo"}'),
          { type: 'response_completed', finishReason: 'tool_calls' },
        ]),
        () => toModelStream([
          { type: 'text_delta', delta: '完成。' },
          { type: 'response_completed', finishReason: 'stop' },
        ]),
      ]
      const harness = createHarness(
        (_, __, callIndex) => {
          estimatedAtRequest.push(estimatedInputs.at(-1))

          return streams[callIndex]!()
        },
        undefined,
        undefined,
        { maxToolCalls: 3 },
        recordingEstimator,
      )

      // 生产 estimator 要求带工具的请求有 system 消息，与真实入口一致。
      const events = await collectEvents(harness.service.runTurnStream({
        conversationId: 'conversation-1',
        userContent: '问题',
        reasoningEffort: 'high',
        instructions: [{ type: 'message', role: 'system', content: 'SYS' }],
      }))

      assert.equal(events.at(-1)?.type, 'run_completed', `${label}: ${JSON.stringify(events.at(-1))}`)
      assert.equal(harness.assistantMessage()?.content, '完成。', label)
      assert.equal(harness.llmCalls.length, 3, label)
      assert.deepEqual(
        harness.toolInvocations.map(invocation => invocation.callId),
        ['call-retry'],
        label,
      )
      assert.deepEqual(
        harness.recorder.steps
          .filter(step => step.type === 'tool_execution')
          .map(step => [
            (step.input as { callId: string }).callId,
            step.status,
            (step.output as { code?: string }).code,
          ]),
        [
          ['call-truncated', AgentStepStatus.FAILED, 'truncated_arguments'],
          ['call-retry', AgentStepStatus.COMPLETED, undefined],
        ],
        label,
      )
      // 续轮表示：未校验参数用 DeepSeek 官方编码器对不可解析参数的回退形状承载，原文一字不改。
      assert.deepEqual(harness.llmCalls[1]?.messages.slice(2, 4), [
        {
          type: 'assistant_tool_call',
          calls: [{
            callId: 'call-truncated',
            name: 'search_articles',
            rawArgumentsJson: JSON.stringify({ arguments: rawArguments }),
          }],
          reasoningContent: '需要查。',
        },
        {
          type: 'tool_result',
          callId: 'call-truncated',
          name: 'search_articles',
          content: '工具 search_articles 的参数因模型输出达到长度限制而不完整，本次未执行；仍需要时请重新发起调用。',
          ok: false,
        },
      ], label)
      // 已校验的重发调用原样续传（对照）。
      assert.deepEqual(harness.llmCalls[2]?.messages.at(-2), {
        type: 'assistant_tool_call',
        calls: [{ callId: 'call-retry', name: 'search_articles', rawArgumentsJson: '{"query":"seo"}' }],
        reasoningContent: 'reasoning for call-retry',
      }, label)
      // 每一轮发出的请求，就是生产 estimator 最后一次估算的那份输入。
      assert.deepEqual(
        estimatedAtRequest,
        harness.llmCalls.map(call => call.messages),
        label,
      )
      assertNoUnfinishedSteps(harness)
    }
  })

  it('invalid_arguments 与 unknown_tool 回喂的未校验参数经生产 estimator 仍能续轮', async () => {
    const productionEstimator = new DeepSeekV4TokenEstimator()
    const cases = [
      { toolName: 'search_articles', code: 'invalid_arguments' },
      { toolName: 'not_a_tool', code: 'unknown_tool' },
    ] as const

    for (const { toolName, code } of cases) {
      for (const rawArguments of ['[]', '{"0":"x"}']) {
        const label = `${code} raw=${rawArguments}`
        const harness = createHarness(
          (_, __, callIndex) => toModelStream(callIndex === 0
            ? [
                toolCallEvent('call-bad', toolName, rawArguments),
                { type: 'response_completed', finishReason: 'tool_calls' },
              ]
            : [
                { type: 'text_delta', delta: '换个说法。' },
                { type: 'response_completed', finishReason: 'stop' },
              ]),
          undefined,
          async envelope => ({
            ok: false,
            code: 'invalid_arguments',
            modelContent: `工具 ${envelope.toolName} 的参数无效。`,
          }),
          undefined,
          productionEstimator,
        )

        const events = await collectEvents(harness.service.runTurnStream({
          conversationId: 'conversation-1',
          userContent: '问题',
          reasoningEffort: 'high',
          instructions: [{ type: 'message', role: 'system', content: 'SYS' }],
        }))

        assert.equal(events.at(-1)?.type, 'run_completed', `${label}: ${JSON.stringify(events.at(-1))}`)
        assert.equal(harness.llmCalls.length, 2, label)
        assert.equal(
          (findStep(harness, 'tool_execution')?.output as { code?: string }).code,
          code,
          label,
        )
        assert.deepEqual(harness.llmCalls[1]?.messages[2], {
          type: 'assistant_tool_call',
          calls: [{
            callId: 'call-bad',
            name: toolName,
            rawArgumentsJson: JSON.stringify({ arguments: rawArguments }),
          }],
          reasoningContent: 'reasoning for call-bad',
        }, label)
        assertNoUnfinishedSteps(harness)
      }
    }
  })

  it('length 后没有任何可配对 Tool Call 时按不完整回答失败', async () => {
    const harness = createHarness(() => adaptDeepSeekStream(toProviderStream([
      providerChunk({
        tool_calls: [{ index: 0, type: 'function', function: { name: 'search_articles', arguments: '{"q' } }],
      } as ChatCompletionChunk.Choice.Delta),
      providerChunk({}, 'length'),
    ])))

    const events = await collectEvents(harness.run())
    const finalEvent = events.at(-1)

    assert.equal(finalEvent?.type, 'run_failed')
    assert.match(finalEvent?.type === 'run_failed' ? finalEvent.message : '', /长度限制/)
    assert.equal(harness.toolInvocations.length, 0)
    assert.equal(findStep(harness, 'model_sampling')?.status, AgentStepStatus.FAILED)
    assertNoUnfinishedSteps(harness)
  })

  it('拒绝缺少 response_completed 的 sampling', async () => {
    const harness = createHarness(() => toModelStream([
      { type: 'text_delta', delta: '未完成' },
    ]))
    const events = await collectEvents(harness.run())

    assert.equal(events.at(-1)?.type, 'run_failed')
    assert.equal(harness.toolInvocations.length, 0)
    assert.deepEqual(harness.recorder.completedRunIds, [])
    assert.equal(findStep(harness, 'model_sampling')?.status, AgentStepStatus.FAILED)
    assertNoUnfinishedSteps(harness)
  })

  it('content 先于 tool_calls 的真实 provider 流按正常路径继续，文本保留并回填', async () => {
    const intermediate = '我先搜一下站内文章。'
    const harness = createHarness((_, options, callIndex) => callIndex === 0
      ? capturedTextThenToolCallModelStream(options, intermediate)
      : toModelStream([
          { type: 'text_delta', delta: '找到了。' },
          { type: 'response_completed', finishReason: 'stop' },
        ]))

    const events = await collectEvents(harness.run())
    const samplingStep = findStep(harness, 'model_sampling')
    const output = samplingStep?.output as Record<string, unknown>

    assert.deepEqual(events.map(event => event.type), [
      'run_started',
      'assistant_delta',
      'assistant_delta',
      'run_completed',
    ])
    assert.equal(harness.assistantMessage()?.content, `${intermediate}\n\n找到了。`)
    assert.equal(samplingStep?.status, AgentStepStatus.COMPLETED)
    assert.equal(output.finishReason, 'tool_calls')
    assert.deepEqual(harness.toolInvocations.map(invocation => invocation.callId), ['call-1'])
    // 第二轮 assistant 消息 content 等于该文本且带 tool_calls。
    assert.deepEqual(harness.llmCalls[1]?.messages[1], {
      type: 'assistant_tool_call',
      calls: [{ callId: 'call-1', name: 'search_articles', rawArgumentsJson: '{"query":"seo"}' }],
      reasoningContent: 'REASONING_NOT_IN_DEBUG_CAPTURE',
      content: intermediate,
    })
    assert.equal((output.debugRawResponse as { state: string }).state, 'complete')
    // 本轮回填模型的文本与 reasoning 作为内容事实落在采样 Step 上；debug 捕获照旧剔除 reasoning。
    assert.equal(output.intermediateText, intermediate)
    assert.equal(output.reasoningContent, 'REASONING_NOT_IN_DEBUG_CAPTURE')
    assert.doesNotMatch(JSON.stringify(output.debugRawResponse), /REASONING_NOT_IN_DEBUG_CAPTURE/)
    assertNoUnfinishedSteps(harness)
  })

  it('第三轮再次请求工具时拒绝第三次执行且不发起第四轮 sampling', async () => {
    const streams: ModelStreamEvent[][] = [
      [
        toolCallEvent('call-1', 'search_articles', '{"query":"seo"}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ],
      [
        toolCallEvent('call-2', 'search_articles', '{"query":"sitemap"}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ],
      [
        toolCallEvent('call-3', 'search_articles', '{"query":"vue"}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ],
    ]
    const harness = createHarness((_, __, callIndex) =>
      toModelStream(streams[callIndex] ?? []))

    const events = await collectEvents(harness.run())
    const finalEvent = events.at(-1)

    assert.equal(finalEvent?.type, 'run_failed')
    assert.match(
      finalEvent?.type === 'run_failed' ? finalEvent.message : '',
      /执行上限/,
    )
    assert.deepEqual(
      harness.toolInvocations.map(invocation => invocation.callId),
      ['call-1', 'call-2'],
    )
    assert.equal(harness.llmCalls.length, 3)
    assert.equal(
      harness.recorder.steps.filter(step => step.type === 'tool_execution').length,
      2,
    )
    assert.equal(harness.assistantMessage()?.status, MessageStatus.FAILED)
    assert.deepEqual(harness.recorder.failedRunIds, ['run-1'])
    const samplingSteps = harness.recorder.steps.filter(
      step => step.type === 'model_sampling',
    )
    assert.deepEqual(
      samplingSteps.map(step => step.status),
      Array.from({ length: 3 }).fill(AgentStepStatus.COMPLETED),
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
    assert.deepEqual(withoutVolatileSamplingFields(samplingStep?.output), {
      samplingAttemptId: 'run-1:sampling-1',
      finishReason: null,
      usage: {
        inputTokens: 7,
        outputTokens: 3,
        totalTokens: 10,
        reasoningTokens: 2,
        promptCacheHitTokens: 5,
        promptCacheMissTokens: 2,
      },
      toolCallCount: 0,
      // 非 LLMError 的流错误只可能来自服务端自身，归为 internal。
      errorCode: 'internal',
    })
    assert.equal(harness.recorder.runErrorCode, 'internal')
    assert.equal(findStep(harness, 'assistant_output')?.status, AgentStepStatus.FAILED)
    assertNoUnfinishedSteps(harness)
  })

  it('Message 已进入 ABORTED 后拒绝迟到 completion 且不伪造收口成功', async () => {
    const harness = createHarness(() => toModelStream([
      { type: 'text_delta', delta: '迟到回答' },
      { type: 'response_completed', finishReason: 'stop' },
    ]))
    const stream = harness.run()

    assert.equal((await stream.next()).value?.type, 'run_started')
    assert.equal((await stream.next()).value?.type, 'assistant_delta')

    const assistantMessage = harness.assistantMessage()

    assert.ok(assistantMessage, 'assistantMessage')
    assistantMessage.status = MessageStatus.ABORTED
    assistantMessage.content = '已停止'

    // 终态化失败在抛出前会先 best-effort 通知流消费者，再拒绝。
    const failureEvent = await stream.next()

    assert.equal(
      (failureEvent.value as AgentRuntimeEvent | undefined)?.type,
      'run_failed',
    )
    await assert.rejects(
      stream.next(),
      AgentRunTerminalizationError,
    )
    assert.equal(harness.assistantMessage()?.status, MessageStatus.ABORTED)
    assert.equal(harness.assistantMessage()?.content, '已停止')
    assert.deepEqual(harness.recorder.completedRunIds, [])
    assert.deepEqual(harness.recorder.failedRunIds, [])
    assert.equal(findStep(harness, 'assistant_output')?.status, AgentStepStatus.RUNNING)
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
      (_, options) => abortingModelStream(abortController, options),
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
    assert.deepEqual(
      (findStep(harness, 'model_sampling')?.output as Record<string, unknown>)
        .usage,
      {
        inputTokens: 7,
        outputTokens: 3,
        totalTokens: 10,
        reasoningTokens: 2,
        promptCacheHitTokens: 5,
        promptCacheMissTokens: 2,
      },
    )
    assert.deepEqual(
      (findStep(harness, 'model_sampling')?.output as Record<string, unknown>)
        .debugRawResponse,
      {
        state: 'partial',
        truncated: false,
        value: { choices: [{ message: { content: '部分' } }] },
      },
    )
    assertNoUnfinishedSteps(harness)
  })

  it('Provider 完整结束后、Step 落库前 Abort 时仍保留已成立 Usage', async () => {
    const abortController = new AbortController()
    const harness = createHarness(
      (_, options) => abortingAfterCompletionModelStream(
        abortController,
        options,
      ),
      abortController.signal,
    )

    const events = await collectEvents(harness.run())
    const samplingStep = findStep(harness, 'model_sampling')

    assert.equal(events.at(-1)?.type, 'run_aborted')
    assert.equal(samplingStep?.status, AgentStepStatus.ABORTED)
    assert.deepEqual(withoutVolatileSamplingFields(samplingStep?.output), {
      samplingAttemptId: 'run-1:sampling-1',
      finishReason: 'stop',
      usage: {
        inputTokens: 7,
        outputTokens: 3,
        totalTokens: 10,
        reasoningTokens: 2,
        promptCacheHitTokens: 5,
        promptCacheMissTokens: 2,
      },
      toolCallCount: 0,
      debugRequestBody: {
        truncated: false,
        value: { model: 'deepseek-v4-flash' },
      },
      debugRawResponse: {
        state: 'complete',
        truncated: false,
        value: { choices: [{ message: { content: '完整' } }] },
      },
      errorCode: 'aborted',
    })
    assertNoUnfinishedSteps(harness)
  })

  it('消费者在 delta 后提前 return() 时兜底收口为 ABORTED 并持久化 partial capture', async () => {
    const warnings: unknown[] = []
    const harness = createHarness((_, options) =>
      capturedTextModelStream(options))

    Object.defineProperty(harness.service, 'logger', {
      value: {
        error: () => {},
        warn: (warning: unknown) => warnings.push(warning),
      },
    })
    const generator = harness.run()

    const first = await generator.next()
    assert.equal((first.value as AgentRuntimeEvent | undefined)?.type, 'run_started')
    const second = await generator.next()
    assert.equal((second.value as AgentRuntimeEvent | undefined)?.type, 'assistant_delta')

    // for-await break 语义：触发 generator.return()，yield 点以 return
    // 语义恢复，catch 不执行，只有 finally 兜底有机会收口。
    await generator.return(undefined)

    assert.equal(harness.assistantMessage()?.status, MessageStatus.ABORTED)
    assert.equal(harness.assistantMessage()?.content, '部')
    assert.deepEqual(harness.recorder.abortedRunIds, ['run-1'])
    assert.deepEqual(harness.recorder.completedRunIds, [])
    assert.deepEqual(harness.recorder.failedRunIds, [])
    // 兜底收口必须同时取消在途模型请求，否则 provider 流会继续生成计费 token。
    assert.equal(harness.llmCalls[0]?.options?.signal?.aborted, true)
    assert.deepEqual(
      (findStep(harness, 'model_sampling')?.output as Record<string, unknown>)
        .debugRawResponse,
      {
        state: 'partial',
        truncated: false,
        value: {
          id: 'chunk-1',
          object: 'chat.completion',
          created: 1_756_000_000,
          model: 'deepseek-v4-flash',
          choices: [{
            index: 0,
            finish_reason: null,
            message: { role: 'assistant', content: '部' },
          }],
        },
      },
    )
    assert.deepEqual(warnings, [{
      event: 'model_sampling_debug_capture_closed',
      runId: 'run-1',
      samplingAttemptId: 'run-1:sampling-1',
      termination: 'consumer_return',
      captureState: 'partial',
      lastModelEvent: 'text_delta',
      textChars: 1,
      toolCallCount: 0,
    }])
    // 兜底按用户中断语义收口：采样 Step 与 Run 同记 aborted 与中断文案。
    assert.equal(harness.recorder.runErrorCode, 'aborted')
    assert.equal(findStep(harness, 'model_sampling')?.errorMessage, '用户已停止生成。')
    assert.equal(
      (findStep(harness, 'model_sampling')?.output as Record<string, unknown>).errorCode,
      'aborted',
    )
    assertNoUnfinishedSteps(harness)
  })

  it('捕获未开启时消费者 return() 的采样 Step 只记失败类别与中断文案', async () => {
    const harness = createHarness(() => toModelStream([
      { type: 'text_delta', delta: '部' },
      { type: 'text_delta', delta: '分' },
      { type: 'response_completed', finishReason: 'stop' },
    ]))
    const generator = harness.run()

    await generator.next()
    await generator.next()
    await generator.return(undefined)

    const { contextPlan: _, ...samplingOutput } = findStep(harness, 'model_sampling')
      ?.output as Record<string, unknown>

    // 流没收完就没有 summary：不伪造 usage / firstTokenMs，只有失败类别。
    assert.deepEqual(samplingOutput, { errorCode: 'aborted' })
    assert.equal(findStep(harness, 'model_sampling')?.status, AgentStepStatus.ABORTED)
    assert.equal(findStep(harness, 'model_sampling')?.errorMessage, '用户已停止生成。')
    assert.equal(harness.recorder.runErrorCode, 'aborted')
    assertNoUnfinishedSteps(harness)
  })

  it('Abort 在已缓冲 delta 返回后生效时先关闭 iterator 再保存 partial capture', async () => {
    const abortController = new AbortController()
    const harness = createHarness(
      (_, options) => abortingBeforeYieldModelStream(
        abortController,
        options,
      ),
      abortController.signal,
    )

    const events = await collectEvents(harness.run())
    const samplingStep = findStep(harness, 'model_sampling')

    assert.deepEqual(
      events.map(event => event.type),
      ['run_started', 'run_aborted'],
    )
    assert.equal(samplingStep?.status, AgentStepStatus.ABORTED)
    assert.deepEqual(
      (samplingStep?.output as Record<string, unknown>).debugRawResponse,
      {
        state: 'partial',
        truncated: false,
        value: { choices: [{ message: { content: '已缓冲' } }] },
      },
    )
    assert.equal(harness.assistantMessage()?.content, '')
    assert.equal(harness.toolInvocations.length, 0)
    assertNoUnfinishedSteps(harness)
  })

  it('请求开始前已 Abort 时不再开始 normal DB / sampling 并收口 Run', async () => {
    const abortController = new AbortController()

    abortController.abort()
    const harness = createHarness(
      () => toModelStream([
        { type: 'response_completed', finishReason: 'stop' },
      ]),
      abortController.signal,
    )

    const events = await collectEvents(harness.run())

    assert.deepEqual(events, [])
    assert.equal(harness.llmCalls.length, 0)
    assert.equal(harness.assistantMessage(), undefined)
    assert.deepEqual(harness.recorder.abortedRunIds, ['run-1'])
    assert.deepEqual(harness.recorder.failedRunIds, [])
    assert.deepEqual(harness.recorder.steps, [])
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

  it('用户在第二或第三轮 sampling 期间 Abort 时只收口为 ABORTED', async () => {
    for (const targetSampling of [2, 3]) {
      const abortController = new AbortController()
      const harness = createHarness((_, options, callIndex) => {
        if (callIndex + 1 === targetSampling) {
          return abortingWithoutDeltaModelStream(
            abortController,
            options?.signal,
          )
        }

        return toModelStream([
          toolCallEvent(
            `call-${callIndex + 1}`,
            'search_articles',
            callIndex === 0 ? '{"query":"seo"}' : '{"query":"sitemap"}',
          ),
          { type: 'response_completed', finishReason: 'tool_calls' },
        ])
      }, abortController.signal)

      const events = await collectEvents(harness.run())

      assert.equal(events.at(-1)?.type, 'run_aborted')
      assert.equal(harness.llmCalls.length, targetSampling)
      assert.equal(harness.toolInvocations.length, targetSampling - 1)
      assert.deepEqual(harness.recorder.abortedRunIds, ['run-1'])
      assert.deepEqual(harness.recorder.failedRunIds, [])
      assert.equal(
        harness.recorder.steps.filter(step => step.type === 'model_sampling').at(-1)?.status,
        AgentStepStatus.ABORTED,
      )
      assertNoUnfinishedSteps(harness)
    }
  })

  it('Run deadline 先到时会取消 sampling 并且不被随后用户 Abort 覆盖', async () => {
    const abortController = new AbortController()
    const harness = createHarness(
      (_, options) => waitForAbortModelStream(
        options?.signal,
        () => abortController.abort(),
        options,
      ),
      abortController.signal,
      async () => ({
        ok: true,
        data: null,
        modelContent: '不会执行工具。',
      }),
      { runDeadlineMs: 10 },
    )

    const events = await collectEvents(harness.run())
    const finalEvent = events.at(-1)

    assert.equal(finalEvent?.type, 'run_failed')
    assert.match(
      finalEvent?.type === 'run_failed' ? finalEvent.message : '',
      /执行时限/,
    )
    assert.equal(harness.llmCalls.length, 1)
    assert.equal(abortController.signal.aborted, true)
    assert.equal(harness.llmCalls[0]?.options?.signal?.aborted, true)
    assert.equal(harness.assistantMessage()?.status, MessageStatus.FAILED)
    assert.deepEqual(harness.recorder.failedRunIds, ['run-1'])
    assert.deepEqual(harness.recorder.abortedRunIds, [])
    assert.equal(findStep(harness, 'model_sampling')?.status, AgentStepStatus.FAILED)
    assert.deepEqual(
      (findStep(harness, 'model_sampling')?.output as Record<string, unknown>)
        .debugRawResponse,
      { state: 'empty' },
    )
    assertNoUnfinishedSteps(harness)
  })

  it('工具执行本身抛错时 Step 记工具失败，Run 归为 internal 且不说成模型问题', async () => {
    const harness = createHarness(
      () => toModelStream([
        toolCallEvent('call-1', 'search_articles', '{"query":"seo"}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]),
      undefined,
      async () => {
        throw new Error('database connection lost')
      },
    )

    const events = await collectEvents(harness.run())
    const failedEvent = events.at(-1)

    assert.equal(failedEvent?.type, 'run_failed')
    assert.equal(
      failedEvent?.type === 'run_failed' ? failedEvent.message : undefined,
      '服务端未能完成本轮回答，请稍后重试。',
    )
    assert.equal(findStep(harness, 'tool_execution')?.errorMessage, '工具执行未能安全完成。')
    assert.equal(harness.recorder.runErrorCode, 'internal')
    assertNoUnfinishedSteps(harness)
  })

  it('Run deadline 会取消 in-flight Tool Execution 且不发起下一轮 sampling', async () => {
    const harness = createHarness(
      () => toModelStream([
        toolCallEvent('call-1', 'search_articles', '{"query":"seo"}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]),
      undefined,
      async (_, context) => {
        await waitForAbort(context.signal)
        context.signal.throwIfAborted()
        return {
          ok: true,
          data: null,
          modelContent: '不会返回结果。',
        }
      },
      { runDeadlineMs: 10 },
    )

    const events = await collectEvents(harness.run())

    assert.equal(events.at(-1)?.type, 'run_failed')
    assert.equal(harness.llmCalls.length, 1)
    assert.equal(harness.toolInvocations.length, 1)
    assert.equal(harness.toolExecutionContexts[0]?.signal.aborted, true)
    assert.equal(findStep(harness, 'tool_execution')?.status, AgentStepStatus.FAILED)
    // 工具是被 deadline 取消的，Step 按终态原因记时限文案，不记成工具自身失败。
    assert.equal(findStep(harness, 'tool_execution')?.errorMessage, 'Agent Run 已达到执行时限。')
    assert.equal(harness.recorder.runErrorCode, 'deadline')
    assert.deepEqual(harness.recorder.failedRunIds, ['run-1'])
    assert.deepEqual(harness.recorder.abortedRunIds, [])
    assertNoUnfinishedSteps(harness)
  })

  it('Run-budget DB timeout 归因为 deadline 且不开始 sampling', async () => {
    const harness = createHarness(() => toModelStream([
      { type: 'response_completed', finishReason: 'stop' },
    ]))

    harness.prisma.deadlineTransactionError
      = new DatabaseOperationDeadlineExceededError()
    const events = await collectEvents(harness.run())
    const failure = events.at(-1)

    assert.equal(failure?.type, 'run_failed')
    assert.match(
      failure?.type === 'run_failed' ? failure.message : '',
      /执行时限/,
    )
    assert.equal(harness.llmCalls.length, 0)
    assert.deepEqual(harness.recorder.failedRunIds, ['run-1'])
    assertNoUnfinishedSteps(harness)
  })

  it('普通 DB failure 先发生时不被随后 Run deadline 改写', async () => {
    const harness = createHarness(
      () => toModelStream([
        { type: 'response_completed', finishReason: 'stop' },
      ]),
      undefined,
      undefined,
      { runDeadlineMs: 5 },
    )

    harness.prisma.deadlineTransactionError = new Error('ordinary database failure')
    harness.recorder.failRunDelayMs = 15
    const events = await collectEvents(harness.run())
    const failure = events.at(-1)

    assert.equal(failure?.type, 'run_failed')
    assert.doesNotMatch(
      failure?.type === 'run_failed' ? failure.message : '',
      /执行时限/,
    )
    assert.equal(harness.llmCalls.length, 0)
    assert.deepEqual(harness.recorder.failedRunIds, ['run-1'])
    assertNoUnfinishedSteps(harness)
  })

  it('terminal transaction 提交后到达的用户 Abort 不覆盖正常完成', async () => {
    const abortController = new AbortController()
    const harness = createHarness(
      () => toModelStream([
        { type: 'text_delta', delta: '已完成' },
        { type: 'response_completed', finishReason: 'stop' },
      ]),
      abortController.signal,
    )
    const events = await collectEvents(harness.run())

    abortController.abort()
    assert.equal(events.at(-1)?.type, 'run_completed')
    assert.equal(harness.assistantMessage()?.status, MessageStatus.COMPLETED)
    assert.deepEqual(harness.recorder.completedRunIds, ['run-1'])
    assert.deepEqual(harness.recorder.abortedRunIds, [])
    assertNoUnfinishedSteps(harness)
  })

  it('completion commit ownership 已取得时，提交期间 Abort 不覆盖正常完成', async () => {
    const abortController = new AbortController()
    const commitGate = createDeferred()
    const harness = createHarness(
      () => toModelStream([
        { type: 'text_delta', delta: '已完成' },
        { type: 'response_completed', finishReason: 'stop' },
      ]),
      abortController.signal,
    )
    harness.recorder.completeRunCommitGate = commitGate.promise

    const eventsPromise = collectEvents(harness.run())
    await harness.recorder.completionOwnership.promise
    abortController.abort()
    commitGate.resolve()
    const events = await eventsPromise

    assert.equal(events.at(-1)?.type, 'run_completed')
    assert.equal(harness.assistantMessage()?.status, MessageStatus.COMPLETED)
    assert.deepEqual(harness.recorder.completedRunIds, ['run-1'])
    assert.deepEqual(harness.recorder.abortedRunIds, [])
    assertNoUnfinishedSteps(harness)
  })

  it('completion commit 失败时恢复提交期间最先到达的 deadline', async () => {
    const commitGate = createDeferred()
    const harness = createHarness(
      () => toModelStream([
        { type: 'text_delta', delta: '未提交' },
        { type: 'response_completed', finishReason: 'stop' },
      ]),
      undefined,
      undefined,
      { runDeadlineMs: 20 },
    )
    harness.recorder.completeRunCommitGate = commitGate.promise
    harness.recorder.completeRunCommitError = new Error('commit failed')

    const eventsPromise = collectEvents(harness.run())
    await harness.recorder.completionOwnership.promise
    await new Promise(resolve => setTimeout(resolve, 30))
    commitGate.resolve()
    const events = await eventsPromise

    assert.equal(events.at(-1)?.type, 'run_failed')
    assert.equal(harness.assistantMessage()?.status, MessageStatus.FAILED)
    assert.deepEqual(harness.recorder.completedRunIds, [])
    assert.deepEqual(harness.recorder.failedRunIds, ['run-1'])
    assertNoUnfinishedSteps(harness)
  })

  it('completion commit 结果未知时不伪造失败收口或启动 cleanup', async () => {
    const outcomeUnknown = new DatabaseCommitOutcomeUnknownError()
    const harness = createHarness(() => toModelStream([
      { type: 'text_delta', delta: '结果未知' },
      { type: 'response_completed', finishReason: 'stop' },
    ]))
    harness.recorder.completeRunCommitError = outcomeUnknown

    await assert.rejects(
      collectEvents(harness.run()),
      error => (
        error instanceof AgentRunTerminalizationError
        && error.runCause === outcomeUnknown
        && error.terminalizationCause === outcomeUnknown
      ),
    )

    assert.equal(harness.assistantMessage()?.status, MessageStatus.STREAMING)
    assert.deepEqual(harness.recorder.completedRunIds, [])
    assert.deepEqual(harness.recorder.failedRunIds, [])
    assert.deepEqual(harness.recorder.abortedRunIds, [])
    assert.equal(findStep(harness, 'assistant_output')?.status, AgentStepStatus.RUNNING)
  })

  it('completion commit 结果未知时抛出前 best-effort 通知流消费者', async () => {
    const outcomeUnknown = new DatabaseCommitOutcomeUnknownError()
    const harness = createHarness(() => toModelStream([
      { type: 'text_delta', delta: '结果未知' },
      { type: 'response_completed', finishReason: 'stop' },
    ]))
    harness.recorder.completeRunCommitError = outcomeUnknown

    const events: AgentRuntimeEvent[] = []
    let caught: unknown

    try {
      for await (const event of harness.run())
        events.push(event)
    }
    catch (error) {
      caught = error
    }

    assert.ok(caught instanceof AgentRunTerminalizationError, 'caught instanceof AgentRunTerminalizationError')
    assert.equal(events.at(-1)?.type, 'run_failed')
    assert.match(
      (events.at(-1) as { message: string }).message,
      /收口结果未知/,
    )
    // DB 终态仍不被伪造：Message 保持 STREAMING，无任何 cleanup。
    assert.equal(harness.assistantMessage()?.status, MessageStatus.STREAMING)
    assert.deepEqual(harness.recorder.abortedRunIds, [])
    assert.deepEqual(harness.recorder.failedRunIds, [])
  })
})

/** 测试 Provider 的密钥；出现在日志里就说明泄漏。 */
const FAKE_PROVIDER_API_KEY = 'sk-test-must-not-leak-4f2a'
/** 写进用户输入的哨兵；出现在日志里就说明记了请求体。 */
const PROMPT_SENTINEL = '请求体哨兵-不应出现在日志里'

describe('Run 失败归因与首 token 时间（真实 SDK + fake fetch 故障注入）', () => {
  const failureCases: Array<{
    name: string
    attempts: FakeFetchAttempt[]
    errorCode: string
    error: Error
    httpStatus?: number
    fetchCount: number
  }> = [
    {
      name: '401',
      attempts: [() => providerErrorResponse(401)],
      errorCode: 'llm_auth',
      error: new LLMAuthError(),
      httpStatus: 401,
      fetchCount: 1,
    },
    {
      name: '402',
      attempts: [() => providerErrorResponse(402)],
      errorCode: 'llm_balance',
      error: new LLMBalanceError(),
      httpStatus: 402,
      fetchCount: 1,
    },
    {
      name: '429 重试用尽',
      attempts: Array.from({ length: 3 }, () => () => providerErrorResponse(429)),
      errorCode: 'llm_rate_limit',
      error: new LLMRateLimitError(),
      httpStatus: 429,
      fetchCount: 3,
    },
    {
      name: '500 重试用尽',
      attempts: Array.from({ length: 3 }, () => () => providerErrorResponse(500)),
      errorCode: 'llm_server',
      error: new LLMServerError(500),
      httpStatus: 500,
      fetchCount: 3,
    },
    {
      name: '流中途连接重置',
      attempts: [() => connectionResetSseResponse()],
      errorCode: 'llm_network',
      error: new LLMNetworkError(new Error('terminated')),
      fetchCount: 1,
    },
    {
      name: '流中途结束却缺 finish_reason',
      attempts: [() => sseResponse([sseData({ content: '部分' }), 'data: [DONE]'])],
      errorCode: 'llm_protocol',
      error: new LLMApiError('模型流在没有 finish reason 的情况下结束'),
      fetchCount: 1,
    },
    // #168：未映射状态码的报错回显了 key，warn 日志只能带 *** 的版本。
    {
      name: '404 且报错回显 key',
      attempts: [() => providerErrorResponse(404)],
      errorCode: 'llm_protocol',
      error: new LLMApiError('LLM API HTTP 404 错误'),
      httpStatus: 404,
      fetchCount: 1,
    },
    {
      name: 'SSE 行不是合法 JSON',
      attempts: [() => sseResponse([sseData({ content: '部分' }), 'data: {"choices": [truncated'])],
      errorCode: 'llm_protocol',
      error: new LLMApiError('模型服务返回了无法解析的数据'),
      fetchCount: 1,
    },
    {
      name: '数据块没有 choices',
      attempts: [() => sseResponse(['data: {"message":"upstream oops"}', 'data: [DONE]'])],
      errorCode: 'llm_protocol',
      error: new LLMApiError('模型流返回了没有 choices 的数据块'),
      fetchCount: 1,
    },
    {
      name: '流内 error 对象 code 429',
      attempts: [() => sseResponse([`data: ${JSON.stringify({ error: { code: 429, message: 'rate limited' } })}`])],
      errorCode: 'llm_rate_limit',
      error: new LLMRateLimitError(),
      fetchCount: 1,
    },
    {
      name: '流内 error 对象 code 503',
      attempts: [() => sseResponse([`data: ${JSON.stringify({ error: { code: '503', message: 'busy' } })}`])],
      errorCode: 'llm_server',
      error: new LLMServerError(503),
      fetchCount: 1,
    },
  ]

  for (const failureCase of failureCases) {
    it(`AC-01 上游${failureCase.name}：Run FAILED / ${failureCase.errorCode}，Step 与 error 事件同一套文案，一条不含密钥与请求体的 warn`, async () => {
      const provider = createFakeFetchProvider(failureCase.attempts)
      const harness = createHarness(provider.createModelStream)
      const warnings = captureRuntimeWarnings(harness)
      const expectedMessage = getAiExceptionMessage(failureCase.error)

      const events = await collectEvents(harness.service.runTurnStream({
        conversationId: 'conversation-1',
        userContent: PROMPT_SENTINEL,
        instructions: [],
      }))
      const failedEvent = events.at(-1)
      const chatEvent = failedEvent ? toChatStreamEvent(failedEvent) : undefined
      const samplingStep = findStep(harness, 'model_sampling')
      const samplingOutput = samplingStep?.output as Record<string, unknown>

      assert.equal(provider.fetchCalls.length, failureCase.fetchCount)
      assert.equal(failedEvent?.type, 'run_failed')
      assert.deepEqual(harness.recorder.failedRunIds, ['run-1'])
      assert.equal(harness.recorder.runErrorCode, failureCase.errorCode)
      // 前台 error 事件、采样 Step 与 getAiExceptionMessage 是同一套文案。
      assert.equal(chatEvent?.type === 'error' ? chatEvent.message : undefined, expectedMessage)
      assert.equal(samplingStep?.status, AgentStepStatus.FAILED)
      assert.equal(samplingStep?.errorMessage, expectedMessage)
      assert.equal(samplingOutput.errorCode, failureCase.errorCode)

      const runFailures = warnings.filter(warning => warning.event === 'agent_run_failed')

      assert.deepEqual(runFailures, [{
        event: 'agent_run_failed',
        runId: 'run-1',
        stepId: samplingStep?.id,
        errorCode: failureCase.errorCode,
        errorName: failureCase.error.name,
        ...(failureCase.httpStatus === undefined ? {} : { httpStatus: failureCase.httpStatus }),
        message: runFailures[0]?.message,
      }])
      assert.equal(typeof runFailures[0]?.message, 'string')
      // 上游 401 body 回显了 key；日志只有安全字段，既不含 key 也不含请求体。
      assert.equal(JSON.stringify(warnings).includes(FAKE_PROVIDER_API_KEY), false)
      assert.equal(JSON.stringify(warnings).includes(PROMPT_SENTINEL), false)
      assertNoUnfinishedSteps(harness)
    })
  }

  it('AC-02 流进行中用户停止：Run ABORTED / aborted，采样 Step 记中断文案，raw capture 为 partial', async () => {
    const abortController = new AbortController()
    const provider = createFakeFetchProvider([
      init => hangingSseResponse(init, sseData({ content: '部分' })),
    ])
    const harness = createHarness(provider.createModelStream, abortController.signal)
    const warnings = captureRuntimeWarnings(harness)
    const events: AgentRuntimeEvent[] = []

    for await (const event of harness.run()) {
      events.push(event)
      if (event.type === 'assistant_delta')
        abortController.abort()
    }

    const samplingStep = findStep(harness, 'model_sampling')
    const samplingOutput = samplingStep?.output as Record<string, unknown>

    assert.deepEqual(events.map(event => event.type), [
      'run_started',
      'assistant_delta',
      'run_aborted',
    ])
    assert.deepEqual(harness.recorder.abortedRunIds, ['run-1'])
    assert.equal(harness.recorder.runErrorCode, 'aborted')
    assert.equal(samplingStep?.status, AgentStepStatus.ABORTED)
    assert.equal(samplingStep?.errorMessage, '用户已停止生成。')
    assert.equal(samplingOutput.errorCode, 'aborted')
    // SDK 读响应体遇到 abort 会静默结束迭代，源流「正常结束」也不能标 complete。
    assert.equal(
      (samplingOutput.debugRawResponse as Record<string, unknown>).state,
      'partial',
    )
    // 用户停止不是故障，不打失败日志。
    assert.equal(warnings.some(warning => warning.event === 'agent_run_failed'), false)
    assertNoUnfinishedSteps(harness)
  })

  it('AC-02 流进行中 Run deadline 到期：Run FAILED / deadline，采样 Step 与 assistant_output Step 文案一致', async () => {
    const provider = createFakeFetchProvider([
      init => hangingSseResponse(init, sseData({ content: '部分' })),
    ])
    const harness = createHarness(
      provider.createModelStream,
      undefined,
      undefined,
      { runDeadlineMs: 80 },
    )
    const warnings = captureRuntimeWarnings(harness)

    const events = await collectEvents(harness.run())
    const failedEvent = events.at(-1)
    const samplingStep = findStep(harness, 'model_sampling')
    const assistantOutputStep = findStep(harness, 'assistant_output')
    const samplingOutput = samplingStep?.output as Record<string, unknown>

    assert.deepEqual(events.map(event => event.type), [
      'run_started',
      'assistant_delta',
      'run_failed',
    ])
    assert.deepEqual(harness.recorder.failedRunIds, ['run-1'])
    assert.equal(harness.recorder.runErrorCode, 'deadline')
    assert.equal(
      failedEvent?.type === 'run_failed' ? failedEvent.message : undefined,
      'Agent Run 已达到执行时限。',
    )
    assert.equal(samplingStep?.status, AgentStepStatus.FAILED)
    assert.equal(assistantOutputStep?.status, AgentStepStatus.FAILED)
    assert.equal(samplingStep?.errorMessage, 'Agent Run 已达到执行时限。')
    assert.equal(samplingStep?.errorMessage, assistantOutputStep?.errorMessage)
    assert.equal(samplingOutput.errorCode, 'deadline')
    assert.equal(
      (samplingOutput.debugRawResponse as Record<string, unknown>).state,
      'partial',
    )
    assert.deepEqual(
      warnings
        .filter(warning => warning.event === 'agent_run_failed')
        .map(warning => [warning.errorCode, warning.errorName]),
      [['deadline', 'AgentRunDeadlineExceededError']],
    )
    assertNoUnfinishedSteps(harness)
  })

  // 「首 token 从 reasoning_started 算起」由 model-sampling-decision.test.ts 用注入时钟确定性断言。
  it('AC-04 正常完成的采样 Step 带 firstTokenMs：大于 0 且不超过 Step 时长；成功 Run 的 errorCode 为 null', async () => {
    const provider = createFakeFetchProvider([
      () => delayedSseResponse([
        { delayMs: 20, data: sseData({ reasoning_content: '先想一下' }) },
        { delayMs: 10, data: sseData({ content: '答' }, 'stop') },
        { delayMs: 0, data: 'data: [DONE]' },
      ]),
    ])
    const harness = createHarness(provider.createModelStream)

    const events = await collectEvents(harness.run())
    const samplingStep = findStep(harness, 'model_sampling')
    const firstTokenMs = (samplingStep?.output as Record<string, unknown>).firstTokenMs
    const stepDurationMs = samplingStep!.endedAt!.getTime() - samplingStep!.startedAt.getTime()

    assert.equal(events.at(-1)?.type, 'run_completed')
    assert.deepEqual(harness.recorder.completedRunIds, ['run-1'])
    assert.equal(harness.recorder.runErrorCode, null)
    assert.equal(typeof firstTokenMs, 'number')
    assert.ok((firstTokenMs as number) > 0, `firstTokenMs=${String(firstTokenMs)}`)
    assert.ok((firstTokenMs as number) <= stepDurationMs, `firstTokenMs=${String(firstTokenMs)} > ${stepDurationMs}`)

    const detail = projectHarnessRunDetail(harness, 'COMPLETED')
    const samplingItem = detail.timeline.find(item => item.type === 'model_sampling')

    assert.equal(detail.errorCode, null)
    assert.deepEqual(
      samplingItem?.kind === 'known' && samplingItem.type === 'model_sampling'
        ? [samplingItem.firstTokenMs, samplingItem.errorCode]
        : null,
      [firstTokenMs, null],
    )
  })
})

describe('Run 轨迹补齐模型可见内容', () => {
  it('AC-01 多轮 Run：每轮请求里的参数、observation、中间文本、reasoning 与历史条数都能从落库事实逐字还原', async () => {
    const streams: ModelStreamEvent[][] = [
      [
        { type: 'text_delta', delta: '先查两处。' },
        toolCallEvent('call-bad', 'search_articles', '{"query":', '第一轮推理', 0),
        toolCallEvent('call-ok', 'search_articles', '{"query":"seo"}', '第一轮推理', 1),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ],
      [
        toolCallEvent('call-second', 'search_articles', '{"query":"sitemap"}', '第二轮推理'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ],
      [
        { type: 'text_delta', delta: '最终回答。' },
        { type: 'response_completed', finishReason: 'stop' },
      ],
    ]
    const harness = createHarness(
      (_, __, callIndex) => toModelStream(streams[callIndex] ?? []),
      undefined,
      async envelope => envelope.callId === 'call-bad'
        ? {
            ok: false,
            code: 'invalid_arguments',
            modelContent: `工具 ${envelope.toolName} 的参数无效。`,
          }
        : { ok: true, modelContent: `结果 ${envelope.callId}\n第二行` },
      { maxToolCalls: 3 },
    )

    for (const [index, content] of ['旧问题', '旧回答'].entries()) {
      harness.prisma.seedMessage({
        id: `history-${index + 1}`,
        content,
        role: index === 0 ? MessageRole.USER : MessageRole.ASSISTANT,
        status: MessageStatus.COMPLETED,
        createdAt: new Date(`2026-01-01T00:00:0${index + 1}.000Z`),
      })
    }

    const events = await collectEvents(harness.run())

    assert.equal(events.at(-1)?.type, 'run_completed')
    assert.equal(harness.llmCalls.length, 3)

    const samplingSteps = harness.recorder.steps.filter(step => step.type === 'model_sampling')
    const toolSteps = harness.recorder.steps.filter(step => step.type === 'tool_execution')

    // 每轮续轮请求里的 assistant_tool_call / tool_result 只用落库事实就能逐字拼出来。
    for (const callIndex of [1, 2]) {
      assert.deepEqual(
        harness.llmCalls[callIndex]?.messages.filter(item => item.type !== 'message'),
        toolExchangesFromSteps(harness, callIndex + 1),
      )
    }
    // 非法参数没有通过校验：落库与回喂都是 `{"arguments": raw}`；合法参数原样。
    assert.deepEqual(
      toolSteps.map(step => (step.input as Record<string, unknown>).arguments),
      ['{"arguments":"{\\"query\\":"}', '{"query":"seo"}', '{"query":"sitemap"}'],
    )
    assert.deepEqual(
      toolSteps.map(step => (step.output as Record<string, unknown>).observation),
      ['工具 search_articles 的参数无效。', '结果 call-ok\n第二行', '结果 call-second\n第二行'],
    )
    // 中间文本：只有第 1 轮有，等于第 2 轮请求里 assistant 消息的 content。
    assert.deepEqual(
      samplingSteps.map(step => (step.output as Record<string, unknown>).intermediateText),
      ['先查两处。', undefined, undefined],
    )
    assert.equal(
      harness.llmCalls[1]?.messages.find(item => item.type === 'assistant_tool_call')?.content,
      '先查两处。',
    )
    assert.deepEqual(
      samplingSteps.map(step => (step.output as Record<string, unknown>).reasoningContent),
      ['第一轮推理', '第二轮推理', undefined],
    )
    // 每轮的历史条数与各自请求里的历史消息条数一致。
    assert.deepEqual(
      samplingSteps.map(step => readContextPlan(step).historyIncludedCount),
      harness.llmCalls.map(call => countHistoryMessages(call.messages)),
    )
    assert.deepEqual(harness.llmCalls.map(call => countHistoryMessages(call.messages)), [2, 2, 2])
    // 每轮每个 tool result 实际送入的字符数，按 exchange、call 顺序。
    assert.deepEqual(
      samplingSteps.map(step => readContextPlan(step).observationPreviewChars),
      harness.llmCalls.map(call => call.messages.flatMap(item =>
        item.type === 'tool_result' ? [[...item.content].length] : [])),
    )
    assert.deepEqual(
      samplingSteps.map(step => readContextPlan(step).observationPreviewChars),
      [[], [25, 14], [25, 14, 18]],
    )

    // AC-06 跨层：新字段经 Admin projector 原样投影。
    const detail = projectHarnessRunDetail(harness, 'COMPLETED')
    const toolItems = detail.timeline.flatMap(item =>
      item.kind === 'known' && item.type === 'tool_execution' ? [item] : [])
    const samplingItems = detail.timeline.flatMap(item =>
      item.kind === 'known' && item.type === 'model_sampling' ? [item] : [])

    assert.deepEqual(
      toolItems.map(item => [item.arguments, item.observation]),
      toolSteps.map(step => [
        (step.input as Record<string, unknown>).arguments,
        (step.output as Record<string, unknown>).observation,
      ]),
    )
    assert.deepEqual(
      samplingItems.map(item => [item.intermediateText, item.reasoningContent]),
      [['先查两处。', '第一轮推理'], [null, '第二轮推理'], [null, null]],
    )
    assert.deepEqual(
      samplingItems.map(item => [
        item.contextInspector.historyIncludedCount,
        item.contextInspector.historyCandidateCount,
      ]),
      [[2, 2], [2, 2], [2, 2]],
    )
    assertNoUnfinishedSteps(harness)
  })

  it('AC-02 首轮超预算裁剪历史：historyIncludedCount 小于候选条数，且与首轮请求里的历史条数一致', async () => {
    const harness = createHarness(
      () => toModelStream([
        { type: 'text_delta', delta: '完成。' },
        { type: 'response_completed', finishReason: 'stop' },
      ]),
      undefined,
      undefined,
      {},
      new BaseCostTokenEstimator(250_000),
    )

    // 预算 262_144 − 基础 250_000 只容得下 2 条 5_000 字历史 + 当前消息 + 工具。
    for (const index of [1, 2, 3]) {
      harness.prisma.seedMessage({
        id: `history-${index}`,
        content: String(index).padEnd(5_000, '旧'),
        status: MessageStatus.COMPLETED,
        createdAt: new Date(`2026-01-01T00:00:0${index}.000Z`),
      })
    }

    await collectEvents(harness.run())

    const plan = readContextPlan(findStep(harness, 'model_sampling'))

    assert.deepEqual(findStep(harness, 'load_conversation_history')?.output, { messageCount: 3 })
    assert.equal(plan.historyIncludedCount, 2)
    assert.equal(countHistoryMessages(harness.llmCalls[0]?.messages ?? []), 2)

    const sampling = projectHarnessRunDetail(harness, 'COMPLETED').timeline.find(
      item => item.kind === 'known' && item.type === 'model_sampling',
    )

    assert.deepEqual(
      sampling?.kind === 'known' && sampling.type === 'model_sampling'
        ? [sampling.contextInspector.historyIncludedCount, sampling.contextInspector.historyCandidateCount]
        : undefined,
      [2, 3],
    )
  })

  it('AC-02 后续轮压缩 observation：observationPreviewChars 记压缩后实际送入的长度，tool Step 仍是压缩前正文', async () => {
    const olderObservation = '旧'.repeat(8_000)
    const latestObservation = '新'.repeat(8_000)
    const streams: ModelStreamEvent[][] = [
      [
        toolCallEvent('call-old', 'search_articles', '{"query":"seo"}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ],
      [
        toolCallEvent('call-new', 'search_articles', '{"query":"sitemap"}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ],
      [
        { type: 'text_delta', delta: '完成。' },
        { type: 'response_completed', finishReason: 'stop' },
      ],
    ]
    const harness = createHarness(
      (_, __, callIndex) => toModelStream(streams[callIndex] ?? []),
      undefined,
      async envelope => ({
        ok: true,
        modelContent: envelope.callId === 'call-old' ? olderObservation : latestObservation,
      }),
      {},
      new BaseCostTokenEstimator(249_000),
    )

    await collectEvents(harness.run())

    const samplingSteps = harness.recorder.steps.filter(step => step.type === 'model_sampling')
    const thirdRoundLengths = (harness.llmCalls[2]?.messages ?? []).flatMap(item =>
      item.type === 'tool_result' ? [[...item.content].length] : [])

    assert.equal(harness.llmCalls.length, 3)
    // 第 2 轮放得下；第 3 轮较旧的 observation 被压缩，最新的保持原长。
    assert.deepEqual(readContextPlan(samplingSteps[1]).observationPreviewChars, [8_000])
    assert.deepEqual(readContextPlan(samplingSteps[2]).observationPreviewChars, thirdRoundLengths)
    assert.ok(thirdRoundLengths[0]! < 8_000, 'thirdRoundLengths[0]! < 8_000')
    assert.equal(thirdRoundLengths[1], 8_000)
    assert.deepEqual(
      harness.recorder.steps
        .filter(step => step.type === 'tool_execution')
        .map(step => (step.output as Record<string, unknown>).observation),
      [olderObservation, latestObservation],
    )
  })

  it('AC-02 参数因 length 截断整批不执行：tool Step 的 arguments 是回喂给模型的 {"arguments": raw} 形状', async () => {
    const streams: Array<() => AsyncGenerator<ModelStreamEvent>> = [
      () => adaptDeepSeekStream(toProviderStream([
        providerChunk({ reasoning_content: '需要查两篇。' } as ChatCompletionChunk.Choice.Delta),
        providerChunk({
          tool_calls: [
            { index: 0, id: 'call-empty', type: 'function', function: { name: 'search_articles' } },
            { index: 1, id: 'call-partial', type: 'function', function: { name: 'search_articles', arguments: '{"query":' } },
          ],
        } as ChatCompletionChunk.Choice.Delta),
        providerChunk({}, 'length'),
      ])),
      () => toModelStream([
        { type: 'text_delta', delta: '换个方式回答。' },
        { type: 'response_completed', finishReason: 'stop' },
      ]),
    ]
    const harness = createHarness((_, __, callIndex) => streams[callIndex]!())

    await collectEvents(harness.run())

    const toolSteps = harness.recorder.steps.filter(step => step.type === 'tool_execution')

    assert.equal(harness.toolInvocations.length, 0)
    assert.deepEqual(
      toolSteps.map(step => (step.input as Record<string, unknown>).arguments),
      ['{"arguments":""}', '{"arguments":"{\\"query\\":"}'],
    )
    assert.deepEqual(
      harness.llmCalls[1]?.messages.filter(item => item.type !== 'message'),
      toolExchangesFromSteps(harness, 2),
    )
    assert.equal(
      (findStep(harness, 'model_sampling')?.output as Record<string, unknown>).reasoningContent,
      '需要查两篇。',
    )
  })

  it('AC-03 DeepSeek 家族 Tool Call 轮：reasoningContent 与下一轮请求体回填的 reasoning_content 逐字相等', async () => {
    const provider = createFakeFetchProvider([
      () => sseResponse([
        sseData({ reasoning_content: '先想想要查' }),
        sseData({ reasoning_content: '什么关键词。' }),
        sseData({ tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'search_articles', arguments: '{"query":"seo"}' } }] }),
        sseData({}, 'tool_calls'),
        'data: [DONE]',
      ]),
      () => sseResponse([sseData({ content: '完成。' }), sseData({}, 'stop'), 'data: [DONE]']),
    ])
    const harness = createHarness(provider.createModelStream)

    await collectEvents(harness.run())

    const secondBody = readRequestBody(provider.fetchCalls[1])
    const assistantMessage = secondBody.messages.find(message => message.role === 'assistant')
    const toolMessage = secondBody.messages.find(message => message.role === 'tool')
    const samplingOutput = findStep(harness, 'model_sampling')?.output as Record<string, unknown>
    const toolStep = findStep(harness, 'tool_execution')

    assert.equal(assistantMessage?.reasoning_content, '先想想要查什么关键词。')
    assert.equal(samplingOutput.reasoningContent, assistantMessage?.reasoning_content)
    // wire 上的参数与 tool 消息正文也和落库的逐字相等。
    assert.equal(
      (toolStep?.input as Record<string, unknown>).arguments,
      assistantMessage?.tool_calls?.[0]?.function.arguments,
    )
    assert.equal((toolStep?.output as Record<string, unknown>).observation, toolMessage?.content)
    assertNoUnfinishedSteps(harness)
  })

  it('AC-03 非 DeepSeek 家族（上游不给 reasoning_content）：采样 Step 不写 reasoningContent，请求体也不回填', async () => {
    const provider = createFakeFetchProvider([
      () => sseResponse([
        sseData({ tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'search_articles', arguments: '{"query":"seo"}' } }] }),
        sseData({}, 'tool_calls'),
        'data: [DONE]',
      ]),
      () => sseResponse([sseData({ content: '完成。' }), sseData({}, 'stop'), 'data: [DONE]']),
    ])
    const harness = createHarness(provider.createModelStream)

    const events = await collectEvents(harness.service.runTurnStream({
      conversationId: 'conversation-1',
      userContent: '问题',
      model: createResolvedLlmModel({ compat: familyCompatOf('openai'), reasoningEffort: null }),
      instructions: [],
    }))

    const assistantMessage = readRequestBody(provider.fetchCalls[1]).messages.find(
      message => message.role === 'assistant',
    )
    const samplingOutput = findStep(harness, 'model_sampling')?.output as Record<string, unknown>

    assert.equal(events.at(-1)?.type, 'run_completed')
    assert.equal(Object.hasOwn(samplingOutput, 'reasoningContent'), false)
    assert.equal(Object.hasOwn(assistantMessage ?? {}, 'reasoning_content'), false)
    assertNoUnfinishedSteps(harness)
  })

  it('模型文本或工具结果含 U+0000 / 孤立代理项时，Step 落库副本与 Message.content 都换成 U+FFFD，Run 照常完成', async () => {
    const streams: ModelStreamEvent[][] = [
      [
        { type: 'text_delta', delta: '先查\u0000一下\uD83D。' },
        toolCallEvent('call-1', 'search_articles', '{"query":"a\u0000b"}', '推理\u0000内容'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ],
      [
        { type: 'text_delta', delta: '完成。' },
        { type: 'response_completed', finishReason: 'stop' },
      ],
    ]
    const harness = createHarness(
      (_, __, callIndex) => toModelStream(streams[callIndex] ?? []),
      undefined,
      async () => ({ ok: true, modelContent: '结果\u0000正文🚀\uDE80' }),
    )

    const events = await collectEvents(harness.run())
    const samplingOutput = findStep(harness, 'model_sampling')?.output as Record<string, unknown>
    const toolStep = findStep(harness, 'tool_execution')

    assert.equal(events.at(-1)?.type, 'run_completed')
    // 模型实际看到的仍是原文。
    assert.equal(
      harness.llmCalls[1]?.messages.find(item => item.type === 'tool_result')?.content,
      '结果\u0000正文🚀\uDE80',
    )
    assert.equal(samplingOutput.intermediateText, '先查\uFFFD一下\uFFFD。')
    assert.equal(samplingOutput.reasoningContent, '推理\uFFFD内容')
    assert.equal((toolStep?.input as Record<string, unknown>).arguments, '{"query":"a\uFFFDb"}')
    // 成对的代理项（🚀）原样保留，只有孤立的半个被替换。
    assert.equal((toolStep?.output as Record<string, unknown>).observation, '结果\uFFFD正文🚀\uFFFD')
    assert.doesNotMatch(JSON.stringify(harness.recorder.steps), /\\u0000/)
    // delta 拼接、done 与 Message.content 是同一个替换后的串（pg 驱动也会把 text 列里的孤立代理项换掉，这里先换保持一致）。
    const streamed = events
      .map(event => event.type === 'assistant_delta' ? event.contentDelta : '')
      .join('')

    assert.equal(streamed, '先查\uFFFD一下\uFFFD。\n\n完成。')
    assert.equal((events.at(-1) as { content?: string }).content, streamed)
    assert.equal(harness.assistantMessage()?.content, streamed)
    assertNoUnfinishedSteps(harness)
  })

  it('AC-05 用户在同轮第二个工具执行中停止：已收口的 tool Step 带参数与 observation，被中断的 Step 两者都不写', async () => {
    const abortController = new AbortController()
    const harness = createHarness(
      () => toModelStream([
        toolCallEvent('call-done', 'search_articles', '{"query":"seo"}', '推理', 0),
        toolCallEvent('call-cut', 'search_articles', '{"query":"sitemap"}', '推理', 1),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]),
      abortController.signal,
      async (envelope, context) => {
        if (envelope.callId === 'call-done')
          return { ok: true, modelContent: '已完成的结果。' }

        abortController.abort()
        context.signal.throwIfAborted()
        return { ok: true, modelContent: '不会落库的结果。' }
      },
    )

    const events = await collectEvents(harness.run())

    assert.equal(events.at(-1)?.type, 'run_aborted')
    assertInterruptedToolSteps(harness, AgentStepStatus.ABORTED)
  })

  it('AC-05 同轮第二个工具执行中 Run deadline 到期：已收口的 tool Step 带参数与 observation，被中断的 Step 两者都不写', async () => {
    const harness = createHarness(
      () => toModelStream([
        toolCallEvent('call-done', 'search_articles', '{"query":"seo"}', '推理', 0),
        toolCallEvent('call-cut', 'search_articles', '{"query":"sitemap"}', '推理', 1),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]),
      undefined,
      async (envelope, context) => {
        if (envelope.callId === 'call-done')
          return { ok: true, modelContent: '已完成的结果。' }

        await waitForAbort(context.signal)
        context.signal.throwIfAborted()
        return { ok: true, modelContent: '不会落库的结果。' }
      },
      { runDeadlineMs: 200 },
    )

    const events = await collectEvents(harness.run())

    assert.equal(events.at(-1)?.type, 'run_failed')
    assert.equal(harness.recorder.runErrorCode, 'deadline')
    assertInterruptedToolSteps(harness, AgentStepStatus.FAILED)
  })
})

describe('ModelContext', () => {
  it('保持 direct-final、一次 Tool 和两次顺序 Tool 的 items', () => {
    const context = ModelContext.fromHistory({
      instructions: [{ type: 'message', role: 'system', content: 'SYS' }],
      initialHistory: [],
      currentUserMessage: { type: 'message', role: 'user', content: 'USER' },
    })

    assert.deepEqual(flattenPlanningState(context.forPlanning()), [
      { type: 'message', role: 'system', content: 'SYS' },
      { type: 'message', role: 'user', content: 'USER' },
    ])

    context.appendToolExchange({
      calls: [{ callId: 'c1', toolName: 't1' }],
      intermediateText: 'I',
      reasoningContent: 'R',
      results: [{
        observation: {
          content: 'O',
          originalChars: 1,
          observationChars: 1,
          truncated: false,
        },
        ok: true,
        feedbackArgumentsJson: 'A',
      }],
    })

    assert.deepEqual(flattenPlanningState(context.forPlanning()).slice(-2), [
      {
        type: 'assistant_tool_call',
        calls: [{ callId: 'c1', name: 't1', rawArgumentsJson: 'A' }],
        reasoningContent: 'R',
        content: 'I',
      },
      {
        type: 'tool_result',
        callId: 'c1',
        name: 't1',
        content: 'O',
        ok: true,
      },
    ])
    assert.equal(flattenPlanningState(context.forPlanning()).length, 4)

    context.appendToolExchange({
      calls: [
        { callId: 'c2', toolName: 't2' },
        { callId: 'c3', toolName: 't3' },
      ],
      intermediateText: 'J',
      reasoningContent: 'S',
      results: [
        {
          observation: { content: 'P', originalChars: 1, observationChars: 1, truncated: false },
          ok: false,
          // 未校验的原始参数：续轮用官方回退形状承载，原文保留在值里。
          feedbackArgumentsJson: toFeedbackArgumentsJson('B', false),
        },
        {
          observation: { content: 'Q', originalChars: 1, observationChars: 1, truncated: false },
          ok: true,
          feedbackArgumentsJson: toFeedbackArgumentsJson('C', true),
        },
      ],
    })

    // 同轮两个 call：一条 assistant 消息带 calls[]，后接两条按 callId 配对的 tool_result。
    assert.deepEqual(flattenPlanningState(context.forPlanning()).slice(-3), [
      {
        type: 'assistant_tool_call',
        calls: [
          { callId: 'c2', name: 't2', rawArgumentsJson: '{"arguments":"B"}' },
          { callId: 'c3', name: 't3', rawArgumentsJson: 'C' },
        ],
        reasoningContent: 'S',
        content: 'J',
      },
      { type: 'tool_result', callId: 'c2', name: 't2', content: 'P', ok: false },
      { type: 'tool_result', callId: 'c3', name: 't3', content: 'Q', ok: true },
    ])
    assert.equal(flattenPlanningState(context.forPlanning()).length, 7)
    assert.throws(
      () => context.appendToolExchange({
        calls: [],
        intermediateText: '',
        reasoningContent: '',
        results: [],
      }),
      RangeError,
    )
  })
})

// Agent system prompt 的工具选择策略由
// `src/chat/prompts/agent.prompt.test.ts` 直接覆盖。

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
  maxObservationChars: 16_000,
}

const hiddenAdminDefinition: ToolDefinition = {
  ...searchArticlesDefinition,
  name: 'hidden_admin_tool',
  description: '不属于本 Run allowlist 的测试工具。',
}

const successfulToolResult: ToolResult = {
  ok: true,
  modelContent: '找到 1 篇相关文章。',
}

function createHarness(
  createModelStream: CreateModelStream,
  signal?: AbortSignal,
  invokeTool: InvokeTool = async () => successfulToolResult,
  policy: Partial<AgentRuntimePolicy> = {},
  tokenEstimator: TokenEstimator = new TestTokenEstimator(),
  registeredToolNames?: string[],
  // 生产中 runtime 与 planner 共用同一个 estimator 实例；只在需要把估算故障
  // 精确注入到 plan() 边界时才单独提供。
  plannerTokenEstimator: TokenEstimator = tokenEstimator,
) {
  const registeredDefinitions = [
    hiddenAdminDefinition,
    searchArticlesDefinition,
  ].filter(definition => (
    registeredToolNames === undefined
    || registeredToolNames.includes(definition.name)
  ))
  const prisma = new FakePrismaService()
  const recorder = new FakeAgentRunRecorderService(prisma)
  const llmCalls: Array<{
    provider: ResolvedLlmModel['provider']
    messages: ModelInputItem[]
    options: ChatStreamOptions | undefined
  }> = []
  const llmService = {
    chatStream: (
      provider: ResolvedLlmModel['provider'],
      messages: ModelInputItem[],
      options?: ChatStreamOptions,
    ) => {
      const callIndex = llmCalls.length

      llmCalls.push({
        provider,
        messages: structuredClone(messages),
        options,
      })

      return createModelStream(messages, options, callIndex)
    },
  } as unknown as LLMService
  const toolInvocationService = new FakeToolInvocationService(invokeTool)
  const runtimeService = new AgentRuntimeService(
    llmService,
    prisma as unknown as PrismaService,
    recorder as unknown as AgentRunRecorderService,
    toolInvocationService as unknown as ToolInvocationService,
    {
      value: {
        historyCandidateHardLimit: 1_000,
        maxSamplingRounds: 3,
        maxToolCalls: 2,
        runDeadlineMs: 600_000,
        ...policy,
      },
    } as AgentRuntimePolicyService,
    new FakeToolRegistryService(registeredDefinitions) as unknown as ToolRegistryService,
    tokenEstimator,
    new SamplingContextPlanner(plannerTokenEstimator),
  )
  // 模型行快照由 ChatService 在 Run 之前解析；这里给用例一个默认快照，省得每处都写。
  const runTurnStream = runtimeService.runTurnStream.bind(runtimeService)
  const service = Object.assign(runtimeService, {
    runTurnStream: (input: TestRunTurnStreamInput) =>
      runTurnStream({ model: createResolvedLlmModel(), ...input }),
  })

  return {
    llmCalls,
    prisma,
    recorder,
    service,
    toolInvocations: toolInvocationService.invocations,
    toolExecutionContexts: toolInvocationService.contexts,
    assistantMessage: () => prisma.messages.find(
      message => message.role === MessageRole.ASSISTANT,
    ),
    run: () => service.runTurnStream({
      conversationId: 'conversation-1',
      userContent: '问题',
      reasoningEffort: 'high',
      ...(signal ? { signal } : {}),
      instructions: [],
    }),
  }
}

class FakeToolRegistryService {
  constructor(private readonly definitions: ToolDefinition[]) {}

  get(name: string): { definition: ToolDefinition } | undefined {
    const definition = this.definitions.find(
      candidate => candidate.name === name,
    )

    return definition ? { definition } : undefined
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
  readonly findManyArguments: FakeMessageFindManyArguments[] = []
  conversationExists = true
  deadlineTransactionError: unknown
  nextMessageCreatedAt: Date | undefined

  readonly conversation = {
    findUnique: async () => this.conversationExists
      ? { id: 'conversation-1' }
      : null,
    update: async () => ({ id: 'conversation-1' }),
  }

  readonly message = {
    create: async ({ data }: {
      data: Pick<Message, 'conversationId' | 'role' | 'content'> & Partial<Pick<Message, 'status'>>
    }): Promise<Message> => {
      const now = this.nextMessageCreatedAt ?? new Date()
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
    findMany: async (
      arguments_: FakeMessageFindManyArguments,
    ): Promise<Message[]> => {
      this.findManyArguments.push(structuredClone(arguments_))

      return this.messages
        .filter(message =>
          message.conversationId === arguments_.where.conversationId
          && message.status === arguments_.where.status
          && isStrictlyBefore(message, arguments_.where.OR))
        .sort((left, right) =>
          right.createdAt.getTime() - left.createdAt.getTime()
          || right.id.localeCompare(left.id))
        .slice(0, arguments_.take)
    },
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

  async withDeadlineTransaction<T>(
    deadline: DatabaseOperationDeadline,
    callback: (transaction: DeadlineTransaction) => Promise<T>,
  ): Promise<T> {
    if (this.deadlineTransactionError !== undefined) {
      const error = this.deadlineTransactionError

      this.deadlineTransactionError = undefined
      throw error
    }

    const assertAvailable = (): void => {
      deadline.signal?.throwIfAborted()
      if (Date.now() >= deadline.deadlineAt)
        throw deadline.createTimeoutError()
    }
    const transaction: DeadlineTransaction = {
      execute: async (operation) => {
        assertAvailable()
        const result = await operation(this as never)
        assertAvailable()
        return result
      },
    }

    assertAvailable()
    const result = await callback(transaction)
    assertAvailable()
    return result
  }

  seedMessage(input: {
    id: string
    content: string
    role?: Message['role']
    status: Message['status']
    createdAt: Date
  }): void {
    this.messages.push({
      id: input.id,
      conversationId: 'conversation-1',
      role: input.role ?? MessageRole.USER,
      content: input.content,
      status: input.status,
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
    })
  }
}

type FakeStrictlyBeforeOr = [
  { createdAt: { lt: Date } },
  { createdAt: Date, id: { lt: string } },
]

interface FakeMessageFindManyArguments {
  where: {
    conversationId: string
    status: Message['status']
    OR: FakeStrictlyBeforeOr
  }
  orderBy: Array<{ createdAt: 'desc' } | { id: 'desc' }>
  take: number
}

function isStrictlyBefore(
  message: Message,
  [byCreatedAt, sameCreatedAt]: FakeStrictlyBeforeOr,
): boolean {
  const boundDate = byCreatedAt.createdAt.lt

  return message.createdAt < boundDate
    || (message.createdAt.getTime() === boundDate.getTime()
      && message.id < sameCreatedAt.id.lt)
}

class TestTokenEstimator implements TokenEstimator {
  estimateRequest(input: TokenEstimatorInput): number {
    return input.items.reduce(
      (tokens, item) => tokens + countModelInputCharacters(item) + 1,
      input.tools.length,
    )
  }
}

class OverflowTokenEstimator implements TokenEstimator {
  estimateRequest(_input: TokenEstimatorInput): number {
    return 300_000
  }
}

class AlwaysFailingTokenEstimator implements TokenEstimator {
  estimateRequest(_input: TokenEstimatorInput): number {
    throw new ContextTokenEstimationError(
      new Error('initial-estimator-secret'),
    )
  }
}

class BaseCostTokenEstimator implements TokenEstimator {
  readonly inputs: TokenEstimatorInput[] = []

  constructor(private readonly baseTokens: number) {}

  estimateRequest(input: TokenEstimatorInput): number {
    this.inputs.push(structuredClone(input))

    return input.items.reduce(
      (tokens, item) => tokens + countModelInputCharacters(item) + 1,
      this.baseTokens + input.tools.length,
    )
  }
}

class FollowUpOverflowTokenEstimator implements TokenEstimator {
  estimateRequest(input: TokenEstimatorInput): number {
    return input.items.some(item => item.type === 'tool_result') ? 300_000 : 1
  }
}

class FollowUpFailingTokenEstimator implements TokenEstimator {
  estimateRequest(input: TokenEstimatorInput): number {
    if (input.items.some(item => item.type === 'tool_result')) {
      throw new ContextTokenEstimationError(new Error('estimator-secret'))
    }

    return 1
  }
}

function countModelInputCharacters(item: ModelInputItem): number {
  switch (item.type) {
    case 'message':
    case 'tool_result':
      return [...item.content].length
    case 'assistant_tool_call':
      return [
        ...item.calls.flatMap(call => [call.callId, call.name, call.rawArgumentsJson]),
        item.reasoningContent,
        item.content ?? '',
      ].reduce((total, value) => total + [...value].length, 0)
  }
}

class FakeAgentRunRecorderService {
  readonly completedRunIds: string[] = []
  readonly failedRunIds: string[] = []
  readonly abortedRunIds: string[] = []
  /** failRun / abortRun 与终态同事务写入的 Run 失败类别；成功时保持 null。 */
  runErrorCode: AgentRunErrorCode | null = null
  readonly steps: RecordedAgentStep[] = []
  readonly completionOwnership = createDeferred()
  completeRunCommitError: Error | undefined
  completeRunCommitGate: Promise<void> | undefined
  failRunDelayMs = 0

  constructor(private readonly prisma: FakePrismaService) {}

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
      errorCode: null,
      startedAt: now,
      endedAt: null,
      createdAt: now,
      updatedAt: now,
    }
  }

  async createAssistantMessage(
    _runId: string,
    conversationId: string,
    deadline: DatabaseOperationDeadline,
  ): Promise<Message> {
    this.assertDeadline(deadline)
    return await this.prisma.message.create({
      data: {
        conversationId,
        role: MessageRole.ASSISTANT,
        content: '',
        status: MessageStatus.STREAMING,
      },
    })
  }

  async startStep(input: {
    runId: string
    type: string
    input?: unknown
  }, deadline: DatabaseOperationDeadline): Promise<RecordedAgentStep> {
    this.assertDeadline(deadline)
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

  async completeStep(
    stepId: string,
    _deadline: DatabaseOperationDeadline,
    input: { input?: unknown, output?: unknown } = {},
  ): Promise<void> {
    this.assertDeadline(_deadline)
    this.transitionStep(stepId, AgentStepStatus.COMPLETED, input)
  }

  async failStep(
    stepId: string,
    _deadline: DatabaseOperationDeadline,
    input: { errorMessage: string, input?: unknown, output?: unknown },
  ): Promise<void> {
    this.assertDeadline(_deadline)
    this.transitionStep(stepId, AgentStepStatus.FAILED, input)
  }

  async completeRun(
    input: {
      runId: string
      assistantMessageId: string
      assistantOutputStepId: string
      content: string
      output?: unknown
    },
    _deadline: DatabaseOperationDeadline,
    onCommitOwned: () => void = () => {},
  ): Promise<Message> {
    this.assertDeadline(_deadline)
    const message = this.prisma.messages.find(
      candidate => candidate.id === input.assistantMessageId,
    )

    assert.ok(message, 'message')
    if (
      message.status !== MessageStatus.PENDING
      && message.status !== MessageStatus.STREAMING
    ) {
      throw new Error(`Message ${message.id} 已进入终态`)
    }

    onCommitOwned()
    this.completionOwnership.resolve()
    if (this.completeRunCommitGate)
      await this.completeRunCommitGate

    if (this.completeRunCommitError)
      throw this.completeRunCommitError

    this.transitionStep(
      input.assistantOutputStepId,
      AgentStepStatus.COMPLETED,
      { output: input.output },
    )
    assert.equal(
      this.steps.some(step => step.runId === input.runId && isUnfinishedStep(step)),
      false,
    )
    message.content = input.content
    message.status = MessageStatus.COMPLETED
    message.updatedAt = new Date()
    this.completedRunIds.push(input.runId)
    return message
  }

  async failRun(
    runId: string,
    errorMessage: string,
    errorCode: AgentRunErrorCode,
    _deadline: DatabaseOperationDeadline,
    assistantMessage?: { id: string, content: string },
    failedStep?: { id: string, errorMessage: string, output?: unknown },
  ): Promise<void> {
    if (this.failRunDelayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.failRunDelayMs))
    }
    this.runErrorCode = errorCode
    this.closeMessage(assistantMessage, MessageStatus.FAILED)
    if (failedStep) {
      this.transitionStep(failedStep.id, AgentStepStatus.FAILED, failedStep)
    }
    this.closeUnfinishedSteps(runId, AgentStepStatus.FAILED, errorMessage)
    this.failedRunIds.push(runId)
  }

  async abortRun(
    runId: string,
    _deadline: DatabaseOperationDeadline,
    assistantMessage?: { id: string, content: string },
    abortedStep?: { id: string, errorMessage: string, output?: unknown },
  ): Promise<void> {
    this.runErrorCode = 'aborted'
    this.closeMessage(assistantMessage, MessageStatus.ABORTED)
    if (abortedStep) {
      this.transitionStep(
        abortedStep.id,
        AgentStepStatus.ABORTED,
        abortedStep,
      )
    }
    this.closeUnfinishedSteps(runId, AgentStepStatus.ABORTED)
    this.abortedRunIds.push(runId)
  }

  private closeMessage(
    input: { id: string, content: string } | undefined,
    status: typeof MessageStatus.FAILED | typeof MessageStatus.ABORTED,
  ): void {
    if (!input)
      return

    const message = this.prisma.messages.find(candidate => candidate.id === input.id)

    if (!message)
      throw new Error(`Message ${input.id} 不存在`)
    if (
      message.status !== MessageStatus.PENDING
      && message.status !== MessageStatus.STREAMING
    ) {
      throw new Error(`Message ${input.id} 已进入终态`)
    }
    message.content = input.content
    message.status = status
    message.updatedAt = new Date()
  }

  private transitionStep(
    stepId: string,
    status: RecordedAgentStep['status'],
    input: { errorMessage?: string, input?: unknown, output?: unknown },
  ): void {
    const step = this.steps.find(candidate => candidate.id === stepId)

    assert.ok(step, 'step')
    assert.equal(step.status, AgentStepStatus.RUNNING)
    // 与真实 Recorder 一致：收口时提供 input 就整体替换，否则保留开始时的 input。
    if (input.input !== undefined)
      step.input = input.input
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

  private assertDeadline(deadline: DatabaseOperationDeadline): void {
    deadline.signal?.throwIfAborted()
    if (Date.now() >= deadline.deadlineAt)
      throw deadline.createTimeoutError()
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

/** 跨层：把 runtime 真实写出的 Step 记录原样交给 Admin projector，不手写 fixture。 */
function projectHarnessRunDetail(
  harness: ReturnType<typeof createHarness>,
  status: 'COMPLETED' | 'FAILED',
) {
  const assistantMessage = harness.assistantMessage()
  const now = new Date()

  assert.ok(assistantMessage, 'assistantMessage')

  return projectAdminRunDetail({
    id: 'run-1',
    conversationId: 'conversation-1',
    assistantMessageId: assistantMessage.id,
    status,
    errorCode: harness.recorder.runErrorCode,
    startedAt: now,
    endedAt: now,
    createdAt: now,
    updatedAt: now,
    userMessage: {
      id: 'message-user',
      role: 'USER',
      status: 'COMPLETED',
      content: '问题',
      createdAt: now,
      updatedAt: now,
    },
    assistantMessage: {
      id: assistantMessage.id,
      role: 'ASSISTANT',
      status: assistantMessage.status,
      content: assistantMessage.content,
      createdAt: assistantMessage.createdAt,
      updatedAt: assistantMessage.updatedAt,
    },
    // 内存 recorder 只保证写入的是 InputJsonValue；投影按持久化后的 JsonValue 读。
    steps: harness.recorder.steps.map(step => ({
      ...step,
      title: step.type,
      input: step.input as Prisma.JsonValue,
      output: step.output as Prisma.JsonValue,
    })),
  }, null)
}

/**
 * 只用落库的 Step 事实拼出第 samplingIndex 轮请求里的 Tool Exchange 部分（按轮次的
 * assistant_tool_call + 逐个 tool_result），与 `llmCalls[samplingIndex - 1].messages` 逐字比对。
 * observation 取 tool Step 落库的正文，只适用于没被 context budget 压缩的轮次。
 */
function toolExchangesFromSteps(
  harness: ReturnType<typeof createHarness>,
  samplingIndex: number,
): ModelInputItem[] {
  const { steps } = harness.recorder

  return steps
    .filter(step => step.type === 'model_sampling'
      && (step.input as { samplingIndex: number }).samplingIndex < samplingIndex)
    .flatMap((samplingStep): ModelInputItem[] => {
      const { samplingAttemptId } = samplingStep.input as { samplingAttemptId: string }
      const output = samplingStep.output as Record<string, unknown>
      const toolSteps = steps
        .filter(step => step.type === 'tool_execution'
          && (step.input as { samplingAttemptId: string }).samplingAttemptId === samplingAttemptId)
        .map(step => ({
          input: step.input as { callId: string, toolName: string, arguments: string },
          output: step.output as { ok: boolean, observation: string },
        }))

      if (toolSteps.length === 0)
        return []

      return [
        {
          type: 'assistant_tool_call',
          calls: toolSteps.map(({ input }) => ({
            callId: input.callId,
            name: input.toolName,
            rawArgumentsJson: input.arguments,
          })),
          reasoningContent: (output.reasoningContent as string | undefined) ?? '',
          ...(typeof output.intermediateText === 'string'
            ? { content: output.intermediateText }
            : {}),
        },
        ...toolSteps.map(({ input, output: toolOutput }): ModelInputItem => ({
          type: 'tool_result',
          callId: input.callId,
          name: input.toolName,
          content: toolOutput.observation,
          ok: toolOutput.ok,
        })),
      ]
    })
}

function readContextPlan(step: RecordedAgentStep | undefined): {
  historyIncludedCount?: number
  observationPreviewChars?: number[]
} {
  return (step?.output as { contextPlan: Record<string, never> }).contextPlan
}

/** 请求里的历史条数：instructions 为空时，全部 message 减去当前用户消息。 */
function countHistoryMessages(messages: ModelInputItem[]): number {
  return messages.filter(item => item.type === 'message').length - 1
}

/** fake fetch 收到的请求体里的 messages（OpenAI Chat Completions wire 形状）。 */
function readRequestBody(init: RequestInit | undefined): {
  messages: Array<{
    role: string
    content?: string
    reasoning_content?: string
    tool_calls?: Array<{ function: { arguments: string } }>
  }>
} {
  assert.ok(typeof init?.body === 'string', 'typeof init?.body === \'string\'')
  return JSON.parse(init.body)
}

/** AC-05：同轮第一个工具已收口、第二个执行中被停止 / deadline 打断。 */
function assertInterruptedToolSteps(
  harness: ReturnType<typeof createHarness>,
  interruptedStatus: RecordedAgentStep['status'],
): void {
  const [done, cut] = harness.recorder.steps.filter(step => step.type === 'tool_execution')

  assert.equal(harness.llmCalls.length, 1)
  assert.equal(done?.status, AgentStepStatus.COMPLETED)
  assert.equal((done?.input as Record<string, unknown>).arguments, '{"query":"seo"}')
  assert.equal((done?.output as Record<string, unknown>).observation, '已完成的结果。')
  assert.equal(cut?.status, interruptedStatus)
  // 未收口的 Step 只保留开始时的 input，没有参数，也没有 observation。
  assert.deepEqual(cut?.input, {
    callId: 'call-cut',
    toolName: 'search_articles',
    samplingAttemptId: 'run-1:sampling-1',
  })
  assert.equal(cut?.output, null)
  assert.doesNotMatch(JSON.stringify(harness.recorder.steps), /不会落库的结果/)
  assertNoUnfinishedSteps(harness)
}

function assertNoUnfinishedSteps(harness: ReturnType<typeof createHarness>): void {
  assert.equal(harness.recorder.steps.some(isUnfinishedStep), false)
}

function isUnfinishedStep(step: RecordedAgentStep): boolean {
  return step.status === AgentStepStatus.PENDING
    || step.status === AgentStepStatus.RUNNING
}

/**
 * 去掉 sampling output 里随环境变化的字段：contextPlan 由各用例单独断言；
 * firstTokenMs 依赖真实时钟，这里只确认它是非负整数或 null（取值由 AC-04 用例单独断言）。
 */
function withoutVolatileSamplingFields(value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return value

  const { contextPlan: _, firstTokenMs, ...rest } = value as Record<string, unknown>

  assert.ok(
    firstTokenMs === null || (Number.isSafeInteger(firstTokenMs) && (firstTokenMs as number) >= 0),
    `firstTokenMs 应为非负整数或 null，实际 ${String(firstTokenMs)}`,
  )
  return rest
}

async function* toModelStream(
  events: ModelStreamEvent[],
): AsyncGenerator<ModelStreamEvent> {
  yield* events
}

type TestRunTurnStreamInput = Omit<RunTurnStreamInput, 'model'> & { model?: ResolvedLlmModel }

function capturedTextThenToolCallModelStream(
  options: ChatStreamOptions | undefined,
  content: string,
): AsyncGenerator<ModelStreamEvent> {
  options?.debugCapture?.onRequest({ model: 'deepseek-v4-flash' })

  return adaptDeepSeekStream(teeRawResponseCapture(
    toProviderStream([
      providerChunk({ content }),
      providerChunk({
        reasoning_content: 'REASONING_NOT_IN_DEBUG_CAPTURE',
        tool_calls: [{
          index: 0,
          id: 'call-1',
          type: 'function',
          function: {
            name: 'search_articles',
            arguments: '{"query":"seo"}',
          },
        }],
      } as ChatCompletionChunk.Choice.Delta),
      providerChunk({}, 'tool_calls'),
    ]),
    capture => options?.debugCapture?.onResponse(capture),
  ))
}

function capturedTextModelStream(
  options: ChatStreamOptions | undefined,
): AsyncGenerator<ModelStreamEvent> {
  options?.debugCapture?.onRequest({ model: 'deepseek-v4-flash' })

  return adaptDeepSeekStream(teeRawResponseCapture(
    toProviderStream([
      providerChunk({ content: '部' }),
      providerChunk({ content: '分' }),
      providerChunk({}, 'stop'),
    ]),
    capture => options?.debugCapture?.onResponse(capture),
  ))
}

function providerChunk(
  delta: ChatCompletionChunk.Choice.Delta,
  finishReason: ChatCompletionChunk.Choice['finish_reason'] = null,
): ChatCompletionChunk {
  return {
    id: 'chunk-1',
    object: 'chat.completion.chunk',
    created: 1_756_000_000,
    model: 'deepseek-v4-flash',
    choices: [{
      index: 0,
      delta,
      finish_reason: finishReason,
      logprobs: null,
    }],
  }
}

async function* toProviderStream(
  chunks: ChatCompletionChunk[],
): AsyncGenerator<ChatCompletionChunk> {
  yield* chunks
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
  yield {
    type: 'usage',
    usage: {
      inputTokens: 7,
      outputTokens: 3,
      totalTokens: 10,
      reasoningTokens: 2,
      promptCacheHitTokens: 5,
      promptCacheMissTokens: 2,
    },
  }
  throw new Error('provider unavailable')
}

async function* abortingModelStream(
  abortController: AbortController,
  options: ChatStreamOptions | undefined,
): AsyncGenerator<ModelStreamEvent> {
  options?.debugCapture?.onRequest({ model: 'deepseek-v4-flash' })

  try {
    yield { type: 'text_delta', delta: '部分' }
    yield {
      type: 'usage',
      usage: {
        inputTokens: 7,
        outputTokens: 3,
        totalTokens: 10,
        reasoningTokens: 2,
        promptCacheHitTokens: 5,
        promptCacheMissTokens: 2,
      },
    }
    abortController.abort()
    throw new Error('aborted')
  }
  finally {
    options?.debugCapture?.onResponse({
      state: 'partial',
      lastEvent: 'text_delta',
      textChars: 2,
      toolCallCount: 0,
      rawResponse: { choices: [{ message: { content: '部分' } }] },
    })
  }
}

async function* abortingBeforeYieldModelStream(
  abortController: AbortController,
  options: ChatStreamOptions | undefined,
): AsyncGenerator<ModelStreamEvent> {
  options?.debugCapture?.onRequest({ model: 'deepseek-v4-flash' })

  try {
    abortController.abort()
    yield { type: 'text_delta', delta: '已缓冲' }
  }
  finally {
    options?.debugCapture?.onResponse({
      state: 'partial',
      lastEvent: 'text_delta',
      textChars: 3,
      toolCallCount: 0,
      rawResponse: { choices: [{ message: { content: '已缓冲' } }] },
    })
  }
}

async function* abortingAfterCompletionModelStream(
  abortController: AbortController,
  options: ChatStreamOptions | undefined,
): AsyncGenerator<ModelStreamEvent> {
  options?.debugCapture?.onRequest({ model: 'deepseek-v4-flash' })

  try {
    yield { type: 'text_delta', delta: '完整' }
    yield {
      type: 'usage',
      usage: {
        inputTokens: 7,
        outputTokens: 3,
        totalTokens: 10,
        reasoningTokens: 2,
        promptCacheHitTokens: 5,
        promptCacheMissTokens: 2,
      },
    }
    yield { type: 'response_completed', finishReason: 'stop' }
    abortController.abort()
  }
  finally {
    options?.debugCapture?.onResponse({
      state: 'complete',
      lastEvent: 'finish_reason',
      textChars: 2,
      toolCallCount: 0,
      rawResponse: { choices: [{ message: { content: '完整' } }] },
    })
  }
}

async function* abortingWithoutDeltaModelStream(
  abortController: AbortController,
  signal: AbortSignal | undefined,
): AsyncGenerator<ModelStreamEvent> {
  abortController.abort()
  signal?.throwIfAborted()
}

async function* waitForAbortModelStream(
  signal: AbortSignal | undefined,
  afterAbort?: () => void,
  options?: ChatStreamOptions,
): AsyncGenerator<ModelStreamEvent> {
  assert.ok(signal, 'signal')
  options?.debugCapture?.onRequest({ model: 'deepseek-v4-flash' })

  try {
    await waitForAbort(signal)
    afterAbort?.()
    signal.throwIfAborted()
  }
  finally {
    options?.debugCapture?.onResponse({
      state: 'empty',
      lastEvent: null,
      textChars: 0,
      toolCallCount: 0,
    })
  }
}

async function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted)
    return

  await new Promise<void>(resolve =>
    signal.addEventListener('abort', () => resolve(), { once: true }))
}

function toolCallEvent(
  callId: string,
  name: string,
  argumentsJson: string,
  reasoningContent = `reasoning for ${callId}`,
  index = 0,
): ModelStreamEvent {
  return {
    type: 'tool_call_completed',
    reasoningContent,
    toolCall: {
      providerCallId: callId,
      name,
      argumentsJson,
      index,
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

/** 用例全部按 DeepSeek 家族走真实 adapter：严格 index、带 Tool Call 的 stop 报错。 */
function adaptDeepSeekStream(
  chunks: Parameters<typeof adaptOpenAICompatibleStream>[0],
): AsyncGenerator<ModelStreamEvent> {
  return adaptOpenAICompatibleStream(chunks, {})
}

type FakeFetchAttempt = (init: RequestInit) => Response

/**
 * 真实 `OpenAICompatibleClient`（SDK 重试与退避、错误转换、adapter、raw capture）+ 按次序消费的
 * fake fetch：除了网络本身，模型调用链路与生产完全一致。
 */
function createFakeFetchProvider(attempts: FakeFetchAttempt[]) {
  const fetchCalls: RequestInit[] = []
  const client = new OpenAICompatibleClient({
    apiKey: FAKE_PROVIDER_API_KEY,
    baseUrl: 'https://relay.invalid/v1',
    captureModelIO: true,
  })
  // 沿用生产 client 的 maxRetries，只替换 fetch。
  // eslint-disable-next-line dot-notation
  const providerClient = client['createClient']().withOptions({
    fetch: async (_input: string | URL | Request, init?: RequestInit) => {
      fetchCalls.push(init ?? {})
      const attempt = attempts[fetchCalls.length - 1]

      assert.ok(attempt, `fake fetch 第 ${fetchCalls.length} 次调用没有预设响应`)

      return attempt(init ?? {})
    },
  })

  Object.defineProperty(client, 'createClient', {
    configurable: true,
    value: () => providerClient,
  })

  const createModelStream: CreateModelStream = (messages, options) => {
    assert.ok(options, 'options')
    return client.chatStream(messages, options)
  }

  return { fetchCalls, createModelStream }
}

function captureRuntimeWarnings(
  harness: ReturnType<typeof createHarness>,
): Array<Record<string, unknown>> {
  const warnings: Array<Record<string, unknown>> = []

  Object.defineProperty(harness.service, 'logger', {
    value: {
      error: () => {},
      warn: (warning: Record<string, unknown>) => warnings.push(warning),
    },
  })

  return warnings
}

/** 上游错误响应；body 回显密钥，模拟服务商把 key 写进报错的情况。retry-after-ms 让 SDK 退避只等 1ms。 */
function providerErrorResponse(status: number): Response {
  return new Response(
    JSON.stringify({ error: { message: `Incorrect API key provided: ${FAKE_PROVIDER_API_KEY}` } }),
    {
      status,
      headers: {
        'Content-Type': 'application/json',
        'retry-after-ms': '1',
      },
    },
  )
}

function sseData(delta: Record<string, unknown>, finishReason?: string): string {
  return `data: ${JSON.stringify({
    id: 'response-1',
    object: 'chat.completion.chunk',
    created: 0,
    model: 'deepseek-v4-flash',
    choices: [{ index: 0, delta, finish_reason: finishReason ?? null }],
  })}`
}

function sseResponse(lines: string[]): Response {
  return new Response(
    lines.map(line => `${line}\n\n`).join(''),
    { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
  )
}

function sseStreamResponse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

/** 先推一段正文，随后连接被对端重置（undici 表现为 `TypeError: terminated`）。 */
function connectionResetSseResponse(): Response {
  return sseStreamResponse(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`${sseData({ content: '部分' })}\n\n`))
      controller.error(Object.assign(new TypeError('terminated'), {
        cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }),
      }))
    },
  }))
}

/** 推出第一段后一直挂起；与真实 fetch 一致，请求 signal abort 后响应体以 AbortError 出错。 */
function hangingSseResponse(init: RequestInit, firstLine: string): Response {
  return sseStreamResponse(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(`${firstLine}\n\n`))
      init.signal?.addEventListener('abort', () => {
        controller.error(new DOMException('This operation was aborted', 'AbortError'))
      }, { once: true })
    },
  }))
}

/** 每段按给定延迟推出，用来制造可测的首 token 时间。 */
function delayedSseResponse(parts: Array<{ delayMs: number, data: string }>): Response {
  let index = 0

  return sseStreamResponse(new ReadableStream<Uint8Array>({
    async pull(controller) {
      const part = parts[index++]

      if (!part) {
        controller.close()
        return
      }

      await sleep(part.delayMs)
      controller.enqueue(new TextEncoder().encode(`${part.data}\n\n`))
    },
  }))
}
