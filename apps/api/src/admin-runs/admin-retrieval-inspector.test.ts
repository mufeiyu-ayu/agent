import type {
  AdminRunDetail,
  AdminRunTimelineItem,
  MessageCitationV1,
} from '@agent/contracts'
import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，不为 Admin 投影引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { GROUNDED_FINALIZATION_MAX_ATTEMPTS } from '../agent-runtime/grounding/grounded-answer.finalizer.js'
import {
  ADMIN_RETRIEVAL_MAX_CALLS,
  ADMIN_RETRIEVAL_MAX_REFS_PER_CALL,
} from './admin-retrieval-inspector.projector.js'
import { projectAdminRunDetail } from './admin-run.projector.js'

type RunStatus = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'ABORTED'
type StepStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'ABORTED'
type MessageStatus = 'PENDING' | 'STREAMING' | 'COMPLETED' | 'FAILED' | 'ABORTED'

/** 注入到所有禁止外泄位置的哨兵；序列化响应中出现即视为泄漏。 */
const SENTINEL = 'DO_NOT_LEAK_SENTINEL'

const RETRIEVAL_STRATEGY = { name: 'hybrid_rrf', version: '2' }

describe('Admin Retrieval Inspector', () => {
  it('普通未检索 Run 返回 not_applicable 且不破坏既有 Timeline', () => {
    const detail = projectAdminRunDetail(createOrdinaryRun())
    const inspector = detail.retrievalInspector

    assert.equal(inspector.availability, 'not_applicable')
    assert.deepEqual(inspector.retrievalCalls, [])
    assert.equal(inspector.callsTruncated, false)
    assert.equal(inspector.finalization, null)
    assert.equal(inspector.citations, null)
    assert.equal(inspector.candidateCount, 0)
    assert.equal(inspector.evidenceRefCount, 0)
    // 既有 Timeline 与 Generic fallback 不受影响。
    assert.deepEqual(
      detail.timeline.map(item => item.type),
      ['receive_user_message', 'model_sampling', 'tool_execution', 'assistant_output'],
    )
    assert.equal(detail.timeline[2]?.kind, 'known')
  })

  it('discovery_only 工具不进入 evidence call，也不改变 not_applicable', () => {
    const run = createOrdinaryRun()
    const toolStep = run.steps.find(step => step.type === 'tool_execution')!

    ;(toolStep.input as Record<string, unknown>).toolName = 'search_articles'
    ;(toolStep.input as Record<string, unknown>).toolVersion = '1'

    const inspector = projectAdminRunDetail(run).retrievalInspector

    assert.equal(inspector.availability, 'not_applicable')
    assert.deepEqual(inspector.retrievalCalls, [])
  })

  it('COMPLETED answered 时 candidate、evidence 与 cited 分层且可关联', () => {
    const detail = projectAdminRunDetail(createGroundedRun())
    const inspector = detail.retrievalInspector

    assert.equal(inspector.availability, 'available')
    assert.equal(inspector.retrievalCalls.length, 1)
    assert.equal(inspector.candidateCount, 3)
    assert.equal(inspector.evidenceRefCount, 3)
    assert.equal(inspector.citations?.length, 2)

    const call = inspector.retrievalCalls[0]!

    assert.equal(call.callId, 'call-1')
    assert.equal(call.toolName, 'retrieve_article_context')
    assert.equal(call.toolVersion, '1')
    assert.equal(call.samplingAttemptId, 'run-1:sampling-1')
    assert.equal(call.ok, true)
    assert.equal(call.code, null)
    assert.equal(call.sourceCount, 3)
    assert.equal(call.chunkEvidenceCount, 2)
    assert.equal(call.evidenceRefCount, 3)
    assert.equal(call.refs.length, 3)
    assert.equal(call.refsTruncated, false)
    assert.equal(call.metadataTrusted, true)
    assert.deepEqual(call.strategy, RETRIEVAL_STRATEGY)
    assert.equal(call.originalChars, 4_000)
    assert.equal(call.observationChars, 3_000)
    assert.equal(call.truncated, true)
    assert.equal(call.recordedDurationMs, 420)
    // v1 没有任何工具把 query 写进 typed metadata。
    assert.equal(call.query, null)

    // 第 3 个候选未被引用：candidate 不等于 answer source。
    const citedIdentities = inspector.citations!.map(
      citation => `${citation.sourceId}:${citation.chunkId ?? ''}`,
    )

    assert.deepEqual(citedIdentities, ['11:chunk-a', '12:'])
    assert.ok(!citedIdentities.includes('13:chunk-c'))
    assert.ok(inspector.citations!.every(
      citation => citation.correlation === 'matched',
    ))
    assert.deepEqual(inspector.citations![0]!.matchedCallIds, ['call-1'])
    assert.equal(inspector.citations![0]!.granularity, 'chunk')
    assert.equal(inspector.citations![1]!.granularity, 'article')
    assert.equal(inspector.citations![1]!.chunkId, null)
  })

  it('finalization schema、outcome、attempt、validation 与 usage 可审计', () => {
    const inspector = projectAdminRunDetail(createGroundedRun()).retrievalInspector
    const finalization = inspector.finalization!

    assert.equal(finalization.stepId, 'step-5')
    assert.equal(finalization.status, 'COMPLETED')
    assert.equal(finalization.schemaVersion, 1)
    assert.equal(finalization.evidenceAvailability, 'available')
    assert.equal(finalization.outcome, 'answered')
    assert.equal(finalization.attemptCount, 1)
    assert.equal(finalization.maxAttempts, GROUNDED_FINALIZATION_MAX_ATTEMPTS)
    assert.equal(finalization.registryRefCount, 3)
    assert.equal(finalization.registryTruncated, false)
    assert.equal(finalization.eligibleToolCallCount, 1)
    assert.equal(finalization.eligibleToolFailureCount, 0)
    assert.equal(finalization.validation, 'passed')
    assert.equal(finalization.failureReason, null)
    assert.equal(finalization.rejectionCode, null)
    assert.equal(finalization.samplingFailure, null)
    assert.equal(finalization.citationCount, 2)
    assert.equal(finalization.citationIntegrity, 'validated')
    assert.equal(finalization.faithfulnessStatus, 'not_evaluated')
    assert.deepEqual(finalization.usage, {
      inputTokens: 30,
      outputTokens: 12,
      totalTokens: 42,
    })
    assert.equal(finalization.recordedDurationMs, 500)
    assert.equal(finalization.metadataTrusted, true)
  })

  it('grounded_finalization 获得 typed timeline item 而不是 Generic fallback', () => {
    const detail = projectAdminRunDetail(createGroundedRun())
    const item = findTimelineItem(detail, 'grounded_finalization')

    assert.equal(item.kind, 'known')
    assert.ok(item.kind === 'known' && item.type === 'grounded_finalization')

    if (item.kind !== 'known' || item.type !== 'grounded_finalization')
      return

    assert.equal(item.assistantMessageId, 'message-assistant')
    assert.equal(item.evidenceAvailability, 'available')
    assert.equal(item.outcome, 'answered')
    assert.equal(item.attemptCount, 1)
    assert.equal(item.registryRefCount, 3)
    assert.equal(item.registryTruncated, false)
    assert.equal(item.citationCount, 2)
    assert.equal(item.validation, 'passed')
    assert.equal(item.failureReason, null)
    assert.match(item.outputSummary ?? '', /outcome=answered/)
  })

  it('zero-hit 时 Inspector 仍为 available，Grounding 为 none / insufficient / 0 citations', () => {
    const run = createGroundedRun({
      toolSummary: {
        status: 'no_candidates',
        answerStatus: 'unverified',
        strategy: RETRIEVAL_STRATEGY,
        sourceCount: 0,
        chunkEvidenceCount: 0,
        sources: [],
      },
      finalization: {
        evidenceAvailability: 'none',
        registryRefCount: 0,
        outcome: 'insufficient_evidence',
        citationCount: 0,
      },
      citations: [],
      groundingOverrides: {
        evidenceAvailability: 'none',
        outcome: 'insufficient_evidence',
      },
    })
    const inspector = projectAdminRunDetail(run).retrievalInspector

    assert.equal(inspector.availability, 'available')
    assert.equal(inspector.finalization?.evidenceAvailability, 'none')
    assert.equal(inspector.finalization?.outcome, 'insufficient_evidence')
    assert.deepEqual(inspector.citations, [])
    assert.equal(inspector.candidateCount, 0)
    assert.equal(inspector.evidenceRefCount, 0)
  })

  it('Tool unavailable 时 Inspector 仍为 available，Grounding 为 unavailable', () => {
    const run = createGroundedRun({
      toolFailure: { code: 'timeout' },
      finalization: {
        evidenceAvailability: 'unavailable',
        registryRefCount: 0,
        eligibleToolFailureCount: 1,
        outcome: 'insufficient_evidence',
        citationCount: 0,
      },
      citations: [],
      groundingOverrides: {
        evidenceAvailability: 'unavailable',
        outcome: 'insufficient_evidence',
      },
    })
    const inspector = projectAdminRunDetail(run).retrievalInspector

    assert.equal(inspector.availability, 'available')
    assert.equal(inspector.retrievalCalls[0]?.ok, false)
    assert.equal(inspector.retrievalCalls[0]?.code, 'timeout')
    assert.equal(inspector.retrievalCalls[0]?.metadataTrusted, true)
    assert.equal(inspector.retrievalCalls[0]?.sourceCount, null)
    assert.equal(inspector.finalization?.evidenceAvailability, 'unavailable')
    assert.deepEqual(inspector.citations, [])
  })

  it('partial failure 保持 Inspector available，Grounding 为 partial', () => {
    const run = createGroundedRun({
      finalization: {
        evidenceAvailability: 'partial',
        eligibleToolCallCount: 2,
        eligibleToolFailureCount: 1,
      },
      groundingOverrides: { evidenceAvailability: 'partial' },
    })

    run.steps.push(failedToolStep(6, 'call-2'))

    const inspector = projectAdminRunDetail(run).retrievalInspector

    assert.equal(inspector.availability, 'available')
    assert.equal(inspector.retrievalCalls.length, 2)
    assert.equal(inspector.finalization?.evidenceAvailability, 'partial')
    assert.equal(inspector.finalization?.eligibleToolFailureCount, 1)
  })

  it('conflicting evidence 至少关联两个不同 source', () => {
    const run = createGroundedRun({
      finalization: { outcome: 'conflicting_evidence' },
      groundingOverrides: { outcome: 'conflicting_evidence' },
    })
    const inspector = projectAdminRunDetail(run).retrievalInspector

    assert.equal(inspector.availability, 'available')
    assert.equal(inspector.finalization?.outcome, 'conflicting_evidence')
    assert.equal(
      new Set(inspector.citations!.map(citation => citation.sourceId)).size,
      2,
    )
  })

  it('RUNNING 时保留已发生 call，finalization 为 null 且不伪造 outcome', () => {
    const run = createGroundedRun()

    run.status = 'RUNNING'
    run.endedAt = null
    run.assistantMessage!.status = 'STREAMING'
    run.assistantMessage!.grounding = null
    run.steps = run.steps.filter(step => step.type !== 'grounded_finalization')

    const inspector = projectAdminRunDetail(run).retrievalInspector

    assert.equal(inspector.availability, 'partial')
    assert.equal(inspector.retrievalCalls.length, 1)
    assert.equal(inspector.retrievalCalls[0]?.metadataTrusted, true)
    assert.equal(inspector.finalization, null)
    assert.equal(inspector.citations, null)
  })

  for (const status of ['FAILED', 'ABORTED'] as const) {
    it(`${status} Run 保留已发生 attempt 且不显示 completed Grounding`, () => {
      const run = createGroundedRun({
        finalization: { outcome: null, citationCount: null, failure: status },
      })

      run.status = status
      run.assistantMessage!.status = status
      run.assistantMessage!.grounding = null

      const finalizationStep = run.steps.find(
        step => step.type === 'grounded_finalization',
      )!
      finalizationStep.status = status === 'FAILED' ? 'FAILED' : 'ABORTED'

      const inspector = projectAdminRunDetail(run).retrievalInspector

      assert.equal(inspector.availability, 'partial')
      assert.equal(inspector.finalization?.validation, 'failed')
      assert.equal(inspector.finalization?.outcome, null)
      assert.equal(inspector.finalization?.failureReason, 'sampling_incomplete')
      assert.equal(inspector.finalization?.samplingFailure, 'stream_failed')
      assert.equal(inspector.citations, null)
    })
  }

  it('legacy Retrieval Step 缺少 toolSummary 时降为 partial 而不是伪装完整', () => {
    const run = createGroundedRun({ omitToolSummary: true })
    const inspector = projectAdminRunDetail(run).retrievalInspector

    // 基础字段仍可信，但投影出的 evidence 身份数与 Registry 记录不一致。
    assert.equal(inspector.availability, 'partial')
    assert.equal(inspector.retrievalCalls[0]?.metadataTrusted, true)
    assert.equal(inspector.retrievalCalls[0]?.sourceCount, null)
    assert.deepEqual(inspector.retrievalCalls[0]?.refs, [])
    assert.equal(inspector.evidenceRefCount, 0)
    assert.equal(inspector.finalization?.registryRefCount, 3)
    assert.ok(inspector.citations!.every(
      citation => citation.correlation === 'unmatched',
    ))
  })

  it('malformed Tool summary fail closed，不返回原始 JSON', () => {
    const run = createGroundedRun({
      toolSummary: {
        status: 'candidates_returned',
        strategy: RETRIEVAL_STRATEGY,
        sourceCount: 1,
        // chunkEvidenceCount 大于 sourceCount：跨字段自相矛盾。
        chunkEvidenceCount: 4,
        sources: [{ sourceId: 11, chunkId: 'chunk-a' }],
        rawObservation: SENTINEL,
      },
    })
    const detail = projectAdminRunDetail(run)
    const inspector = detail.retrievalInspector
    const call = inspector.retrievalCalls[0]!

    assert.equal(inspector.availability, 'partial')
    assert.equal(call.metadataTrusted, false)
    assert.equal(call.sourceCount, null)
    assert.equal(call.chunkEvidenceCount, null)
    assert.equal(call.strategy, null)
    assert.deepEqual(call.refs, [])
    assert.equal(inspector.candidateCount, null)
    assert.equal(inspector.evidenceRefCount, null)
    assert.ok(!JSON.stringify(detail).includes(SENTINEL))
  })

  it('malformed finalization metadata 回落 Generic 并标记 validation=unavailable', () => {
    const run = createGroundedRun()
    const finalizationStep = run.steps.find(
      step => step.type === 'grounded_finalization',
    )!

    // attemptCount 与 attempts 数量不一致：无法确定真实 attempt 事实。
    ;(finalizationStep.output as Record<string, unknown>).attemptCount = 2

    const detail = projectAdminRunDetail(run)
    const inspector = detail.retrievalInspector

    assert.equal(inspector.availability, 'partial')
    assert.equal(inspector.finalization?.metadataTrusted, false)
    assert.equal(inspector.finalization?.validation, 'unavailable')
    assert.equal(inspector.finalization?.attemptCount, null)
    assert.equal(inspector.finalization?.usage, null)
    assert.equal(
      findTimelineItem(detail, 'grounded_finalization').kind,
      'generic',
    )
    assert.ok(!JSON.stringify(detail).includes(SENTINEL))
  })

  it('malformed persisted Grounding 不返回半份 Citation', () => {
    const run = createGroundedRun()

    run.assistantMessage!.grounding!.citations = [
      { citationId: 'evk_not_a_public_id', sourceId: 11 },
    ]

    const detail = projectAdminRunDetail(run)

    assert.equal(detail.retrievalInspector.availability, 'partial')
    assert.equal(detail.retrievalInspector.citations, null)
    // Run Detail 本身仍可加载。
    assert.equal(detail.timeline.length > 0, true)
    assert.ok(!JSON.stringify(detail).includes('evk_'))
  })

  it('非 COMPLETED 助手消息上的 Grounding 不被当成成立事实', () => {
    const run = createGroundedRun()

    run.assistantMessage!.status = 'ABORTED'

    const inspector = projectAdminRunDetail(run).retrievalInspector

    assert.equal(inspector.citations, null)
    assert.equal(inspector.availability, 'partial')
  })

  it('合法 Citation 但 evidence 无法关联时标记 unmatched 并降为 partial', () => {
    const run = createGroundedRun({
      toolSummary: {
        status: 'candidates_returned',
        answerStatus: 'unverified',
        strategy: RETRIEVAL_STRATEGY,
        sourceCount: 3,
        chunkEvidenceCount: 2,
        // 与 Citation 身份完全不同的来源。
        sources: [
          { sourceId: 91, chunkId: 'chunk-x' },
          { sourceId: 92 },
          { sourceId: 93, chunkId: 'chunk-z' },
        ],
      },
    })
    const inspector = projectAdminRunDetail(run).retrievalInspector

    assert.equal(inspector.availability, 'partial')
    assert.ok(inspector.citations!.every(
      citation => citation.correlation === 'unmatched',
    ))
    assert.deepEqual(inspector.citations![0]!.matchedCallIds, [])
  })

  it('call 与 ref 超限时显式标记 truncation 而不是静默裁剪', () => {
    const run = createGroundedRun()
    const template = run.steps.find(step => step.type === 'tool_execution')!

    for (let index = 0; index < ADMIN_RETRIEVAL_MAX_CALLS; index += 1) {
      run.steps.push({
        ...template,
        id: `step-extra-${index}`,
        sequence: 20 + index,
        input: { ...(template.input as Record<string, unknown>), callId: `call-extra-${index}` },
        output: JSON.parse(JSON.stringify(template.output)),
      })
    }

    const inspector = projectAdminRunDetail(run).retrievalInspector

    assert.equal(inspector.callsTruncated, true)
    assert.equal(inspector.retrievalCalls.length, ADMIN_RETRIEVAL_MAX_CALLS)
    assert.equal(inspector.availability, 'partial')
  })

  it('单个 call 的 ref 超过上限时标记 refsTruncated', () => {
    const sources = Array.from(
      { length: ADMIN_RETRIEVAL_MAX_REFS_PER_CALL + 1 },
      (_, index) => ({ sourceId: 100 + index, chunkId: `chunk-${index}` }),
    )
    const run = createGroundedRun({
      toolSummary: {
        status: 'candidates_returned',
        strategy: RETRIEVAL_STRATEGY,
        sourceCount: sources.length,
        chunkEvidenceCount: sources.length,
        sources,
      },
    })
    const inspector = projectAdminRunDetail(run).retrievalInspector
    const call = inspector.retrievalCalls[0]!

    assert.equal(call.refs.length, ADMIN_RETRIEVAL_MAX_REFS_PER_CALL)
    assert.equal(call.refsTruncated, true)
    assert.equal(call.evidenceRefCount, sources.length)
    assert.equal(inspector.availability, 'partial')
  })

  it('Prompt、reasoning、excerpt、embedding 等敏感字段不进入序列化响应', () => {
    const run = createGroundedRun({ injectSentinels: true })
    const serialized = JSON.stringify(projectAdminRunDetail(run))

    assert.ok(!serialized.includes(SENTINEL))
    assert.doesNotMatch(serialized, /excerpt|embedding|cosineDistance|authorization|api[_-]?key/i)
    assert.doesNotMatch(serialized, /evk_/)
    // 内部 citationKey 与 slug 路由都不在 Admin Citation 投影里。
    assert.doesNotMatch(serialized, /"slug"|"href"|"rank"/)
  })

  it('safeRawData 保持既有 bounded 形状，不携带 Inspector 内部字段', () => {
    const detail = projectAdminRunDetail(createGroundedRun())
    const raw = JSON.stringify(detail.safeRawData)

    assert.doesNotMatch(raw, /"(?:input|output)":/)
    assert.doesNotMatch(raw, /retrievalInspector|toolSummary|citations/)
    assert.deepEqual(
      Object.keys(detail.safeRawData.agentSteps[0]!).sort(),
      [
        'endedAt',
        'hasError',
        'id',
        'inputSummary',
        'outputSummary',
        'sequence',
        'startedAt',
        'status',
        'title',
        'type',
      ],
    )
  })
})

