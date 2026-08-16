import type {
  AdminGroundedCitationSummary,
  AdminRetrievalCallSummary,
  AdminRetrievalInspector,
  AdminRunDetail,
  AdminRunTimelineItem,
} from '@agent/contracts'
import type { Page } from '@playwright/test'

/**
 * Issue #62 浏览器验收使用的确定性 fixture。
 *
 * 所有响应都严格符合公共 `AdminRunDetail` contract，由 `page.route()` 提供：
 * 不启动 API 进程、不连数据库、不调用模型 Provider，也不向组件注入生产中
 * 不存在的数据结构。
 */

export const RUN_ID = 'run-e2e-1'

/**
 * DOM 负向断言使用的禁止词表。
 *
 * 这些词只可能来自 Prompt、reasoning、原始 Observation、内部引用凭据或
 * Provider / SQL / 向量内部数据；公共 Admin contract 里根本没有承载它们的字段，
 * 因此只要页面上出现任意一个，就说明有人绕过了 typed 投影。
 */
export const FORBIDDEN_DOM_PATTERNS = [
  /evk_/,
  /excerpt/i,
  /"slug"|slug=/i,
  /cosineDistance|distance=/i,
  /embedding/i,
  /select\s+\*\s+from/i,
  /authorization|api[_-]?key|bearer\s/i,
  /at\s+\w+\s+\(.*:\d+:\d+\)/,
] as const

const START = '2026-08-16T00:00:00.000Z'
const END = '2026-08-16T00:00:05.000Z'

export async function installRunDetail(
  page: Page,
  detail: AdminRunDetail,
): Promise<void> {
  await page.route('**/api/admin/runs/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true, data: detail }),
    })
  })
}

export function createAnsweredDetail(): AdminRunDetail {
  return createDetail({
    timeline: [
      receiveStep(),
      samplingStep(3, 'run-e2e-1:sampling-1', 'tool_calls'),
      toolStep(4),
      samplingStep(5, 'run-e2e-1:sampling-2', 'stop'),
      finalizationStep(6),
      assistantOutputStep(7),
    ],
    retrievalInspector: createAvailableInspector(),
  })
}

export function createRunningDetail(): AdminRunDetail {
  return createDetail({
    status: 'RUNNING',
    endedAt: null,
    timeline: [
      receiveStep(),
      samplingStep(3, 'run-e2e-1:sampling-1', 'tool_calls'),
      toolStep(4),
    ],
    retrievalInspector: {
      ...createAvailableInspector(),
      availability: 'partial',
      finalization: null,
      citations: null,
    },
  })
}

export function createFailedDetail(): AdminRunDetail {
  const inspector = createAvailableInspector()

  return createDetail({
    status: 'FAILED',
    timeline: [
      receiveStep(),
      samplingStep(3, 'run-e2e-1:sampling-1', 'tool_calls'),
      { ...toolStep(4), status: 'FAILED', hasError: true, ok: false, code: 'timeout' },
      finalizationStep(6, 'FAILED'),
    ],
    retrievalInspector: {
      ...inspector,
      availability: 'partial',
      retrievalCalls: [{
        ...inspector.retrievalCalls[0]!,
        status: 'FAILED',
        ok: false,
        code: 'timeout',
        sourceCount: null,
        chunkEvidenceCount: null,
        evidenceRefCount: null,
        strategy: null,
        refs: [],
      }],
      // Tool 超时：候选数量未知，不能展示成 0。
      candidateCount: null,
      evidenceRefCount: 0,
      finalization: {
        ...inspector.finalization!,
        status: 'FAILED',
        validation: 'failed',
        outcome: null,
        citationCount: null,
        citationIntegrity: null,
        faithfulnessStatus: null,
        schemaVersion: null,
        evidenceAvailability: 'unavailable',
        registryRefCount: 0,
        eligibleToolFailureCount: 1,
        failureReason: 'sampling_incomplete',
        samplingFailure: 'stream_failed',
        usage: null,
      },
      citations: null,
    },
  })
}

/**
 * 只有身份不完整的 Tool Step：既不能算 evidence-eligible，也不能说「未进入检索链路」。
 */
