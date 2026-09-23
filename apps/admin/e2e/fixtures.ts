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
 * Retrieval 视图 DOM 负向断言使用的禁止词表。
 *
 * 这些词只可能来自内部引用凭据、原始 Observation 或 Provider / SQL / 向量内部数据。
 * #152 起 tool Step 的 observation 会在事件视图里按原文展示，所以只用于
 * 不带 observation 正文的 fixture（createModelVisibleContentDetail 不适用）。
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
      historyStep(),
      samplingStep(3, 'run-e2e-1:sampling-1', 'tool_calls'),
      toolStep(4),
      samplingStep(5, 'run-e2e-1:sampling-2', 'stop'),
      finalizationStep(6),
      assistantOutputStep(7),
    ],
    retrievalInspector: createAvailableInspector(),
  })
}

/** 回喂给模型的 observation：含 HTML 与脚本，页面只能按原文显示，不能解析执行。 */
export const UNTRUSTED_OBSERVATION = '[retrieve_article_context@1]\n<script>window.__observationExecuted = true</script>\n<b>不应加粗</b> SEO 指南候选'

/**
 * #152 之后的 Run：tool Step 带参数与 observation，采样 Step 带中间文本与 reasoning。
 * 第 1 轮有两个工具调用，用来验证在同类条目之间切换时折叠状态不被带过去。
 */
export function createModelVisibleContentDetail(): AdminRunDetail {
  const detail = createDetail({
    timeline: [
      historyStep(),
      samplingStep(3, 'run-e2e-1:sampling-1', 'tool_calls'),
      toolStep(4),
      { ...toolStep(5), callId: 'call-2' },
      samplingStep(6, 'run-e2e-1:sampling-2', 'stop'),
      finalizationStep(7),
      assistantOutputStep(8),
    ],
    retrievalInspector: createAvailableInspector(),
  })

  detail.timeline = detail.timeline.map((item) => {
    if (item.kind !== 'known')
      return item

    switch (item.type) {
      case 'load_conversation_history':
        return { ...item, messageCount: 3 }
      case 'tool_execution':
        return {
          ...item,
          arguments: '{"query":"SEO 指南","limit":3}',
          observation: item.callId === 'call-1' ? UNTRUSTED_OBSERVATION : '第二个工具的结果',
          observationChars: [...UNTRUSTED_OBSERVATION].length,
          originalChars: [...UNTRUSTED_OBSERVATION].length,
          truncated: false,
        }
      case 'model_sampling':
        return item.finishReason === 'tool_calls'
          ? {
              ...item,
              intermediateText: '先查一下站内文章。',
              reasoningContent: '用户在问 SEO 指南，应先检索。',
              contextInspector: { ...item.contextInspector, historyIncludedCount: 2, historyCandidateCount: 3 },
            }
          : {
              ...item,
              contextInspector: { ...item.contextInspector, historyIncludedCount: 2, historyCandidateCount: 3 },
            }
      case 'grounded_finalization':
        return { ...item, registryTruncated: false, eligibleToolCallCount: 1, eligibleToolFailureCount: 0 }
      default:
        return item
    }
  })
  detail.retrievalInspector = {
    ...detail.retrievalInspector,
    retrievalCalls: detail.retrievalInspector.retrievalCalls.map(call => ({ ...call, query: 'SEO 指南' })),
  }

  return detail
}

export function createRunningDetail(): AdminRunDetail {
  return createDetail({
    status: 'RUNNING',
    endedAt: null,
    timeline: [
      historyStep(),
      samplingStep(3, 'run-e2e-1:sampling-1', 'tool_calls'),
      toolStep(4),
    ],
    retrievalInspector: {
      ...createAvailableInspector(),
      citations: null,
    },
  })
}

export function createFailedDetail(): AdminRunDetail {
  const inspector = createAvailableInspector()

  return createDetail({
    status: 'FAILED',
    timeline: [
      historyStep(),
      samplingStep(3, 'run-e2e-1:sampling-1', 'tool_calls'),
      { ...toolStep(4), status: 'FAILED', hasError: true, ok: false, code: 'timeout' },
      finalizationStep(6, 'FAILED'),
    ],
    retrievalInspector: {
      ...inspector,
      // Tool 超时：没有 summary，候选数量未记录，不能展示成 0。
      retrievalCalls: [{
        ...inspector.retrievalCalls[0]!,
        sourceCount: null,
        chunkEvidenceCount: null,
        strategy: null,
        refs: [],
      }],
      citations: null,
    },
  })
}

/** COMPLETED zero-hit：检索成功但确实没有候选，候选数量是确定的 0。 */
export function createZeroHitDetail(): AdminRunDetail {
  const inspector = createAvailableInspector()

  return createDetail({
    timeline: [
      historyStep(),
      samplingStep(3, 'run-e2e-1:sampling-1', 'tool_calls'),
      toolStep(4),
      { ...finalizationStep(6), evidenceAvailability: 'none', outcome: 'insufficient_evidence', registryRefCount: 0 },
      assistantOutputStep(7),
    ],
    retrievalInspector: {
      ...inspector,
      retrievalCalls: [{
        ...inspector.retrievalCalls[0]!,
        sourceCount: 0,
        chunkEvidenceCount: 0,
        refs: [],
      }],
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
      historyStep(),
      samplingStep(3, 'run-e2e-1:sampling-1', 'tool_calls'),
      { ...toolStep(4), status: 'RUNNING', endedAt: null, ok: null, truncated: null },
    ],
    retrievalInspector: {
      ...inspector,
      retrievalCalls: [{
        ...inspector.retrievalCalls[0]!,
        sourceCount: null,
        chunkEvidenceCount: null,
        strategy: null,
        refs: [],
      }],
      citations: null,
    },
  })
}