function findTimelineItem(
  detail: AdminRunDetail,
  type: string,
): AdminRunTimelineItem {
  const item = detail.timeline.find(candidate => candidate.type === type)

  assert.ok(item, `timeline 缺少 ${type}`)
  return item
}

interface GroundedRunOptions {
  toolSummary?: Record<string, unknown> | undefined
  omitToolSummary?: boolean
  toolFailure?: { code: string }
  finalization?: {
    evidenceAvailability?: string
    registryRefCount?: number | null
    eligibleToolCallCount?: number
    eligibleToolFailureCount?: number
    outcome?: string | null
    citationCount?: number | null
    failure?: 'FAILED' | 'ABORTED'
  }
  citations?: MessageCitationV1[]
  groundingOverrides?: Record<string, unknown>
  injectSentinels?: boolean
}

function createOrdinaryRun() {
  const run = baseRun()

  run.steps = [
    step(1, 'receive_user_message', {
      input: { messageId: 'message-user', messageLength: 12 },
    }),
    step(2, 'model_sampling', {
      input: {
        samplingIndex: 1,
        samplingAttemptId: 'run-1:sampling-1',
        requestedModel: null,
        candidateMessageCount: 4,
        toolCount: 3,
      },
      output: {
        samplingAttemptId: 'run-1:sampling-1',
        messageCount: 4,
        finishReason: 'tool_calls',
        usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
        toolCallCount: 1,
        textChars: 0,
        intermediateTextChars: 0,
        durationMs: 300,
      },
    }),
    step(3, 'tool_execution', {
      input: {
        callId: 'call-1',
        toolName: 'search_articles',
        toolVersion: '1',
        samplingAttemptId: 'run-1:sampling-1',
        executionAttempt: 1,
        rawArgumentsChars: 24,
      },
      output: {
        ok: true,
        originalChars: 900,
        observationChars: 900,
        truncated: false,
        durationMs: 120,
      },
    }),
    step(4, 'assistant_output', {
      input: { assistantMessageId: 'message-assistant' },
      output: { contentLength: 8 },
    }),
  ]

  return run
}