export function createUnclassifiableToolDetail(): AdminRunDetail {
  return createDetail({
    timeline: [
      receiveStep(),
      samplingStep(3, 'run-e2e-1:sampling-1', 'tool_calls'),
      {
        id: 'step-4',
        kind: 'generic',
        sequence: 4,
        type: 'tool_execution',
        title: '执行工具',
        status: 'COMPLETED',
        startedAt: START,
        endedAt: END,
        durationMs: 120,
        inputSummary: '未识别 Step 的 input 已省略',
        outputSummary: '未识别 Step 的 output 已省略',
        hasError: false,
      },
    ],
    retrievalInspector: {
      availability: 'unavailable',
      retrievalCalls: [],
      callsTruncated: false,
      candidateCount: 0,
      evidenceRefCount: 0,
      finalization: null,
      citations: null,
    },
  })
}

/** 失败调用被改写进 toolSummary：整项 fail closed，Citation 不得 matched。 */
export function createFailedSummaryDetail(): AdminRunDetail {
  const inspector = createAvailableInspector()

  return createDetail({
    timeline: [
      receiveStep(),
      samplingStep(3, 'run-e2e-1:sampling-1', 'tool_calls'),
      { ...toolStep(4), status: 'FAILED', hasError: true, ok: false, code: 'timeout' },
      finalizationStep(6),
      assistantOutputStep(7),
    ],
    retrievalInspector: {
      ...inspector,
      availability: 'partial',
      candidateCount: null,
      evidenceRefCount: null,
      retrievalCalls: [{
        ...inspector.retrievalCalls[0]!,
        status: 'FAILED',
        ok: false,
        code: 'timeout',
        sourceCount: null,
        chunkEvidenceCount: null,
        evidenceRefCount: null,
        strategy: null,
        refs: [],
        metadataTrusted: false,
      }],
      citations: inspector.citations!.map(citation => ({
        ...citation,
        correlation: 'unmatched' as const,
        matchedCallIds: [],
      })),
    },
  })
}

/** COMPLETED zero-hit：检索成功但确实没有候选，候选数量是确定的 0。 */
export function createZeroHitDetail(): AdminRunDetail {
  const inspector = createAvailableInspector()

  return createDetail({
    timeline: [
      receiveStep(),
      samplingStep(3, 'run-e2e-1:sampling-1', 'tool_calls'),
      toolStep(4),
      finalizationStep(6),
      assistantOutputStep(7),
    ],
    retrievalInspector: {
      ...inspector,
      candidateCount: 0,
      evidenceRefCount: 0,
      retrievalCalls: [{
        ...inspector.retrievalCalls[0]!,
        sourceCount: 0,
        chunkEvidenceCount: 0,
        evidenceRefCount: 0,
        refs: [],
      }],
      finalization: {
        ...inspector.finalization!,
        evidenceAvailability: 'none',
        outcome: 'insufficient_evidence',
        registryRefCount: 0,
        citationCount: 0,
      },
      citations: [],
    },
  })
}

/** Tool 结果未记录：`ok` 为 null，既不是成功也不是失败。 */
export function createUnknownResultDetail(): AdminRunDetail {
  const inspector = createAvailableInspector()

  return createDetail({
    status: 'RUNNING',
    endedAt: null,
    timeline: [
      receiveStep(),
      samplingStep(3, 'run-e2e-1:sampling-1', 'tool_calls'),
      { ...toolStep(4), status: 'RUNNING', endedAt: null, ok: null, truncated: null },
    ],
    retrievalInspector: {
      ...inspector,
      availability: 'partial',
      candidateCount: null,
      evidenceRefCount: null,
      retrievalCalls: [{
        ...inspector.retrievalCalls[0]!,
        status: 'RUNNING',
        ok: null,
        code: null,
        sourceCount: null,
        chunkEvidenceCount: null,
        evidenceRefCount: null,
        strategy: null,
        truncated: null,
        refs: [],
      }],
      finalization: null,
      citations: null,
    },
  })
}

/** 普通 Run：没有任何 evidence-eligible 调用。 */
export function createOrdinaryDetail(): AdminRunDetail {
  return createDetail({
    timeline: [
      receiveStep(),
      samplingStep(3, 'run-e2e-1:sampling-1', 'stop'),
      assistantOutputStep(4),
    ],
    retrievalInspector: {
      availability: 'not_applicable',
      retrievalCalls: [],
      callsTruncated: false,
      candidateCount: 0,
      evidenceRefCount: 0,
      finalization: null,
      citations: null,
    },
  })
}

