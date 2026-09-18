import type {
  AdminRunDetail,
  AdminRunTimelineItem,
  MessageCitationV1,
} from '@agent/contracts'
import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，不为 Admin 投影引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { projectAdminRunDetail } from './admin-run.projector.js'

type RunStatus = 'RUNNING' | 'COMPLETED' | 'FAILED' | 'ABORTED'
type StepStatus = 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'ABORTED'
type MessageStatus = 'PENDING' | 'STREAMING' | 'COMPLETED' | 'FAILED' | 'ABORTED'

/** 注入到所有禁止外泄位置的哨兵；序列化响应中出现即视为泄漏。 */
const SENTINEL = 'DO_NOT_LEAK_SENTINEL'

const RETRIEVAL_STRATEGY = { name: 'hybrid_rrf', version: '2' }

describe('Admin Retrieval Inspector', () => {
  it('普通未检索 Run 返回空 calls 与 null citations，且不破坏既有 Timeline', () => {
    const detail = projectAdminRunDetail(createOrdinaryRun())

    assert.deepEqual(detail.retrievalInspector, { retrievalCalls: [], citations: null })
    assert.deepEqual(
      detail.timeline.map(item => item.type),
      ['load_conversation_history', 'model_sampling', 'tool_execution', 'assistant_output'],
    )
    assert.equal(detail.timeline[2]?.kind, 'known')
  })

  it('discovery_only 工具与未注册工具都不进入 evidence call', () => {
    for (const toolName of ['search_articles', 'unknown_tool', undefined]) {
      const run = createOrdinaryRun()
      const toolStep = run.steps.find(step => step.type === 'tool_execution')!

      ;(toolStep.input as Record<string, unknown>).toolName = toolName

      assert.deepEqual(projectAdminRunDetail(run).retrievalInspector.retrievalCalls, [])
    }
  })

  it('evidence-eligible 工具按 definition.name 判定，忽略 toolVersion', () => {
    const run = createGroundedRun()
    const toolStep = run.steps.find(step => step.type === 'tool_execution')!

    ;(toolStep.input as Record<string, unknown>).toolVersion = 'drifted'
    delete (toolStep.input as Record<string, unknown>).toolVersion

    const inspector = projectAdminRunDetail(run).retrievalInspector

    assert.equal(inspector.retrievalCalls.length, 1)
    assert.equal(inspector.retrievalCalls[0]?.stepId, 'step-3')
  })

  it('COMPLETED answered 时 call 摘要与 Citation 按 sourceId:chunkId 关联', () => {
    const detail = projectAdminRunDetail(createGroundedRun())
    const inspector = detail.retrievalInspector

    assert.deepEqual(inspector.retrievalCalls, [{
      stepId: 'step-3',
      query: null,
      strategy: RETRIEVAL_STRATEGY,
      sourceCount: 3,
      chunkEvidenceCount: 2,
      refs: [
        { sourceId: 11, chunkId: 'chunk-a' },
        { sourceId: 12, chunkId: null },
        { sourceId: 13, chunkId: 'chunk-c' },
      ],
    }])

    // 工具身份与执行结果按 stepId 从 timeline 取。
    const toolItem = detail.timeline.find(item => item.id === 'step-3')
    assert.ok(toolItem?.kind === 'known' && toolItem.type === 'tool_execution')
    assert.equal(toolItem.toolName, 'retrieve_article_context')
    assert.equal(toolItem.callId, 'call-1')
    assert.equal(toolItem.ok, true)
    assert.equal(toolItem.truncated, true)

    // 第 3 个候选未被引用：candidate 不等于 answer source。
    assert.deepEqual(inspector.citations, [
      {
        citationId: 'cit_00000000000000000000000000000001',
        sourceId: 11,
        chunkId: 'chunk-a',
        title: '示例文章 1',
        sectionPath: '指南 / 基础',
        languageCode: 'zh-CN',
        strategy: RETRIEVAL_STRATEGY,
        matchedCallIds: ['call-1'],
      },
      {
        citationId: 'cit_00000000000000000000000000000002',
        sourceId: 12,
        chunkId: null,
        title: '示例文章 2',
        sectionPath: null,
        languageCode: 'zh-CN',
        strategy: RETRIEVAL_STRATEGY,
        matchedCallIds: ['call-1'],
      },
    ])
  })

  it('Citation 身份没有出现在任何 call 的 refs 时 matchedCallIds 为空', () => {
    const inspector = projectAdminRunDetail(createGroundedRun({
      citations: [citation(1, { sourceId: 99, chunkId: 'chunk-z' })],
    })).retrievalInspector

    assert.deepEqual(inspector.citations?.map(item => item.matchedCallIds), [[]])
  })

  it('同一身份出现在多个 call 时 matchedCallIds 按 sequence 去重列出', () => {
    const run = createGroundedRun()
    const toolStep = run.steps.find(step => step.type === 'tool_execution')!

    run.steps.push({
      ...toolStep,
      id: 'step-3b',
      sequence: 3.5,
      input: { ...(toolStep.input as Record<string, unknown>), callId: 'call-2' },
    })

    const inspector = projectAdminRunDetail(run).retrievalInspector

    assert.deepEqual(inspector.retrievalCalls.map(call => call.stepId), ['step-3', 'step-3b'])
    assert.deepEqual(inspector.citations?.[0]?.matchedCallIds, ['call-1', 'call-2'])
  })

  it('grounded_finalization 逐字段投影 typed timeline item', () => {
    const detail = projectAdminRunDetail(createGroundedRun())
    const item = findTimelineItem(detail, 'grounded_finalization')

    assert.ok(item.kind === 'known' && item.type === 'grounded_finalization')
    assert.equal(item.evidenceAvailability, 'available')
    assert.equal(item.outcome, 'answered')
    assert.equal(item.attemptCount, 1)
    assert.equal(item.registryRefCount, 3)
    assert.equal(item.failureReason, null)
    assert.equal(item.rejectionCode, null)
    assert.equal(item.samplingFailure, null)
    assert.deepEqual(item.usage, {
      inputTokens: 30,
      outputTokens: 12,
      totalTokens: 42,
      reasoningTokens: null,
      promptCacheHitTokens: null,
      promptCacheMissTokens: null,
    })
  })

  it('finalization usage 按 attempt 求和且投影 reasoning / cache 明细', () => {
    const run = createGroundedRun()
    const step = run.steps.find(item => item.type === 'grounded_finalization')!
    const output = step.output as Record<string, unknown>

    output.attempts = [
      {
        attempt: 1,
        ok: false,
        rejectionCode: 'schema_invalid',
        usage: {
          inputTokens: 10,
          outputTokens: 2,
          totalTokens: 12,
          reasoningTokens: 1,
          promptCacheHitTokens: 4,
          promptCacheMissTokens: 6,
        },
      },
      {
        attempt: 2,
        ok: true,
        usage: {
          inputTokens: 30,
          outputTokens: 12,
          totalTokens: 42,
          reasoningTokens: 8,
          promptCacheHitTokens: 20,
          promptCacheMissTokens: 10,
        },
      },
    ]
    output.attemptCount = 2

    const item = findTimelineItem(projectAdminRunDetail(run), 'grounded_finalization')

    assert.ok(item.kind === 'known' && item.type === 'grounded_finalization')
    assert.deepEqual(item.usage, {
      inputTokens: 40,
      outputTokens: 14,
      totalTokens: 54,
      reasoningTokens: 9,
      promptCacheHitTokens: 24,
      promptCacheMissTokens: 16,
    })
  })

  it('finalization 失败类别逐字段读取；非法枚举值为 null，不降级为 Generic', () => {
    const run = createGroundedRun({
      finalization: { outcome: null, failure: 'FAILED' },
    })
    const step = run.steps.find(item => item.type === 'grounded_finalization')!
    ;(step.output as Record<string, unknown>).rejectionCode = 'not_a_code'

    const detail = projectAdminRunDetail(run)
    const item = findTimelineItem(detail, 'grounded_finalization')

    assert.ok(item.kind === 'known' && item.type === 'grounded_finalization')
    assert.equal(item.outcome, null)
    assert.equal(item.failureReason, 'sampling_incomplete')
    assert.equal(item.samplingFailure, 'stream_failed')
    assert.equal(item.rejectionCode, null)
    assert.equal(detail.retrievalInspector.citations?.length, 2)
  })

  it('finalization output 缺失或 attempts 不是数组时 usage 为 null，Step 仍是 known', () => {
    for (const output of [null, { attempts: 'broken' }, { evidenceAvailability: 'none' }]) {
      const run = createGroundedRun()
      const step = run.steps.find(item => item.type === 'grounded_finalization')!
      step.output = output

      const item = findTimelineItem(projectAdminRunDetail(run), 'grounded_finalization')

      assert.ok(item.kind === 'known' && item.type === 'grounded_finalization')
      assert.equal(item.usage, null)
      assert.equal(item.attemptCount, null)
    }
  })

  it('zero-hit 时 call 摘要为 0 候选，Grounding 为 none / insufficient / 0 citations', () => {
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
    })
    const detail = projectAdminRunDetail(run)

    assert.equal(detail.retrievalInspector.retrievalCalls[0]?.sourceCount, 0)
    assert.deepEqual(detail.retrievalInspector.retrievalCalls[0]?.refs, [])
    assert.deepEqual(detail.retrievalInspector.citations, [])

    const item = findTimelineItem(detail, 'grounded_finalization')
    assert.ok(item.kind === 'known' && item.type === 'grounded_finalization')
    assert.equal(item.evidenceAvailability, 'none')
    assert.equal(item.outcome, 'insufficient_evidence')
  })

  it('Tool 失败调用没有 summary 时 call 摘要全为 null，refs 为空', () => {
    const run = createGroundedRun({
      toolFailure: { code: 'timeout' },
      finalization: { evidenceAvailability: 'unavailable', registryRefCount: 0, outcome: null, failure: 'FAILED' },
      citations: [],
    })
    const detail = projectAdminRunDetail(run)

    assert.deepEqual(detail.retrievalInspector.retrievalCalls, [{
      stepId: 'step-3',
      query: null,
      strategy: null,
      sourceCount: null,
      chunkEvidenceCount: null,
      refs: [],
    }])

    const toolItem = detail.timeline.find(item => item.id === 'step-3')
    assert.ok(toolItem?.kind === 'known' && toolItem.type === 'tool_execution')
    assert.equal(toolItem.ok, false)
    assert.equal(toolItem.code, 'timeout')
  })

  it('RUNNING 时保留已发生 call，citations 为 null', () => {
    const run = createGroundedRun()
    run.status = 'RUNNING'
    run.endedAt = null
    run.assistantMessage!.status = 'STREAMING'
    run.assistantMessage!.grounding = null
    run.steps = run.steps.filter(step => step.sequence <= 3)

    const inspector = projectAdminRunDetail(run).retrievalInspector

    assert.equal(inspector.retrievalCalls.length, 1)
    assert.equal(inspector.citations, null)
  })

  it('legacy Retrieval Step 缺少 toolSummary 时 call 摘要为 null，Citation 无关联', () => {
    const inspector = projectAdminRunDetail(
      createGroundedRun({ omitToolSummary: true }),
    ).retrievalInspector

    assert.equal(inspector.retrievalCalls.length, 1)
    assert.equal(inspector.retrievalCalls[0]?.sourceCount, null)
    assert.deepEqual(inspector.retrievalCalls[0]?.refs, [])
    assert.deepEqual(inspector.citations?.map(item => item.matchedCallIds), [[], []])
  })

  it('malformed Tool summary 逐字段读取：读不出的字段为 null，非法 ref 跳过', () => {
    const inspector = projectAdminRunDetail(createGroundedRun({
      toolSummary: {
        strategy: { name: 'hybrid_rrf' },
        sourceCount: -1,
        chunkEvidenceCount: 2,
        query: '  SEO   指南  ',
        sources: [
          { sourceId: 0 },
          // 非字符串 chunkId 不能退化成 article 身份，整条跳过。
          { sourceId: 11, chunkId: 7 },
          'broken',
          { sourceId: 12, chunkId: 'chunk-b' },
          { sourceId: 13, chunkId: null },
          { sourceId: 14 },
        ],
      },
      citations: [citation(1, { sourceId: 11, chunkId: null })],
    })).retrievalInspector

    assert.deepEqual(inspector.retrievalCalls[0], {
      stepId: 'step-3',
      query: 'SEO 指南',
      strategy: null,
      sourceCount: null,
      chunkEvidenceCount: 2,
      refs: [
        { sourceId: 12, chunkId: 'chunk-b' },
        { sourceId: 13, chunkId: null },
        { sourceId: 14, chunkId: null },
      ],
    })
    // 损坏的 chunk ref 不得与同 sourceId 的 article 级 Citation 假关联。
    assert.deepEqual(inspector.citations?.map(item => item.matchedCallIds), [[]])
  })

  it('chunkId 身份原样保留：首尾空白、重复空白不做归一化，不与 Citation 误关联', () => {
    const inspector = projectAdminRunDetail(createGroundedRun({
      toolSummary: summaryWithSources([
        { sourceId: 11, chunkId: ' chunk-a ' },
        { sourceId: 12, chunkId: 'chunk  b' },
        { sourceId: 13, chunkId: 'chunk-c' },
      ]),
      citations: [
        citation(1, { sourceId: 11, chunkId: 'chunk-a' }),
        citation(2, { sourceId: 12, chunkId: 'chunk b' }),
        citation(3, { sourceId: 13, chunkId: 'chunk-c' }),
      ],
    })).retrievalInspector

    assert.deepEqual(inspector.retrievalCalls[0]?.refs, [
      { sourceId: 11, chunkId: ' chunk-a ' },
      { sourceId: 12, chunkId: 'chunk  b' },
      { sourceId: 13, chunkId: 'chunk-c' },
    ])
    // 只有逐字符相等的身份才关联；trim / 折叠空白后碰巧相等的不算。
    assert.deepEqual(
      inspector.citations?.map(item => item.matchedCallIds),
      [[], [], ['call-1']],
    )
  })

  it('空字符串 chunkId 整条跳过，不与 article 级 null 碰撞；合法 article null 照常关联', () => {
    const inspector = projectAdminRunDetail(createGroundedRun({
      toolSummary: summaryWithSources([
        { sourceId: 11, chunkId: '' },
        // 纯空白是非空字符串，按契约是一个独立身份，原样保留。
        { sourceId: 12, chunkId: '   ' },
        { sourceId: 13, chunkId: null },
        { sourceId: 14 },
      ]),
      citations: [
        citation(1, { sourceId: 11, chunkId: null }),
        citation(2, { sourceId: 12, chunkId: null }),
        citation(3, { sourceId: 13, chunkId: null }),
        citation(4, { sourceId: 14, chunkId: null }),
      ],
    })).retrievalInspector

    assert.deepEqual(inspector.retrievalCalls[0]?.refs, [
      { sourceId: 12, chunkId: '   ' },
      { sourceId: 13, chunkId: null },
      { sourceId: 14, chunkId: null },
    ])
    assert.deepEqual(
      inspector.citations?.map(item => item.matchedCallIds),
      [[], [], ['call-1'], ['call-1']],
    )
  })

  it('超长或类型非法的 chunkId 整条跳过，不截断成另一个可关联的身份', () => {
    const boundary = 'x'.repeat(200)
    const inspector = projectAdminRunDetail(createGroundedRun({
      toolSummary: summaryWithSources([
        { sourceId: 11, chunkId: `${boundary}y` },
        { sourceId: 11, chunkId: 7 },
        { sourceId: 11, chunkId: true },
        { sourceId: 11, chunkId: { id: 'chunk-a' } },
        { sourceId: 12, chunkId: boundary },
      ]),
      citations: [
        // preview 截断会产出的形状：199 个字符加省略号；它不能被伪造出来。
        citation(1, { sourceId: 11, chunkId: `${'x'.repeat(199)}…` }),
        citation(2, { sourceId: 11, chunkId: null }),
        citation(3, { sourceId: 12, chunkId: boundary }),
      ],
    })).retrievalInspector

    assert.deepEqual(inspector.retrievalCalls[0]?.refs, [
      { sourceId: 12, chunkId: boundary },
    ])
    assert.deepEqual(
      inspector.citations?.map(item => item.matchedCallIds),
      [[], [], ['call-1']],
    )
  })

  it('get_article_detail 命中：真实工具只提交 evidence 不写 stepSummary，call 摘要数量未知', () => {
    const detail = projectAdminRunDetail(createGroundedRun({
      toolName: 'get_article_detail',
      omitToolSummary: true,
      finalization: { registryRefCount: 1 },
      citations: [citation(1, { sourceId: 301, chunkId: null })],
    }))
    const item = findTimelineItem(detail, 'grounded_finalization')

    // Registry 已有 1 条 article 证据，但 call 摘要读不出数量：null 而不是 0。
    assert.deepEqual(detail.retrievalInspector.retrievalCalls, [{
      stepId: 'step-3',
      query: null,
      strategy: null,
      sourceCount: null,
      chunkEvidenceCount: null,
      refs: [],
    }])
    assert.ok(item.kind === 'known' && item.type === 'grounded_finalization')
    assert.equal(item.registryRefCount, 1)
    assert.deepEqual(detail.retrievalInspector.citations?.map(c => c.matchedCallIds), [[]])
  })

  it('malformed persisted Grounding 不返回半份 Citation', () => {
    const run = createGroundedRun({
      groundingOverrides: { citations: [{ leaked: SENTINEL }] },
    })
    const detail = projectAdminRunDetail(run)

    assert.equal(detail.retrievalInspector.citations, null)
    assert.doesNotMatch(JSON.stringify(detail), new RegExp(SENTINEL))
  })

  it('非 COMPLETED 助手消息上的 Grounding 不被当成成立事实', () => {
    const run = createGroundedRun()
    run.assistantMessage!.status = 'FAILED'

    assert.equal(projectAdminRunDetail(run).retrievalInspector.citations, null)
  })

  it('Citation 文本字段做 preview 截断，超长 title 不原样透传', () => {
    const inspector = projectAdminRunDetail(createGroundedRun({
      citations: [citation(1, {
        sourceId: 11,
        chunkId: 'chunk-a',
        // Grounding 契约允许 300 字符；Admin 投影在 200 字符处做 preview 截断。
        title: 'x'.repeat(250),
      })],
    })).retrievalInspector

    assert.equal([...inspector.citations![0]!.title].length, 200)
    assert.match(inspector.citations![0]!.title, /…$/)
  })

  it('Prompt、reasoning、excerpt、embedding 等敏感字段不进入序列化响应', () => {
    const detail = projectAdminRunDetail(createGroundedRun({ injectSentinels: true }))
    const serialized = JSON.stringify(detail)

    assert.doesNotMatch(serialized, new RegExp(SENTINEL))
    assert.doesNotMatch(serialized, /embedding|excerpt|citationKey|evk_/)
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
  toolName?: string
  toolSummary?: Record<string, unknown> | undefined
  omitToolSummary?: boolean
  toolFailure?: { code: string }
  finalization?: {
    evidenceAvailability?: string
    registryRefCount?: number | null
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
    step(1, 'load_conversation_history', {
      output: { messageCount: 2 },
    }),
    step(2, 'model_sampling', {
      input: {
        samplingIndex: 1,
        samplingAttemptId: 'run-1:sampling-1',
      },
      output: {
        samplingAttemptId: 'run-1:sampling-1',
        messageCount: 4,
        finishReason: 'tool_calls',
        usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
        toolCallCount: 1,
      },
    }),
    step(3, 'tool_execution', {
      input: {
        callId: 'call-1',
        toolName: 'search_articles',
        samplingAttemptId: 'run-1:sampling-1',
      },
      output: {
        ok: true,
        originalChars: 900,
        observationChars: 900,
        truncated: false,
      },
    }),
    step(4, 'assistant_output', {
      input: { assistantMessageId: 'message-assistant' },
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
    step(1, 'load_conversation_history', {
      output: { messageCount: 2 },
    }),
    step(2, 'model_sampling', {
      input: {
        samplingIndex: 1,
        samplingAttemptId: 'run-1:sampling-1',
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
        ...(options.injectSentinels ? { reasoning: SENTINEL } : {}),
      },
    }),
    options.toolFailure
      ? failedToolStep(3, 'call-1', options.toolFailure.code)
      : step(3, 'tool_execution', {
          input: {
            callId: 'call-1',
            toolName: options.toolName ?? 'retrieve_article_context',
            samplingAttemptId: 'run-1:sampling-1',
            ...(options.injectSentinels ? { rawArguments: SENTINEL } : {}),
          },
          output: {
            ok: true,
            originalChars: 4_000,
            observationChars: 3_000,
            truncated: true,
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
      },
      output: {
        samplingAttemptId: 'run-1:sampling-2',
        messageCount: 6,
        finishReason: 'stop',
        usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 },
        toolCallCount: 0,
      },
    }),
    step(5, 'grounded_finalization', {
      status: finalization.failure ?? 'COMPLETED',
      input: {
        assistantMessageId: 'message-assistant',
        evidenceAvailability,
        registryRefCount,
        ...(options.injectSentinels ? { hiddenDraft: SENTINEL } : {}),
      },
      output: {
        evidenceAvailability,
        registryRefCount,
        attemptCount: 1,
        attempts: [{
          attempt: 1,
          ok: finalization.failure === undefined,
          ...(finalization.failure ? { samplingFailure: 'stream_failed' } : {}),
          usage: { inputTokens: 30, outputTokens: 12, totalTokens: 42 },
        }],
        ...(outcome === null
          ? {}
          : { outcome, citationCount }),
        ...(finalization.failure
          ? { failureReason: 'sampling_incomplete', samplingFailure: 'stream_failed' }
          : {}),
        ...(options.injectSentinels ? { promptPreview: SENTINEL } : {}),
      },
    }),
    step(7, 'assistant_output', {
      input: { assistantMessageId: 'message-assistant' },
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

/** 只改 sources 的 summary；其余字段与默认 grounded fixture 一致。 */
function summaryWithSources(sources: unknown[]): Record<string, unknown> {
  return {
    status: 'candidates_returned',
    answerStatus: 'unverified',
    strategy: RETRIEVAL_STRATEGY,
    sourceCount: sources.length,
    chunkEvidenceCount: sources.filter(source => (
      typeof source === 'object' && source !== null && typeof (source as Record<string, unknown>).chunkId === 'string'
    )).length,
    sources,
  }
}

function failedToolStep(sequence: number, callId: string, code = 'execution_failed') {
  return step(sequence, 'tool_execution', {
    status: 'FAILED' as StepStatus,
    input: {
      callId,
      toolName: 'retrieve_article_context',
      samplingAttemptId: 'run-1:sampling-1',
    },
    output: {
      ok: false,
      code,
      originalChars: 0,
      observationChars: 60,
      truncated: false,
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
    granularity: overrides.chunkId === null ? 'article' : 'chunk',
    strategy: { ...RETRIEVAL_STRATEGY },
    ...overrides,
  }
}

function baseRun() {
  return {
    id: 'run-1',
    conversationId: 'conversation-1',
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