function createGroundedRun(options: GroundedRunOptions = {}) {
  const run = baseRun()
  const citations = options.citations ?? defaultCitations()
  const finalization = options.finalization ?? {}
  const evidenceAvailability = finalization.evidenceAvailability ?? 'available'
  const registryRefCount = finalization.registryRefCount ?? 3
  const outcome = finalization.outcome === undefined
    ? 'answered'
    : finalization.outcome
  const citationCount = finalization.citationCount === undefined
    ? citations.length
    : finalization.citationCount
  const toolSummary = options.omitToolSummary
    ? undefined
    : options.toolSummary ?? {
      status: 'candidates_returned',
      answerStatus: 'unverified',
      strategy: RETRIEVAL_STRATEGY,
      sourceCount: 3,
      chunkEvidenceCount: 2,
      sources: [
        { sourceId: 11, chunkId: 'chunk-a' },
        { sourceId: 12 },
        { sourceId: 13, chunkId: 'chunk-c' },
      ],
    }

  run.steps = [
    step(1, 'receive_user_message', {
      input: { messageId: 'message-user', messageLength: 12 },
    }),
    step(2, 'model_sampling', {
      input: {
        samplingIndex: 1,
        samplingAttemptId: 'run-1:sampling-1',
        requestedModel: null,
        candidateMessageCount: 4,
        toolCount: 3,
        ...(options.injectSentinels
          ? { prompt: SENTINEL, systemInstructions: SENTINEL }
          : {}),
      },
      output: {
        samplingAttemptId: 'run-1:sampling-1',
        messageCount: 4,
        finishReason: 'tool_calls',
        usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
        toolCallCount: 1,
        textChars: 0,
        intermediateTextChars: 0,
        durationMs: 300,
        ...(options.injectSentinels ? { reasoning: SENTINEL } : {}),
      },
    }),
    options.toolFailure
      ? failedToolStep(3, 'call-1', options.toolFailure.code)
      : step(3, 'tool_execution', {
          input: {
            callId: 'call-1',
            toolName: 'retrieve_article_context',
            toolVersion: '1',
            samplingAttemptId: 'run-1:sampling-1',
            executionAttempt: 1,
            rawArgumentsChars: 48,
            ...(options.injectSentinels ? { rawArguments: SENTINEL } : {}),
          },
          output: {
            ok: true,
            originalChars: 4_000,
            observationChars: 3_000,
            truncated: true,
            durationMs: 420,
            ...(toolSummary ? { toolSummary } : {}),
            ...(options.injectSentinels
              ? { modelContent: SENTINEL, sql: SENTINEL, embedding: [0.1, 0.2] }
              : {}),
          },
        }),
    step(4, 'model_sampling', {
      input: {
        samplingIndex: 2,
        samplingAttemptId: 'run-1:sampling-2',
        requestedModel: null,
        candidateMessageCount: 6,
        toolCount: 3,
      },
      output: {
        samplingAttemptId: 'run-1:sampling-2',
        messageCount: 6,
        finishReason: 'stop',
        usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 },
        toolCallCount: 0,
        textChars: 40,
        intermediateTextChars: 0,
        durationMs: 350,
      },
    }),
    step(5, 'grounded_finalization', {
      input: {
        assistantMessageId: 'message-assistant',
        evidenceAvailability,
        registryRefCount,
        registryTruncated: false,
        ...(options.injectSentinels ? { hiddenDraft: SENTINEL } : {}),
      },
      output: {
        evidenceAvailability,
        registryRefCount,
        registryTruncated: false,
        eligibleToolCallCount: finalization.eligibleToolCallCount ?? 1,
        eligibleToolFailureCount: finalization.eligibleToolFailureCount
          ?? (options.toolFailure ? 1 : 0),
        attemptCount: 1,
        attempts: [{
          attempt: 1,
          ok: finalization.failure === undefined,
          ...(finalization.failure ? { samplingFailure: 'stream_failed' } : {}),
          submittedCitationKeyCount: citationCount ?? 0,
          usage: { inputTokens: 30, outputTokens: 12, totalTokens: 42 },
          durationMs: 500,
        }],
        ...(outcome === null
          ? {}
          : {
              outcome,
              citationCount,
              citationIntegrity: 'validated',
              faithfulnessStatus: 'not_evaluated',
              schemaVersion: 1,
            }),
        ...(finalization.failure
          ? { failureReason: 'sampling_incomplete', samplingFailure: 'stream_failed' }
          : {}),
        ...(options.injectSentinels ? { promptPreview: SENTINEL } : {}),
      },
    }),
    step(7, 'assistant_output', {
      input: { assistantMessageId: 'message-assistant' },
      output: { contentLength: 40 },
    }),
  ]

  run.assistantMessage!.grounding = {
    schemaVersion: 1,
    evidenceAvailability,
    outcome: outcome ?? 'answered',
    citationIntegrity: 'validated',
    faithfulnessStatus: 'not_evaluated',
    citations: citations as unknown,
    ...options.groundingOverrides,
  } as GroundingRecord

  return run
}