/**
 * legacy / malformed：Step 落入 Generic fallback，Inspector 侧计数不可信、
 * 持久化 Grounding 损坏。
 */
export function createMalformedDetail(): AdminRunDetail {
  const inspector = createAvailableInspector()

  return createDetail({
    timeline: [
      receiveStep(),
      samplingStep(3, 'run-e2e-1:sampling-1', 'tool_calls'),
      toolStep(4),
      {
        id: 'step-6',
        kind: 'generic',
        sequence: 6,
        type: 'grounded_finalization',
        title: '校验回答引用',
        status: 'COMPLETED',
        startedAt: START,
        endedAt: END,
        durationMs: 500,
        inputSummary: '未识别 Step 的 input 已省略',
        outputSummary: '未识别 Step 的 output 已省略',
        hasError: false,
      },
    ],
    retrievalInspector: {
      ...inspector,
      availability: 'partial',
      retrievalCalls: [{
        ...inspector.retrievalCalls[0]!,
        metadataTrusted: false,
        strategy: null,
        sourceCount: null,
        chunkEvidenceCount: null,
        evidenceRefCount: null,
        refs: [],
      }],
      candidateCount: null,
      evidenceRefCount: null,
      finalization: {
        ...inspector.finalization!,
        metadataTrusted: false,
        validation: 'unavailable',
        outcome: null,
        attemptCount: null,
        citationCount: null,
        citationIntegrity: null,
        faithfulnessStatus: null,
        schemaVersion: null,
        registryRefCount: null,
        registryTruncated: null,
        eligibleToolCallCount: null,
        eligibleToolFailureCount: null,
        evidenceAvailability: null,
        usage: null,
        recordedDurationMs: null,
      },
      citations: null,
    },
  })
}

/** 长 ID / 长标题：用于窄屏溢出验收。 */
export function createLongIdentifierDetail(): AdminRunDetail {
  const inspector = createAvailableInspector()
  const longChunkId = `article-301-chunk-${'0123456789'.repeat(8)}`

  return createDetail({
    timeline: [
      receiveStep(),
      samplingStep(3, 'run-e2e-1:sampling-1', 'tool_calls'),
      toolStep(4),
      finalizationStep(6),
    ],
    retrievalInspector: {
      ...inspector,
      retrievalCalls: [{
        ...inspector.retrievalCalls[0]!,
        refs: [{ sourceId: 301, chunkId: longChunkId }],
        sourceCount: 1,
        chunkEvidenceCount: 1,
        evidenceRefCount: 1,
      }],
      candidateCount: 1,
      evidenceRefCount: 1,
      finalization: { ...inspector.finalization!, registryRefCount: 1, citationCount: 1 },
      citations: [{
        ...inspector.citations![0]!,
        chunkId: longChunkId,
        title: `超长标题 ${'搜索引擎优化指南'.repeat(12)}`,
        sectionPath: `章节 / ${'层级'.repeat(40)}`,
      }],
    },
  })
}

function createAvailableInspector(): AdminRetrievalInspector {
  return {
    availability: 'available',
    callsTruncated: false,
    candidateCount: 3,
    evidenceRefCount: 3,
    retrievalCalls: [createCall()],
    finalization: {
      stepId: 'step-6',
      sequence: 6,
      status: 'COMPLETED',
      schemaVersion: 1,
      evidenceAvailability: 'available',
      outcome: 'answered',
      attemptCount: 1,
      maxAttempts: 2,
      registryRefCount: 3,
      registryTruncated: false,
      eligibleToolCallCount: 1,
      eligibleToolFailureCount: 0,
      validation: 'passed',
      failureReason: null,
      rejectionCode: null,
      samplingFailure: null,
      citationCount: 2,
      citationIntegrity: 'validated',
      faithfulnessStatus: 'not_evaluated',
      usage: { inputTokens: 30, outputTokens: 12, totalTokens: 42 },
      recordedDurationMs: 500,
      durationMs: 520,
      metadataTrusted: true,
    },
    citations: createCitations(),
  }
}

