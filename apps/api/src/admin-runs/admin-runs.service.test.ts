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
    const item = projectAdminRunListItem(createRunRecord(), null)

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

    const item = projectAdminRunListItem(record, null)

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

    const detail = projectAdminRunDetail(record, null)

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

  it('调用口径与概览一致：没有 usage 又不是 llm_* 失败的不算调用，也不把 Token 变成未记录', () => {
    const record = createRunRecord()
    record.steps = [
      ...record.steps,
      // 估算失败 / 上下文溢出 / 请求前取消：从未发出请求。
      step(10, 'model_sampling', { status: 'FAILED', output: { contextFailureReason: 'estimator_failure' } }),
      step(11, 'model_sampling', { status: 'ABORTED', output: { usage: null, errorCode: 'aborted' } }),
    ]

    const item = projectAdminRunListItem(record, null)

    assert.equal(item.samplingCount, 3)
    assert.equal(item.usage.totalTokens, 83)
  })

  it('以 llm_* 类别失败的调用计入次数，Token 只汇总带 usage 的调用', () => {
    const record = createRunRecord()
    record.status = 'FAILED'
    record.errorCode = 'llm_auth'
    record.steps = [
      ...record.steps,
      step(10, 'model_sampling', { status: 'FAILED', output: { usage: null, errorCode: 'llm_auth' } }),
    ]

    const failed = projectAdminRunListItem(record, null)

    assert.equal(failed.samplingCount, 3 + 1)
    assert.equal(failed.usage.totalTokens, 83)
  })

  it('失败文案只认终态事务里与 Run 一起收口的 Step；成功 Run 与两 Step 之间中断为 null', () => {
    const record = createRunRecord()
    // 更早失败、已回喂模型的工具 Step：有自己的 endedAt，与终态无关。
    record.steps.find(candidate => candidate.sequence === 6)!.errorMessage = '工具 search_articles 返回 invalid_arguments。'

    assert.equal(projectAdminRunListItem(record, null).failureMessage, null)

    record.status = 'ABORTED'
    record.errorCode = 'aborted'
    assert.equal(projectAdminRunListItem(record, null).failureMessage, null)

    record.status = 'FAILED'
    record.errorCode = 'llm_auth'
    const sampling = record.steps.find(candidate => candidate.sequence === 7)!
    sampling.errorMessage = 'AI 服务认证失败，请检查服务端模型配置'
    sampling.endedAt = record.endedAt

    assert.equal(projectAdminRunListItem(record, null).failureMessage, 'AI 服务认证失败，请检查服务端模型配置')
  })

  it('AC-03：sampling output 缺 finishReason 仍是 known Step，仅该字段为 null', () => {
    const record = createRunRecord()
    const sampling = record.steps.find(step => step.sequence === 3)!
    delete (sampling.output as Record<string, unknown>).finishReason

    const item = projectAdminRunDetail(record, null).timeline.find(candidate => candidate.sequence === 3)

    assert.ok(item?.kind === 'known' && item.type === 'model_sampling', 'item?.kind === \'known\' && item.type === \'model_sampling\'')
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

    const detail = projectAdminRunDetail(record, null)
    const item = detail.timeline.find(candidate => candidate.sequence === 3)

    assert.ok(item?.kind === 'known' && item.type === 'model_sampling', 'item?.kind === \'known\' && item.type === \'model_sampling\'')
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

    const item = projectAdminRunDetail(record, null).timeline.find(candidate => candidate.sequence === 4)

    assert.ok(item?.kind === 'known' && item.type === 'tool_execution', 'item?.kind === \'known\' && item.type === \'tool_execution\'')
    assert.equal(item.callId, null)
    assert.equal(item.toolName, 'search_articles')
    assert.equal(item.ok, true)
    assert.equal(item.truncated, true)
  })

  it('AC-03：receive_user_message 与未知 type 投影为 generic', () => {
    const detail = projectAdminRunDetail(createRunRecord(), null)

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

    const item = projectAdminRunDetail(record, null).timeline.find(candidate => candidate.sequence === 3)

    assert.ok(item?.kind === 'known' && item.type === 'model_sampling', 'item?.kind === \'known\' && item.type === \'model_sampling\'')
    assert.equal(item.samplingIndex, null)
    assert.equal(item.finishReason, null)
    assert.equal(item.usage, null)
    assert.equal(item.contextInspector.outcome, null)
    assert.equal(item.contextInspector.resolvedModel, null)
  })

  it('AC-04：#124 之前落库的 Run 全部投影为 known 且忽略多余字段', () => {
    const detail = projectAdminRunDetail(createLegacyRunRecord(), null)
    const serialized = JSON.stringify(detail)

    assert.deepEqual(
      detail.timeline.map(item => [item.type, item.kind]),
      [
        ['receive_user_message', 'generic'],
        ['load_conversation_history', 'known'],
        ['model_sampling', 'known'],
        ['tool_execution', 'known'],
        ['model_sampling', 'known'],
        // #185 删除后不再有这类 Step：老数据按通用 Step 显示。
        ['grounded_finalization', 'generic'],
        ['assistant_output', 'known'],
      ],
    )
    assert.doesNotMatch(
      serialized,
      /toolVersion|executionAttempt|retryable|rawArgumentsChars|requestedModel|textChars|contentLength|estimatorStrategyId|contextWindowTokens|exchangeIndex|toolCeilingTruncated|recordedDurationMs/,
    )
    assert.doesNotMatch(serialized, /DO_NOT_LEAK/)

    const sampling = detail.timeline.find(item => item.sequence === 3)
    assert.ok(sampling?.kind === 'known' && sampling.type === 'model_sampling', 'sampling?.kind === \'known\' && sampling.type === \'model_sampling\'')
    // 旧 contextPlan 带过 historyIncludedCount，照读；候选条数取自 load_conversation_history。
    assert.deepEqual(sampling.contextInspector, {
      outcome: 'success',
      resolvedModel: 'deepseek-v4-flash',
      providerId: null,
      modelId: null,
      resolvedInputBudgetTokens: 262_144,
      estimatedInputTokens: 120_000,
      historyIncludedCount: 2,
      historyCandidateCount: 2,
    })
    assert.equal(sampling.intermediateText, null)
    assert.equal(sampling.reasoningContent, null)

    // 旧 Run 没有落参数与 observation：投影为 null，不报错。已删除工具的老 Step 照常按工具 Step 显示。
    const tool = detail.timeline.find(item => item.sequence === 4)
    assert.ok(tool?.kind === 'known' && tool.type === 'tool_execution', 'tool?.kind === \'known\' && tool.type === \'tool_execution\'')
    assert.equal(tool.toolName, 'retrieve_article_context')
    assert.equal(tool.ok, true)
    assert.equal(tool.arguments, null)
    assert.equal(tool.observation, null)

    // 第 6 步这类老 Step 的 attempt 不再计入模型调用，只剩两次 action sampling。
    assert.equal(detail.samplingCount, 2)
    assert.equal(detail.usage.totalTokens, 15 + 28)
  })

  it('四类已知 Step 使用 allowlist，unknown Step 安全降级且 Timeline 按 sequence 排序', () => {
    const detail = projectAdminRunDetail(createRunRecord(), null)
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

    const detail = projectAdminRunDetail(record, null)
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

    const detail = projectAdminRunDetail(record, null)
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

    const detail = projectAdminRunDetail(record, null)
    const inspectors = detail.timeline.flatMap(item => (
      item.kind === 'known' && item.type === 'model_sampling'
        ? [item.contextInspector]
        : []
    ))

    assert.deepEqual(inspectors.map(item => item.outcome), ['success', 'success', 'success'])
    assert.deepEqual(inspectors.map(item => item.resolvedModel), Array.from({ length: 3 }).fill('deepseek-v4-flash'))
    assert.deepEqual(inspectors.map(item => item.estimatedInputTokens), [120_000, 180_000, 220_000])
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

    const failed = projectAdminRunDetail(estimatorFailure, null).timeline.find(item => item.sequence === 3)
    assert.ok(failed?.kind === 'known' && failed.type === 'model_sampling', 'failed?.kind === \'known\' && failed.type === \'model_sampling\'')
    assert.equal(failed.contextInspector.outcome, 'estimator_failure')
    // 预算来自 initialContext；估算 Token 是 plan 的结果，plan 缺失时为 null。
    assert.equal(failed.contextInspector.resolvedInputBudgetTokens, 262_144)
    assert.equal(failed.contextInspector.estimatedInputTokens, null)

    const overflow = createRunRecord()
    const overflowSampling = overflow.steps.find(step => step.sequence === 3)!
    overflowSampling.output = {
      messageCount: 0,
      contextPlan: safeContextPlan('minimum_context'),
    }
    const overflowItem = projectAdminRunDetail(overflow, null).timeline.find(item => item.sequence === 3)
    assert.ok(overflowItem?.kind === 'known' && overflowItem.type === 'model_sampling', 'overflowItem?.kind === \'known\' && overflowItem.type === \'model_sampling\'')
    assert.equal(overflowItem.contextInspector.outcome, 'minimum_context_overflow')
    assert.equal(overflowItem.contextInspector.estimatedInputTokens, 262_145)

    const noMetadata = projectAdminRunDetail(createRunRecord(), null).timeline.find(item => item.sequence === 3)
    assert.ok(noMetadata?.kind === 'known' && noMetadata.type === 'model_sampling', 'noMetadata?.kind === \'known\' && noMetadata.type === \'model_sampling\'')
    assert.equal(noMetadata.contextInspector.outcome, null)
  })

  it('Run 四种状态都能投影且只有终态计算 duration', () => {
    for (const status of ['RUNNING', 'COMPLETED', 'FAILED', 'ABORTED'] as const) {
      const record = createRunRecord()
      record.status = status
      record.endedAt = status === 'RUNNING' ? null : new Date('2026-08-09T00:00:03.000Z')

      const item = projectAdminRunListItem(record, null)

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

    const runningDetail = projectAdminRunDetail(running, null)
    const runningSamplingProjection = runningDetail.timeline.at(-1)

    assert.equal(runningSamplingProjection?.kind, 'known')
    assert.equal(runningSamplingProjection?.status, 'RUNNING')
    assert.equal(runningDetail.messages.at(-1)?.status, 'STREAMING')

    const aborted = createRunRecord()
    aborted.status = 'ABORTED'
    aborted.assistantMessageId = null
    aborted.assistantMessage = null
    aborted.steps = aborted.steps.filter(step => step.sequence <= 3)
    const abortedSampling = aborted.steps.find(step => step.sequence === 3)!
    abortedSampling.status = 'ABORTED'
    abortedSampling.output = null

    const abortedDetail = projectAdminRunDetail(aborted, null)
    assert.equal(abortedDetail.timeline.at(-1)?.kind, 'known')
    assert.equal(abortedDetail.timeline.at(-1)?.status, 'ABORTED')
    assert.deepEqual(abortedDetail.messages.map(message => message.role), ['USER'])
  })

  it('Message 固定按 Run 的 user / assistant 关系排序，不用同毫秒 ID 猜顺序', () => {
    const record = createRunRecord()
    record.userMessage.id = 'z-user'
    record.assistantMessage!.id = 'a-assistant'
    record.assistantMessage!.createdAt = record.userMessage.createdAt

    const detail = projectAdminRunDetail(record, null)

    assert.deepEqual(detail.messages.map(message => message.role), [
      'USER',
      'ASSISTANT',
    ])
  })

  it('#151 errorCode 与 firstTokenMs：新 Run 原样投影，旧 Run 与非法值读成 null', () => {
    const failed = createRunRecord()
    failed.status = 'FAILED'
    failed.errorCode = 'llm_auth'
    const failedSampling = failed.steps.find(step => step.sequence === 7)!
    failedSampling.output = {
      ...(failedSampling.output as Record<string, unknown>),
      firstTokenMs: 812,
      errorCode: 'llm_auth',
    }

    const failedDetail = projectAdminRunDetail(failed, null)
    const failedSamplingItem = failedDetail.timeline.find(item => item.sequence === 7)

    assert.equal(projectAdminRunListItem(failed, null).errorCode, 'llm_auth')
    assert.equal(failedDetail.errorCode, 'llm_auth')
    assert.ok(failedSamplingItem?.kind === 'known' && failedSamplingItem.type === 'model_sampling', 'failedSamplingItem?.kind === \'known\' && failedSamplingItem.type === \'model_sampling\'')
    assert.equal(failedSamplingItem.firstTokenMs, 812)
    assert.equal(failedSamplingItem.errorCode, 'llm_auth')

    // 字段上线前的旧 Run：列为 null、Step output 没有这两个键，前端显示「未记录」。
    const legacyDetail = projectAdminRunDetail(createLegacyRunRecord(), null)
    const legacySampling = legacyDetail.timeline.find(item => item.sequence === 3)

    assert.equal(legacyDetail.errorCode, null)
    assert.ok(legacySampling?.kind === 'known' && legacySampling.type === 'model_sampling', 'legacySampling?.kind === \'known\' && legacySampling.type === \'model_sampling\'')
    assert.equal(legacySampling.firstTokenMs, null)
    assert.equal(legacySampling.errorCode, null)

    const corrupted = createRunRecord()
    corrupted.errorCode = 'not_a_code'
    const corruptedSampling = corrupted.steps.find(step => step.sequence === 7)!
    corruptedSampling.output = {
      ...(corruptedSampling.output as Record<string, unknown>),
      firstTokenMs: -1,
      errorCode: 'provider_secret',
    }

    const corruptedDetail = projectAdminRunDetail(corrupted, null)
    const corruptedSamplingItem = corruptedDetail.timeline.find(item => item.sequence === 7)

    assert.equal(corruptedDetail.errorCode, null)
    assert.ok(corruptedSamplingItem?.kind === 'known' && corruptedSamplingItem.type === 'model_sampling', 'corruptedSamplingItem?.kind === \'known\' && corruptedSamplingItem.type === \'model_sampling\'')
    assert.equal(corruptedSamplingItem.firstTokenMs, null)
    assert.equal(corruptedSamplingItem.errorCode, null)
  })

  it('零 sampling 的早期终止保留 usage 未记录语义', () => {
    const record = createRunRecord()
    record.status = 'FAILED'
    record.assistantMessageId = null
    record.assistantMessage = null
    record.steps = record.steps.filter(step => step.sequence <= 2)

    const item = projectAdminRunListItem(record, null)

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

  it('列表不读整列 Step JSON：Run 查询不带 steps，Step 另用 SQL 只取需要的路径', async () => {
    const harness = createServiceHarness()

    await harness.service.list({ errorCode: 'llm_auth' })

    assert.equal('steps' in (harness.calls.findMany[0]?.select as object), false)
    assert.equal((harness.calls.findMany[0]?.where as { errorCode?: string }).errorCode, 'llm_auth')
    assert.equal(harness.calls.queryRaw.length, 1)
    const query = harness.calls.queryRaw[0]!
    assert.doesNotMatch(query.sql, /debug/i)
    // 整列只能出现在 `->` 左边（取路径）或作为别名，不能被原样选出。
    assert.doesNotMatch(query.sql, /(?<!AS )"(input|output)"(?!\s*->)/)
    // 两类统计 Step 都在参数里，且只查本页的 Run。
    for (const type of ['model_sampling', 'tool_execution'])
      assert.ok(query.values.includes(type), 'query.values.includes(type)')
    assert.ok(query.values.some(value => Array.isArray(value) && value.includes('run-1')), 'query.values.some(value => Array.isArray(value) && value.includes(\'run-1\'))')
  })

  it('模型列按 modelId 关联模型行；模型行已删除时显示 wire name 并标 deleted', async () => {
    const record = createRunRecord()
    for (const candidate of record.steps.filter(item => item.type === 'model_sampling'))
      candidate.input = { ...(candidate.input as object), initialContext: { modelId: 'model-1', resolvedModel: 'deepseek-v4-flash' } }

    const found = createServiceHarness({
      list: record,
      models: [{ id: 'model-1', displayName: 'DeepSeek V4 Flash', wireName: 'deepseek-v4-flash', provider: { family: 'deepseek' } }],
    })
    const [item] = (await found.service.list({})).items

    assert.deepEqual(item?.model, {
      modelId: 'model-1',
      displayName: 'DeepSeek V4 Flash',
      wireName: 'deepseek-v4-flash',
      family: 'deepseek',
      deleted: false,
    })
    assert.deepEqual(found.calls.llmModelFindMany[0]?.where, { id: { in: ['model-1'] } })

    const deleted = createServiceHarness({ list: record, models: [] })
    assert.deepEqual((await deleted.service.list({})).items[0]?.model, {
      modelId: 'model-1',
      displayName: 'deepseek-v4-flash',
      wireName: 'deepseek-v4-flash',
      family: null,
      deleted: true,
    })

    // 没有任何采样快照的旧 Run：模型为 null，前端显示「未记录」。
    const legacy = createServiceHarness()
    assert.equal((await legacy.service.list({})).items[0]?.model, null)
    assert.equal(legacy.calls.llmModelFindMany.length, 0)
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
        toolName: 'search_articles',
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

/** #124 之前 runtime 落库的真实形状：含已停写字段（第 6 步只留计数相关的 attempts）。 */
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
      output: {
        attemptCount: 1,
        attempts: [{
          attempt: 1,
          ok: true,
          usage: { inputTokens: 6, outputTokens: 3, totalTokens: 9 },
        }],
      },
    }),
    step(7, 'assistant_output', {
      input: { assistantMessageId: 'message-assistant' },
      output: { contentLength: 40 },
    }),
  ]

  return record
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
  models?: Array<{ id: string, displayName: string, wireName: string, provider: { family: string } }>
} = {}) {
  const calls = {
    findMany: [] as Array<Record<string, unknown>>,
    findUnique: [] as Array<Record<string, unknown>>,
    groupBy: [] as Array<Record<string, unknown>>,
    queryRaw: [] as Prisma.Sql[],
    llmModelFindMany: [] as Array<Record<string, unknown>>,
  }
  const record = createRunRecord()
  const listRecord = options.list ?? record
  const prisma = {
    agentRun: {
      async findMany(args: Record<string, unknown>) {
        calls.findMany.push(args)
        const { steps: _steps, ...run } = listRecord
        return [run]
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
    // 模拟列表 Step SQL 的真实行为：只回两类统计 Step 与失败 / 中断 Run 终态收口的带错误文案 Step，JSON 只留需要的路径。
    async $queryRaw(query: Prisma.Sql) {
      calls.queryRaw.push(query)
      return listRecord.steps
        .filter(candidate => ['model_sampling', 'tool_execution'].includes(candidate.type)
          || (candidate.errorMessage !== null
            && (listRecord.status === 'FAILED' || listRecord.status === 'ABORTED')
            && candidate.endedAt?.getTime() === listRecord.endedAt?.getTime()))
        .map(candidate => toListStepRow(listRecord.id, candidate))
    },
    llmModel: {
      async findMany(args: Record<string, unknown>) {
        calls.llmModelFindMany.push(args)
        return options.models ?? []
      },
    },
  } as unknown as PrismaService

  return {
    calls,
    service: new AdminRunsService(prisma),
  }
}

function toListStepRow(runId: string, candidate: ReturnType<typeof step>) {
  const input = candidate.input as Record<string, unknown> | null
  const output = candidate.output as Record<string, unknown> | null

  return {
    runId,
    sequence: candidate.sequence,
    type: candidate.type,
    status: candidate.status,
    errorMessage: candidate.errorMessage,
    endedAt: candidate.endedAt,
    input: candidate.type === 'model_sampling' ? { initialContext: input?.initialContext ?? null } : null,
    output: candidate.type === 'model_sampling'
      ? { usage: output?.usage ?? null, errorCode: output?.errorCode ?? null }
      : null,
  }
}