interface GroundingRecord {
  schemaVersion: number
  evidenceAvailability: string
  outcome: string
  citationIntegrity: string
  faithfulnessStatus: string
  citations: unknown
}

function failedToolStep(sequence: number, callId: string, code = 'execution_failed') {
  return step(sequence, 'tool_execution', {
    status: 'FAILED' as StepStatus,
    input: {
      callId,
      toolName: 'retrieve_article_context',
      toolVersion: '1',
      samplingAttemptId: 'run-1:sampling-1',
      executionAttempt: 1,
      rawArgumentsChars: 48,
    },
    output: {
      ok: false,
      code,
      retryable: true,
      originalChars: 0,
      observationChars: 60,
      truncated: false,
      durationMs: 5_000,
    },
  })
}

function defaultCitations(): MessageCitationV1[] {
  return [
    citation(1, {
      sourceId: 11,
      chunkId: 'chunk-a',
      granularity: 'chunk',
      sectionPath: '指南 / 基础',
    }),
    citation(2, { sourceId: 12, chunkId: null, granularity: 'article' }),
  ]
}

function citation(
  index: number,
  overrides: Partial<MessageCitationV1> & {
    sourceId: number
    chunkId: string | null
    granularity: 'article' | 'chunk'
  },
): MessageCitationV1 {
  return {
    citationId: `cit_${String(index).padStart(32, '0')}`,
    title: `示例文章 ${index}`,
    slug: `article-${index}`,
    languageCode: 'zh-CN',
    sectionPath: null,
    excerpt: null,
    rank: index,
    href: null,
    strategy: { ...RETRIEVAL_STRATEGY },
    ...overrides,
  }
}

