import type { AgentRuntimeEvent, HistoryRunRow, HistoryStepRow, ToolDisplay, UnvalidatedToolCallEnvelope } from '@agent/agent'
import type {
  ChatStreamOptions,
  MessageInputItem,
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
import type { RunLimits, RuntimeConfigSnapshot } from '../runtime-config/runtime-config.service.js'
import type { ToolExecutionContext, ToolInvocationContext, ToolInvocationResult, ToolResult } from '../tools/core/tool.types.js'
import type { WorkspaceService } from '../workspaces/workspace.service.js'
import type { RunTurnStreamInput } from './agent-runtime.types.js'
import type { AgentRunRecorderService } from './lifecycle/agent-run-recorder.service.js'
import assert from 'node:assert/strict'
import { setTimeout as sleep } from 'node:timers/promises'
import { AgentRunTerminalizationError, estimateRequestTokens, historySummaryMessage, normalizeToolObservation, roughTokens, SUMMARIZATION_SYSTEM_PROMPT, turnSummaryMessage } from '@agent/agent'

import {
  adaptOpenAICompatibleStream,
  LLMApiError,
  LLMAuthError,
  LLMBalanceError,
  LLMContextOverflowError,
  LLMNetworkError,
  LLMRateLimitError,
  LLMServerError,
  OpenAICompatibleClient,
  teeRawResponseCapture,
} from '@agent/ai'
import { familyCompatOf } from '@agent/contracts'
import { describe, it, onTestFinished, vi } from 'vitest'
import { projectAdminRunDetail } from '../admin-runs/projection/admin-run.projector.js'
import { AttachmentsService } from '../attachments/attachments.service.js'
import { toChatStreamEvent } from '../chat/chat-stream-event.mapper.js'
import { WORKSPACE_DEVELOPMENT_INSTRUCTION, WORKSPACE_TOOL_NAMES } from '../chat/prompts/workspace-development.prompt.js'
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
import { createRuntimeConfigSnapshot } from '../runtime-config/__fixtures__.js'
import { ToolInvocationService } from '../tools/core/tool-invocation.service.js'
import { ToolRegistryService } from '../tools/core/tool-registry.service.js'
import { TOOL_DEFINITIONS } from '../tools/tool-definitions.js'
import { AgentRuntimeService } from './agent-runtime.service.js'
import { ContextCompactionService } from './context/context-compaction.service.js'

// 模型每轮看到的就是工具清单、与清单同序；不写死名字，清单加工具时 runtime 用例不用跟着改。
// 清单里少了 web_search 时，大量以它为工具的用例会因 unknown_tool 失败，不靠这里兜。
const MODEL_TOOL_NAMES = TOOL_DEFINITIONS.map(definition => definition.name)

describe('AgentRuntimeService model stream', () => {
  it('提交后读图失败仍保留用户消息与 Run，先确认 start 再按已持久化失败收口', async () => {
    const spy = vi.spyOn(AttachmentsService.prototype, 'modelInput').mockRejectedValue(new Error('storage read timeout'))
    onTestFinished(() => spy.mockRestore())
    const harness = createHarness(() => {
      throw new Error('不应调用模型')
    })
    const events = await collectEvents(harness.run())
    assert.equal(events[0]?.type, 'run_started')
    const failure = events.find(event => event.type === 'run_failed')
    assert.equal(failure?.userMessagePersisted, true)
    assert.deepEqual(harness.recorder.failedRunIds, ['run-1'])
    assert.equal(harness.prisma.messages.filter(message => message.role === MessageRole.USER).length, 1)
    assert.equal(harness.assistantMessage()?.status, MessageStatus.FAILED)
    assert.equal(harness.llmCalls.length, 0)
  })

  it('读附件尚未返回时停止立即收口，迟到读取不能恢复运行或调用模型', async () => {
    const gate = createDeferred()
    const controller = new AbortController()
    const spy = vi.spyOn(AttachmentsService.prototype, 'modelInput').mockImplementation(async () => {
      await gate.promise
      return { modelContent: 'late image input' }
    })
    onTestFinished(() => spy.mockRestore())
    const harness = createHarness(() => {
      throw new Error('不应调用模型')
    }, controller.signal)
    const stream = harness.run()
    assert.equal((await stream.next()).value?.type, 'run_started')
    const waiting = stream.next()
    controller.abort(new Error('user stop'))
    assert.equal((await waiting).value?.type, 'run_aborted')
    assert.equal((await stream.next()).done, true)
    gate.resolve()
    await Promise.resolve()
    assert.deepEqual(harness.recorder.abortedRunIds, ['run-1'])
    assert.deepEqual(harness.recorder.failedRunIds, [])
    assert.equal(harness.llmCalls.length, 0)
  })

  it('开发指南先落库再重采样；整批旧工作区计划不执行，续轮只执行新计划', async () => {
    const args = ['{"path":"src/App.tsx"}', '{"path":"a.py","content":"print(42)"}', '{"path":"a.py","edits":[{"oldText":"42","newText":"43"}]}', '{"command":"pnpm check"}']
    const harness = createHarness((_messages, _options, index) => index < 2
      ? toModelStream([...WORKSPACE_TOOL_NAMES.map((name, i) => toolCallEvent(`call-${index}-${i}`, name, args[i]!, '', i)), { type: 'response_completed', finishReason: 'tool_calls' }])
      : toModelStream([{ type: 'response_completed', finishReason: 'stop' }]))
    const events = await collectEvents(harness.run())
    assert.equal(events.at(-1)?.type, 'run_completed')
    const replans = events.filter(event => event.type === 'tool_finished' && event.skipped)
    assert.equal(replans.length, 4)
    assert.ok(replans.every(event => event.type === 'tool_finished' && !event.ok && !event.failure))
    assert.equal(harness.toolInvocations.length, 4)
    assert.ok(harness.toolInvocations.every(call => call.callId.startsWith('call-1-')))
    assert.equal(harness.llmCalls[0]!.messages.some(item => item.type === 'message' && item.content === WORKSPACE_DEVELOPMENT_INSTRUCTION.content), false)
    assert.deepEqual(harness.llmCalls[1]!.messages[0], WORKSPACE_DEVELOPMENT_INSTRUCTION)
    const guide = harness.recorder.steps.find(step => step.type === 'workspace_development')!
    assert.equal(guide.status, AgentStepStatus.COMPLETED)
    assert.deepEqual(guide.output, { instruction: WORKSPACE_DEVELOPMENT_INSTRUCTION })
    const firstResults = harness.recorder.steps.filter(step => step.type === 'tool_execution').slice(0, 4)
    assert.ok(firstResults.every(step => step.status === AgentStepStatus.COMPLETED && (step.output as Record<string, unknown>).ok === false && (step.output as Record<string, unknown>).code === 'workspace_replan'))
    const sampling = harness.recorder.steps.filter(step => step.type === 'model_sampling')
    assert.equal((sampling[0]!.input as Record<string, unknown>).workspaceDevelopment, undefined)
    assert.equal(((sampling[1]!.input as Record<string, unknown>).workspaceDevelopment as Record<string, unknown>).stepId, guide.id)
    assertNoUnfinishedSteps(harness)
  })

  it('R1：交付终态事件前已启动工作区交接，云端 kill 尚未返回也不漏掉清理', async () => {
    for (const terminal of ['run_completed', 'run_failed', 'run_aborted']) {
      let finish!: () => void
      const cleanup = new Promise<void>((resolve) => {
        finish = resolve
      })
      const releaseRun = vi.fn(() => cleanup)
      const workspaces = { cloud: { configured: true }, releaseRun } as unknown as WorkspaceService
      const controller = new AbortController()
      const harness = createHarness(() => {
        if (terminal === 'run_failed')
          throw new Error('fixture failure')
        if (terminal === 'run_aborted')
          controller.abort(new Error('fixture abort'))
        return toModelStream([{ type: 'text_delta', delta: '完成' }, { type: 'response_completed', finishReason: 'stop' }])
      }, controller.signal, undefined, {}, workspaces)
      const stream = harness.run()
      try {
        while (true) {
          const event = await stream.next()
          assert.equal(event.done, false)
          if (event.value?.type === terminal)
            break
        }
        assert.ok(releaseRun.mock.calls.length > 0, `${terminal} 发出时下一轮必须已能找到收尾 Promise`)
      }
      finally {
        finish()
        await stream.return(undefined)
      }
    }
  })

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
      MODEL_TOOL_NAMES,
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
      // 给模型的工具名单随快照落库：运行配置事后可改，靠它还原这次给没给工具。
      modelToolNames: TOOL_DEFINITIONS.map(definition => definition.name),
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
    // 落库的输入预算原样取模型行的单次输入上限，不再按窗口与输出上限现算。
    assert.equal(initialContext.resolvedInputBudgetTokens, 262_144)
    assert.equal(harness.llmCalls[0]?.options?.request.reasoningEffort, 'max')
    // Provider 凭据随快照传给 LLMService：整个 Run 用同一把 key。
    assert.equal(harness.llmCalls[0]?.provider.providerId, 'provider-deepseek')
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

  it('一次读取 previous COMPLETED 的全部历史（不按条数截断），当前输入恰好一次', async () => {
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

    // 只看本 Run 读历史的那一次（带当前问题上界）；问答结束后检查点 B 在后台另读一次，不带上界。
    assert.deepEqual(harness.prisma.findManyArguments.filter(arguments_ => arguments_.where.OR), [{
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
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      // 第一步只读元数据，不带正文（#239）。
      select: { id: true, conversationId: true, role: true, status: true, createdAt: true, updatedAt: true },
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

  it('createdAt 相同时按 id 排序一次读取，保持稳定时间顺序', async () => {
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

    // 不再 keyset 翻页：本 Run 整段历史只有一次 findMany，且只带当前用户消息上界。
    assert.equal(harness.prisma.findManyArguments.filter(arguments_ => arguments_.where.OR).length, 1)
    const contents = (harness.llmCalls[0]?.messages ?? [])
      .filter(item => item.type === 'message')
      .map(item => item.content)

    assert.deepEqual(contents, [
      ...Array.from({ length: 60 }, (_, index) => `历史消息 ${index + 1}`),
      '问题',
    ])
  })

  it('#218 AC-05 历史不按条数截断：超过原来 1,000 条上限的 1,200 条候选全部读出，预算够时全部进入首轮请求', async () => {
    const harness = createHarness(() => toModelStream([{ type: 'response_completed', finishReason: 'stop' }]))

    for (let index = 1; index <= 1_200; index += 1) {
      harness.prisma.seedMessage({
        id: `history-${String(index).padStart(4, '0')}`,
        content: `历史消息 ${index}`,
        status: MessageStatus.COMPLETED,
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, index)),
      })
    }

    const events = await collectEvents(harness.run())

    assert.equal(events.at(-1)?.type, 'run_completed')
    assert.equal(harness.prisma.findManyArguments.filter(arguments_ => arguments_.where.OR).length, 1)
    assert.equal(Object.hasOwn(harness.prisma.findManyArguments[0]!, 'take'), false)
    const contents = (harness.llmCalls[0]?.messages ?? [])
      .filter(item => item.type === 'message')
      .map(item => item.content)

    assert.deepEqual(contents, [
      ...Array.from({ length: 1_200 }, (_, index) => `历史消息 ${index + 1}`),
      '问题',
    ])
    assert.deepEqual(findStep(harness, 'load_conversation_history')?.output, { messageCount: 1_200 })
    assert.equal(readContextPlan(findStep(harness, 'model_sampling'))?.historyIncludedCount, 1_200)
    assertNoUnfinishedSteps(harness)
  })

  it('#218 历史带回之前问答的工具记录；AC-06(c) 某次问答的 tool Step 缺 observation 时只退回这一次的一问一答，请求照常发出', async () => {
    const harness = createHarness(() => toModelStream([
      { type: 'text_delta', delta: '好' },
      { type: 'response_completed', finishReason: 'stop' },
    ]))
    const seed = (id: string, content: string, role: Message['role'], second: number) => harness.prisma.seedMessage({
      id,
      content,
      role,
      status: MessageStatus.COMPLETED,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, second)),
    })
    seed('u1', '第一问', MessageRole.USER, 1)
    seed('a1', '先搜一下。\n\n第一答', MessageRole.ASSISTANT, 2)
    seed('u2', '第二问', MessageRole.USER, 3)
    seed('a2', '第二答', MessageRole.ASSISTANT, 4)
    harness.prisma.historyRuns = [historyRun('r1', 'u1', 'a1'), historyRun('r2', 'u2', 'a2')]
    harness.prisma.historyStepRows = [
      historyStep('r1', { sequence: 2, type: 'model_sampling', samplingAttemptId: 'r1:sampling-1', toolCallCount: 1, intermediateText: '先搜一下。' }),
      historyStep('r1', { sequence: 3, type: 'tool_execution', samplingAttemptId: 'r1:sampling-1', callId: 'call-1', toolName: 'web_search', arguments: '{"query":"react"}', observation: '搜索结果', ok: true }),
      historyStep('r1', { sequence: 5, type: 'model_sampling', samplingAttemptId: 'r1:sampling-2', toolCallCount: 0 }),
      // 第二次问答的工具 Step 没收口（被停止或进程中断）：没有 observation。
      historyStep('r2', { sequence: 2, type: 'model_sampling', samplingAttemptId: 'r2:sampling-1', toolCallCount: 1 }),
      historyStep('r2', { sequence: 3, type: 'tool_execution', samplingAttemptId: 'r2:sampling-1', callId: 'call-2', toolName: 'web_search', arguments: '{"query":"vue"}' }),
      historyStep('r2', { sequence: 5, type: 'model_sampling', samplingAttemptId: 'r2:sampling-2', toolCallCount: 0 }),
    ]

    const events = await collectEvents(harness.run())

    assert.equal(events.at(-1)?.type, 'run_completed')
    assert.equal(harness.prisma.historyStepQueryCount, 1)
    assert.deepEqual(harness.llmCalls[0]?.messages, [
      { type: 'message', role: 'user', content: '第一问' },
      {
        type: 'assistant_tool_call',
        calls: [{ callId: 'call-1', name: 'web_search', rawArgumentsJson: '{"query":"react"}' }],
        reasoningContent: '',
        content: '先搜一下。',
      },
      { type: 'tool_result', callId: 'call-1', name: 'web_search', content: '搜索结果', ok: true },
      { type: 'message', role: 'assistant', content: '第一答' },
      { type: 'message', role: 'user', content: '第二问' },
      { type: 'message', role: 'assistant', content: '第二答' },
      { type: 'message', role: 'user', content: '问题' },
    ])
    // 候选与选入仍按 Message 条数记。
    assert.deepEqual(findStep(harness, 'load_conversation_history')?.output, { messageCount: 4 })
    assert.equal(readContextPlan(findStep(harness, 'model_sampling'))?.historyIncludedCount, 4)
    assertNoUnfinishedSteps(harness)
  })

  it('#218 AC-06(b) 读历史时查 Step 失败：调用模型前失败并收口为 FAILED，不带着半截历史发请求', async () => {
    const harness = createHarness(() => toModelStream([
      { type: 'text_delta', delta: '不应调用模型' },
      { type: 'response_completed', finishReason: 'stop' },
    ]))

    harness.prisma.seedMessage({ id: 'u1', content: '旧问题', status: MessageStatus.COMPLETED, createdAt: new Date('2026-01-01T00:00:01.000Z') })
    harness.prisma.seedMessage({ id: 'a1', content: '旧回答', role: MessageRole.ASSISTANT, status: MessageStatus.COMPLETED, createdAt: new Date('2026-01-01T00:00:02.000Z') })
    harness.prisma.historyRuns = [historyRun('r1', 'u1', 'a1')]
    harness.prisma.historyStepQueryError = new Error('connection reset')

    const events = await collectEvents(harness.run())

    assert.deepEqual(events.map(event => event.type), ['run_failed'])
    assert.equal(harness.prisma.historyStepQueryCount, 1)
    assert.equal(harness.llmCalls.length, 0)
    assert.deepEqual(harness.recorder.steps.map(step => [step.type, step.status]), [
      ['load_conversation_history', AgentStepStatus.FAILED],
    ])
    assert.equal(harness.recorder.runErrorCode, 'internal')
    assert.deepEqual(harness.recorder.failedRunIds, ['run-1'])
    // 助手消息在读完历史之后才建：失败时还没有它，只有种进去的旧回答。
    assert.deepEqual(harness.prisma.messages.filter(message => message.role === MessageRole.ASSISTANT).map(message => message.id), ['a1'])
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

  it('文件保存确认后才推工具完成和回喂；事务失败不发成功结果，两个分支都释放 Run 实例', async () => {
    for (const confirmed of [true, false]) {
      const releasedRuns = new Set<string>()
      const releaseRun = async (id: string) => {
        releasedRuns.add(id)
      }
      const workspaces = { cloud: { configured: true }, releaseRun } as unknown as WorkspaceService
      const commit = { conversationId: 'conversation-1', runId: 'run-1', expectedRevision: 0, files: [] }
      const harness = createHarness((_, __, index) => toModelStream(index < 2
        ? [toolCallEvent(index === 0 ? 'guide-plan' : 'write-file', 'write', '{"path":"a.txt","content":"ok"}'), { type: 'response_completed', finishReason: 'tool_calls' }]
        : [{ type: 'text_delta', delta: '完成' }, { type: 'response_completed', finishReason: 'stop' }]), undefined, async (_call, context) => {
        assert.equal(context.workspace?.userId, 'trusted-user')
        assert.equal(context.workspace?.conversationId, 'conversation-1')
        assert.equal(context.workspace?.runId, 'run-1')
        return { ok: true, modelContent: '已保存版本 1', workspaceCommit: commit }
      }, {}, workspaces)
      const complete = harness.recorder.completeStep.bind(harness.recorder)
      let committed = false
      vi.spyOn(harness.recorder, 'completeStep').mockImplementation(async (id, deadline, input) => {
        if (input && 'workspaceCommit' in input) {
          assert.deepEqual(input.workspaceCommit, commit)
          if (!confirmed)
            throw new Error('文件事务确认失败')
          committed = true
        }
        await complete(id, deadline, input)
      })
      const events: AgentRuntimeEvent[] = []
      for await (const event of harness.service.runTurnStream({ userId: 'trusted-user', conversationId: 'conversation-1', userContent: '生成文件', instructions: [] })) {
        if (event.type === 'tool_finished' && event.callId === 'write-file')
          assert.equal(committed, true)
        events.push(event)
      }
      assert.equal(events.some(event => event.type === 'tool_finished' && event.callId === 'write-file'), confirmed)
      assert.equal(harness.llmCalls.length, confirmed ? 3 : 2)
      if (confirmed) {
        assert.ok(harness.llmCalls[2]!.messages.some(item => item.type === 'tool_result' && item.content === '已保存版本 1'))
        assert.equal((harness.recorder.steps.filter(step => step.type === 'tool_execution').at(-1)?.output as { observation: string }).observation, '已保存版本 1')
      }
      assert.equal(events.at(-1)?.type, confirmed ? 'run_completed' : 'run_failed')
      assert.deepEqual([...releasedRuns], ['run-1'])
    }
  })

  it('文件 COMMIT 确认后的停止不再推 tool_finished，确认未知向用户说明而非声称回滚', async () => {
    for (const unknown of [false, true]) {
      const controller = new AbortController()
      const harness = createHarness((_, __, index) => toModelStream([
        toolCallEvent(index === 0 ? 'guide-plan' : 'save', 'write', '{"path":"a.txt","content":"ok"}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]), controller.signal, async () => ({ ok: true, modelContent: '已保存', workspaceCommit: { conversationId: 'conversation-1', runId: 'run-1', expectedRevision: 0, files: [] } }))
      const complete = harness.recorder.completeStep.bind(harness.recorder)
      vi.spyOn(harness.recorder, 'completeStep').mockImplementation(async (id, deadline, input) => {
        if (input && 'workspaceCommit' in input && unknown)
          throw new DatabaseCommitOutcomeUnknownError()
        await complete(id, deadline, input)
        if (input && 'workspaceCommit' in input)
          controller.abort(new Error('stop after file COMMIT'))
      })
      const events = await collectEvents(harness.run())
      assert.equal(events.some(event => event.type === 'tool_finished' && event.callId === 'save'), false)
      assert.equal(harness.llmCalls.length, 2)
      const terminal = events.at(-1)
      if (unknown) {
        assert.ok(terminal?.type === 'run_failed')
        assert.match(terminal.message, /提交结果未知/)
        assert.match(terminal.message, /不要假设改动已经回滚/)
      }
      else {
        assert.equal(terminal?.type, 'run_aborted')
        assert.equal(harness.recorder.steps.filter(step => step.type === 'tool_execution').at(-1)?.status, AgentStepStatus.COMPLETED)
      }
    }
  })

  it('文件 COMMIT 响应未知与停止或 deadline 同时发生时保留原终态并持久化未知提示', async () => {
    for (const source of ['user', 'deadline'] as const) {
      const controller = new AbortController()
      const harness = createHarness((_, __, index) => toModelStream([
        { type: 'text_delta', delta: '正在保存文件。' },
        toolCallEvent(index === 0 ? 'guide-plan' : 'save', 'write', '{"path":"a.txt","content":"ok"}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]), controller.signal, async () => ({ ok: true, modelContent: '已保存', workspaceCommit: { conversationId: 'conversation-1', runId: 'run-1', expectedRevision: 0, files: [] } }), { runDeadlineMs: 100 })
      const complete = harness.recorder.completeStep.bind(harness.recorder)
      vi.spyOn(harness.recorder, 'completeStep').mockImplementation(async (id, deadline, input) => {
        await complete(id, deadline, input)
        if (input && 'workspaceCommit' in input) {
          if (source === 'user')
            controller.abort(new Error('stop while waiting for file COMMIT'))
          else
            await waitForAbort(deadline.signal!)
          throw new DatabaseCommitOutcomeUnknownError()
        }
      })
      const events = await collectEvents(harness.run())
      const terminal = events.at(-1)
      assert.equal(events.some(event => event.type === 'tool_finished' && event.callId === 'save'), false)
      assert.equal(harness.llmCalls.length, 2)
      assert.equal(harness.recorder.steps.filter(step => step.type === 'tool_execution').at(-1)?.status, AgentStepStatus.COMPLETED)
      const content = harness.assistantMessage()?.content
      assert.match(content ?? '', /^正在保存文件。/)
      assert.match(content ?? '', /提交结果未知/)
      assert.match(content ?? '', /不要假设改动已经回滚/)
      if (source === 'user') {
        assert.ok(terminal?.type === 'run_aborted')
        assert.equal(terminal.content, content)
        assert.equal(harness.assistantMessage()?.status, MessageStatus.ABORTED)
        assert.deepEqual(harness.recorder.abortedRunIds, ['run-1'])
      }
      else {
        assert.ok(terminal?.type === 'run_failed')
        assert.match(terminal.message, /提交结果未知/)
        assert.equal(harness.recorder.runErrorCode, 'deadline')
      }
    }
  })

  it('执行一次工具并把 Observation 回填第二轮模型输入', async () => {
    const streams: ModelStreamEvent[][] = [
      [
        toolCallEvent('call-1', 'web_search', '{"query":"SP Himeko"}'),
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
      'tool_started',
      'tool_finished',
      'assistant_delta',
      'assistant_delta',
      'run_completed',
    ])
    assert.deepEqual(harness.toolInvocations, [{
      callId: 'call-1',
      toolName: 'web_search',
      rawArgumentsJson: '{"query":"SP Himeko"}',
    }])
    assert.equal(harness.llmCalls.length, 2)
    assert.deepEqual(
      harness.llmCalls.map(call => call.options?.tools?.map(tool => tool.name)),
      [MODEL_TOOL_NAMES, MODEL_TOOL_NAMES],
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
        calls: [{ callId: 'call-1', name: 'web_search', rawArgumentsJson: '{"query":"SP Himeko"}' }],
        reasoningContent: 'reasoning for call-1',
      },
      {
        type: 'tool_result',
        callId: 'call-1',
        name: 'web_search',
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
    // contextPlan：预算、估算之外落本轮基于的压缩记录、本轮压缩 Step 与未覆盖的历史条数（#220）。
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
        { compactionId: null, turnCompactionStepId: null, historyIncludedCount: 0 },
        { compactionId: null, turnCompactionStepId: null, historyIncludedCount: 0 },
      ],
    )
    const toolStep = harness.recorder.steps[2]
    assert.deepEqual(toolStep?.input, {
      callId: 'call-1',
      toolName: 'web_search',
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

  it('#220 AC-01 生产计数：第 1 次调用整份粗估；同一问答内之后 = 上次用量（输入 + 输出）+ 新增工具结果粗估', async () => {
    const harness = createHarness(
      (_, __, callIndex) => toModelStream(callIndex === 0
        ? [
            toolCallEvent('call-1', 'web_search', '{"query":"x"}'),
            { type: 'usage', usage: { inputTokens: 5_000, outputTokens: 120, totalTokens: 5_120 } },
            { type: 'response_completed', finishReason: 'tool_calls' },
          ]
        : [
            { type: 'text_delta', delta: '好' },
            { type: 'response_completed', finishReason: 'stop' },
          ]),
      undefined,
      async () => ({ ok: true, modelContent: '工具结果正文' }),
    )

    await collectEvents(harness.run())

    const estimates = harness.recorder.steps
      .filter(step => step.type === 'model_sampling')
      .map(step => readContextPlan(step).estimatedInputTokens)

    assert.deepEqual(estimates, [
      estimateRequestTokens({ items: harness.llmCalls[0]!.messages, tools: harness.llmCalls[0]!.options!.tools! }),
      5_120 + roughTokens('工具结果正文'),
    ])
  })

  it('按模型决策执行 search -> search -> final 三轮路径', async () => {
    const firstReasoning = 'secret-first-reasoning'
    const secondReasoning = 'secret-second-reasoning'
    const streams: ModelStreamEvent[][] = [
      [
        toolCallEvent(
          'call-search',
          'web_search',
          '{"query":"seo"}',
          firstReasoning,
        ),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ],
      [
        toolCallEvent(
          'call-search-2',
          'web_search',
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
      Array.from({ length: 3 }).fill(MODEL_TOOL_NAMES),
    )
    assert.deepEqual(harness.toolInvocations, [
      {
        callId: 'call-search',
        toolName: 'web_search',
        rawArgumentsJson: '{"query":"seo"}',
      },
      {
        callId: 'call-search-2',
        toolName: 'web_search',
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
        calls: [{ callId: 'call-search', name: 'web_search', rawArgumentsJson: '{"query":"seo"}' }],
        reasoningContent: firstReasoning,
      },
      {
        type: 'tool_result',
        callId: 'call-search',
        name: 'web_search',
        content: '搜索到 sourceId=24。',
        ok: true,
      },
      {
        type: 'assistant_tool_call',
        calls: [{ callId: 'call-search-2', name: 'web_search', rawArgumentsJson: '{"query":"sitemap"}' }],
        reasoningContent: secondReasoning,
      },
      {
        type: 'tool_result',
        callId: 'call-search-2',
        name: 'web_search',
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
    // 回填用的 reasoningContent 只随 assistant 消息回填模型，不经事件与 Message 外泄
    // （这条假流没有 reasoning_delta；前台看到的思考原文只来自 reasoning_delta，见 #209 用例）。
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

  it('#209 思考原文作为 reasoning_delta 转发；Message、Step 落库与下一轮模型请求和没有思考分片时逐字一致（#212 起最后一轮的思考只多存在最终采样 Step）', async () => {
    const reasoningRounds = [['先搜\0一下', ' seo。'], ['整理结果。']]
    const streamsOf = (withReasoning: boolean): ModelStreamEvent[][] => [
      [
        { type: 'reasoning_started' },
        ...(withReasoning ? reasoningRounds[0]!.map(delta => ({ type: 'reasoning_delta' as const, delta })) : []),
        toolCallEvent('call-search', 'web_search', '{"query":"seo"}', reasoningRounds[0]!.join('')),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ],
      [
        { type: 'reasoning_started' },
        ...(withReasoning ? reasoningRounds[1]!.map(delta => ({ type: 'reasoning_delta' as const, delta })) : []),
        { type: 'text_delta', delta: '结论。' },
        { type: 'response_completed', finishReason: 'stop' },
      ],
    ]
    const runScenario = async (withReasoning: boolean) => {
      const streams = streamsOf(withReasoning)
      const harness = createHarness((_, __, callIndex) => toModelStream(streams[callIndex] ?? []))
      const events = await collectEvents(harness.run())

      assertNoUnfinishedSteps(harness)

      return {
        events,
        message: harness.assistantMessage()?.content,
        // 时间、首 token 与正文开始的毫秒数随真实时钟变化，其余字段逐字比对。
        steps: harness.recorder.steps.map(({ type, sequence, status, input, output }) => {
          const { firstTokenMs: _firstTokenMs, answerStartedMs: _answerStartedMs, ...rest } = (output ?? {}) as Record<string, unknown>

          return { type, sequence, status, input, output: rest }
        }),
        modelRequests: harness.llmCalls.map(call => call.messages),
      }
    }
    const without = await runScenario(false)
    const withReasoning = await runScenario(true)

    assert.deepEqual(
      withReasoning.events.flatMap(event => event.type === 'reasoning_delta' ? [event.delta] : []),
      ['先搜\uFFFD一下', ' seo。', '整理结果。'],
    )
    assert.deepEqual(
      withReasoning.events.filter(event => event.type !== 'reasoning_delta').map(event => event.type),
      without.events.map(event => event.type),
    )
    // 思考原文排在本轮正文与工具事件之前。
    assert.deepEqual(withReasoning.events.map(event => event.type), [
      'run_started',
      'reasoning_delta',
      'reasoning_delta',
      'tool_started',
      'tool_finished',
      'reasoning_delta',
      'assistant_delta',
      'run_completed',
    ])
    assert.deepEqual(
      withReasoning.events.filter(event => event.type === 'reasoning_delta').map(toChatStreamEvent)[0],
      { type: 'reasoning_delta', conversationId: 'conversation-1', assistantMessageId: withReasoning.events.find(event => event.type === 'run_started')?.assistantMessageId, delta: '先搜\uFFFD一下' },
    )
    assert.equal(withReasoning.message, '结论。')
    assert.deepEqual(withReasoning.message, without.message)
    // #212：最后一轮（final answer）的思考只为界面还原存进它的采样 Step，没有思考分片时不写。
    const finalSampling = (steps: typeof without.steps) => steps.filter(step => step.type === 'model_sampling').at(-1)!
    const { reasoningContent: finalReasoning, ...finalRest } = finalSampling(withReasoning.steps).output

    assert.equal(finalReasoning, '整理结果。')
    assert.equal(Object.hasOwn(finalSampling(without.steps).output, 'reasoningContent'), false)
    assert.deepEqual(finalRest, finalSampling(without.steps).output)
    assert.deepEqual(
      withReasoning.steps.filter(step => step !== finalSampling(withReasoning.steps)),
      without.steps.filter(step => step !== finalSampling(without.steps)),
    )
    assert.deepEqual(withReasoning.modelRequests, without.modelRequests)
  })

  it('拒绝执行工具清单之外的工具', async () => {
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
      [MODEL_TOOL_NAMES, MODEL_TOOL_NAMES],
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
      'tool_started',
      'tool_finished',
      'assistant_delta',
      'run_completed',
    ])
    assert.deepEqual(chatEvents.map(event => event.type), ['start', 'tool_started', 'tool_finished', 'delta', 'done'])
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
    // 清单外工具的参数没有经过校验：落库的是回喂给模型的 `{"arguments": raw}` 形状。
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

  it('execution_failed 按模型原参数落库、不自动重试，参数不进用户可见 Message', async () => {
    const harness = createHarness(
      (_, __, callIndex) => toModelStream(callIndex === 0
        ? [
            toolCallEvent(
              'call-secret',
              'web_search',
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
        modelContent: '工具 web_search 执行失败。',
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

  it('规范化超大 Unicode Observation，durable Step 只保存受工具上限约束的正文', async () => {
    const oversizedObservation = '🚀'.repeat(16_100)
    const harness = createHarness(
      (_, __, callIndex) => toModelStream(callIndex === 0
        ? [
            toolCallEvent('call-large', 'web_search', '{"query":"seo"}'),
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

    assert.ok([...observationContent].length <= 8_000, '[...observationContent].length <= 8_000')
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
        toolCallEvent('call-1', 'web_search', '{"query":"seo"}', '两个都查。', 0),
        toolCallEvent('call-2', 'web_search', '{"query":"sitemap"}', '两个都查。', 1),
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
      'tool_started',
      'tool_finished',
      'tool_started',
      'tool_finished',
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
          { callId: 'call-1', name: 'web_search', rawArgumentsJson: '{"query":"seo"}' },
          { callId: 'call-2', name: 'web_search', rawArgumentsJson: '{"query":"sitemap"}' },
        ],
        reasoningContent: '两个都查。',
        content: '先查两篇。',
      },
      { type: 'tool_result', callId: 'call-1', name: 'web_search', content: '结果 call-1', ok: true },
      { type: 'tool_result', callId: 'call-2', name: 'web_search', content: '结果 call-2', ok: true },
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
        toolCallEvent('call-1', 'web_search', '{"query":"seo"}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ],
      // 没有文本的工具轮不推 delta，也不产生分隔。
      [
        toolCallEvent('call-2', 'web_search', '{"query":"sitemap"}'),
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
          toolCallEvent('call-1', 'web_search', '{"query":"seo"}'),
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

  it('#218 AC-05 不限轮数与工具调用次数：模型连续 12 轮调工具（共 14 次，超过原来的 10 轮、8 次）后照常给出回答', async () => {
    const harness = createHarness((_, __, callIndex) => toModelStream(callIndex < 12
      ? [
          toolCallEvent(`call-${callIndex}-a`, 'web_search', `{"query":"q${callIndex}"}`, 'reason', 0),
          // 第一轮一次给三个 call：原来的剩余预算整批拒绝。
          ...(callIndex === 0
            ? [
                toolCallEvent('call-0-b', 'web_search', '{"query":"b"}', 'reason', 1),
                toolCallEvent('call-0-c', 'web_search', '{"query":"c"}', 'reason', 2),
              ]
            : []),
          { type: 'response_completed', finishReason: 'tool_calls' },
        ]
      : [
          { type: 'text_delta', delta: '查完了。' },
          { type: 'response_completed', finishReason: 'stop' },
        ]))

    const events = await collectEvents(harness.run())

    assert.equal(events.at(-1)?.type, 'run_completed')
    assert.equal(harness.llmCalls.length, 13)
    assert.equal(harness.toolInvocations.length, 14)
    assert.equal(harness.assistantMessage()?.content, '查完了。')
    // 每轮都给模型完整的工具清单。
    assert.ok(harness.llmCalls.every(call => call.options?.tools?.length === TOOL_DEFINITIONS.length))
    // 最后一轮请求里 12 组工具来回都在，调用与结果成对。
    assert.equal(harness.llmCalls.at(-1)?.messages.filter(item => item.type === 'assistant_tool_call').length, 12)
    assert.equal(harness.llmCalls.at(-1)?.messages.filter(item => item.type === 'tool_result').length, 14)
    assert.deepEqual(harness.recorder.completedRunIds, ['run-1'])
    assertNoUnfinishedSteps(harness)
  })

  it('length 截断的 Tool Call 整批不执行，逐个记 truncated_arguments 并回喂，Run 继续', async () => {
    const streams: Array<() => AsyncGenerator<ModelStreamEvent>> = [
      // 原始 provider chunk 经真实 adapter：arguments 为空、不完整，以及无 id 分片各一。
      () => adaptDeepSeekStream(toProviderStream([
        providerChunk({ reasoning_content: '需要查两篇。' } as ChatCompletionChunk.Choice.Delta),
        providerChunk({
          tool_calls: [
            { index: 0, id: 'call-empty', type: 'function', function: { name: 'web_search' } },
            { index: 1, id: 'call-partial', type: 'function', function: { name: 'web_search', arguments: '{"query":' } },
            { index: 2, type: 'function', function: { name: 'search_', arguments: '{"q' } },
          ],
        } as ChatCompletionChunk.Choice.Delta),
        providerChunk({}, 'length'),
      ])),
      () => toModelStream([
        toolCallEvent('call-retry', 'web_search', '{"query":"seo"}'),
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
          { callId: 'call-empty', name: 'web_search', rawArgumentsJson: '{"arguments":""}' },
          { callId: 'call-partial', name: 'web_search', rawArgumentsJson: '{"arguments":"{\\"query\\":"}' },
        ],
        reasoningContent: '需要查两篇。',
      },
      {
        type: 'tool_result',
        callId: 'call-empty',
        name: 'web_search',
        content: '工具 web_search 的参数因模型输出达到长度限制而不完整，本次未执行；仍需要时请重新发起调用。',
        ok: false,
      },
      {
        type: 'tool_result',
        callId: 'call-partial',
        name: 'web_search',
        content: '工具 web_search 的参数因模型输出达到长度限制而不完整，本次未执行；仍需要时请重新发起调用。',
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

  it('length 截断的原始参数仍能续轮：未校验参数以官方回退形状回喂', async () => {
    // 同一根因的全部边界：空、半截对象、非对象 JSON、特殊数值，以及完整对象对照。
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
      const streams: Array<() => AsyncGenerator<ModelStreamEvent>> = [
        () => adaptDeepSeekStream(toProviderStream([
          providerChunk({ reasoning_content: '需要查。' } as ChatCompletionChunk.Choice.Delta),
          providerChunk({
            tool_calls: [{
              index: 0,
              id: 'call-truncated',
              type: 'function',
              function: {
                name: 'web_search',
                ...(rawArguments ? { arguments: rawArguments } : {}),
              },
            }],
          } as ChatCompletionChunk.Choice.Delta),
          providerChunk({}, 'length'),
        ])),
        () => toModelStream([
          toolCallEvent('call-retry', 'web_search', '{"query":"seo"}'),
          { type: 'response_completed', finishReason: 'tool_calls' },
        ]),
        () => toModelStream([
          { type: 'text_delta', delta: '完成。' },
          { type: 'response_completed', finishReason: 'stop' },
        ]),
      ]
      const harness = createHarness((_, __, callIndex) => streams[callIndex]!())

      // 与真实入口一致，带 system 消息。
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
            name: 'web_search',
            rawArgumentsJson: JSON.stringify({ arguments: rawArguments }),
          }],
          reasoningContent: '需要查。',
        },
        {
          type: 'tool_result',
          callId: 'call-truncated',
          name: 'web_search',
          content: '工具 web_search 的参数因模型输出达到长度限制而不完整，本次未执行；仍需要时请重新发起调用。',
          ok: false,
        },
      ], label)
      // 已校验的重发调用原样续传（对照）。
      assert.deepEqual(harness.llmCalls[2]?.messages.at(-2), {
        type: 'assistant_tool_call',
        calls: [{ callId: 'call-retry', name: 'web_search', rawArgumentsJson: '{"query":"seo"}' }],
        reasoningContent: 'reasoning for call-retry',
      }, label)
      assertNoUnfinishedSteps(harness)
    }
  })

  it('invalid_arguments 与 unknown_tool 回喂的未校验参数仍能续轮', async () => {
    const cases = [
      { toolName: 'web_search', code: 'invalid_arguments' },
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
        tool_calls: [{ index: 0, type: 'function', function: { name: 'web_search', arguments: '{"q' } }],
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

    // 真实流里的 reasoning_content 同样作为 reasoning_delta 推给界面（#209）。
    assert.deepEqual(events.map(event => event.type), [
      'run_started',
      'assistant_delta',
      'reasoning_delta',
      'tool_started',
      'tool_finished',
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
      calls: [{ callId: 'call-1', name: 'web_search', rawArgumentsJson: '{"query":"seo"}' }],
      reasoningContent: 'REASONING_IN_DEBUG_CAPTURE',
      content: intermediate,
    })
    assert.equal((output.debugRawResponse as { state: string }).state, 'complete')
    // 本轮回填模型的文本与 reasoning 作为内容事实落在采样 Step 上；debug 原始响应同样保留 reasoning_content。
    assert.equal(output.intermediateText, intermediate)
    assert.equal(output.reasoningContent, 'REASONING_IN_DEBUG_CAPTURE')
    assert.equal(
      (output.debugRawResponse as { value: { choices: [{ message: { reasoning_content?: string } }] } })
        .value.choices[0].message.reasoning_content,
      'REASONING_IN_DEBUG_CAPTURE',
    )
    assertNoUnfinishedSteps(harness)
  })

  it('运行配置快照：关闭调试抓取时不给 client 回调、采样 Step 不带 debug 字段；Serper Key 原样交给工具上下文', async () => {
    const harness = createHarness((_, options, callIndex) => callIndex === 0
      ? capturedTextThenToolCallModelStream(options, '我先搜一下。')
      : toModelStream([
          { type: 'text_delta', delta: '找到了。' },
          { type: 'response_completed', finishReason: 'stop' },
        ]))
    const serperApiKey = { status: 'set', value: 'serper-key-from-snapshot' } as const

    const events = await collectEvents(harness.service.runTurnStream({
      conversationId: 'conversation-1',
      userContent: '问题',
      runtimeConfig: createRuntimeConfigSnapshot({ debugCaptureModelIo: false, serperApiKey }),
      instructions: [],
    }))
    const output = findStep(harness, 'model_sampling')?.output as Record<string, unknown>

    assert.equal(events.at(-1)?.type, 'run_completed')
    assert.deepEqual(harness.llmCalls.map(call => call.options?.debugCapture), [undefined, undefined])
    assert.equal('debugRequestBody' in output, false)
    assert.equal('debugRawResponse' in output, false)
    assert.deepEqual(harness.toolExecutionContexts.map(context => context.serperApiKey), [serperApiKey])
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

    const { contextPlan: _, answerStartedMs, ...samplingOutput } = findStep(harness, 'model_sampling')
      ?.output as Record<string, unknown>

    // 流没收完就没有 summary：不伪造 usage / firstTokenMs，只有失败类别；正文已开始，所以带「用时」（#212）。
    assert.deepEqual(samplingOutput, { errorCode: 'aborted' })
    assert.ok(Number.isSafeInteger(answerStartedMs) && (answerStartedMs as number) >= 0)
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
        toolCallEvent('call-1', 'web_search', '{"query":"seo"}'),
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
            'web_search',
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
        toolCallEvent('call-1', 'web_search', '{"query":"seo"}'),
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
        toolCallEvent('call-1', 'web_search', '{"query":"seo"}'),
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

  it('#218 AC-06(d) 模型一直调工具：不再有次数上限，到「单次最长时间」按时限终态结束，不无限循环', async () => {
    const harness = createHarness(
      (_, __, callIndex) => toModelStream([
        toolCallEvent(`call-${callIndex}`, 'web_search', '{"query":"again"}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]),
      undefined,
      async () => {
        await sleep(5)
        return { ok: true, modelContent: '再查一次。' }
      },
      { runDeadlineMs: 200 },
    )

    const events = await collectEvents(harness.run())
    const finalEvent = events.at(-1)

    assert.equal(finalEvent?.type, 'run_failed')
    assert.equal(finalEvent.message, 'Agent Run 已达到执行时限。')
    // 一直在调工具，停下的原因是时限；超过原来 10 轮上限的确定性证明见 AC-05 的用例。
    assert.ok(harness.llmCalls.length >= 2, `模型调用 ${harness.llmCalls.length} 轮`)
    assert.equal(harness.recorder.runErrorCode, 'deadline')
    assert.deepEqual(harness.recorder.failedRunIds, ['run-1'])
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
    // #220：报错原文是输入超长时不论状态码都归 llm_context_overflow，文案不再是「请求参数异常」。
    {
      name: '400 输入超长',
      attempts: [() => new Response(
        JSON.stringify({ error: { message: 'This model\'s maximum context length is 131072 tokens. However, you requested 140000 tokens.' } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      )],
      errorCode: 'llm_context_overflow',
      error: new LLMContextOverflowError(400),
      httpStatus: 400,
      fetchCount: 1,
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
        toolCallEvent('call-bad', 'web_search', '{"query":', '第一轮推理', 0),
        toolCallEvent('call-ok', 'web_search', '{"query":"seo"}', '第一轮推理', 1),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ],
      [
        toolCallEvent('call-second', 'web_search', '{"query":"sitemap"}', '第二轮推理'),
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
      ['工具 web_search 的参数无效。', '结果 call-ok\n第二行', '结果 call-second\n第二行'],
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
    // 没有压缩：每轮都不基于压缩记录与本轮压缩 Step（#220 起 tool result 原样送入，不再记缩短后的长度）。
    assert.deepEqual(
      samplingSteps.map(step => [readContextPlan(step).compactionId, readContextPlan(step).turnCompactionStepId]),
      [[null, null], [null, null], [null, null]],
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
    // #220 起没有「候选」条数：未被压缩记录覆盖的部分就是发出的原文。
    assert.deepEqual(
      samplingItems.map(item => [
        item.contextInspector.historyIncludedCount,
        item.contextInspector.historyCandidateCount,
      ]),
      [[2, null], [2, null], [2, null]],
    )
    assertNoUnfinishedSteps(harness)
  })

  it('AC-02 参数因 length 截断整批不执行：tool Step 的 arguments 是回喂给模型的 {"arguments": raw} 形状', async () => {
    const streams: Array<() => AsyncGenerator<ModelStreamEvent>> = [
      () => adaptDeepSeekStream(toProviderStream([
        providerChunk({ reasoning_content: '需要查两篇。' } as ChatCompletionChunk.Choice.Delta),
        providerChunk({
          tool_calls: [
            { index: 0, id: 'call-empty', type: 'function', function: { name: 'web_search' } },
            { index: 1, id: 'call-partial', type: 'function', function: { name: 'web_search', arguments: '{"query":' } },
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
        sseData({ tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'web_search', arguments: '{"query":"seo"}' } }] }),
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
        sseData({ tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'web_search', arguments: '{"query":"seo"}' } }] }),
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
        toolCallEvent('call-1', 'web_search', '{"query":"a\u0000b"}', '推理\u0000内容'),
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
        toolCallEvent('call-done', 'web_search', '{"query":"seo"}', '推理', 0),
        toolCallEvent('call-cut', 'web_search', '{"query":"sitemap"}', '推理', 1),
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
        toolCallEvent('call-done', 'web_search', '{"query":"seo"}', '推理', 0),
        toolCallEvent('call-cut', 'web_search', '{"query":"sitemap"}', '推理', 1),
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

describe('工具进度事件（#208）', () => {
  it('AC-02 一轮两个 call：tool_started(A) → tool_finished(A) → tool_started(B) → tool_finished(B) 之后才进入下一轮采样，display 只进事件', async () => {
    const display = { results: [{ title: '界面来源', url: 'https://ui-only.example/' }] }
    const harness = createHarness(
      (_, __, callIndex) => callIndex === 0
        ? toModelStream([
            toolCallEvent('call-a', 'web_search', '{"query":"seo"}', '推理', 0),
            toolCallEvent('call-b', 'web_fetch', '{"url":"https://b.example/page"}', '推理', 1),
            { type: 'response_completed', finishReason: 'tool_calls' },
          ])
        : toModelStream([
            { type: 'text_delta', delta: '完成。' },
            { type: 'response_completed', finishReason: 'stop' },
          ]),
      undefined,
      async envelope => ({ ok: true, modelContent: `结果 ${envelope.callId}`, display }),
    )
    const generator = harness.run()
    const trace: string[] = []

    // 每拿到一个事件记下此刻已执行的工具数与模型调用数：证明事件与执行的先后。
    for await (const event of generator)
      trace.push(`${event.type}${'callId' in event ? `:${event.callId}` : ''} tools=${harness.toolInvocations.length} llm=${harness.llmCalls.length}`)

    assert.deepEqual(trace, [
      'run_started tools=0 llm=0',
      'tool_started:call-a tools=0 llm=1',
      'tool_finished:call-a tools=1 llm=1',
      'tool_started:call-b tools=1 llm=1',
      'tool_finished:call-b tools=2 llm=1',
      'assistant_delta tools=2 llm=2',
      'run_completed tools=2 llm=2',
    ])
  })

  it('AC-02 事件字段：started 带展示参数，finished 带 display；chat 流只带协议字段；display 不进 observation 与模型请求（#212 起按协议字段存进 tool Step）', async () => {
    const display = { finalUrl: 'https://ui-only.example/final', title: '界面标题', chars: 1234 }
    const harness = createHarness(
      (_, __, callIndex) => callIndex === 0
        ? toModelStream([
            toolCallEvent('call-a', 'web_fetch', '{"url":"https://a.example/"}'),
            { type: 'response_completed', finishReason: 'tool_calls' },
          ])
        : toModelStream([
            { type: 'text_delta', delta: '完成。' },
            { type: 'response_completed', finishReason: 'stop' },
          ]),
      undefined,
      // 工具在 display 里多带的字段（secret）不能出现在 chat 流里。
      async () => ({ ok: true, modelContent: '网页正文', display: { ...display, secret: 'ui-only-extra' } as ToolDisplay }),
    )

    const events = (await collectEvents(harness.run())).map(toChatStreamEvent)

    assert.deepEqual(events.filter(event => event.type.startsWith('tool_')), [
      {
        type: 'tool_started',
        conversationId: 'conversation-1',
        assistantMessageId: 'message-2',
        callId: 'call-a',
        toolName: 'web_fetch',
        url: 'https://a.example/',
      },
      {
        type: 'tool_finished',
        conversationId: 'conversation-1',
        assistantMessageId: 'message-2',
        callId: 'call-a',
        ok: true,
        ...display,
      },
    ])
    assert.deepEqual(findStep(harness, 'tool_execution')?.output, {
      ok: true,
      originalChars: 4,
      observationChars: 4,
      truncated: false,
      observation: '网页正文',
      display,
    })
    assert.doesNotMatch(JSON.stringify(harness.recorder.steps), /ui-only-extra/)
    assert.doesNotMatch(
      JSON.stringify(harness.llmCalls.map(call => call.messages)),
      /ui-only|界面标题|1234/,
    )
  })

  it('AC-03 截断批次、未知工具、参数无效、执行失败、display 标了失败的各发一对事件，failure=failed；工具超时 failure=timeout', async () => {
    const streams: Array<() => AsyncGenerator<ModelStreamEvent>> = [
      // 截断批次：arguments 不完整，整批不执行。
      () => adaptDeepSeekStream(toProviderStream([
        providerChunk({
          tool_calls: [{ index: 0, id: 'call-truncated', type: 'function', function: { name: 'web_search', arguments: '{"query":' } }],
        } as ChatCompletionChunk.Choice.Delta),
        providerChunk({}, 'length'),
      ])),
      () => toModelStream([
        toolCallEvent('call-unknown', 'hidden_tool', '{}', '推理', 0),
        toolCallEvent('call-invalid', 'web_search', '{"query":""}', '推理', 1),
        toolCallEvent('call-failed', 'web_search', '{"query":"a"}', '推理', 2),
        toolCallEvent('call-timeout', 'web_fetch', '{"url":"https://slow.example/"}', '推理', 3),
        toolCallEvent('call-unsupported', 'web_fetch', '{"url":"https://a.example/x.pdf"}', '推理', 4),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]),
      () => toModelStream([
        { type: 'text_delta', delta: '完成。' },
        { type: 'response_completed', finishReason: 'stop' },
      ]),
    ]
    const outcomes: Record<string, ToolResult> = {
      'call-invalid': { ok: false, code: 'invalid_arguments', modelContent: '参数无效。' },
      'call-failed': { ok: false, code: 'execution_failed', modelContent: '执行失败。' },
      'call-timeout': { ok: false, code: 'timeout', modelContent: '执行超时。' },
      // 模型拿到说明（ok），界面上由 display 标成失败。
      'call-unsupported': { ok: true, modelContent: '不支持的内容类型：application/pdf', display: { failure: 'failed' } },
    }
    const harness = createHarness(
      (_, __, callIndex) => streams[callIndex]!(),
      undefined,
      async envelope => outcomes[envelope.callId]!,
    )

    const events = await collectEvents(harness.run())
    const toolEvents = events
      .filter(event => event.type === 'tool_started' || event.type === 'tool_finished')
      .map(event => event.type === 'tool_started'
        ? `started:${event.callId}`
        : `finished:${event.callId}:${event.ok}:${event.failure}`)

    assert.deepEqual(toolEvents, [
      'started:call-truncated',
      'finished:call-truncated:false:failed',
      'started:call-unknown',
      'finished:call-unknown:false:failed',
      'started:call-invalid',
      'finished:call-invalid:false:failed',
      'started:call-failed',
      'finished:call-failed:false:failed',
      'started:call-timeout',
      'finished:call-timeout:false:timeout',
      'started:call-unsupported',
      'finished:call-unsupported:false:failed',
    ])
    assert.equal(events.at(-1)?.type, 'run_completed')
  })

  for (const interruption of ['用户停止', 'Run deadline'] as const) {
    it(`AC-04 同轮第二个工具执行中${interruption}：被打断的 call 只有 tool_started，终态事件照旧`, async () => {
      const abortController = new AbortController()
      const harness = createHarness(
        () => toModelStream([
          toolCallEvent('call-done', 'web_search', '{"query":"seo"}', '推理', 0),
          toolCallEvent('call-cut', 'web_search', '{"query":"sitemap"}', '推理', 1),
          { type: 'response_completed', finishReason: 'tool_calls' },
        ]),
        interruption === '用户停止' ? abortController.signal : undefined,
        async (envelope, context) => {
          if (envelope.callId === 'call-done')
            return { ok: true, modelContent: '已完成的结果。' }

          if (interruption === '用户停止')
            abortController.abort()
          await waitForAbort(context.signal)
          context.signal.throwIfAborted()
          return { ok: true, modelContent: '不会落库的结果。' }
        },
        interruption === 'Run deadline' ? { runDeadlineMs: 200 } : {},
      )

      const events = await collectEvents(harness.run())

      assert.deepEqual(events.map(event => event.type === 'tool_started' || event.type === 'tool_finished'
        ? `${event.type}:${event.callId}`
        : event.type), [
        'run_started',
        'tool_started:call-done',
        'tool_finished:call-done',
        'tool_started:call-cut',
        interruption === '用户停止' ? 'run_aborted' : 'run_failed',
      ])
      assertInterruptedToolSteps(harness, interruption === '用户停止' ? AgentStepStatus.ABORTED : AgentStepStatus.FAILED)
    })
  }

  it('消费者在 tool_started / tool_finished 处 return()：不留 RUNNING 的 Step，Run 收口为 ABORTED', async () => {
    for (const stopAt of ['tool_started', 'tool_finished'] as const) {
      const harness = createHarness(() => toModelStream([
        toolCallEvent('call-1', 'web_search', '{"query":"seo"}'),
        { type: 'response_completed', finishReason: 'tool_calls' },
      ]))
      const generator = harness.run()

      for (let result = await generator.next(); !result.done; result = await generator.next()) {
        if (result.value.type === stopAt)
          break
      }
      await generator.return(undefined)

      assert.deepEqual(harness.recorder.abortedRunIds, ['run-1'], stopAt)
      assert.equal(harness.toolInvocations.length, stopAt === 'tool_started' ? 0 : 1, stopAt)
      assertNoUnfinishedSteps(harness)
    }
  })
})

describe('刷新后还原要用的落库补齐（#212）', () => {
  it('AC-01 web_search / web_fetch 成功与自标失败时 tool Step 存 display；工具失败不存；observation 与模型请求不变', async () => {
    const searchDisplay: ToolDisplay = { results: [{ title: '来源\0标题', url: 'https://a.example/' }] }
    const fetchDisplay: ToolDisplay = { failure: 'failed', finalUrl: 'https://b.example/final' }
    const toolResults: Record<string, ToolResult> = {
      'call-search': { ok: true, modelContent: '搜索结果', display: searchDisplay },
      'call-fetch': { ok: true, modelContent: '不支持的内容类型', display: fetchDisplay },
      'call-broken': { ok: false, code: 'execution_failed', modelContent: '执行失败' },
    }
    const harness = createHarness(
      (_, __, callIndex) => callIndex === 0
        ? toModelStream([
            toolCallEvent('call-search', 'web_search', '{"query":"seo"}', '推理', 0),
            toolCallEvent('call-fetch', 'web_fetch', '{"url":"https://b.example/"}', '推理', 1),
            toolCallEvent('call-broken', 'web_search', '{"query":"x"}', '推理', 2),
            { type: 'response_completed', finishReason: 'tool_calls' },
          ])
        : toModelStream([
            { type: 'text_delta', delta: '完成。' },
            { type: 'response_completed', finishReason: 'stop' },
          ]),
      undefined,
      async envelope => toolResults[envelope.callId]!,
    )

    await collectEvents(harness.run())

    const outputs = harness.recorder.steps
      .filter(step => step.type === 'tool_execution')
      .map(step => step.output as Record<string, unknown>)

    // jsonb 存不了 U+0000：来自网页的标题同样换成 U+FFFD。
    assert.deepEqual(outputs[0]?.display, { results: [{ title: '来源�标题', url: 'https://a.example/' }] })
    assert.deepEqual(outputs[1]?.display, fetchDisplay)
    assert.equal(Object.hasOwn(outputs[2]!, 'display'), false)
    assert.deepEqual(outputs.map(output => output.observation), ['搜索结果', '不支持的内容类型', '执行失败'])
    // 下一轮模型请求里只有 observation，没有 display 的任何字段。
    assert.doesNotMatch(JSON.stringify(harness.llmCalls.map(call => call.messages)), /来源|a\.example|b\.example\/final/)
    assertNoUnfinishedSteps(harness)
  })

  it('AC-02 最后一轮的思考只进采样 Step：下一次对话的模型请求里历史仍只有消息', async () => {
    const harness = createHarness((_, __, callIndex) => toModelStream(callIndex === 0
      ? [
          { type: 'reasoning_started' },
          { type: 'reasoning_delta', delta: '最后一轮的思考' },
          { type: 'text_delta', delta: '第一轮回答' },
          { type: 'response_completed', finishReason: 'stop' },
        ]
      : [
          { type: 'text_delta', delta: '第二轮回答' },
          { type: 'response_completed', finishReason: 'stop' },
        ]))

    await collectEvents(harness.run())
    assert.equal((findStep(harness, 'model_sampling')?.output as Record<string, unknown>).reasoningContent, '最后一轮的思考')

    await collectEvents(harness.run())
    assert.deepEqual(harness.llmCalls[1]?.messages, [
      { type: 'message', role: 'user', content: '问题' },
      { type: 'message', role: 'assistant', content: '第一轮回答' },
      { type: 'message', role: 'user', content: '问题' },
    ])
    assert.doesNotMatch(JSON.stringify(harness.llmCalls[1]?.messages), /最后一轮的思考/)
  })

  it('AC-02 停止或失败的一轮：已推给界面的思考同样存进它的采样 Step（管理台不当作回填内容）', async () => {
    const reasoningOf = async (events: ModelStreamEvent[], stopAfter?: number) => {
      const controller = new AbortController()
      const harness = createHarness(
        () => (async function* () {
          for (const [index, event] of events.entries()) {
            yield event
            if (stopAfter === index)
              controller.abort()
          }
        })(),
        controller.signal,
      )

      await collectEvents(harness.run())
      assertNoUnfinishedSteps(harness)

      const output = findStep(harness, 'model_sampling')?.output as Record<string, unknown>
      const projected = projectHarnessRunDetail(harness, 'FAILED').timeline.find(item => item.type === 'model_sampling')

      return [output.reasoningContent, projected && 'reasoningContent' in projected ? projected.reasoningContent : 'missing']
    }
    const thinking: ModelStreamEvent[] = [
      { type: 'reasoning_started' },
      { type: 'reasoning_delta', delta: '想了\0很久' },
      { type: 'reasoning_delta', delta: '还没想完' },
    ]

    // 缺 response_completed（流读取失败）、思考中途停止：存的是推给界面的同一份原文（已替换 U+0000）。
    assert.deepEqual(await reasoningOf(thinking), ['想了\uFFFD很久还没想完', null])
    assert.deepEqual(await reasoningOf(thinking, 1), ['想了\uFFFD很久', null])
    assert.deepEqual(await reasoningOf(thinking.slice(0, 1), 0), [undefined, null])
  })

  it('AC-03 answerStartedMs 从 run_started 起算到第一段正文（假时钟）：先思考后正文时不等于 firstTokenMs，只有空白不算', async () => {
    const clock = useFakeClock()
    const harness = createHarness(() => clock.stream([
      [1_000, { type: 'reasoning_started' }],
      [1_500, { type: 'reasoning_delta', delta: '想一想' }],
      [3_000, { type: 'text_delta', delta: '\n' }],
      [4_200, { type: 'text_delta', delta: '答' }],
      [4_300, { type: 'response_completed', finishReason: 'stop' }],
    ]))

    await collectEvents(harness.run())

    const output = findStep(harness, 'model_sampling')?.output as Record<string, unknown>

    assert.equal(output.answerStartedMs, 4_200)
    assert.equal(output.firstTokenMs, 1_000)
  })

  it('AC-03 正文在 Tool Call 轮开始时，此后收口的采样 Step 都带同一个值', async () => {
    const clock = useFakeClock()
    const harness = createHarness((_, __, callIndex) => clock.stream(callIndex === 0
      ? [
          [1_200, { type: 'text_delta', delta: '先查一下。' }],
          [1_300, toolCallEvent('call-1', 'web_search', '{"query":"seo"}')],
          [1_400, { type: 'response_completed', finishReason: 'tool_calls' }],
        ]
      : [
          [3_000, { type: 'text_delta', delta: '结论。' }],
          [3_100, { type: 'response_completed', finishReason: 'stop' }],
        ]))

    await collectEvents(harness.run())

    assert.deepEqual(
      harness.recorder.steps
        .filter(step => step.type === 'model_sampling')
        .map(step => (step.output as Record<string, unknown>).answerStartedMs),
      [1_200, 1_200],
    )
  })

  it('AC-03 没出正文就失败或停止时不写 answerStartedMs；出了正文再停止时写', async () => {
    const answerStartedMsOf = async (events: Array<[number, ModelStreamEvent]>, stopAfter?: number) => {
      const clock = useFakeClock()
      const controller = new AbortController()
      const harness = createHarness(
        () => clock.stream(events, { stopAfter, controller }),
        controller.signal,
      )

      await collectEvents(harness.run())
      assertNoUnfinishedSteps(harness)

      return (findStep(harness, 'model_sampling')?.output as Record<string, unknown>).answerStartedMs
    }
    const thinking: Array<[number, ModelStreamEvent]> = [
      [1_000, { type: 'reasoning_started' }],
      [2_000, { type: 'reasoning_delta', delta: '想一想' }],
    ]

    // 流读取失败（缺 response_completed）、正文前停止：都没有正文。
    assert.equal(await answerStartedMsOf(thinking), undefined)
    assert.equal(await answerStartedMsOf(thinking, 1), undefined)
    assert.equal(await answerStartedMsOf([...thinking, [2_500, { type: 'text_delta', delta: '部分' }]], 2), 2_500)
  })
})

/**
 * 只假时钟（Date 给首 token 时间，performance 给 #212 的「用时」）：定时器仍是真的，deadline 与 sleep 照常工作。
 * stream 按给定时刻（从创建时起算）推进时钟再吐事件；stopAfter 指定在第几个事件之后停止（abort）。
 */
function useFakeClock() {
  let elapsed = 0

  vi.useFakeTimers({ toFake: ['Date', 'performance'] })
  onTestFinished(() => {
    vi.useRealTimers()
  })

  return {
    async* stream(
      events: Array<[number, ModelStreamEvent]>,
      stop: { stopAfter?: number | undefined, controller?: AbortController } = {},
    ): AsyncGenerator<ModelStreamEvent> {
      for (const [index, [at, event]] of events.entries()) {
        vi.advanceTimersByTime(at - elapsed)
        elapsed = at
        yield event
        if (stop.stopAfter === index)
          stop.controller?.abort()
      }
    },
  }
}

describe('上下文自动压缩（#220）', () => {
  /** 触发线 4,000 的模型：用例按粗估（ASCII 每 4 个字符 1 token）构造体积。 */
  const SMALL_MODEL: ResolvedLlmModel = { ...createResolvedLlmModel(), maxInputTokens: 4_000 }
  const SUMMARY_TEXT = '## Goal\n- 摘要正文'

  type Harness = ReturnType<typeof createHarness>
  type StreamFactory = (index: number, messages: ModelInputItem[], options: ChatStreamOptions | undefined) => AsyncGenerator<ModelStreamEvent>

  function isSummaryCall(messages: ModelInputItem[]): boolean {
    const [first] = messages

    return first?.type === 'message' && first.role === 'system' && first.content === SUMMARIZATION_SYSTEM_PROMPT
  }

  /** 摘要调用与采样调用分开计数、分开给流。 */
  function routed(input: { sampling: StreamFactory, summary?: StreamFactory }): CreateModelStream {
    let samplingIndex = 0
    let summaryIndex = 0

    return (messages, options) => isSummaryCall(messages)
      ? (input.summary ?? (() => toModelStream(summaryEvents())))(summaryIndex++, messages, options)
      : input.sampling(samplingIndex++, messages, options)
  }

  function summaryEvents(text = SUMMARY_TEXT): ModelStreamEvent[] {
    return [
      { type: 'text_delta', delta: text },
      { type: 'usage', usage: { inputTokens: 900, outputTokens: 60 } },
      { type: 'response_completed', finishReason: 'stop' },
    ]
  }

  function finalAnswer(text = '好的。'): AsyncGenerator<ModelStreamEvent> {
    return toModelStream([{ type: 'text_delta', delta: text }, { type: 'response_completed', finishReason: 'stop' }])
  }

  function toolRound(callId: string): AsyncGenerator<ModelStreamEvent> {
    return toModelStream([toolCallEvent(callId, 'web_fetch', '{"url":"https://example.com/"}'), { type: 'response_completed', finishReason: 'tool_calls' }])
  }

  async function* failingStream(error: unknown, events: ModelStreamEvent[] = []): AsyncGenerator<ModelStreamEvent> {
    yield* events
    throw error
  }

  /** 之前的问答：每组一问一答，回答是 answerChars 个 ASCII 字符（约 answerChars / 4 token），Run 都已完成。 */
  function seedHistory(harness: Harness, count: number, answerChars: number): void {
    for (let index = 1; index <= count; index += 1) {
      harness.prisma.seedMessage({ id: `u${index}`, content: `第 ${index} 问`, status: MessageStatus.COMPLETED, createdAt: new Date(Date.UTC(2026, 8, 29, 0, 0, index * 2)) })
      harness.prisma.seedMessage({ id: `a${index}`, role: MessageRole.ASSISTANT, content: `${index}`.padEnd(answerChars, 'x'), status: MessageStatus.COMPLETED, createdAt: new Date(Date.UTC(2026, 8, 29, 0, 0, index * 2 + 1)) })
      harness.prisma.historyRuns.push(historyRun(`r${index}`, `u${index}`, `a${index}`))
    }
  }

  function run(harness: Harness, options: {
    userContent?: string
    instructions?: MessageInputItem[]
    model?: ResolvedLlmModel
    keepRecentTokens?: number
    runDeadlineMs?: number
    signal?: AbortSignal
  } = {}): Promise<AgentRuntimeEvent[]> {
    return collectEvents(harness.service.runTurnStream({
      conversationId: 'conversation-1',
      userContent: options.userContent ?? '新问题',
      instructions: options.instructions ?? [],
      model: options.model ?? SMALL_MODEL,
      runtimeConfig: createRuntimeConfigSnapshot({
        compactionKeepRecentTokens: options.keepRecentTokens ?? 20_000,
        limits: { runDeadlineMs: options.runDeadlineMs ?? 600_000 },
      }),
      ...(options.signal ? { signal: options.signal } : {}),
    }))
  }

  const stepTrail = (harness: Harness) => harness.recorder.steps.map(step => [step.type, step.status])
  const samplingCalls = (harness: Harness) => harness.llmCalls.filter(call => !isSummaryCall(call.messages))
  const summaryCalls = (harness: Harness) => harness.llmCalls.filter(call => isSummaryCall(call.messages))
  const compactionSteps = (harness: Harness) => harness.recorder.steps.filter(step => step.type === 'context_compaction')
  const userMessage = (content: string): ModelInputItem => ({ type: 'message', role: 'user', content })
  const answer = (content: string): ModelInputItem => ({ type: 'message', role: 'assistant', content })

  it('AC-06 检查点 A：run_started 之后、开采样 Step 之前把较早的问答写成摘要，这次调用就用上；AC-04 摘要请求用 Run 的模型快照、不带工具、关掉 DeepSeek 思考', async () => {
    const harness = createHarness(routed({ sampling: () => finalAnswer() }))
    const question = 'q'.repeat(10_000)

    // 当前问题约 2,500 token + 6 组各约 253 token + 工具定义 190，超过触发线 4,000；
    // 保留预算 min(20,000, 1,000) 放得下最新三组，较早的三组一块就能摘要完。
    seedHistory(harness, 6, 1_000)

    const events = await run(harness, { userContent: question })

    assert.deepEqual(events.map(event => event.type), ['run_started', 'assistant_delta', 'run_completed'])
    assert.deepEqual(stepTrail(harness), [
      ['load_conversation_history', AgentStepStatus.COMPLETED],
      ['context_compaction', AgentStepStatus.COMPLETED],
      ['model_sampling', AgentStepStatus.COMPLETED],
      ['assistant_output', AgentStepStatus.COMPLETED],
    ])

    const [step] = compactionSteps(harness)
    const output = step?.output as Record<string, unknown>
    const [record] = harness.prisma.compactions

    assert.deepEqual(step?.input, { kind: 'history' })
    assert.deepEqual({ ...output, durationMs: typeof output.durationMs }, {
      compactionId: 'compaction-1',
      tokensBefore: output.tokensBefore,
      usage: { inputTokens: 900, outputTokens: 60 },
      durationMs: 'number',
    })
    assert.ok((output.tokensBefore as number) > 4_000, 'tokensBefore 是触发这次压缩的估算')
    assert.deepEqual({ ...record, createdAt: undefined }, {
      id: 'compaction-1',
      conversationId: 'conversation-1',
      runId: 'run-1',
      reason: 'threshold',
      summary: SUMMARY_TEXT,
      coveredGroupIds: ['u1', 'u2', 'u3'],
      answerOnlyGroupId: null,
      readAt: harness.prisma.readAt,
      tokensBefore: output.tokensBefore,
      usage: { inputTokens: 900, outputTokens: 60 },
      modelId: SMALL_MODEL.modelId,
      createdAt: undefined,
    })

    // 这次调用：摘要消息 + 保留的最新三组 + 当前问题；contextPlan 记下基于哪条记录。
    assert.deepEqual(samplingCalls(harness)[0]?.messages, [
      historySummaryMessage(SUMMARY_TEXT),
      ...[4, 5, 6].flatMap(index => [userMessage(`第 ${index} 问`), answer(`${index}`.padEnd(1_000, 'x'))]),
      userMessage(question),
    ])
    assert.deepEqual(
      { ...readContextPlan(findStep(harness, 'model_sampling')), estimatedInputTokens: undefined },
      { resolvedInputBudgetTokens: 4_000, estimatedInputTokens: undefined, compactionId: 'compaction-1', turnCompactionStepId: null, historyIncludedCount: 6 },
    )

    // 摘要请求：Run 的模型与服务商、不带工具、思考关掉、输出上限 min(13107, 最大输出)。
    const [summary] = summaryCalls(harness)

    assert.equal(summary?.provider, SMALL_MODEL.provider)
    assert.deepEqual(summary?.options?.request, {
      model: 'deepseek-v4-flash',
      contextWindowTokens: 1_000_000,
      maxOutputTokens: 13_107,
      compat: familyCompatOf('deepseek'),
      thinking: 'disabled',
    })
    assert.equal(summary?.options?.tools, undefined)
    assert.equal(summary?.messages.length, 2)
    assert.match((summary?.messages[1] as { content: string }).content, /^<conversation>\n\[User\] \(2026-09-29\): 第 1 问\n\n\[Assistant\]: 1x+\n\n\[User\] \(2026-09-29\): 第 2 问/)
    assert.match((summary?.messages[1] as { content: string }).content, /\n<\/conversation>\n\nThe messages above are a conversation to summarize\./)
    assertNoUnfinishedSteps(harness)
  })

  it('AC-04 其他家族取最低一档 reasoning_effort、列表为空不发；输出上限不超过模型最大输出', async () => {
    const cases = [
      { family: 'openai', expected: { reasoningEffort: 'low' } },
      { family: 'gemini', expected: {} },
    ] as const

    for (const { family, expected } of cases) {
      const harness = createHarness(routed({ sampling: () => finalAnswer() }))
      const model = { ...createResolvedLlmModel({ compat: familyCompatOf(family), maxOutputTokens: 8_192 }), family, maxInputTokens: 4_000 }

      seedHistory(harness, 8, 2_000)
      await run(harness, { model })

      assert.deepEqual(summaryCalls(harness)[0]?.options?.request, {
        model: 'deepseek-v4-flash',
        contextWindowTokens: 1_000_000,
        maxOutputTokens: 8_192,
        compat: familyCompatOf(family),
        ...expected,
      }, family)
    }
  })

  it('AC-04 / AC-08(a) 摘要失败（length、正文为空、5xx 重试耗尽、网络错误）：记 FAILED 的压缩 Step，这次按未压缩的内容照常回答', async () => {
    const cases: Array<[string, () => AsyncGenerator<ModelStreamEvent>, RegExp]> = [
      ['length', () => toModelStream([{ type: 'text_delta', delta: '半截' }, { type: 'response_completed', finishReason: 'length' }]), /^写摘要失败：模型输出达到长度限制/],
      ['空正文', () => toModelStream([{ type: 'text_delta', delta: '  ' }, { type: 'response_completed', finishReason: 'stop' }]), /^写摘要失败：摘要正文为空。$/],
      ['5xx', () => failingStream(new LLMServerError(503)), /^写摘要失败：服务商服务器繁忙（503）/],
      ['网络错误', () => failingStream(new LLMNetworkError(new Error('socket hang up'))), /^写摘要失败：LLM API 网络请求失败/],
    ]

    for (const [label, summary, reason] of cases) {
      const harness = createHarness(routed({ sampling: () => finalAnswer(), summary }))

      seedHistory(harness, 8, 2_000)

      const events = await run(harness)
      const [step] = compactionSteps(harness)

      assert.equal(events.at(-1)?.type, 'run_completed', label)
      assert.equal(step?.status, AgentStepStatus.FAILED, label)
      assert.match(step?.errorMessage ?? '', reason, label)
      assert.equal(harness.prisma.compactions.length, 0, label)
      // 没压缩：全部 8 组原样发出。
      assert.equal(samplingCalls(harness)[0]?.messages.length, 17, label)
      assert.equal(readContextPlan(findStep(harness, 'model_sampling')).compactionId, null, label)
      assertNoUnfinishedSteps(harness)
    }
  })

  it('AC-08(i) 长会话首次提问：按整组分块逐块摘要（第 2 块起用 UPDATE 滚动），每块一条完整记录、覆盖范围逐块累计，本次问答成功', async () => {
    const harness = createHarness(routed({
      sampling: () => finalAnswer(),
      summary: index => toModelStream(summaryEvents(`摘要 ${index + 1}`)),
    }))

    // 30 组各约 503 token，共约 15,000，远超触发线 4,000；块预算 0.5 × 4,000 = 2,000，每块放得下 3 组。
    seedHistory(harness, 30, 2_000)

    const events = await run(harness)
    const records = harness.prisma.compactions
    const requests = summaryCalls(harness).map(call => (call.messages[1] as { content: string }).content)

    assert.equal(events.at(-1)?.type, 'run_completed')
    assert.deepEqual(records.map(record => record.coveredGroupIds.length), [3, 6, 9, 12, 15, 18, 21, 24, 27, 29])
    assert.deepEqual(records.at(-1)?.coveredGroupIds, Array.from({ length: 29 }, (_, index) => `u${index + 1}`))
    assert.ok(records.every(record => record.readAt.getTime() === harness.prisma.readAt.getTime() && record.reason === 'threshold' && record.answerOnlyGroupId === null))
    assert.deepEqual(
      compactionSteps(harness).map(step => [step.status, (step.output as { compactionId: string }).compactionId]),
      records.map(record => [AgentStepStatus.COMPLETED, record.id]),
    )
    for (const [index, request] of requests.entries()) {
      const conversation = request.slice(0, request.indexOf('</conversation>'))

      assert.ok(roughTokens(conversation) <= 2_000, `第 ${index + 1} 块 ${roughTokens(conversation)} token`)
      if (index === 0)
        assert.doesNotMatch(request, /<previous-summary>/)
      else
        assert.match(request, new RegExp(`</conversation>\\n\\n<previous-summary>\\n摘要 ${index}\\n</previous-summary>\\n\\nThe messages above are NEW conversation messages`))
    }
    assert.deepEqual(samplingCalls(harness)[0]?.messages, [
      historySummaryMessage('摘要 10'),
      userMessage('第 30 问'),
      answer('30'.padEnd(2_000, 'x')),
      userMessage('新问题'),
    ])
    assert.equal(readContextPlan(findStep(harness, 'model_sampling')).compactionId, records.at(-1)?.id)
    assertNoUnfinishedSteps(harness)
  })

  it('AC-06 检查点 B：run_completed 之后在后台发起、不被等待，只在下一次问答的历史超过触发线 0.8 时压缩；下一次问答不等它', async () => {
    const release = createDeferred()
    const completedWhenBStarted: boolean[] = []
    const harness = createHarness(routed({
      sampling: () => finalAnswer(),
      async* summary() {
        completedWhenBStarted.push(harness.recorder.completedRunIds.length > 0)
        await release.promise
        yield* summaryEvents('## Goal\n- 后台摘要')
      },
    }))

    // 工具定义按真实清单粗估；模型预算加 3,800，初次采样不超线、后台超过 0.8。
    // 固定保留预算 1,000，工具描述扩展不能改变该测试预期的历史切点。
    const instructions: MessageInputItem[] = [{ type: 'message', role: 'system', content: 's'.repeat(6_000) }]

    seedHistory(harness, 4, 1_600)

    const toolTokens = estimateRequestTokens({ items: [], tools: TOOL_DEFINITIONS.map(definition => ({ name: definition.name, description: definition.description, inputSchema: definition.input.schema })) })
    const config = { instructions, model: { ...SMALL_MODEL, maxInputTokens: toolTokens + 3800 }, keepRecentTokens: 1000 }
    const events = await run(harness, config)

    assert.equal(events.at(-1)?.type, 'run_completed')
    assert.equal(compactionSteps(harness).length, 0)
    assert.equal(harness.afterRunCompactions.length, 1)
    // run_completed 已推出，B 还卡在摘要调用里：没有记录。
    await sleep(0)
    assert.deepEqual(completedWhenBStarted, [true])
    assert.equal(harness.prisma.compactions.length, 0)

    // 下一次问答不等 B：它自己的估算没超触发线，直接用当时的历史。
    const second = await run(harness, { userContent: '再问一句', ...config })

    assert.equal(second.at(-1)?.type, 'run_completed')
    assert.equal(harness.prisma.compactions.length, 0)

    release.resolve()
    await Promise.all(harness.afterRunCompactions)

    const [record] = harness.prisma.compactions

    assert.deepEqual(
      [record?.reason, record?.runId, record?.summary, record?.coveredGroupIds],
      ['after_run', 'run-1', '## Goal\n- 后台摘要', ['u1', 'u2']],
    )
    // B 不写 Step。
    assert.equal(compactionSteps(harness).length, 0)
  })

  it('AC-06 检查点 B：下一次问答的历史没超过触发线 0.8 时只读不压', async () => {
    const harness = createHarness(routed({ sampling: () => finalAnswer() }))

    seedHistory(harness, 3, 2_000)
    await run(harness)
    await Promise.all(harness.afterRunCompactions)

    assert.equal(summaryCalls(harness).length, 0)
    assert.equal(harness.prisma.compactions.length, 0)
  })

  it('AC-08(g) 后台压缩的上游卡住到时限结束、写表时库不可用：都只记日志，Promise 不拒绝', async () => {
    for (const failure of ['上游卡住', '库不可用'] as const) {
      const harness = createHarness(routed({
        sampling: () => finalAnswer(),
        summary: failure === '上游卡住'
          ? async function* (_index, _messages, options) {
            await waitForAbort(options!.signal!)
            yield* failingStream(new Error('摘要请求被取消'))
          }
          : () => toModelStream(summaryEvents()),
      }))
      const warnings: Array<Record<string, unknown>> = []

      Object.defineProperty(harness.compactionService, 'logger', { value: { warn: (warning: Record<string, unknown>) => warnings.push(warning) } })
      if (failure === '库不可用')
        harness.prisma.compactionCreateError = new Error('database unavailable')
      seedHistory(harness, 6, 2_100)
      // 后台时限取本 Run 快照的单次最长时间。
      const toolTokens = estimateRequestTokens({ items: [], tools: TOOL_DEFINITIONS.map(definition => ({ name: definition.name, description: definition.description, inputSchema: definition.input.schema })) })
      await run(harness, { runDeadlineMs: 200, model: { ...SMALL_MODEL, maxInputTokens: toolTokens + 3800 } })
      await Promise.all(harness.afterRunCompactions)

      assert.equal(harness.prisma.compactions.length, 0, failure)
      assert.deepEqual(warnings.map(warning => [warning.event, warning.runId, typeof warning.durationMs]), [
        ['after_run_compaction_failed', 'run-1', 'number'],
      ], failure)
    }
  })

  it('AC-08(h) 后台任务随进程重启丢失：下一次提问由检查点 A 同步压缩，结果正确', async () => {
    const toolTokens = estimateRequestTokens({ items: [], tools: TOOL_DEFINITIONS.map(definition => ({ name: definition.name, description: definition.description, inputSchema: definition.input.schema })) })
    const model = { ...SMALL_MODEL, maxInputTokens: toolTokens + 3800 }
    // 第一次问答的回答较长：它把历史推过触发线，本该由检查点 B 预压。
    const harness = createHarness(routed({ sampling: index => finalAnswer(index === 0 ? 'y'.repeat(2_000) : '好的。') }))

    // 模拟丢失：检查点 B 什么都没做。
    harness.compactionService.compactAfterRun = async () => {}
    seedHistory(harness, 7, 2_000)
    await run(harness, { userContent: '第一问（这次）', model })

    assert.equal(harness.prisma.compactions.length, 0)

    await run(harness, { userContent: '下一问', model })

    const [record] = harness.prisma.compactions

    assert.equal(record?.reason, 'threshold')
    assert.deepEqual(samplingCalls(harness).at(-1)?.messages.at(0), historySummaryMessage(SUMMARY_TEXT))
    assert.deepEqual(samplingCalls(harness).at(-1)?.messages.at(-1), userMessage('下一问'))
  })

  it('AC-06 检查点 C：服务商报超长时失败的采样照常收口、不推失败事件，强制压缩后新开采样重试成功；管理台轨迹照常投影', async () => {
    // 触发线 8,000：估算没超线，检查点 A 不压；服务商按自己的上限报超长。
    const model = { ...SMALL_MODEL, maxInputTokens: 8_000 }
    const harness = createHarness(routed({
      sampling: index => index === 0 ? failingStream(new LLMContextOverflowError(400)) : finalAnswer(),
    }))

    seedHistory(harness, 8, 2_000)

    const events = await run(harness, { model })
    const failedSampling = harness.recorder.steps.find(step => step.type === 'model_sampling')

    assert.deepEqual(events.map(event => event.type), ['run_started', 'assistant_delta', 'run_completed'])
    assert.deepEqual(stepTrail(harness), [
      ['load_conversation_history', AgentStepStatus.COMPLETED],
      ['model_sampling', AgentStepStatus.FAILED],
      ['context_compaction', AgentStepStatus.COMPLETED],
      ['model_sampling', AgentStepStatus.COMPLETED],
      ['assistant_output', AgentStepStatus.COMPLETED],
    ])
    assert.equal(failedSampling?.errorMessage, getAiExceptionMessage(new LLMContextOverflowError(400)))
    assert.equal((failedSampling?.output as Record<string, unknown>).errorCode, 'llm_context_overflow')
    assert.equal(harness.prisma.compactions[0]?.reason, 'overflow')
    assert.deepEqual(samplingCalls(harness)[1]?.messages[0], historySummaryMessage(SUMMARY_TEXT))
    assert.deepEqual(harness.recorder.completedRunIds, ['run-1'])
    assertNoUnfinishedSteps(harness)

    const samplingItems = projectHarnessRunDetail(harness, 'COMPLETED').timeline.flatMap(item => item.kind === 'known' && item.type === 'model_sampling' ? [item] : [])

    assert.deepEqual(samplingItems.map(item => [item.samplingIndex, item.errorCode]), [[1, 'llm_context_overflow'], [2, null]])
  })

  it('AC-08(b) 连续两次报超长、或强制压缩失败：Run 以 llm_context_overflow 失败并正常收口，前台显示超长文案', async () => {
    const overflowMessage = getAiExceptionMessage(new LLMContextOverflowError(400))
    const model = { ...SMALL_MODEL, maxInputTokens: 8_000 }
    const cases: Array<[string, Parameters<typeof routed>[0], string[][]]> = [
      ['连续两次超长', { sampling: () => failingStream(new LLMContextOverflowError(400)) }, [
        ['load_conversation_history', AgentStepStatus.COMPLETED],
        ['model_sampling', AgentStepStatus.FAILED],
        ['context_compaction', AgentStepStatus.COMPLETED],
        ['model_sampling', AgentStepStatus.FAILED],
      ]],
      ['强制压缩失败', {
        sampling: () => failingStream(new LLMContextOverflowError(400)),
        summary: () => toModelStream([{ type: 'response_completed', finishReason: 'length' }]),
      }, [
        ['load_conversation_history', AgentStepStatus.COMPLETED],
        ['model_sampling', AgentStepStatus.FAILED],
        ['context_compaction', AgentStepStatus.FAILED],
      ]],
    ]

    for (const [label, streams, trail] of cases) {
      const harness = createHarness(routed(streams))

      seedHistory(harness, 8, 2_000)

      const events = await run(harness, { model })
      const failed = events.at(-1)

      assert.equal(failed?.type, 'run_failed', label)
      assert.equal(failed?.type === 'run_failed' ? failed.message : undefined, overflowMessage, label)
      assert.equal(harness.recorder.runErrorCode, 'llm_context_overflow', label)
      assert.deepEqual(stepTrail(harness), trail, label)
      assert.equal(harness.assistantMessage()?.status, MessageStatus.FAILED, label)
      assertNoUnfinishedSteps(harness)
    }
  })

  it('AC-08(f) 本次采样已推出 delta（含思考）后遇到超长：不重试，按失败收口', async () => {
    for (const pushed of [
      { type: 'text_delta', delta: '先说一半' },
      { type: 'reasoning_delta', delta: '想了一半' },
    ] as ModelStreamEvent[]) {
      const harness = createHarness(routed({ sampling: () => failingStream(new LLMContextOverflowError(undefined), [pushed]) }))

      seedHistory(harness, 8, 2_000)

      const events = await run(harness, { model: { ...SMALL_MODEL, maxInputTokens: 8_000 } })

      assert.equal(events.at(-1)?.type, 'run_failed', pushed.type)
      assert.equal(compactionSteps(harness).length, 0, pushed.type)
      assert.equal(samplingCalls(harness).length, 1, pushed.type)
      assert.equal(harness.recorder.runErrorCode, 'llm_context_overflow', pushed.type)
    }
  })

  it('AC-06 成功采样后再次超长可以再救一次；AC-07 C 的强制压缩后、重试成功前 A 不再压', async () => {
    const summaries: string[] = []
    const harness = createHarness(routed({
      sampling: (index) => {
        switch (index) {
          case 0: return toModelStream([toolCallEvent('call-1', 'web_fetch', '{"url":"https://a.example/"}'), { type: 'usage', usage: { inputTokens: 10, outputTokens: 1 } }, { type: 'response_completed', finishReason: 'tool_calls' }])
          case 1: return toModelStream([toolCallEvent('call-2', 'web_fetch', '{"url":"https://b.example/"}'), { type: 'usage', usage: { inputTokens: 10, outputTokens: 1 } }, { type: 'response_completed', finishReason: 'tool_calls' }])
          case 2: return failingStream(new LLMContextOverflowError(400))
          case 3: return toModelStream([toolCallEvent('call-3', 'web_fetch', '{"url":"https://c.example/"}'), { type: 'usage', usage: { inputTokens: 10, outputTokens: 1 } }, { type: 'response_completed', finishReason: 'tool_calls' }])
          case 4: return failingStream(new LLMContextOverflowError(400))
          default: return finalAnswer()
        }
      },
      summary: (index, messages) => {
        summaries.push((messages[1] as { content: string }).content)
        // 第 2 次（本轮）失败：历史那层成了，强制压缩仍算压成。
        return index === 1
          ? toModelStream([{ type: 'response_completed', finishReason: 'length' }])
          : toModelStream(summaryEvents(`摘要 ${index}`))
      },
    }), undefined, async () => ({ ok: true, modelContent: 'z'.repeat(12_000) }))

    // 用量锚点很小：检查点 A 的估算一直不超线；服务商按自己的上限报超长。历史一块就能摘要完。
    seedHistory(harness, 6, 1_000)

    const events = await run(harness, { keepRecentTokens: 10 })

    assert.equal(events.at(-1)?.type, 'run_completed')
    assert.deepEqual(stepTrail(harness).filter(([type]) => type !== 'tool_execution'), [
      ['load_conversation_history', AgentStepStatus.COMPLETED],
      ['model_sampling', AgentStepStatus.COMPLETED],
      ['model_sampling', AgentStepStatus.COMPLETED],
      // 第 1 次超长：历史层压成，本轮层失败；重试前检查点 A 不再压（仍超线、本轮也有新内容）。
      ['model_sampling', AgentStepStatus.FAILED],
      ['context_compaction', AgentStepStatus.COMPLETED],
      ['context_compaction', AgentStepStatus.FAILED],
      ['model_sampling', AgentStepStatus.COMPLETED],
      // 重试成功后再次超长：再救一次（本轮层）。
      ['model_sampling', AgentStepStatus.FAILED],
      ['context_compaction', AgentStepStatus.COMPLETED],
      ['model_sampling', AgentStepStatus.COMPLETED],
      ['assistant_output', AgentStepStatus.COMPLETED],
    ])
    assert.equal(summaries.length, 3)
    assert.deepEqual(compactionSteps(harness).map(step => (step.input as { kind: string }).kind), ['history', 'turn', 'turn'])
  })

  it('AC-07 两层都没有新内容时不压、不算一次尝试：当前问题本身就超线', async () => {
    const harness = createHarness(routed({ sampling: () => finalAnswer() }))
    const events = await run(harness, { userContent: 'q'.repeat(20_000) })

    assert.equal(events.at(-1)?.type, 'run_completed')
    assert.equal(compactionSteps(harness).length, 0)
    assert.equal(summaryCalls(harness).length, 0)
  })

  it('AC-07 连续 2 次无效后停用阈值压缩、只剩 C；AC-09 超线时不删历史、不截短工具结果', async () => {
    const harness = createHarness(routed({
      sampling: index => index < 2 ? toolRound(`call-${index}`) : index === 2 ? failingStream(new LLMContextOverflowError(400)) : finalAnswer(),
      summary: index => index < 2
        ? toModelStream([{ type: 'response_completed', finishReason: 'length' }])
        : toModelStream(summaryEvents()),
    }), undefined, async () => ({ ok: true, modelContent: 'o'.repeat(8_000) }))

    // 当前问题约 3,000 token，5 组历史约 1,265 token（一块就能摘要完），合起来超过触发线。
    seedHistory(harness, 5, 1_000)

    const events = await run(harness, { keepRecentTokens: 10, userContent: 'q'.repeat(12_000) })

    assert.equal(events.at(-1)?.type, 'run_completed')
    assert.deepEqual(stepTrail(harness).filter(([type]) => type !== 'tool_execution'), [
      ['load_conversation_history', AgentStepStatus.COMPLETED],
      ['context_compaction', AgentStepStatus.FAILED],
      ['model_sampling', AgentStepStatus.COMPLETED],
      ['context_compaction', AgentStepStatus.FAILED],
      ['model_sampling', AgentStepStatus.COMPLETED],
      // 已停用：超线也不再压；服务商报超长时 C 照常救（先历史、压完仍超线再本轮）。
      ['model_sampling', AgentStepStatus.FAILED],
      ['context_compaction', AgentStepStatus.COMPLETED],
      ['context_compaction', AgentStepStatus.COMPLETED],
      ['model_sampling', AgentStepStatus.COMPLETED],
      ['assistant_output', AgentStepStatus.COMPLETED],
    ])
    // 压缩失败期间：5 组历史全部原样发出，工具结果也不截短。
    const third = samplingCalls(harness)[2]!.messages

    assert.equal(third.filter(item => item.type === 'message').length, 11)
    assert.deepEqual(third.filter(item => item.type === 'tool_result').map(item => item.content.length), [8_000, 8_000])
  })

  it('AC-07 一次有效压缩把连续无效计数清零', async () => {
    const harness = createHarness(routed({
      sampling: index => index < 5 ? toolRound(`call-${index}`) : finalAnswer(),
      // 历史失败 → 历史成功（有效，清零）→ 本轮失败 → 本轮失败（第 2 次连续无效，停用）。
      summary: index => index === 1 ? toModelStream(summaryEvents()) : toModelStream([{ type: 'response_completed', finishReason: 'length' }]),
    }), undefined, async () => ({ ok: true, modelContent: 'o'.repeat(2_000) }))

    // 当前问题约 2,500 token + 6 组历史约 1,518 token：第 1 次调用前就超线；历史压成后回到线内（有效）。
    seedHistory(harness, 6, 1_000)
    await run(harness, { keepRecentTokens: 10, userContent: 'q'.repeat(10_000) })

    assert.deepEqual(compactionSteps(harness).map(step => [(step.input as { kind: string }).kind, step.status]), [
      ['history', AgentStepStatus.FAILED],
      ['history', AgentStepStatus.COMPLETED],
      ['turn', AgentStepStatus.FAILED],
      ['turn', AgentStepStatus.FAILED],
    ])
  })

  it('AC-07 长工具循环：工具结果持续增长，同一 Run 内本轮压缩 ≥ 3 次后正常给出最终回答；首次 TURN_PREFIX，之后 UPDATE 滚动', async () => {
    const harness = createHarness(routed({
      sampling: index => index < 14 ? toolRound(`call-${index + 1}`) : finalAnswer('全部看完了。'),
      summary: (index, messages) => {
        void messages
        return toModelStream(summaryEvents(`前缀摘要 ${index + 1}`))
      },
    }), undefined, async () => ({ ok: true, modelContent: 'w'.repeat(4_000) }))
    const events = await run(harness)
    const turns = compactionSteps(harness)
    const requests = summaryCalls(harness)

    assert.equal(events.at(-1)?.type, 'run_completed')
    assert.equal(harness.assistantMessage()?.content, '全部看完了。')
    assert.ok(turns.length >= 3, `本轮压缩 ${turns.length} 次`)
    assert.ok(turns.every(step => step.status === AgentStepStatus.COMPLETED && (step.input as { kind: string }).kind === 'turn'))
    // 首次：TURN_PREFIX，带当前问题，输出上限 8,192；之后：旧前缀摘要进 <previous-summary>，UPDATE，13,107。
    assert.match((requests[0]!.messages[1] as { content: string }).content, /^<conversation>\n\[User\] \(\d{4}-\d{2}-\d{2}\): 新问题\n\n/)
    assert.match((requests[0]!.messages[1] as { content: string }).content, /This is the PREFIX of a turn that was too large to keep\./)
    assert.equal(requests[0]!.options?.request.maxOutputTokens, 8_192)
    for (const [index, request] of requests.slice(1).entries()) {
      const text = (request.messages[1] as { content: string }).content

      assert.match(text, new RegExp(`<previous-summary>\\n前缀摘要 ${index + 1}\\n</previous-summary>`))
      assert.match(text, /The messages above are NEW conversation messages/)
      assert.doesNotMatch(text, /\[User\]/)
      assert.equal(request.options?.request.maxOutputTokens, 13_107)
    }

    // 压缩后的请求：当前问题原样，其后是前缀摘要与保留的工具轮（本 Run 内 reasoning 是原文）。
    const lastTurn = turns.at(-1)!
    const keptFrom = (lastTurn.input as { keptFromSamplingAttemptId: string }).keptFromSamplingAttemptId
    const finalRequest = samplingCalls(harness).at(-1)!.messages

    assert.deepEqual(finalRequest.slice(0, 2), [userMessage('新问题'), turnSummaryMessage((lastTurn.output as { summary: string }).summary)])
    assert.equal(finalRequest[2]?.type === 'assistant_tool_call' ? finalRequest[2].reasoningContent : undefined, `reasoning for call-${keptFrom.split('sampling-')[1]}`)
    assert.equal(readContextPlan(harness.recorder.steps.filter(step => step.type === 'model_sampling').at(-1)).turnCompactionStepId, lastTurn.id)
    assertNoUnfinishedSteps(harness)
  })

  it('AC-03 本轮保留预算先扣掉历史里仍是原文的部分：历史原文越多，本轮保留的工具轮越少', async () => {
    /** 第一次本轮压缩之后的那次请求里带着几轮工具来回（历史组都没有工具记录，数到的都是本 Run 保留的）。 */
    async function keptRounds(historyGroups: number): Promise<number> {
      const harness = createHarness(routed({
        sampling: index => index < 15 ? toolRound(`call-${index + 1}`) : finalAnswer(),
      }), undefined, async () => ({ ok: true, modelContent: 'w'.repeat(1_000) }))

      seedHistory(harness, historyGroups, 1_000)

      const events = await run(harness)
      const steps = harness.recorder.steps
      const compaction = steps.findIndex(step => step.type === 'context_compaction')

      assert.ok(compaction >= 0, `${historyGroups} 组历史：没有触发本轮压缩`)
      assert.equal((steps[compaction]!.input as { kind: string }).kind, 'turn')
      assert.equal(events.at(-1)?.type, 'run_completed')
      assertNoUnfinishedSteps(harness)

      const next = steps.slice(compaction).find(step => step.type === 'model_sampling')!
      const request = samplingCalls(harness)[(next.input as { samplingIndex: number }).samplingIndex - 1]!

      return request.messages.filter(item => item.type === 'assistant_tool_call').length
    }

    // 保留预算 min(20,000, 1,000)，每轮约 265（工具结果 250 + 调用约 15）；每组历史约 253，都放得下、不压历史。
    // 没有历史：放得下 3 轮（795）；1 组：扣到 747，放得下 2 轮（530）；2 组：扣到 494，只剩最新 1 轮。
    assert.equal(await keptRounds(0), 3)
    assert.equal(await keptRounds(1), 2)
    assert.equal(await keptRounds(2), 1)
  })

  it('AC-08(e) 同步压缩中用户停止：压缩请求被取消，Run 与 Message 为 ABORTED，压缩 Step 随 Run 收成 ABORTED，没有记录', async () => {
    const controller = new AbortController()
    const harness = createHarness(routed({
      sampling: () => finalAnswer(),
      async* summary(_index, _messages, options) {
        controller.abort()
        await waitForAbort(options!.signal!)
        yield* failingStream(new Error('摘要请求被取消'))
      },
    }))

    seedHistory(harness, 8, 2_000)

    const events = await run(harness, { signal: controller.signal })

    assert.deepEqual(events.map(event => event.type), ['run_started', 'run_aborted'])
    assert.equal(harness.recorder.runErrorCode, 'aborted')
    assert.equal(harness.assistantMessage()?.status, MessageStatus.ABORTED)
    assert.deepEqual(stepTrail(harness), [
      ['load_conversation_history', AgentStepStatus.COMPLETED],
      ['context_compaction', AgentStepStatus.ABORTED],
    ])
    assert.equal(harness.prisma.compactions.length, 0)
    assert.equal(samplingCalls(harness).length, 0)
  })

  it('AC-08(e) 停止发生在记录插入之后：记录完整保留、Step 为 ABORTED，下一次问答照常使用它', async () => {
    const controller = new AbortController()
    const harness = createHarness(routed({ sampling: () => finalAnswer() }))
    const create = harness.prisma.conversationCompaction.create

    harness.prisma.conversationCompaction.create = async (input) => {
      const record = await create(input)

      controller.abort()
      return record
    }
    seedHistory(harness, 8, 2_000)

    const events = await run(harness, { signal: controller.signal })

    assert.equal(events.at(-1)?.type, 'run_aborted')
    assert.equal(compactionSteps(harness)[0]?.status, AgentStepStatus.ABORTED)
    assert.equal(harness.prisma.compactions[0]?.summary, SUMMARY_TEXT)

    await run(harness, { userContent: '接着问' })

    assert.deepEqual(samplingCalls(harness).at(-1)?.messages[0], historySummaryMessage(SUMMARY_TEXT))
  })

  it('AC-08(e) 同步压缩中到达时限：压缩请求被取消，Run 以 deadline 失败，压缩 Step 随 Run 收口', async () => {
    const harness = createHarness(routed({
      sampling: () => finalAnswer(),
      async* summary(_index, _messages, options) {
        await waitForAbort(options!.signal!)
        yield* failingStream(new Error('摘要请求被取消'))
      },
    }))

    seedHistory(harness, 8, 2_000)

    const events = await run(harness, { runDeadlineMs: 50 })

    assert.equal(events.at(-1)?.type, 'run_failed')
    assert.equal(harness.recorder.runErrorCode, 'deadline')
    assert.deepEqual(stepTrail(harness), [
      ['load_conversation_history', AgentStepStatus.COMPLETED],
      ['context_compaction', AgentStepStatus.FAILED],
    ])
    assert.equal(harness.prisma.compactions.length, 0)
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

const successfulToolResult: ToolResult = {
  ok: true,
  modelContent: '找到 1 篇相关文章。',
}

function createHarness(
  createModelStream: CreateModelStream,
  signal?: AbortSignal,
  invokeTool: InvokeTool = async () => successfulToolResult,
  limits: Partial<RunLimits> = {},
  workspaces?: WorkspaceService,
) {
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
  const compactionService = new ContextCompactionService(
    llmService,
    prisma as unknown as PrismaService,
    recorder as unknown as AgentRunRecorderService,
  )
  // 检查点 B 不被 runtime await：记下它返回的 Promise，用例需要时等它跑完再断言。
  const afterRunCompactions: Array<Promise<void>> = []
  const compactAfterRun = compactionService.compactAfterRun.bind(compactionService)

  compactionService.compactAfterRun = (input) => {
    const done = compactAfterRun(input)

    afterRunCompactions.push(done)
    return done
  }
  const runtimeService = new AgentRuntimeService(
    llmService,
    prisma as unknown as PrismaService,
    recorder as unknown as AgentRunRecorderService,
    toolInvocationService as unknown as ToolInvocationService,
    compactionService,
    workspaces,
  )
  // 模型行与运行配置快照由 ChatService 在 Run 之前读好；这里给用例一份默认快照，省得每处都写。
  // 默认打开调试抓取：fake 模型流总会回调 debugCapture，关掉时的行为单独覆盖。
  const runtimeConfig = createRuntimeConfigSnapshot({
    limits,
    debugCaptureModelIo: true,
  })
  const runTurnStream = runtimeService.runTurnStream.bind(runtimeService)
  const service = Object.assign(runtimeService, {
    runTurnStream: (input: TestRunTurnStreamInput) =>
      runTurnStream({ model: createResolvedLlmModel(), runtimeConfig, ...input }),
  })

  return {
    llmCalls,
    prisma,
    recorder,
    service,
    compactionService,
    afterRunCompactions,
    toolInvocations: toolInvocationService.invocations,
    toolExecutionContexts: toolInvocationService.contexts,
    // 取最后一条：用例可能先种下之前问答的回答。
    assistantMessage: () => prisma.messages.filter(
      message => message.role === MessageRole.ASSISTANT,
    ).at(-1),
    run: () => service.runTurnStream({
      conversationId: 'conversation-1',
      userContent: '问题',
      reasoningEffort: 'high',
      ...(signal ? { signal } : {}),
      instructions: [],
    }),
  }
}

/** 顶替真实 invoke：清单里的工具交给用例模拟执行结局，并记为一次执行。 */
class FakeToolInvocationService {
  readonly invocations: UnvalidatedToolCallEnvelope[] = []
  readonly contexts: ToolExecutionContext[] = []
  // 截断批次与清单外的工具名走真实 invoke（Registry 为空，到不了执行）：文案、observation 与生产同源。
  private readonly notExecuted = new ToolInvocationService(new ToolRegistryService())

  constructor(private readonly invokeTool: InvokeTool) {}

  async invoke(
    envelope: UnvalidatedToolCallEnvelope,
    context: ToolInvocationContext,
  ): Promise<ToolInvocationResult> {
    const definition = TOOL_DEFINITIONS.find(candidate => candidate.name === envelope.toolName)

    if (context.argumentsTruncated || !definition)
      return await this.notExecuted.invoke(envelope, context)
    if (context.workspaceGuideRequired && WORKSPACE_TOOL_NAMES.includes(envelope.toolName)) {
      const registry = new ToolRegistryService()
      registry.register({ definition, executor: { execute: async () => {
        throw new Error('旧计划不可执行')
      } } })
      return new ToolInvocationService(registry).invoke(envelope, context)
    }

    this.invocations.push(envelope)
    this.contexts.push(context)
    const result = await this.invokeTool(envelope, context)

    return {
      result,
      // 用例用 invalid_arguments 模拟参数没通过 input.parse；其余结局都发生在校验之后。
      argumentsValidated: result.ok || result.code !== 'invalid_arguments',
      observation: normalizeToolObservation(result.modelContent, definition.maxObservationChars),
    }
  }
}

class FakePrismaService {
  readonly messages: Message[] = []
  readonly findManyArguments: FakeMessageFindManyArguments[] = []
  /** 读历史时各用户消息的 Run（配对问答、判断能否进摘要）；用例按需填入。 */
  historyRuns: HistoryRunRow[] = []
  /** 读历史时回答所属 Run 的采样、工具与本轮压缩 Step；按查询里的 runId 过滤后返回。 */
  historyStepRows: HistoryStepRow[] = []
  historyStepQueryError: unknown
  historyStepQueryCount = 0
  /** 历史压缩记录（#220）：读历史取 readAt、createdAt、id 最新的一条。 */
  readonly compactions: FakeCompactionRecord[] = []
  compactionCreateError: unknown
  /** 读历史快照里 `SELECT now()` 的值。 */
  readAt = new Date('2026-09-30T08:00:00.000Z')
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
      // 读历史分两步（#239）：先按状态与上界读元数据，再按保留下来的 ID 读正文；只记第一步的参数。
      const ids = arguments_.where.id?.in

      if (ids) {
        return this.messages.filter(message =>
          message.conversationId === arguments_.where.conversationId && ids.includes(message.id))
      }

      this.findManyArguments.push(structuredClone(arguments_))

      return this.messages
        .filter(message =>
          message.conversationId === arguments_.where.conversationId
          && message.status === arguments_.where.status
          // 检查点 B 读下一次问答的历史：没有上界。
          && (!arguments_.where.OR || isStrictlyBefore(message, arguments_.where.OR)))
        .sort((left, right) =>
          left.createdAt.getTime() - right.createdAt.getTime()
          || left.id.localeCompare(right.id))
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

  // 会话写入与删除使用事务级 advisory lock；此单测夹具不模拟 PostgreSQL 的锁等待。
  async $executeRaw(): Promise<number> { return 0 }

  async $transaction<T>(operation: (prisma: FakePrismaService) => Promise<T>): Promise<T> {
    return await operation(this)
  }

  readonly agentRun = {
    findMany: async ({ where }: { where: { conversationId: string, userMessageId: { in: string[] } } }): Promise<HistoryRunRow[]> =>
      structuredClone(this.historyRuns.filter(run => where.userMessageId.in.includes(run.userMessageId))),
  }

  // 这些用例的消息都不带附件。
  readonly attachment = { findMany: async () => [] }

  readonly conversationCompaction = {
    findFirst: async ({ where }: { where: { conversationId: string } }) => {
      const latest = this.compactions
        .filter(record => record.conversationId === where.conversationId)
        .sort((left, right) => right.readAt.getTime() - left.readAt.getTime()
          || right.createdAt.getTime() - left.createdAt.getTime()
          || right.id.localeCompare(left.id))
        .at(0)

      return latest ? toCompactionSelect(latest) : null
    },
    create: async ({ data }: { data: Omit<FakeCompactionRecord, 'id' | 'createdAt'> }) => {
      if (this.compactionCreateError !== undefined)
        throw this.compactionCreateError

      const record = {
        id: `compaction-${this.compactions.length + 1}`,
        createdAt: new Date(Date.now() + this.compactions.length),
        ...structuredClone(data),
      }

      this.compactions.push(record)
      return toCompactionSelect(record)
    },
  }

  /** 读历史的两条 raw 查询：快照时刻（`SELECT now()`）与回答所属 Run 的 Step。 */
  async $queryRaw(query: TemplateStringsArray | { values: unknown[] }): Promise<unknown[]> {
    if (Array.isArray(query))
      return [{ readAt: this.readAt }]

    this.historyStepQueryCount += 1
    if (this.historyStepQueryError !== undefined)
      throw this.historyStepQueryError

    const runIds = (query as { values: unknown[] }).values.find(Array.isArray) as string[]

    return structuredClone(this.historyStepRows.filter(row => runIds.includes(row.runId)))
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
    status?: Message['status']
    OR?: FakeStrictlyBeforeOr
    id?: { in: string[] }
  }
  orderBy?: Array<{ createdAt: 'asc' } | { id: 'asc' }>
  select?: Partial<Record<keyof Message, true>>
}

interface FakeCompactionRecord {
  id: string
  conversationId: string
  runId: string | null
  reason: string
  summary: string
  coveredGroupIds: string[]
  answerOnlyGroupId: string | null
  readAt: Date
  tokensBefore: number
  usage?: unknown
  modelId: string
  createdAt: Date
}

function toCompactionSelect(record: FakeCompactionRecord) {
  return {
    id: record.id,
    summary: record.summary,
    coveredGroupIds: [...record.coveredGroupIds],
    answerOnlyGroupId: record.answerOnlyGroupId,
  }
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
    // 与真实 Recorder 一致：归因的 Step 已收口（检查点 C 压缩失败后）时不再改它。
    if (failedStep && this.steps.find(step => step.id === failedStep.id)?.status === AgentStepStatus.RUNNING) {
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

function historyRun(id: string, userMessageId: string, assistantMessageId: string | null, status: HistoryRunRow['status'] = 'COMPLETED'): HistoryRunRow {
  return { id, userMessageId, assistantMessageId, status }
}

function historyStep(runId: string, fields: Partial<HistoryStepRow> & Pick<HistoryStepRow, 'sequence' | 'type'>): HistoryStepRow {
  return {
    runId,
    samplingAttemptId: null,
    toolCallCount: null,
    intermediateText: null,
    callId: null,
    toolName: null,
    arguments: null,
    observation: null,
    ok: null,
    keptFromSamplingAttemptId: null,
    summary: null,
    ...fields,
  }
}

function readContextPlan(step: RecordedAgentStep | undefined): {
  resolvedInputBudgetTokens?: number
  estimatedInputTokens?: number
  compactionId?: string | null
  turnCompactionStepId?: string | null
  historyIncludedCount?: number
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
    toolName: 'web_search',
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

  const { contextPlan: _, firstTokenMs, answerStartedMs, ...rest } = value as Record<string, unknown>

  assert.ok(
    firstTokenMs === null || (Number.isSafeInteger(firstTokenMs) && (firstTokenMs as number) >= 0),
    `firstTokenMs 应为非负整数或 null，实际 ${String(firstTokenMs)}`,
  )
  // 随真实时钟变化（#212）；没出正文时没有。
  assert.ok(
    answerStartedMs === undefined || (Number.isSafeInteger(answerStartedMs) && (answerStartedMs as number) >= 0),
    `answerStartedMs 应为非负整数或不存在，实际 ${String(answerStartedMs)}`,
  )
  return rest
}

async function* toModelStream(
  events: ModelStreamEvent[],
): AsyncGenerator<ModelStreamEvent> {
  yield* events
}

type TestRunTurnStreamInput = Omit<RunTurnStreamInput, 'model' | 'runtimeConfig'> & {
  model?: ResolvedLlmModel
  runtimeConfig?: RuntimeConfigSnapshot
}

function capturedTextThenToolCallModelStream(
  options: ChatStreamOptions | undefined,
  content: string,
): AsyncGenerator<ModelStreamEvent> {
  options?.debugCapture?.onRequest({ model: 'deepseek-v4-flash' })

  return adaptDeepSeekStream(teeRawResponseCapture(
    toProviderStream([
      providerChunk({ content }),
      providerChunk({
        reasoning_content: 'REASONING_IN_DEBUG_CAPTURE',
        tool_calls: [{
          index: 0,
          id: 'call-1',
          type: 'function',
          function: {
            name: 'web_search',
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
