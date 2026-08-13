import type { PrismaService } from '../prisma/prisma.service.js'
import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，不为 Admin 查询引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { BadRequestException, NotFoundException } from '@nestjs/common'

import {
  projectAdminRunDetail,
  projectAdminRunListItem,
} from './admin-run.projector.js'
import { AdminRunsService } from './admin-runs.service.js'

describe('Admin Run projector', () => {
  it('从多次 sampling / tool step 聚合 durable 指标且保留 requestedModel=null', () => {
    const item = projectAdminRunListItem(createRunRecord())

    assert.equal(item.requestedModel, null)
    assert.equal(item.samplingCount, 3)
    assert.equal(item.toolCallCount, 2)
    assert.equal(item.inputTokens, 60)
    assert.equal(item.outputTokens, 23)
    assert.equal(item.totalTokens, 83)
    assert.equal(item.durationMs, 3_000)
  })

  it('usage 任一维度缺失时只把无法证明的聚合值保留为 null', () => {
    const record = createRunRecord()
    const secondSampling = record.steps.find(step => step.sequence === 5)!
    secondSampling.output = {
      samplingAttemptId: 'run-1:sampling-2',
      finishReason: 'tool_calls',
      usage: {
        inputTokens: 20,
        outputTokens: 8,
      },
      toolCallCount: 1,
      textChars: 0,
      intermediateTextChars: 0,
      durationMs: 800,
    }

    const item = projectAdminRunListItem(record)

    assert.equal(item.inputTokens, 60)
    assert.equal(item.outputTokens, 23)
    assert.equal(item.totalTokens, null)
  })

  it('普通单次采样成功不会伪造 Tool Execution', () => {
    const record = createRunRecord()
    record.steps = record.steps.filter(
      step => step.sequence <= 3 || step.sequence === 8,
    )

    const item = projectAdminRunListItem(record)

    assert.equal(item.samplingCount, 1)
    assert.equal(item.toolCallCount, 0)
    assert.equal(item.totalTokens, 15)
  })

  it('五类已知 Step 使用 allowlist，unknown Step 安全降级且 Timeline 按 sequence 排序', () => {
    const detail = projectAdminRunDetail(createRunRecord())
    const serialized = JSON.stringify(detail)

    assert.deepEqual(
      detail.timeline.map(item => item.sequence),
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
    )
    assert.deepEqual(
      detail.timeline.slice(0, 8).map(item => item.kind),
      Array.from({ length: 8 }).fill('known'),
    )
    assert.equal(detail.timeline.at(-1)?.kind, 'generic')
    assert.equal(detail.timeline.at(-1)?.type, 'future_retrieval')
    assert.doesNotMatch(
      serialized,
      /DO_NOT_LEAK|rawArgumentsJson|observationBody|providerPayload|reasoning/,
    )
    assert.doesNotMatch(serialized, /"input"|"output"/)
  })

  it('Run 四种状态都能投影且只有终态计算 duration', () => {
    for (const status of ['RUNNING', 'COMPLETED', 'FAILED', 'ABORTED'] as const) {
      const record = createRunRecord()
      record.status = status
      record.endedAt = status === 'RUNNING' ? null : new Date('2026-08-09T00:00:03.000Z')

      const item = projectAdminRunListItem(record)

      assert.equal(item.status, status)
      assert.equal(item.durationMs, status === 'RUNNING' ? null : 3_000)
    }
  })

  it('RUNNING / FAILED / ABORTED 的 partial output 保持 typed 且 assistant Message 可缺失', () => {
    const running = createRunRecord()
    running.status = 'RUNNING'
    running.endedAt = null
    running.assistantMessage!.status = 'STREAMING'
    running.steps = running.steps.filter(step => step.sequence <= 3)
    const runningSampling = running.steps.find(step => step.sequence === 3)!
    runningSampling.status = 'RUNNING'
    runningSampling.output = null
    runningSampling.endedAt = null

    const runningDetail = projectAdminRunDetail(running)
    assert.equal(runningDetail.timeline.at(-1)?.kind, 'known')
    assert.equal(runningDetail.timeline.at(-1)?.status, 'RUNNING')
    assert.equal(runningDetail.messages.at(-1)?.status, 'STREAMING')

    const failed = createRunRecord()
    failed.status = 'FAILED'
    failed.steps = failed.steps.filter(step => step.sequence <= 3)
    const failedSamplingStep = failed.steps.find(step => step.sequence === 3)!
    failedSamplingStep.status = 'FAILED'
    failedSamplingStep.output = {
      durationMs: 500,
      contextPlan: safeContextPlan('minimum_context'),
    }
    failedSamplingStep.errorMessage = '安全错误摘要'

    const failedDetail = projectAdminRunDetail(failed)
    const failedSampling = failedDetail.timeline.at(-1)
    assert.equal(failedSampling?.kind, 'known')
    assert.equal(failedSampling?.status, 'FAILED')
    assert.equal(
      failedSampling?.type === 'model_sampling'
        ? failedSampling.recordedDurationMs
        : null,
      500,
    )

    const aborted = createRunRecord()
    aborted.status = 'ABORTED'
    aborted.assistantMessageId = null
    aborted.assistantMessage = null
    aborted.steps = aborted.steps.filter(step => step.sequence <= 3)
    const abortedSampling = aborted.steps.find(step => step.sequence === 3)!
    abortedSampling.status = 'ABORTED'
    abortedSampling.output = null

    const abortedDetail = projectAdminRunDetail(aborted)
    assert.equal(abortedDetail.timeline.at(-1)?.kind, 'known')
    assert.equal(abortedDetail.timeline.at(-1)?.status, 'ABORTED')
    assert.deepEqual(abortedDetail.messages.map(message => message.role), ['USER'])
  })

  it('malformed 已知 Step 降级 generic 且不污染列表聚合', () => {
    const record = createRunRecord()
    const sampling = record.steps.find(step => step.sequence === 3)!
    sampling.status = 'FAILED'
    sampling.input = {
      ...(sampling.input as Record<string, unknown>),
      requestedModel: 'MALFORMED_SECRET',
    }
    sampling.output = {
      durationMs: 500,
      usage: {
        inputTokens: 999,
        outputTokens: 999,
        totalTokens: 999,
      },
    }
    assert.equal(projectAdminRunListItem(record).requestedModel, null)

    const completedWithPartialOutput = record.steps.find(
      step => step.sequence === 5,
    )!
    completedWithPartialOutput.output = { durationMs: 800 }
    const completedWithInvalidFinish = record.steps.find(
      step => step.sequence === 7,
    )!
    completedWithInvalidFinish.output = {
      ...(completedWithInvalidFinish.output as Record<string, unknown>),
      finishReason: 'length',
    }

    const detail = projectAdminRunDetail(record)
    const item = projectAdminRunListItem(record)
    const malformed = detail.timeline.find(candidate => candidate.sequence === 3)

    assert.equal(malformed?.kind, 'generic')
    assert.equal(
      detail.timeline.find(candidate => candidate.sequence === 5)?.kind,
      'generic',
    )
    assert.equal(
      detail.timeline.find(candidate => candidate.sequence === 7)?.kind,
      'generic',
    )
    assert.equal(item.requestedModel, null)
    assert.equal(item.inputTokens, null)
    assert.equal(item.outputTokens, null)
    assert.equal(item.totalTokens, null)
    assert.doesNotMatch(JSON.stringify({ detail, item }), /MALFORMED_SECRET/)
  })

  it('Message 固定按 Run 的 user / assistant 关系排序，不用同毫秒 ID 猜顺序', () => {
    const record = createRunRecord()
    record.userMessage.id = 'z-user'
    record.assistantMessage!.id = 'a-assistant'
    record.assistantMessage!.createdAt = record.userMessage.createdAt

    const detail = projectAdminRunDetail(record)

    assert.deepEqual(detail.messages.map(message => message.role), [
      'USER',
      'ASSISTANT',
    ])
  })

  it('零 sampling 的早期终止保留 requestedModel 与 usage 未记录语义', () => {
    const record = createRunRecord()
    record.status = 'FAILED'
    record.assistantMessageId = null
    record.assistantMessage = null
    record.steps = record.steps.filter(
      step => step.sequence <= 2,
    )

    const item = projectAdminRunListItem(record)

    assert.equal(item.samplingCount, 0)
    assert.equal(item.requestedModel, null)
    assert.equal(item.inputTokens, null)
    assert.equal(item.outputTokens, null)
    assert.equal(item.totalTokens, null)
  })
})