/** 普通 Run：没有任何 evidence-eligible 调用，也没有持久化 Grounding。 */
export function createOrdinaryDetail(): AdminRunDetail {
  return createDetail({
    timeline: [
      historyStep(),
      samplingStep(3, 'run-e2e-1:sampling-1', 'stop'),
      assistantOutputStep(4),
    ],
    retrievalInspector: {
      retrievalCalls: [],
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
      historyStep(),
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
      }],
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
    retrievalCalls: [createCall()],
    citations: createCitations(),
  }
}

function createCall(): AdminRetrievalCallSummary {
  return {
    stepId: 'step-4',
    query: null,
    strategy: { name: 'hybrid_rrf', version: '2' },
    sourceCount: 3,
    chunkEvidenceCount: 2,
    refs: [
      { sourceId: 301, chunkId: 'article-301-chunk-0' },
      { sourceId: 302, chunkId: null },
      { sourceId: 303, chunkId: 'article-303-chunk-1' },
    ],
  }
}

function createCitations(): AdminGroundedCitationSummary[] {
  return [
    {
      citationId: 'cit_0123456789abcdef0123456789abcdef',
      sourceId: 301,
      chunkId: 'article-301-chunk-0',
      title: '落地页 SEO 结构指南',
      sectionPath: '页面结构 / 标题层级',
      languageCode: 'zh-cn',
      strategy: { name: 'hybrid_rrf', version: '2' },
      matchedCallIds: ['call-1'],
    },
    {
      citationId: 'cit_ffffffffffffffffffffffffffffffff',
      sourceId: 302,
      chunkId: null,
      title: 'Keyword Intent Mapping',
      sectionPath: null,
      languageCode: 'en-us',
      strategy: { name: 'article_detail', version: '1' },
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
    samplingCount: 3,
    toolCallCount: 1,
    usage: {
      inputTokens: 60,
      outputTokens: 24,
      totalTokens: 84,
      reasoningTokens: 18,
      promptCacheHitTokens: 42,
      promptCacheMissTokens: 18,
    },
    durationMs: endedAt === null ? null : 5_000,
    startedAt: START,
    endedAt,
    createdAt: START,
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
  }
}

function historyStep(): AdminRunTimelineItem {
  return {
    id: 'step-1',
    kind: 'known',
    sequence: 1,
    type: 'load_conversation_history',
    title: '加载会话上下文',
    status: 'COMPLETED',
    startedAt: START,
    endedAt: START,
    durationMs: 0,
    hasError: false,
    messageCount: 2,
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
    hasError: false,
    samplingIndex: sequence === 3 ? 1 : 2,
    samplingAttemptId,
    finishReason,
    usage: {
      inputTokens: 20,
      outputTokens: 8,
      totalTokens: 28,
      reasoningTokens: 5,
      promptCacheHitTokens: 14,
      promptCacheMissTokens: 6,
    },
    toolCallCount: finishReason === 'tool_calls' ? 1 : 0,
    // #152 之前的 Run 没有这些内容事实；带内容的场景见 createModelVisibleContentDetail。
    intermediateText: null,
    reasoningContent: null,
    debugRequestBody: null,
    debugRawResponse: null,
    contextInspector: {
      outcome: 'success',
      resolvedModel: 'deepseek-v4-flash',
      providerId: 'provider-deepseek',
      modelId: 'model-deepseek-v4-flash',
      resolvedInputBudgetTokens: 262_144,
      estimatedInputTokens: 1_200,
      historyIncludedCount: null,
      historyCandidateCount: 2,
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
    hasError: false,
    callId: 'call-1',
    toolName: 'retrieve_article_context',
    samplingAttemptId: 'run-e2e-1:sampling-1',
    ok: true,
    code: null,
    arguments: null,
    observation: null,
    originalChars: 4_000,
    observationChars: 3_000,
    truncated: true,
  }
}

function finalizationStep(
  sequence: number,
  status: 'COMPLETED' | 'FAILED' = 'COMPLETED',
): Extract<AdminRunTimelineItem, { type: 'grounded_finalization' }> {
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
    hasError: status === 'FAILED',
    evidenceAvailability: status === 'FAILED' ? 'unavailable' : 'available',
    outcome: status === 'FAILED' ? null : 'answered',
    attemptCount: 1,
    registryRefCount: status === 'FAILED' ? 0 : 3,
    registryTruncated: null,
    eligibleToolCallCount: null,
    eligibleToolFailureCount: null,
    failureReason: status === 'FAILED' ? 'sampling_incomplete' : null,
    rejectionCode: null,
    samplingFailure: status === 'FAILED' ? 'stream_failed' : null,
    usage: status === 'FAILED'
      ? null
      : {
          inputTokens: 30,
          outputTokens: 12,
          totalTokens: 42,
          reasoningTokens: 8,
          promptCacheHitTokens: 20,
          promptCacheMissTokens: 10,
        },
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
    hasError: false,
    assistantMessageId: 'message-assistant',
  }
}
