import type { Prisma } from '../generated/prisma/client.js'
import type { PrismaService } from '../prisma/prisma.service.js'
import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，不为 Admin 查询引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { BadRequestException, NotFoundException } from '@nestjs/common'

import { AdminRunsService } from './admin-runs.service.js'
import { runRecord, step } from './projection/__fixtures__.js'
import {
  projectAdminRunDetail,
  projectAdminRunListItem,
} from './projection/admin-run.projector.js'

describe('Admin Run projector', () => {
  it('从多次 sampling / tool step 聚合 durable 指标', () => {
    const item = projectAdminRunListItem(createRunRecord())

    assert.equal(item.samplingCount, 3)
    assert.equal(item.toolCallCount, 2)
    assert.deepEqual(item.usage, {
      inputTokens: 60,
      outputTokens: 23,
      totalTokens: 83,
      reasoningTokens: null,
      promptCacheHitTokens: null,
      promptCacheMissTokens: null,
    })
    assert.equal(item.durationMs, 3_000)
  })

  it('usage 每个指标独立求和：任一 step 缺该指标则该指标为 null，其余照常', () => {
    const record = createRunRecord()
    const secondSampling = record.steps.find(step => step.sequence === 5)!
    secondSampling.output = {
      samplingAttemptId: 'run-1:sampling-2',
      messageCount: 4,
      finishReason: 'tool_calls',
      usage: { inputTokens: 20, outputTokens: 8 },
      toolCallCount: 1,
    }

    const item = projectAdminRunListItem(record)

    assert.equal(item.usage.inputTokens, 60)
    assert.equal(item.usage.outputTokens, 23)
    assert.equal(item.usage.totalTokens, null)
  })

  it('reasoning / cache 明细按指标独立求和且原样读取', () => {
    const record = createRunRecord()
    const samplings = record.steps
      .filter(step => step.type === 'model_sampling')
      .sort((left, right) => left.sequence - right.sequence)

    for (const [index, sampling] of samplings.entries()) {
      const output = sampling.output as Record<string, unknown>
      output.usage = {
        ...(output.usage as Record<string, unknown>),
        reasoningTokens: index + 1,
        promptCacheHitTokens: index + 1,
        ...(index === 1 ? {} : { promptCacheMissTokens: 3 }),
      }
    }

    const detail = projectAdminRunDetail(record)

    assert.equal(detail.usage.reasoningTokens, 6)
    assert.equal(detail.usage.promptCacheHitTokens, 6)
    assert.equal(detail.usage.promptCacheMissTokens, null)

    const sampling = detail.timeline.find(item => item.type === 'model_sampling')
    assert.equal(
      sampling?.kind === 'known' && sampling.type === 'model_sampling'
        ? sampling.usage?.reasoningTokens
        : null,
      1,
    )
  })

  it('AC-06：2 次 sampling + 1 次 finalization（2 attempts）的 totalTokens 等于 4 次调用之和', () => {
    const record = createRunRecord()
    record.steps = [
      ...record.steps.filter(step => step.sequence !== 7),
      step(10, 'grounded_finalization', {
        input: groundedFinalizationInput(),
        output: groundedFinalizationOutput([
          { ok: false, usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } },
          { ok: true, usage: { inputTokens: 6, outputTokens: 3, totalTokens: 9 } },
        ]),
      }),
    ]

    const item = projectAdminRunListItem(record)
    const detail = projectAdminRunDetail(record)
    const stepUsages = detail.timeline.flatMap(candidate => (
      candidate.kind === 'known'
      && (candidate.type === 'model_sampling' || candidate.type === 'grounded_finalization')
        ? [candidate.usage]
        : []
    ))

    // 2 次 action sampling + 2 次 finalization attempt。
    assert.equal(item.samplingCount, 4)
    assert.equal(item.usage.totalTokens, 15 + 28 + 7 + 9)
    assert.equal(
      stepUsages.reduce((total, usage) => total + (usage?.totalTokens ?? 0), 0),
      item.usage.totalTokens,
    )

    // 任一调用缺 totalTokens 时该项为 null，其余项照常。
    const output = record.steps.find(candidate => candidate.sequence === 10)!
      .output as { attempts: Array<{ usage: Record<string, unknown> }> }
    delete output.attempts[1]!.usage.totalTokens

    const partial = projectAdminRunListItem(record)

    assert.equal(partial.usage.totalTokens, null)
    assert.equal(partial.usage.inputTokens, 10 + 20 + 5 + 6)
    assert.equal(partial.usage.outputTokens, 5 + 8 + 2 + 3)
  })

  it('finalization attempts 缺失或不是数组时不计入次数，usage 不受影响', () => {
    for (const output of [null, { attemptCount: 1 }, { attempts: 'not-an-array' }]) {
      const record = createRunRecord()
      record.steps = [...record.steps, step(10, 'grounded_finalization', { output })]

      const item = projectAdminRunListItem(record)

      assert.equal(item.samplingCount, 3)
      assert.equal(item.usage.totalTokens, 83)
    }
  })

  it('finalization attempt 缺少 usage 时该项 null，次数照常', () => {
    const record = createRunRecord()
    record.steps = [
      ...record.steps,
      step(10, 'grounded_finalization', {
        output: groundedFinalizationOutput([{ ok: true, usage: null }]),
      }),
    ]

    const item = projectAdminRunListItem(record)

    assert.equal(item.samplingCount, 4)
    assert.equal(item.usage.totalTokens, null)
  })

  it('AC-03：sampling output 缺 finishReason 仍是 known Step，仅该字段为 null', () => {
    const record = createRunRecord()
    const sampling = record.steps.find(step => step.sequence === 3)!
    delete (sampling.output as Record<string, unknown>).finishReason

    const item = projectAdminRunDetail(record).timeline.find(candidate => candidate.sequence === 3)

    assert.ok(item?.kind === 'known' && item.type === 'model_sampling')
    assert.equal(item.finishReason, null)
    assert.equal(item.samplingIndex, 1)
    assert.equal(item.usage?.totalTokens, 15)
    assert.equal(item.toolCallCount, 1)
  })

  it('AC-03：usage.inputTokens 为字符串时只有该项为 null，Step 与其余 usage 照常', () => {
    const record = createRunRecord()
    const sampling = record.steps.find(step => step.sequence === 3)!
    const output = sampling.output as Record<string, unknown>
    output.usage = { ...(output.usage as Record<string, unknown>), inputTokens: '10' }

    const detail = projectAdminRunDetail(record)
    const item = detail.timeline.find(candidate => candidate.sequence === 3)

    assert.ok(item?.kind === 'known' && item.type === 'model_sampling')
    assert.deepEqual(item.usage, {
      inputTokens: null,
      outputTokens: 5,
      totalTokens: 15,
      reasoningTokens: null,
      promptCacheHitTokens: null,
      promptCacheMissTokens: null,
    })
    assert.equal(detail.usage.inputTokens, null)
    assert.equal(detail.usage.totalTokens, 83)
  })

  it('AC-03：tool step input 缺 callId 仍是 known Step，仅 callId 为 null', () => {
    const record = createRunRecord()
    const tool = record.steps.find(step => step.sequence === 4)!
    delete (tool.input as Record<string, unknown>).callId

    const item = projectAdminRunDetail(record).timeline.find(candidate => candidate.sequence === 4)

    assert.ok(item?.kind === 'known' && item.type === 'tool_execution')
    assert.equal(item.callId, null)
    assert.equal(item.toolName, 'search_articles')
    assert.equal(item.ok, true)
    assert.equal(item.truncated, true)
  })

  it('AC-03：receive_user_message 与未知 type 投影为 generic', () => {
    const detail = projectAdminRunDetail(createRunRecord())

    assert.deepEqual(
      detail.timeline
        .filter(item => item.kind === 'generic')
        .map(item => item.type),
      ['receive_user_message', 'future_retrieval'],
    )
  })

  it('input / output 整体不是对象时已知 Step 仍为 known，字段全为 null', () => {
    const record = createRunRecord()
    const sampling = record.steps.find(step => step.sequence === 3)!
    sampling.input = 'broken'
    sampling.output = ['broken']

    const item = projectAdminRunDetail(record).timeline.find(candidate => candidate.sequence === 3)

    assert.ok(item?.kind === 'known' && item.type === 'model_sampling')
    assert.equal(item.samplingIndex, null)
    assert.equal(item.finishReason, null)
    assert.equal(item.usage, null)
    assert.equal(item.contextInspector.outcome, null)
    assert.equal(item.contextInspector.resolvedModel, null)
  })

  it('AC-04：#124 之前落库的 Run 全部投影为 known 且忽略多余字段', () => {
    const detail = projectAdminRunDetail(createLegacyRunRecord())
    const serialized = JSON.stringify(detail)

    assert.deepEqual(
      detail.timeline.map(item => [item.type, item.kind]),
      [
        ['receive_user_message', 'generic'],
        ['load_conversation_history', 'known'],
        ['model_sampling', 'known'],
        ['tool_execution', 'known'],
        ['model_sampling', 'known'],
        ['grounded_finalization', 'known'],
        ['assistant_output', 'known'],
      ],
    )
    assert.doesNotMatch(
      serialized,
      /toolVersion|executionAttempt|retryable|rawArgumentsChars|requestedModel|textChars|registryTruncated|eligibleToolCallCount|schemaVersion|citationIntegrity|contentLength|estimatorStrategyId|contextWindowTokens|exchangeIndex|toolCeilingTruncated|submittedCitationKeyCount|recordedDurationMs/,
    )
    assert.doesNotMatch(serialized, /DO_NOT_LEAK/)

    const sampling = detail.timeline.find(item => item.sequence === 3)
    assert.ok(sampling?.kind === 'known' && sampling.type === 'model_sampling')
    assert.deepEqual(sampling.contextInspector, {
      outcome: 'success',
      resolvedModel: 'deepseek-v4-flash',
      providerId: null,
      modelId: null,
      resolvedInputBudgetTokens: 262_144,
      estimatedInputTokens: 120_000,
      historyCandidateCount: 2,
      historyIncludedCount: 2,
      samplingHistoryExcludedCount: 0,
      observations: [],
    })

    const tool = detail.timeline.find(item => item.sequence === 4)
    assert.ok(tool?.kind === 'known' && tool.type === 'tool_execution')
    assert.equal(tool.toolName, 'retrieve_article_context')
    assert.equal(tool.ok, true)

    const finalization = detail.timeline.find(item => item.sequence === 6)
    assert.ok(finalization?.kind === 'known' && finalization.type === 'grounded_finalization')
    assert.equal(finalization.evidenceAvailability, 'available')
    assert.equal(finalization.outcome, 'answered')
    assert.equal(finalization.attemptCount, 1)
    assert.equal(finalization.registryRefCount, 2)
    assert.equal(finalization.usage?.totalTokens, 9)
    assert.equal(detail.samplingCount, 3)
    assert.equal(detail.retrievalInspector.retrievalCalls.length, 1)
  })

  it('五类已知 Step 使用 allowlist，unknown Step 安全降级且 Timeline 按 sequence 排序', () => {
    const detail = projectAdminRunDetail(createRunRecord())
    const serialized = JSON.stringify(detail)

    assert.deepEqual(
      detail.timeline.map(item => item.sequence),
      [1, 2, 3, 4, 5, 6, 7, 8, 9],
    )
    assert.deepEqual(
      detail.timeline.slice(1, 8).map(item => item.kind),
      Array.from({ length: 7 }).fill('known'),
    )
    assert.doesNotMatch(
      serialized,
      /DO_NOT_LEAK|rawArgumentsJson|observationBody|providerPayload|reasoning_content/,
    )
    assert.doesNotMatch(serialized, /"input"|"output"|inputSummary|outputSummary|safeRawData/)
    const secondSampling = detail.timeline.find(item => item.sequence === 5)

    assert.equal(
      secondSampling?.kind === 'known' && secondSampling.type === 'model_sampling'
        ? secondSampling.providerItemCount
        : null,
      4,
    )
    const history = detail.timeline.find(item => item.sequence === 2)
    assert.equal(
      history?.kind === 'known' && history.type === 'load_conversation_history'
        ? history.messageCount
        : null,
      2,
    )
    const output = detail.timeline.find(item => item.sequence === 8)
    assert.equal(
      output?.kind === 'known' && output.type === 'assistant_output'
        ? output.assistantMessageId
        : null,
      'message-assistant',
    )
  })

  it('Response debug capture 投影 complete / partial / empty，并兼容旧 complete 信封', () => {
    const record = createRunRecord()
    const samplings = record.steps
      .filter(step => step.type === 'model_sampling')
      .sort((left, right) => left.sequence - right.sequence)
    const outputs = samplings.map(step => step.output as Record<string, unknown>)

    outputs[0]!.debugRawResponse = {
      truncated: false,
      value: { choices: [{ message: { content: 'legacy complete' } }] },
    }
    outputs[1]!.debugRawResponse = {
      state: 'partial',
      truncated: true,
      preview: '{"choices":[',
    }
    outputs[2]!.debugRawResponse = { state: 'empty' }
    outputs[2]!.debugRequestBody = { truncated: false, value: { model: 'deepseek-v4-flash' } }

    const detail = projectAdminRunDetail(record)
    const projected = detail.timeline.filter(
      item => item.kind === 'known' && item.type === 'model_sampling',
    )

    assert.deepEqual(projected.map(item => (
      item.kind === 'known' && item.type === 'model_sampling'
        ? [item.debugRawResponse, item.debugRequestBody]
        : null
    )), [
      [{
        state: 'complete',
        truncated: false,
        value: { choices: [{ message: { content: 'legacy complete' } }] },
      }, null],
      [{
        state: 'partial',
        truncated: true,
        preview: '{"choices":[',
      }, null],
      [{ state: 'empty' }, { truncated: false, value: { model: 'deepseek-v4-flash' } }],
    ])
  })

  it('Response debug capture 状态或信封损坏时按未捕获降级', () => {
    const record = createRunRecord()
    const sampling = record.steps.find(step => step.type === 'model_sampling')!
    const output = sampling.output as Record<string, unknown>

    output.debugRawResponse = {
      state: 'empty',
      value: { choices: 'MUST_NOT_PROJECT' },
    }

    const detail = projectAdminRunDetail(record)
    const projected = detail.timeline.find(item => item.id === sampling.id)

    assert.equal(
      projected?.kind === 'known' && projected.type === 'model_sampling'
        ? projected.debugRawResponse
        : undefined,
      null,
    )
    assert.doesNotMatch(JSON.stringify(detail), /MUST_NOT_PROJECT/)
  })

  it('按 Sampling 逐字段投影 Context Inspector', () => {
    const record = createRunRecord()
    attachContextMetadata(record)

    const detail = projectAdminRunDetail(record)
    const inspectors = detail.timeline.flatMap(item => (
      item.kind === 'known' && item.type === 'model_sampling'
        ? [item.contextInspector]
        : []
    ))

    assert.deepEqual(inspectors.map(item => item.outcome), ['success', 'success', 'success'])
    assert.deepEqual(inspectors.map(item => item.resolvedModel), Array.from({ length: 3 }).fill('deepseek-v4-flash'))
    assert.deepEqual(inspectors.map(item => item.estimatedInputTokens), [120_000, 180_000, 220_000])
    assert.deepEqual(inspectors.map(item => item.historyIncludedCount), [2, 1, 1])
    assert.deepEqual(inspectors.map(item => item.samplingHistoryExcludedCount), [0, 1, 1])
    assert.deepEqual(inspectors.map(item => item.observations?.length), [0, 1, 2])
    assert.deepEqual(inspectors[2]?.observations, [
      { originalChars: 100, toolCeilingChars: 80, finalChars: 64 },
      { originalChars: 101, toolCeilingChars: 101, finalChars: 101 },
    ])
    assert.doesNotMatch(
      JSON.stringify(detail),
      /DO_NOT_LEAK|prompt(?!Cache)|observationBody|reasoning_content|exchangeIndex|toolCeilingTruncated/,
    )
  })

  it('Context Inspector 的 outcome 只看 contextFailureReason / overflowReason / contextPlan 是否存在', () => {
    const estimatorFailure = createRunRecord()
    const failedSampling = estimatorFailure.steps.find(step => step.sequence === 3)!
    failedSampling.status = 'FAILED'
    failedSampling.input = {
      ...(failedSampling.input as Record<string, unknown>),
      initialContext: safeInitialContext(),
    }
    failedSampling.output = {
      messageCount: 0,
      contextFailureReason: 'estimator_failure',
    }

    const failed = projectAdminRunDetail(estimatorFailure).timeline.find(item => item.sequence === 3)
    assert.ok(failed?.kind === 'known' && failed.type === 'model_sampling')
    assert.equal(failed.contextInspector.outcome, 'estimator_failure')
    // 预算来自 initialContext；history 三项是 plan 的结果，plan 缺失时一起为 null。
    assert.equal(failed.contextInspector.resolvedInputBudgetTokens, 262_144)
    assert.equal(failed.contextInspector.historyCandidateCount, null)
    assert.equal(failed.contextInspector.historyIncludedCount, null)
    assert.equal(failed.contextInspector.samplingHistoryExcludedCount, null)
    assert.equal(failed.contextInspector.estimatedInputTokens, null)
    assert.equal(failed.providerItemCount, 0)

    const overflow = createRunRecord()
    const overflowSampling = overflow.steps.find(step => step.sequence === 3)!
    overflowSampling.output = {
      messageCount: 0,
      contextPlan: safeContextPlan('minimum_context'),
    }
    const overflowItem = projectAdminRunDetail(overflow).timeline.find(item => item.sequence === 3)
    assert.ok(overflowItem?.kind === 'known' && overflowItem.type === 'model_sampling')
    assert.equal(overflowItem.contextInspector.outcome, 'minimum_context_overflow')
    assert.equal(overflowItem.contextInspector.estimatedInputTokens, 262_145)

    const noMetadata = projectAdminRunDetail(createRunRecord()).timeline.find(item => item.sequence === 3)
    assert.ok(noMetadata?.kind === 'known' && noMetadata.type === 'model_sampling')
    assert.equal(noMetadata.contextInspector.outcome, null)
    assert.equal(noMetadata.contextInspector.observations, null)
  })

  it('Observation 单条读不出时保留位置、只把该字段置 null', () => {
    const record = createRunRecord()
    attachContextMetadata(record)
    const plan = (record.steps.find(step => step.sequence === 7)!.output as Record<string, unknown>)
      .contextPlan as Record<string, unknown>
    plan.observations = [
      { originalChars: 3, toolCeilingChars: 'x', finalChars: 1 },
      'broken',
      { originalChars: 5, toolCeilingChars: 4, finalChars: 3 },
    ]

    const item = projectAdminRunDetail(record).timeline.find(candidate => candidate.sequence === 7)

    assert.ok(item?.kind === 'known' && item.type === 'model_sampling')
    assert.deepEqual(item.contextInspector.observations, [
      { originalChars: 3, toolCeilingChars: null, finalChars: 1 },
      { originalChars: null, toolCeilingChars: null, finalChars: null },
      { originalChars: 5, toolCeilingChars: 4, finalChars: 3 },
    ])
    assert.equal(item.contextInspector.outcome, 'success')
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

  it('RUNNING / ABORTED 的 partial output 保持 typed 且 assistant Message 可缺失', () => {
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
    const runningSamplingProjection = runningDetail.timeline.at(-1)

    assert.equal(runningSamplingProjection?.kind, 'known')
    assert.equal(runningSamplingProjection?.status, 'RUNNING')
    assert.equal(
      runningSamplingProjection?.kind === 'known'
      && runningSamplingProjection.type === 'model_sampling'
        ? runningSamplingProjection.providerItemCount
        : undefined,
      null,
    )
    assert.equal(runningDetail.messages.at(-1)?.status, 'STREAMING')

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
    assert.equal(abortedDetail.retrievalInspector.citations, null)
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

  it('零 sampling 的早期终止保留 usage 未记录语义', () => {
    const record = createRunRecord()
    record.status = 'FAILED'
    record.assistantMessageId = null
    record.assistantMessage = null
    record.steps = record.steps.filter(step => step.sequence <= 2)

    const item = projectAdminRunListItem(record)

    assert.equal(item.samplingCount, 0)
    assert.deepEqual(item.usage, {
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      reasoningTokens: null,
      promptCacheHitTokens: null,
      promptCacheMissTokens: null,
    })
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

  it('conversationId 过滤进入 where 且可与其他过滤叠加；不传时不出现在 where', async () => {
    const harness = createServiceHarness()

    await harness.service.list({ conversationId: 'conv-1', status: 'FAILED' })
    const where = harness.calls.findMany[0]?.where as {
      conversationId?: string
      status?: string
    }
    assert.equal(where?.conversationId, 'conv-1')
    assert.equal(where?.status, 'FAILED')

    await harness.service.list({})
    assert.equal('conversationId' in (harness.calls.findMany[1]?.where as object), false)
  })

  it('列表查询只请求统计所需的三类 Step，且保留 output 字段', async () => {
    const harness = createServiceHarness()

    await harness.service.list({})

    const steps = (harness.calls.findMany[0]?.select as {
      steps?: {
        where?: { type?: { in?: string[] } }
        select?: Record<string, boolean>
      }
    }).steps

    // 排序后精确比对：既证明三类必需 Step 都在，也证明没有夹带无关 Step。
    assert.deepEqual([...(steps?.where?.type?.in ?? [])].sort(), [
      'grounded_finalization',
      'model_sampling',
      'tool_execution',
    ])
    assert.equal(steps?.select?.output, true)
  })

  it('列表统计包含 grounded finalization 的采样次数与 Token', async () => {
    const harness = createServiceHarness({ list: createGroundedListRecord() })

    const response = await harness.service.list({})
    const item = response.items[0]

    // 3 次 action sampling + 1 次 finalization attempt。
    assert.equal(item?.samplingCount, 4)
    assert.deepEqual(item?.usage, {
      inputTokens: 60 + 4,
      outputTokens: 23 + 1,
      totalTokens: 83 + 5,
      reasoningTokens: null,
      promptCacheHitTokens: null,
      promptCacheMissTokens: null,
    })
  })

  it('详情查询把 MessageGrounding 整行交给 projector', async () => {
    const harness = createServiceHarness()

    const detail = await harness.service.getDetail('run-1')

    assert.equal(
      (harness.calls.findUnique[0]?.select as {
        assistantMessage?: { select?: { grounding?: boolean } }
      }).assistantMessage?.select?.grounding,
      true,
    )
    assert.equal(detail.id, 'run-1')
    assert.equal(detail.timeline.length, 9)
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
  const record = runRecord()

  record.steps = [
    step(9, 'future_retrieval', {
      input: { providerPayload: 'DO_NOT_LEAK' },
      output: { reasoning: 'DO_NOT_LEAK' },
    }),
    step(8, 'assistant_output', {
      input: { assistantMessageId: 'message-assistant', extraSecret: 'DO_NOT_LEAK' },
      output: { providerPayload: 'DO_NOT_LEAK' },
    }),
    step(7, 'model_sampling', {
      input: {
        samplingIndex: 3,
        samplingAttemptId: 'run-1:sampling-3',
        reasoning: 'DO_NOT_LEAK',
      },
      output: {
        samplingAttemptId: 'run-1:sampling-3',
        messageCount: 6,
        finishReason: 'stop',
        usage: { inputTokens: 30, outputTokens: 10, totalTokens: 40 },
        toolCallCount: 0,
        providerPayload: 'DO_NOT_LEAK',
      },
    }),
    step(6, 'tool_execution', {
      status: 'FAILED',
      input: {
        callId: 'call-2',
        toolName: 'get_article_detail',
        samplingAttemptId: 'run-1:sampling-2',
        rawArgumentsJson: 'DO_NOT_LEAK',
      },
      output: {
        ok: false,
        code: 'invalid_arguments',
        originalChars: 0,
        observationChars: 0,
        truncated: false,
        observationBody: 'DO_NOT_LEAK',
      },
    }),
    step(5, 'model_sampling', {
      input: {
        samplingIndex: 2,
        samplingAttemptId: 'run-1:sampling-2',
        reasoning: 'DO_NOT_LEAK',
      },
      output: {
        samplingAttemptId: 'run-1:sampling-2',
        messageCount: 4,
        finishReason: 'tool_calls',
        usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 },
        toolCallCount: 1,
        providerPayload: 'DO_NOT_LEAK',
      },
    }),
    step(4, 'tool_execution', {
      input: {
        callId: 'call-1',
        toolName: 'search_articles',
        samplingAttemptId: 'run-1:sampling-1',
        rawArgumentsJson: 'DO_NOT_LEAK',
      },
      output: {
        ok: true,
        originalChars: 100,
        observationChars: 80,
        truncated: true,
        observationBody: 'DO_NOT_LEAK',
      },
    }),
    step(3, 'model_sampling', {
      input: {
        samplingIndex: 1,
        samplingAttemptId: 'run-1:sampling-1',
        reasoning: 'DO_NOT_LEAK',
      },
      output: {
        samplingAttemptId: 'run-1:sampling-1',
        messageCount: 2,
        finishReason: 'tool_calls',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        toolCallCount: 1,
        providerPayload: 'DO_NOT_LEAK',
      },
    }),
    step(2, 'load_conversation_history', {
      input: { prompt: 'DO_NOT_LEAK' },
      output: { messageCount: 2, truncated: 'DO_NOT_LEAK' },
    }),
    step(1, 'receive_user_message', {
      input: {
        messageId: 'message-user',
        messageLength: 14,
        prompt: 'DO_NOT_LEAK',
      },
    }),
  ]

  return record
}

/** #124 之前 runtime 落库的真实形状：含全部已停写字段。 */
function createLegacyRunRecord() {
  const record = createRunRecord()

  record.steps = [
    step(1, 'receive_user_message', {
      input: { messageId: 'message-user', messageLength: 14 },
    }),
    step(2, 'load_conversation_history', {
      input: { limit: 20 },
      output: { messageCount: 2, candidateCount: 2, excludedCount: 0, excludedReason: null },
    }),
    step(3, 'model_sampling', {
      input: {
        samplingIndex: 1,
        samplingAttemptId: 'run-1:sampling-1',
        requestedModel: null,
        candidateMessageCount: 4,
        toolCount: 3,
        initialContext: safeInitialContext(),
      },
      output: {
        samplingAttemptId: 'run-1:sampling-1',
        messageCount: 4,
        finishReason: 'tool_calls',
        usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
        toolCallCount: 1,
        textChars: 0,
        durationMs: 500,
        contextPlan: {
          samplingIndex: 1,
          resolvedInputBudgetTokens: 262_144,
          estimatedInputTokens: 120_000,
          historyCandidateCount: 2,
          historyIncludedCount: 2,
          historyExcludedCount: 0,
          toolExchangeCount: 0,
          observations: [],
          overflowReason: null,
          estimatorStrategyId: 'deepseek-v4-official-b5968e9',
        },
      },
    }),
    step(4, 'tool_execution', {
      input: {
        callId: 'call-1',
        toolName: 'retrieve_article_context',
        toolVersion: '1',
        samplingAttemptId: 'run-1:sampling-1',
        executionAttempt: 1,
        rawArgumentsChars: 48,
      },
      output: {
        ok: true,
        originalChars: 4_000,
        observationChars: 3_000,
        truncated: true,
        durationMs: 420,
        toolSummary: {
          status: 'candidates_returned',
          answerStatus: 'unverified',
          strategy: { name: 'hybrid_rrf', version: '2' },
          sourceCount: 2,
          chunkEvidenceCount: 2,
          sources: [
            { sourceId: 11, chunkId: 'chunk-a' },
            { sourceId: 12, chunkId: 'chunk-b' },
          ],
        },
      },
    }),
    step(5, 'model_sampling', {
      input: {
        samplingIndex: 2,
        samplingAttemptId: 'run-1:sampling-2',
        requestedModel: null,
        candidateMessageCount: 6,
        toolCount: 3,
        initialContext: safeInitialContext(),
      },
      output: {
        samplingAttemptId: 'run-1:sampling-2',
        messageCount: 6,
        finishReason: 'stop',
        usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 },
        toolCallCount: 0,
        textChars: 40,
        durationMs: 350,
        contextPlan: {
          samplingIndex: 2,
          resolvedInputBudgetTokens: 262_144,
          estimatedInputTokens: 180_000,
          historyCandidateCount: 2,
          historyIncludedCount: 2,
          historyExcludedCount: 0,
          toolExchangeCount: 1,
          observations: [{
            exchangeIndex: 0,
            originalChars: 4_000,
            toolCeilingChars: 3_000,
            finalChars: 3_000,
            toolCeilingTruncated: true,
            contextBudgetTruncated: false,
          }],
          overflowReason: null,
          estimatorStrategyId: 'deepseek-v4-official-b5968e9',
        },
      },
    }),
    step(6, 'grounded_finalization', {
      input: {
        assistantMessageId: 'message-assistant',
        evidenceAvailability: 'available',
        registryRefCount: 2,
        registryTruncated: false,
      },
      output: {
        evidenceAvailability: 'available',
        registryRefCount: 2,
        registryTruncated: false,
        eligibleToolCallCount: 1,
        eligibleToolFailureCount: 0,
        attemptCount: 1,
        attempts: [{
          attempt: 1,
          ok: true,
          submittedCitationKeyCount: 1,
          usage: { inputTokens: 6, outputTokens: 3, totalTokens: 9 },
          durationMs: 500,
        }],
        outcome: 'answered',
        citationCount: 1,
        citationIntegrity: 'validated',
        faithfulnessStatus: 'not_evaluated',
        schemaVersion: 1,
      },
    }),
    step(7, 'assistant_output', {
      input: { assistantMessageId: 'message-assistant' },
      output: { contentLength: 40 },
    }),
  ]

  return record
}

/** Runtime 在 startStep 就写入的 Registry 快照与归属事实。 */
function groundedFinalizationInput() {
  return {
    assistantMessageId: 'message-assistant',
    evidenceAvailability: 'available',
    registryRefCount: 2,
  }
}

function groundedFinalizationOutput(
  attempts: Array<{
    ok: boolean
    usage: { inputTokens: number, outputTokens: number, totalTokens: number } | null
  }>,
) {
  return {
    evidenceAvailability: 'available',
    registryRefCount: 2,
    attemptCount: attempts.length,
    attempts: attempts.map((attempt, index) => ({
      attempt: index + 1,
      ok: attempt.ok,
      usage: attempt.usage,
    })),
    outcome: 'answered',
    citationCount: 1,
  }
}

function attachContextMetadata(record: ReturnType<typeof createRunRecord>): void {
  const samplings = record.steps
    .filter(step => step.type === 'model_sampling')
    .sort((left, right) => left.sequence - right.sequence)
  const estimatedInputTokens = [120_000, 180_000, 220_000]

  for (const [index, sampling] of samplings.entries()) {
    const input = sampling.input as Record<string, unknown>
    const output = sampling.output as Record<string, unknown>
    const toolExchangeCount = index
    const historyIncludedCount = index === 0 ? 2 : 1

    input.initialContext = {
      ...safeInitialContext(),
      prompt: 'DO_NOT_LEAK',
    }
    output.contextPlan = {
      resolvedInputBudgetTokens: 262_144,
      estimatedInputTokens: estimatedInputTokens[index],
      historyCandidateCount: 2,
      historyIncludedCount,
      observations: Array.from({ length: toolExchangeCount }, (_, exchangeIndex) => {
        const originalChars = 100 + exchangeIndex
        const toolCeilingChars = exchangeIndex === 0 ? 80 : originalChars
        const contextBudgetTruncated = index === 2 && exchangeIndex === 0

        return {
          exchangeIndex,
          originalChars,
          toolCeilingChars,
          finalChars: contextBudgetTruncated ? 64 : toolCeilingChars,
          toolCeilingTruncated: exchangeIndex === 0,
          contextBudgetTruncated,
          observationBody: 'DO_NOT_LEAK',
        }
      }),
      overflowReason: null,
      futureSafeField: true,
    }
  }
}

function safeInitialContext(): Prisma.JsonObject {
  return {
    resolvedModel: 'deepseek-v4-flash',
    contextWindowTokens: 1_000_000,
    applicationInputCapTokens: 262_144,
    resolvedInputBudgetTokens: 262_144,
    resolvedMaxOutputTokens: 65_536,
    safetyMarginTokens: 16_384,
    estimatedMandatoryTokens: 100,
    historyBudgetTokens: 262_044,
    estimatedInputTokens: 200,
    historyCandidateCount: 2,
    historyIncludedCount: 2,
    historyExcludedCount: 0,
    excludedReason: null,
    estimatorStrategyId: 'deepseek-v4-official-b5968e9',
  }
}

function safeContextPlan(
  overflowReason: 'minimum_context' | null,
): Prisma.JsonObject {
  return {
    resolvedInputBudgetTokens: 262_144,
    estimatedInputTokens: 262_145,
    historyCandidateCount: 2,
    historyIncludedCount: 0,
    observations: [],
    overflowReason,
  }
}

function createServiceHarness(options: {
  detail?: ReturnType<typeof createRunRecord> | null
  list?: ReturnType<typeof createRunRecord>
} = {}) {
  const calls = {
    findMany: [] as Array<Record<string, unknown>>,
    findUnique: [] as Array<Record<string, unknown>>,
    groupBy: [] as Array<Record<string, unknown>>,
  }
  const record = createRunRecord()
  const listRecord = options.list ?? record
  const prisma = {
    agentRun: {
      async findMany(args: Record<string, unknown>) {
        calls.findMany.push(args)
        // 模拟 Prisma 真实行为：只返回 list select allowlist 内的 Step。
        const allowedTypes = readListStepTypes(args)
        return [{
          ...listRecord,
          steps: listRecord.steps.filter(step => allowedTypes.includes(step.type)),
        }]
      },
      async groupBy(args: Record<string, unknown>) {
        calls.groupBy.push(args)
        return [
          { status: 'FAILED', _count: { _all: 1 } },
        ]
      },
      async findUnique(args: Record<string, unknown>) {
        calls.findUnique.push(args)
        return options.detail === undefined ? record : options.detail
      },
    },
  } as unknown as PrismaService

  return {
    calls,
    service: new AdminRunsService(prisma),
  }
}

function readListStepTypes(args: Record<string, unknown>): string[] {
  const select = args.select as {
    steps?: { where?: { type?: { in?: string[] } } }
  } | undefined

  return select?.steps?.where?.type?.in ?? []
}

/** 列表 Run 记录：追加一次成功的 finalization attempt。 */
function createGroundedListRecord() {
  const record = createRunRecord()

  record.steps = [
    ...record.steps,
    step(10, 'grounded_finalization', {
      input: groundedFinalizationInput(),
      output: groundedFinalizationOutput([
        { ok: true, usage: { inputTokens: 4, outputTokens: 1, totalTokens: 5 } },
      ]),
    }),
  ]

  return record
}