function createCall(): AdminRetrievalCallSummary {
  return {
    stepId: 'step-4',
    sequence: 4,
    status: 'COMPLETED',
    callId: 'call-1',
    toolName: 'retrieve_article_context',
    toolVersion: '1',
    samplingAttemptId: 'run-e2e-1:sampling-1',
    query: null,
    strategy: { name: 'hybrid_rrf', version: '2' },
    ok: true,
    code: null,
    sourceCount: 3,
    chunkEvidenceCount: 2,
    evidenceRefCount: 3,
    originalChars: 4_000,
    observationChars: 3_000,
    truncated: true,
    recordedDurationMs: 420,
    durationMs: 430,
    refs: [
      { sourceId: 301, chunkId: 'article-301-chunk-0' },
      { sourceId: 302, chunkId: null },
      { sourceId: 303, chunkId: 'article-303-chunk-1' },
    ],
    refsTruncated: false,
    metadataTrusted: true,
  }
}

function createCitations(): AdminGroundedCitationSummary[] {
  return [
    {
      sequence: 1,
      citationId: 'cit_0123456789abcdef0123456789abcdef',
      sourceId: 301,
      chunkId: 'article-301-chunk-0',
      granularity: 'chunk',
      title: '落地页 SEO 结构指南',
      sectionPath: '页面结构 / 标题层级',
      languageCode: 'zh-cn',
      strategy: { name: 'hybrid_rrf', version: '2' },
      correlation: 'matched',
      matchedCallIds: ['call-1'],
    },
    {
      sequence: 2,
      citationId: 'cit_ffffffffffffffffffffffffffffffff',
      sourceId: 302,
      chunkId: null,
      granularity: 'article',
      title: 'Keyword Intent Mapping',
      sectionPath: null,
      languageCode: 'en-us',
      strategy: { name: 'article_detail', version: '1' },
      correlation: 'matched',
      matchedCallIds: ['call-1'],
    },
  ]
}

function createDetail(overrides: {
  status?: AdminRunDetail['status']
  endedAt?: string | null
  timeline: AdminRunTimelineItem[]
  retrievalInspector: AdminRetrievalInspector
}): AdminRunDetail {
  const status = overrides.status ?? 'COMPLETED'
  const endedAt = overrides.endedAt === undefined ? END : overrides.endedAt

  return {
    id: RUN_ID,
    conversationId: 'conversation-e2e',
    status,
    questionPreview: '站内有哪些 SEO 指南？',
    requestedModel: null,
    samplingCount: 3,
    toolCallCount: 1,
    inputTokens: 60,
    outputTokens: 24,
    totalTokens: 84,
    durationMs: endedAt === null ? null : 5_000,
    startedAt: START,
    endedAt,
    createdAt: START,
    userMessageId: 'message-user',
    assistantMessageId: status === 'COMPLETED' ? 'message-assistant' : null,
    updatedAt: endedAt ?? START,
    messages: [{
      id: 'message-user',
      role: 'USER',
      status: 'COMPLETED',
      contentPreview: '站内有哪些 SEO 指南？',
      createdAt: START,
      updatedAt: START,
    }],
    timeline: overrides.timeline,
    retrievalInspector: overrides.retrievalInspector,
    safeRawData: {
      agentRun: {
        id: RUN_ID,
        conversationId: 'conversation-e2e',
        userMessageId: 'message-user',
        assistantMessageId: status === 'COMPLETED' ? 'message-assistant' : null,
        status,
        startedAt: START,
        endedAt,
        createdAt: START,
        updatedAt: endedAt ?? START,
      },
      agentSteps: overrides.timeline.map(item => ({
        id: item.id,
        sequence: item.sequence,
        type: item.type,
        title: item.title,
        status: item.status,
        startedAt: item.startedAt,
        endedAt: item.endedAt,
        inputSummary: item.inputSummary,
        outputSummary: item.outputSummary,
        hasError: item.hasError,
      })),
    },
  }
}

function receiveStep(): AdminRunTimelineItem {
  return {
    id: 'step-1',
    kind: 'known',
    sequence: 1,
    type: 'receive_user_message',
    title: '接收用户消息',
    status: 'COMPLETED',
    startedAt: START,
    endedAt: START,
    durationMs: 0,
    inputSummary: 'messageId=message-user, messageLength=12',
    outputSummary: null,
    hasError: false,
    messageId: 'message-user',
    messageLength: 12,
  }
}