describe('AdminRunsService', () => {
  it('组合 query / status / date / pagination，保持 createdAt DESC, id DESC 且不逐 Run 查询', async () => {
    const harness = createServiceHarness()

    const response = await harness.service.list({
      page: 2,
      pageSize: 2,
      status: 'FAILED',
      query: '  audit  ',
      dateFrom: '2026-08-01T00:00:00.000Z',
      dateTo: '2026-08-10T00:00:00.000Z',
    })

    assert.equal(harness.calls.findMany.length, 1)
    assert.equal(harness.calls.groupBy.length, 1)
    assert.deepEqual(harness.calls.findMany[0]?.orderBy, [
      { createdAt: 'desc' },
      { id: 'desc' },
    ])
    assert.equal(harness.calls.findMany[0]?.skip, 2)
    assert.equal(harness.calls.findMany[0]?.take, 2)
    assert.equal(
      (harness.calls.findMany[0]?.select as {
        steps?: { select?: { status?: boolean } }
      }).steps?.select?.status,
      true,
    )
    assert.equal(JSON.stringify(harness.calls.findMany[0]?.where).includes('audit'), true)
    assert.equal(response.pagination.page, 2)
    assert.equal(response.pagination.totalItems, 1)
    assert.deepEqual(response.summary.statusCounts, {
      RUNNING: 0,
      COMPLETED: 0,
      FAILED: 1,
      ABORTED: 0,
    })
    assert.deepEqual(
      harness.calls.groupBy[0]?.where,
      harness.calls.findMany[0]?.where,
    )
  })

  it('拒绝反向日期范围', async () => {
    const harness = createServiceHarness()

    await assert.rejects(
      harness.service.list({
        dateFrom: '2026-08-10T00:00:00.000Z',
        dateTo: '2026-08-01T00:00:00.000Z',
      }),
      BadRequestException,
    )
  })

  it('Run 不存在时返回标准 404', async () => {
    const harness = createServiceHarness({ detail: null })

    await assert.rejects(
      harness.service.getDetail('missing-run'),
      NotFoundException,
    )
  })
})

