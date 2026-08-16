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
      messageCount: 4,
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

  it('grounded finalization 计入总采样次数与 Token 汇总', () => {
    const record = createRunRecord()

    record.steps = [
      ...record.steps,
      step(10, 'grounded_finalization', {
        input: {
          assistantMessageId: 'message-assistant',
          evidenceAvailability: 'available',
          registryRefCount: 2,
          registryTruncated: false,
        },
        output: groundedFinalizationOutput([
          { ok: false, usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7 } },
          { ok: true, usage: { inputTokens: 6, outputTokens: 3, totalTokens: 9 } },
        ]),
      }),
    ]

    const item = projectAdminRunListItem(record)

    // 3 次 action sampling + 2 次 finalization attempt。
    assert.equal(item.samplingCount, 5)
    assert.equal(item.inputTokens, 60 + 11)
    assert.equal(item.outputTokens, 23 + 5)
    assert.equal(item.totalTokens, 83 + 16)
  })

  it('单次成功的 finalization 也计入采样次数', () => {
    const record = createRunRecord()

    record.steps = [
      ...record.steps,
      step(10, 'grounded_finalization', {
        output: groundedFinalizationOutput([
          { ok: true, usage: { inputTokens: 4, outputTokens: 1, totalTokens: 5 } },
        ]),
      }),
    ]

    const item = projectAdminRunListItem(record)

    assert.equal(item.samplingCount, 4)
    assert.equal(item.totalTokens, 88)
  })

  it('finalization metadata 损坏时 fail closed：Token 汇总为 null，次数不少算', () => {
    const malformedOutputs: unknown[] = [
      null,
      { attemptCount: 1 },
      { attemptCount: 1, attempts: 'not-an-array' },
      // attemptCount 与 attempts 长度不一致
      { attemptCount: 3, attempts: [{ ok: true, usage: null }] },
      // 超出 v1 的 attempt 上限
      {
        attemptCount: 3,
        attempts: [{ ok: true }, { ok: true }, { ok: true }],
      },
      // attempt 结构非法
      { attemptCount: 1, attempts: [{ usage: null }] },
    ]

    for (const output of malformedOutputs) {
      const record = createRunRecord()

      record.steps = [
        ...record.steps,
        step(10, 'grounded_finalization', { output }),
      ]

      const item = projectAdminRunListItem(record)

      // Step 存在就说明至少发生过一次模型调用，绝不少算成 0。
      assert.equal(item.samplingCount, 4)
      assert.equal(item.inputTokens, null)
      assert.equal(item.outputTokens, null)
      assert.equal(item.totalTokens, null)
    }
  })

  it('finalization attempt 缺少 usage 时不伪造 Token 数字', () => {
    const record = createRunRecord()

    record.steps = [
      ...record.steps,
      step(10, 'grounded_finalization', {
        output: groundedFinalizationOutput([{ ok: true, usage: null }]),
      }),
    ]

    const item = projectAdminRunListItem(record)

    assert.equal(item.samplingCount, 4)
    assert.equal(item.totalTokens, null)
  })

  it('action sampling metadata 损坏时 Token 汇总整体为 null，不输出部分总数', () => {
    const record = createRunRecord()
    const secondSampling = record.steps.find(step => step.sequence === 5)!

    // 破坏一条 action sampling 的 metadata，但 finalization usage 完全合法。
    secondSampling.output = { providerPayload: 'DO_NOT_LEAK' }
    record.steps = [
      ...record.steps,
      step(10, 'grounded_finalization', {
        output: groundedFinalizationOutput([
          { ok: true, usage: { inputTokens: 4, outputTokens: 1, totalTokens: 5 } },
        ]),
      }),
    ]

    const item = projectAdminRunListItem(record)

    // 次数仍然正确：3 次 action sampling + 1 次 finalization。
    assert.equal(item.samplingCount, 4)
    // 但 Token 是 all-or-nothing：不能只报 finalization 那部分。
    assert.equal(item.inputTokens, null)
    assert.equal(item.outputTokens, null)
    assert.equal(item.totalTokens, null)
  })

  it('sampling 与 finalization 都可信时才给出 Token 总数', () => {
    const record = createRunRecord()

    record.steps = [
      ...record.steps,
      step(10, 'grounded_finalization', {
        output: groundedFinalizationOutput([
          { ok: false, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
          { ok: true, usage: { inputTokens: 2, outputTokens: 2, totalTokens: 4 } },
        ]),
      }),
    ]

    const item = projectAdminRunListItem(record)

    assert.equal(item.samplingCount, 5)
    assert.equal(item.totalTokens, 89)
  })

  it('采样故障的 finalization attempt 同样计入 samplingCount', () => {
    const record = createRunRecord()

    record.steps = [
      ...record.steps,
      step(10, 'grounded_finalization', {
        status: 'FAILED',
        output: {
          ...groundedFinalizationOutput([{ ok: false, usage: null }]),
          failureReason: 'sampling_incomplete',
          samplingFailure: 'missing_response_completed',
        },
      }),
    ]

    const item = projectAdminRunListItem(record)

    assert.equal(item.samplingCount, 4)
    // usage 无法确认，整体 fail closed。
    assert.equal(item.totalTokens, null)
  })

  it('ABORTED 的 finalization Step 同样计入 samplingCount 并保留 usage', () => {
    const record = createRunRecord()

    // 模型流已经完整结束、usage 已收到，随后 Abort 生效：
    // 这次调用是既成事实，Run 的采样次数与 Token 都必须包含它。
    record.steps = [
      ...record.steps,
      step(10, 'grounded_finalization', {
        status: 'ABORTED',
        output: groundedFinalizationOutput([
          { ok: false, usage: { inputTokens: 19, outputTokens: 6, totalTokens: 25 } },
        ]),
      }),
    ]

    const item = projectAdminRunListItem(record)

    assert.equal(item.samplingCount, 4)
    assert.equal(item.inputTokens, 60 + 19)
    assert.equal(item.outputTokens, 23 + 6)
    assert.equal(item.totalTokens, 83 + 25)
  })

  // Task 3C 起 grounded_finalization 有 typed 投影；metadata 合法时不再落入
  // Generic fallback，但 allowlist 之外的字段仍然一个都不能出现在响应里。
  it('grounded finalization 在 Timeline 中 typed 投影，不泄漏内部 metadata', () => {
    const record = createRunRecord()

    record.steps = [
      ...record.steps,
      step(10, 'grounded_finalization', {
        input: {
          ...groundedFinalizationInput(),
          hiddenDraft: 'DO_NOT_LEAK',
        },
        output: {
          ...groundedFinalizationOutput([{ ok: true, usage: null }]),
          providerPayload: 'DO_NOT_LEAK',
        },
      }),
    ]

    const detail = projectAdminRunDetail(record)
    const serialized = JSON.stringify(detail)
    const finalizationItem = detail.timeline.find(
      item => item.type === 'grounded_finalization',
    )

    assert.ok(finalizationItem)
    assert.equal(finalizationItem.kind, 'known')
    assert.doesNotMatch(serialized, /DO_NOT_LEAK/)
  })

  it('grounded finalization 缺少必备 input 事实时回落 Generic fallback', () => {
    const record = createRunRecord()

    record.steps = [
      ...record.steps,
      step(10, 'grounded_finalization', {
        input: { hiddenDraft: 'DO_NOT_LEAK' },
        output: groundedFinalizationOutput([{ ok: true, usage: null }]),
      }),
    ]

    const finalizationItem = projectAdminRunDetail(record).timeline.find(
      item => item.type === 'grounded_finalization',
    )

    assert.ok(finalizationItem)
    assert.equal(finalizationItem.kind, 'generic')
  })

  it('grounded finalization metadata 损坏时仍回落 Generic fallback', () => {
    const record = createRunRecord()

    record.steps = [
      ...record.steps,
      step(10, 'grounded_finalization', {
        input: groundedFinalizationInput(),
        output: {
          ...groundedFinalizationOutput([{ ok: true, usage: null }]),
          // registryRefCount 与 evidenceAvailability 自相矛盾。
          registryRefCount: 0,
          providerPayload: 'DO_NOT_LEAK',
        },
      }),
    ]

    const detail = projectAdminRunDetail(record)
    const finalizationItem = detail.timeline.find(
      item => item.type === 'grounded_finalization',
    )

    assert.ok(finalizationItem)
    assert.equal(finalizationItem.kind, 'generic')
    assert.doesNotMatch(JSON.stringify(detail), /DO_NOT_LEAK/)
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
    const secondSampling = detail.timeline.find(item => item.sequence === 5)

    assert.equal(
      secondSampling?.kind === 'known'
      && secondSampling.type === 'model_sampling'
        ? secondSampling.providerItemCount
        : null,
      4,
    )
  })

  it('按 Sampling 投影安全 Context Inspector，并区分三种 item count 与 Tool Exchange 0/1/2', () => {
    const record = createRunRecord()
    attachContextMetadata(record)

    const detail = projectAdminRunDetail(record)
    const samplings = detail.timeline.filter(item => (
      item.kind === 'known' && item.type === 'model_sampling'
    ))
    const inspectors = samplings.map((item) => {
      if (item.type !== 'model_sampling')
        assert.fail('expected model_sampling')
      return item.contextInspector
    })

    assert.deepEqual(
      samplings.map(item => item.type === 'model_sampling'
        ? item.providerItemCount
        : null),
      [4, 5, 7],
    )
    assert.deepEqual(inspectors.map(item => item.prePlanItemCount), [4, 6, 7])
    assert.deepEqual(inspectors.map(item => item.toolExchangeCount), [0, 1, 2])
    assert.deepEqual(
      inspectors.map(item => item.availability),
      ['available', 'available', 'available'],
    )
    assert.deepEqual(
      inspectors.map(item => item.outcome),
      ['success', 'success', 'success'],
    )
    assert.equal(inspectors[0]?.resolvedModel, 'deepseek-v4-flash')
    assert.equal(inspectors[0]?.requestedModel, null)
    assert.equal(inspectors[0]?.budgetUsageRatio, 120_000 / 262_144)
    assert.deepEqual(
      inspectors.map(item => item.samplingHistoryExcludedCount),
      [0, 1, 1],
    )
    assert.equal(inspectors[1]?.observations?.[0]?.toolCeilingTruncated, true)
    assert.equal(inspectors[1]?.observations?.[0]?.contextBudgetTruncated, false)
    assert.deepEqual(inspectors[2]?.observations, [
      {
        exchangeIndex: 0,
        originalChars: 100,
        toolCeilingChars: 80,
        finalChars: 64,
        toolCeilingTruncated: true,
        contextBudgetTruncated: true,
      },
      {
        exchangeIndex: 1,
        originalChars: 101,
        toolCeilingChars: 101,
        finalChars: 101,
        toolCeilingTruncated: false,
        contextBudgetTruncated: false,
      },
    ])
    assert.doesNotMatch(
      JSON.stringify(detail),
      /DO_NOT_LEAK|prompt|observationBody|reasoning/,
    )
  })

  it('sampling estimator failure 使用安全枚举，且 Context metadata 不一致只降级 Inspector', () => {
    const estimatorFailure = createRunRecord()
    estimatorFailure.status = 'FAILED'
    estimatorFailure.steps = estimatorFailure.steps.filter(step => step.sequence <= 3)
    const failedSampling = estimatorFailure.steps.find(step => step.sequence === 3)!
    failedSampling.status = 'FAILED'
    failedSampling.input = {
      ...(failedSampling.input as Record<string, unknown>),
      initialContext: safeInitialContext(),
    }
    failedSampling.output = {
      durationMs: 25,
      messageCount: 0,
      contextFailureReason: 'estimator_failure',
    }

    const failedProjection = projectAdminRunDetail(estimatorFailure).timeline.at(-1)

    assert.equal(failedProjection?.kind, 'known')
    assert.equal(
      failedProjection?.type === 'model_sampling'
        ? failedProjection.contextInspector.availability
        : null,
      'partial',
    )
    assert.equal(
      failedProjection?.type === 'model_sampling'
        ? failedProjection.contextInspector.outcome
        : null,
      'estimator_failure',
    )
    assert.equal(
      failedProjection?.type === 'model_sampling'
        ? failedProjection.providerItemCount
        : null,
      0,
    )
    assert.doesNotMatch(JSON.stringify(failedProjection), /DO_NOT_LEAK/)

    const mismatched = createRunRecord()
    attachContextMetadata(mismatched)
    const secondSampling = mismatched.steps.find(step => step.sequence === 5)!
    const contextPlan = (
      secondSampling.output as Record<string, unknown>
    ).contextPlan as Record<string, unknown>
    contextPlan.samplingIndex = 3

    const mismatchedProjection = projectAdminRunDetail(mismatched).timeline.find(
      item => item.sequence === 5,
    )

    assert.equal(mismatchedProjection?.kind, 'known')
    assert.equal(
      mismatchedProjection?.type === 'model_sampling'
        ? mismatchedProjection.contextInspector.availability
        : null,
      'partial',
    )
    assert.equal(
      mismatchedProjection?.type === 'model_sampling'
        ? mismatchedProjection.contextInspector.outcome
        : null,
      'unavailable',
    )

    for (const [estimatedInputTokens, overflowReason] of [
      [262_145, null],
      [262_144, 'minimum_context'],
    ] as const) {
      const contradictoryBudget = createRunRecord()
      attachContextMetadata(contradictoryBudget)
      const step = contradictoryBudget.steps.find(item => item.sequence === 5)!
      const plan = (step.output as Record<string, unknown>)
        .contextPlan as Record<string, unknown>
      plan.estimatedInputTokens = estimatedInputTokens
      plan.overflowReason = overflowReason

      const projection = projectAdminRunDetail(contradictoryBudget).timeline.find(
        item => item.sequence === 5,
      )
      assert.equal(projection?.kind, 'known')
      assert.equal(
        projection?.type === 'model_sampling'
          ? projection.contextInspector.outcome
          : null,
        'unavailable',
      )
    }
  })

  it('initial budget 不符合唯一公式时只降级 Context Inspector', () => {
    for (const mutate of [
      (initial: Record<string, unknown>) => {
        initial.resolvedInputBudgetTokens = 262_143
      },
      (initial: Record<string, unknown>) => {
        initial.contextWindowTokens = 70_000
      },
    ]) {
      const record = createRunRecord()
      attachContextMetadata(record)
      const firstSampling = record.steps.find(step => step.sequence === 3)!
      const initialContext = (firstSampling.input as Record<string, unknown>)
        .initialContext as Record<string, unknown>

      mutate(initialContext)
      assertContextUnavailable(record, 3)
    }
  })

  it('Observation chars 与截断 flags 冲突时只降级 Context Inspector', () => {
    const toolCeilingConflict = createRunRecord()
    attachContextMetadata(toolCeilingConflict)
    const secondPlan = contextPlanAt(toolCeilingConflict, 5)
    const secondObservation = (secondPlan.observations as Array<
      Record<string, unknown>
    >)[0]!
    secondObservation.toolCeilingTruncated = false
    assertContextUnavailable(toolCeilingConflict, 5)

    const contextBudgetConflict = createRunRecord()
    attachContextMetadata(contextBudgetConflict)
    const thirdPlan = contextPlanAt(contextBudgetConflict, 7)
    const thirdObservation = (thirdPlan.observations as Array<
      Record<string, unknown>
    >)[0]!
    thirdObservation.contextBudgetTruncated = false
    assertContextUnavailable(contextBudgetConflict, 7)

    const markerExpansion = createRunRecord()
    attachContextMetadata(markerExpansion)
    const previousMarkerPlan = contextPlanAt(markerExpansion, 5)
    const previousMarkerObservation = (previousMarkerPlan.observations as Array<
      Record<string, unknown>
    >)[0]!
    previousMarkerObservation.originalChars = 24
    previousMarkerObservation.toolCeilingChars = 24
    previousMarkerObservation.finalChars = 24
    previousMarkerObservation.toolCeilingTruncated = false
    previousMarkerObservation.contextBudgetTruncated = false
    const markerPlan = contextPlanAt(markerExpansion, 7)
    const markerObservation = (markerPlan.observations as Array<
      Record<string, unknown>
    >)[0]!
    markerObservation.originalChars = 24
    markerObservation.toolCeilingChars = 24
    markerObservation.finalChars = 96
    markerObservation.toolCeilingTruncated = false
    markerObservation.contextBudgetTruncated = true

    const markerProjection = projectAdminRunDetail(markerExpansion).timeline.find(
      item => item.sequence === 7,
    )
    assert.equal(markerProjection?.kind, 'known')
    assert.equal(
      markerProjection?.type === 'model_sampling'
        ? markerProjection.contextInspector.availability
        : null,
      'available',
    )
  })

  it('fail-closed outcome 带正数 Provider item 时只降级 Context Inspector', () => {
    const estimatorFailure = createRunRecord()
    estimatorFailure.status = 'FAILED'
    estimatorFailure.steps = estimatorFailure.steps.filter(step => step.sequence <= 3)
    const estimatorStep = estimatorFailure.steps.find(step => step.sequence === 3)!
    estimatorStep.status = 'FAILED'
    estimatorStep.input = {
      ...(estimatorStep.input as Record<string, unknown>),
      candidateMessageCount: 4,
      initialContext: safeInitialContext(),
    }
    estimatorStep.output = {
      durationMs: 25,
      messageCount: 1,
      contextFailureReason: 'estimator_failure',
    }
    assertContextUnavailable(estimatorFailure, 3)

    const minimumOverflow = createRunRecord()
    minimumOverflow.status = 'FAILED'
    minimumOverflow.steps = minimumOverflow.steps.filter(step => step.sequence <= 3)
    const overflowStep = minimumOverflow.steps.find(step => step.sequence === 3)!
    overflowStep.status = 'FAILED'
    overflowStep.input = {
      ...(overflowStep.input as Record<string, unknown>),
      candidateMessageCount: 4,
      initialContext: safeInitialContext(),
    }
    overflowStep.output = {
      durationMs: 25,
      messageCount: 1,
      contextPlan: safeContextPlan('minimum_context'),
    }
    assertContextUnavailable(minimumOverflow, 3)
  })

  it('跨 sampling pre-plan 与已提交 History 矛盾时只降级当前 Inspector', () => {
    const stalePrePlan = createRunRecord()
    attachContextMetadata(stalePrePlan)
    const staleInput = stalePrePlan.steps.find(step => step.sequence === 7)!
      .input as Record<string, unknown>
    staleInput.candidateMessageCount = 8
    assertContextUnavailable(stalePrePlan, 7)

    const restoredHistory = createRunRecord()
    attachContextMetadata(restoredHistory)
    const restoredPlan = contextPlanAt(restoredHistory, 7)
    restoredPlan.historyIncludedCount = 2
    restoredPlan.historyExcludedCount = 0
    assertContextUnavailable(restoredHistory, 7)

    const missingMandatoryContext = createRunRecord()
    attachContextMetadata(missingMandatoryContext)
    const firstInput = missingMandatoryContext.steps.find(
      step => step.sequence === 3,
    )!.input as Record<string, unknown>
    firstInput.candidateMessageCount = 2
    assertContextUnavailable(missingMandatoryContext, 3)
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

    const failed = createRunRecord()
    failed.status = 'FAILED'
    failed.steps = failed.steps.filter(step => step.sequence <= 3)
    const failedSamplingStep = failed.steps.find(step => step.sequence === 3)!
    failedSamplingStep.status = 'FAILED'
    failedSamplingStep.input = {
      ...(failedSamplingStep.input as Record<string, unknown>),
      candidateMessageCount: 4,
      initialContext: safeInitialContext(),
    }
    failedSamplingStep.output = {
      durationMs: 500,
      messageCount: 0,
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
    assert.equal(
      failedSampling?.type === 'model_sampling'
        ? failedSampling.contextInspector.outcome
        : null,
      'minimum_context_overflow',
    )
    assert.equal(
      failedSampling?.type === 'model_sampling'
        ? failedSampling.contextInspector.providerItemCount
        : null,
      0,
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

    const shortFailedOutput = createRunRecord()
    shortFailedOutput.status = 'FAILED'
    shortFailedOutput.steps = shortFailedOutput.steps.filter(
      step => step.sequence <= 3,
    )
    const shortFailedSampling = shortFailedOutput.steps.find(
      step => step.sequence === 3,
    )!
    shortFailedSampling.status = 'FAILED'
    shortFailedSampling.output = {
      durationMs: 10,
      messageCount: 0,
      usage: { inputTokens: 999, outputTokens: 999, totalTokens: 1_998 },
    }

    assert.equal(
      projectAdminRunDetail(shortFailedOutput).timeline.at(-1)?.kind,
      'generic',
    )
    assert.equal(projectAdminRunListItem(shortFailedOutput).totalTokens, null)
  })

  it('兼容旧版 input-only messageCount，并把实际 Provider 数量标为未知', () => {
    const record = createRunRecord()
    const sampling = record.steps.find(step => step.sequence === 3)!
    const input = sampling.input as Record<string, unknown>
    const output = sampling.output as Record<string, unknown>

    input.messageCount = input.candidateMessageCount
    delete input.candidateMessageCount
    delete output.messageCount

    const projected = projectAdminRunDetail(record).timeline.find(
      item => item.sequence === 3,
    )

    assert.equal(projected?.kind, 'known')
    assert.equal(
      projected?.type === 'model_sampling'
        ? projected.providerItemCount
        : null,
      null,
    )
    assert.equal(
      projected?.type === 'model_sampling'
        ? projected.contextInspector.availability
        : null,
      'unavailable',
    )
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
          candidateMessageCount: 6,
          toolCount: 2,
          reasoning: 'DO_NOT_LEAK',
        },
        output: {
          samplingAttemptId: 'run-1:sampling-3',
          messageCount: 6,
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
          candidateMessageCount: 5,
          toolCount: 2,
          reasoning: 'DO_NOT_LEAK',
        },
        output: {
          samplingAttemptId: 'run-1:sampling-2',
          messageCount: 4,
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
          candidateMessageCount: 2,
          toolCount: 2,
          reasoning: 'DO_NOT_LEAK',
        },
        output: {
          samplingAttemptId: 'run-1:sampling-1',
          messageCount: 2,
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

/** 构造与 Runtime 一致形状的 finalization Step output。 */
/** Runtime 在 startStep 就写入的完整 Registry 快照与归属事实。 */
function groundedFinalizationInput() {
  return {
    assistantMessageId: 'message-assistant',
    evidenceAvailability: 'available',
    registryRefCount: 2,
    registryTruncated: false,
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
    registryTruncated: false,
    eligibleToolCallCount: 1,
    eligibleToolFailureCount: 0,
    attemptCount: attempts.length,
    attempts: attempts.map((attempt, index) => ({
      attempt: index + 1,
      ok: attempt.ok,
      submittedCitationKeyCount: attempt.ok ? 1 : 0,
      usage: attempt.usage,
      durationMs: 100,
    })),
    outcome: 'answered',
    citationCount: 1,
    citationIntegrity: 'validated',
    faithfulnessStatus: 'not_evaluated',
    schemaVersion: 1,
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

function attachContextMetadata(record: ReturnType<typeof createRunRecord>): void {
  const samplings = record.steps
    .filter(step => step.type === 'model_sampling')
    .sort((left, right) => left.sequence - right.sequence)
  const prePlanItemCounts = [4, 6, 7]
  const providerItemCounts = [4, 5, 7]
  const estimatedInputTokens = [120_000, 180_000, 220_000]

  for (const [index, sampling] of samplings.entries()) {
    const input = sampling.input as Record<string, unknown>
    const output = sampling.output as Record<string, unknown>
    const samplingIndex = index + 1
    const toolExchangeCount = index
    const historyIncludedCount = index === 0 ? 2 : 1

    input.candidateMessageCount = prePlanItemCounts[index]
    input.initialContext = {
      ...safeInitialContext(),
      prompt: 'DO_NOT_LEAK',
    }
    output.messageCount = providerItemCounts[index]
    output.contextPlan = {
      samplingIndex,
      resolvedInputBudgetTokens: 262_144,
      estimatedInputTokens: estimatedInputTokens[index],
      historyCandidateCount: 2,
      historyIncludedCount,
      historyExcludedCount: 2 - historyIncludedCount,
      toolExchangeCount,
      observations: Array.from({ length: toolExchangeCount }, (_, exchangeIndex) => {
        const originalChars = 100 + exchangeIndex
        const toolCeilingTruncated = exchangeIndex === 0
        const toolCeilingChars = toolCeilingTruncated ? 80 : originalChars
        const contextBudgetTruncated = samplingIndex === 3
          && exchangeIndex === 0

        return {
          exchangeIndex,
          originalChars,
          toolCeilingChars,
          finalChars: contextBudgetTruncated ? 64 : toolCeilingChars,
          toolCeilingTruncated,
          contextBudgetTruncated,
          observationBody: 'DO_NOT_LEAK',
        }
      }),
      overflowReason: null,
      estimatorStrategyId: 'deepseek-v4-official-b5968e9',
      futureSafeField: true,
    }
  }
}

function contextPlanAt(
  record: ReturnType<typeof createRunRecord>,
  sequence: number,
): Record<string, unknown> {
  const sampling = record.steps.find(step => step.sequence === sequence)!

  return (sampling.output as Record<string, unknown>)
    .contextPlan as Record<string, unknown>
}

function assertContextUnavailable(
  record: ReturnType<typeof createRunRecord>,
  sequence: number,
): void {
  const projection = projectAdminRunDetail(record).timeline.find(
    item => item.sequence === sequence,
  )

  assert.equal(projection?.kind, 'known')
  assert.equal(
    projection?.type === 'model_sampling'
      ? projection.contextInspector.availability
      : null,
    'partial',
  )
  assert.equal(
    projection?.type === 'model_sampling'
      ? projection.contextInspector.outcome
      : null,
    'unavailable',
  )
}

function safeInitialContext(): Record<string, unknown> {
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
): Record<string, unknown> {
  return {
    samplingIndex: 1,
    resolvedInputBudgetTokens: 262_144,
    estimatedInputTokens: 262_145,
    historyCandidateCount: 2,
    historyIncludedCount: 0,
    historyExcludedCount: 2,
    toolExchangeCount: 0,
    observations: [],
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