function baseRun() {
  return {
    id: 'run-1',
    conversationId: 'conversation-1',
    userMessageId: 'message-user',
    assistantMessageId: 'message-assistant' as string | null,
    status: 'COMPLETED' as RunStatus,
    startedAt: new Date('2026-08-16T00:00:00.000Z'),
    endedAt: new Date('2026-08-16T00:00:05.000Z') as Date | null,
    createdAt: new Date('2026-08-16T00:00:00.000Z'),
    updatedAt: new Date('2026-08-16T00:00:05.000Z'),
    userMessage: {
      id: 'message-user',
      role: 'USER' as const,
      status: 'COMPLETED' as MessageStatus,
      content: '站内有哪些 SEO 指南？',
      createdAt: new Date('2026-08-16T00:00:00.000Z'),
      updatedAt: new Date('2026-08-16T00:00:00.000Z'),
    },
    assistantMessage: {
      id: 'message-assistant',
      role: 'ASSISTANT' as const,
      status: 'COMPLETED' as MessageStatus,
      content: '已根据站内资料回答。',
      createdAt: new Date('2026-08-16T00:00:00.100Z'),
      updatedAt: new Date('2026-08-16T00:00:05.000Z'),
      grounding: null as GroundingRecord | null,
    } as {
      id: string
      role: 'ASSISTANT'
      status: MessageStatus
      content: string
      createdAt: Date
      updatedAt: Date
      grounding: GroundingRecord | null
    } | null,
    steps: [] as ReturnType<typeof step>[],
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
    status: 'COMPLETED' as StepStatus,
    input: null as unknown,
    output: null as unknown,
    errorMessage: null as string | null,
    startedAt: new Date('2026-08-16T00:00:01.000Z') as Date | null,
    endedAt: new Date('2026-08-16T00:00:01.500Z') as Date | null,
    ...overrides,
  }
}