function createRunRecord() {
  return {
    id: 'run-1',
    conversationId: 'conversation-1',
    userMessageId: 'message-user',
    assistantMessageId: 'message-assistant' as string | null,
    status: 'COMPLETED' as 'RUNNING' | 'COMPLETED' | 'FAILED' | 'ABORTED',
    startedAt: new Date('2026-08-09T00:00:00.000Z'),
    endedAt: new Date('2026-08-09T00:00:03.000Z') as Date | null,
    createdAt: new Date('2026-08-09T00:00:00.000Z'),
    updatedAt: new Date('2026-08-09T00:00:03.000Z'),
    userMessage: {
      id: 'message-user',
      role: 'USER' as const,
      status: 'COMPLETED' as const,
      content: '请检查这个页面的 SEO。',
      createdAt: new Date('2026-08-09T00:00:00.000Z'),
      updatedAt: new Date('2026-08-09T00:00:00.000Z'),
    },
    assistantMessage: {
      id: 'message-assistant',
      role: 'ASSISTANT' as const,
      status: 'COMPLETED' as const,
      content: '已经完成检查。',
      createdAt: new Date('2026-08-09T00:00:00.100Z'),
      updatedAt: new Date('2026-08-09T00:00:03.000Z'),
    } as {
      id: string
      role: 'ASSISTANT'
      status: 'PENDING' | 'STREAMING' | 'COMPLETED' | 'FAILED' | 'ABORTED'
      content: string
      createdAt: Date
      updatedAt: Date
    } | null,
    steps: [
      step(9, 'future_retrieval', {
        input: { providerPayload: 'DO_NOT_LEAK' },
        output: { reasoning: 'DO_NOT_LEAK' },
      }),
      step(8, 'assistant_output', {
        input: { assistantMessageId: 'message-assistant', extraSecret: 'DO_NOT_LEAK' },
        output: { contentLength: 8, providerPayload: 'DO_NOT_LEAK' },
      }),
      step(7, 'model_sampling', {
        input: {
          samplingIndex: 3,
          samplingAttemptId: 'run-1:sampling-3',
          requestedModel: null,
          messageCount: 6,
          toolCount: 2,
          reasoning: 'DO_NOT_LEAK',
        },
        output: {
          samplingAttemptId: 'run-1:sampling-3',
          finishReason: 'stop',
          usage: { inputTokens: 30, outputTokens: 10, totalTokens: 40 },
          toolCallCount: 0,
          textChars: 8,
          intermediateTextChars: 0,
          durationMs: 900,
          providerPayload: 'DO_NOT_LEAK',
        },
      }),
      step(6, 'tool_execution', {
        status: 'FAILED',
        input: {
          callId: 'call-2',
          toolName: 'get_article_detail',
          toolVersion: '1',
          samplingAttemptId: 'run-1:sampling-2',
          executionAttempt: 1,
          rawArgumentsChars: 20,
          rawArgumentsJson: 'DO_NOT_LEAK',
        },
        output: {
          ok: false,
          code: 'invalid_arguments',
          retryable: false,
          originalChars: 0,
          observationChars: 0,
          truncated: false,
          durationMs: 5,
          observationBody: 'DO_NOT_LEAK',
        },
      }),
      step(5, 'model_sampling', {
        input: {
          samplingIndex: 2,
          samplingAttemptId: 'run-1:sampling-2',
          requestedModel: null,
          messageCount: 4,
          toolCount: 2,
          reasoning: 'DO_NOT_LEAK',
        },
        output: {
          samplingAttemptId: 'run-1:sampling-2',
          finishReason: 'tool_calls',
          usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 },
          toolCallCount: 1,
          textChars: 0,
          intermediateTextChars: 0,
          durationMs: 800,
          providerPayload: 'DO_NOT_LEAK',
        },
      }),
      step(4, 'tool_execution', {
        input: {
          callId: 'call-1',
          toolName: 'search_articles',
          toolVersion: '1',
          samplingAttemptId: 'run-1:sampling-1',
          executionAttempt: 1,
          rawArgumentsChars: 30,
          rawArgumentsJson: 'DO_NOT_LEAK',
        },
        output: {
          ok: true,
          originalChars: 100,
          observationChars: 80,
          truncated: true,
          durationMs: 10,
          observationBody: 'DO_NOT_LEAK',
        },
      }),
      step(3, 'model_sampling', {
        input: {
          samplingIndex: 1,
          samplingAttemptId: 'run-1:sampling-1',
          requestedModel: null,
          messageCount: 2,
          toolCount: 2,
          reasoning: 'DO_NOT_LEAK',
        },
        output: {
          samplingAttemptId: 'run-1:sampling-1',
          finishReason: 'tool_calls',
          usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
          toolCallCount: 1,
          textChars: 0,
          intermediateTextChars: 0,
          durationMs: 500,
          providerPayload: 'DO_NOT_LEAK',
        },
      }),
      step(2, 'load_conversation_history', {
        input: { limit: 20, prompt: 'DO_NOT_LEAK' },
        output: { messageCount: 2, truncated: 'DO_NOT_LEAK' },
      }),
      step(1, 'receive_user_message', {
        input: {
          messageId: 'message-user',
          messageLength: 14,
          prompt: 'DO_NOT_LEAK',
        },
      }),
    ],
  }
}