function samplingStep(
  sequence: number,
  samplingAttemptId: string,
  finishReason: 'stop' | 'tool_calls',
): AdminRunTimelineItem {
  return {
    id: `step-${sequence}`,
    kind: 'known',
    sequence,
    type: 'model_sampling',
    title: '模型采样',
    status: 'COMPLETED',
    startedAt: START,
    endedAt: END,
    durationMs: 300,
    inputSummary: `samplingAttemptId=${samplingAttemptId}`,
    outputSummary: `finishReason=${finishReason}`,
    hasError: false,
    samplingIndex: sequence === 3 ? 1 : 2,
    samplingAttemptId,
    requestedModel: null,
    providerItemCount: 4,
    toolCount: 3,
    finishReason,
    usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 },
    toolCallCount: finishReason === 'tool_calls' ? 1 : 0,
    textChars: 40,
    intermediateTextChars: 0,
    recordedDurationMs: 300,
    contextInspector: {
      availability: 'unavailable',
      outcome: 'unavailable',
      resolvedModel: 'deepseek-v4-flash',
      requestedModel: null,
      estimatorStrategyId: null,
      contextWindowTokens: null,
      applicationInputCapTokens: null,
      outputReserveTokens: null,
      safetyMarginTokens: null,
      resolvedInputBudgetTokens: null,
      estimatedInputTokens: null,
      budgetUsageRatio: null,
      prePlanItemCount: null,
      providerItemCount: 4,
      historyCandidateCount: null,
      historyIncludedCount: null,
      historyExcludedCount: null,
      initialHistoryExcludedReason: null,
      samplingHistoryExcludedCount: null,
      toolExchangeCount: null,
      observations: null,
    },
  }
}

function toolStep(sequence: number): Extract<
  AdminRunTimelineItem,
  { type: 'tool_execution' }
> {
  return {
    id: `step-${sequence}`,
    kind: 'known',
    sequence,
    type: 'tool_execution',
    title: '执行工具',
    status: 'COMPLETED',
    startedAt: START,
    endedAt: END,
    durationMs: 430,
    inputSummary: 'callId=call-1, toolName=retrieve_article_context',
    outputSummary: 'ok=true, originalChars=4000',
    hasError: false,
    callId: 'call-1',
    toolName: 'retrieve_article_context',
    toolVersion: '1',
    samplingAttemptId: 'run-e2e-1:sampling-1',
    executionAttempt: 1,
    rawArgumentsChars: 48,
    ok: true,
    code: null,
    retryable: null,
    originalChars: 4_000,
    observationChars: 3_000,
    truncated: true,
    recordedDurationMs: 420,
  }
}

function finalizationStep(
  sequence: number,
  status: 'COMPLETED' | 'FAILED' = 'COMPLETED',
): AdminRunTimelineItem {
  return {
    id: `step-${sequence}`,
    kind: 'known',
    sequence,
    type: 'grounded_finalization',
    title: '校验回答引用',
    status,
    startedAt: START,
    endedAt: END,
    durationMs: 520,
    inputSummary: 'evidenceAvailability=available, registryRefCount=3',
    outputSummary: 'attemptCount=1, outcome=answered, citationCount=2',
    hasError: status === 'FAILED',
    assistantMessageId: 'message-assistant',
    evidenceAvailability: status === 'FAILED' ? 'unavailable' : 'available',
    outcome: status === 'FAILED' ? null : 'answered',
    attemptCount: 1,
    maxAttempts: 2,
    registryRefCount: status === 'FAILED' ? 0 : 3,
    registryTruncated: false,
    citationCount: status === 'FAILED' ? null : 2,
    validation: status === 'FAILED' ? 'failed' : 'passed',
    failureReason: status === 'FAILED' ? 'sampling_incomplete' : null,
  }
}

function assistantOutputStep(sequence: number): AdminRunTimelineItem {
  return {
    id: `step-${sequence}`,
    kind: 'known',
    sequence,
    type: 'assistant_output',
    title: '生成助手回复',
    status: 'COMPLETED',
    startedAt: START,
    endedAt: END,
    durationMs: 10,
    inputSummary: 'assistantMessageId=message-assistant',
    outputSummary: 'contentLength=40',
    hasError: false,
    assistantMessageId: 'message-assistant',
    contentLength: 40,
  }
}