function step(
  sequence: number,
  type: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: `step-${sequence}`,
    sequence,
    type,
    title: `Step ${sequence}`,
    status: 'COMPLETED' as 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'ABORTED',
    input: null as unknown,
    output: null as unknown,
    errorMessage: null as string | null,
    startedAt: new Date(`2026-08-09T00:00:0${Math.min(sequence, 9)}.000Z`) as Date | null,
    endedAt: new Date(`2026-08-09T00:00:0${Math.min(sequence, 9)}.100Z`) as Date | null,
    ...overrides,
  }
}

function safeContextPlan(
  overflowReason: 'minimum_context' | null,
): Record<string, unknown> {
  return {
    samplingIndex: 1,
    resolvedInputBudgetTokens: 262_144,
    estimatedInputTokens: 262_145,
    historyCandidateCount: 0,
    historyIncludedCount: 0,
    historyExcludedCount: 0,
    toolExchangeCount: 1,
    observations: [{
      exchangeIndex: 0,
      originalChars: 100,
      toolCeilingChars: 80,
      finalChars: 64,
      toolCeilingTruncated: true,
      contextBudgetTruncated: true,
    }],
    overflowReason,
    estimatorStrategyId: 'deepseek-v4-official-b5968e9',
  }
}

function createServiceHarness(options: { detail?: ReturnType<typeof createRunRecord> | null } = {}) {
  const calls = {
    findMany: [] as Array<Record<string, unknown>>,
    groupBy: [] as Array<Record<string, unknown>>,
  }
  const record = createRunRecord()
  const prisma = {
    agentRun: {
      async findMany(args: Record<string, unknown>) {
        calls.findMany.push(args)
        return [record]
      },
      async groupBy(args: Record<string, unknown>) {
        calls.groupBy.push(args)
        return [
          { status: 'FAILED', _count: { _all: 1 } },
        ]
      },
      async findUnique() {
        return options.detail === undefined ? record : options.detail
      },
    },
  } as unknown as PrismaService

  return {
    calls,
    service: new AdminRunsService(prisma),
  }
}
