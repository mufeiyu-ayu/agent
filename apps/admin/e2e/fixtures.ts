import type {
  AdminRunDetail,
  AdminRunTimelineItem,
} from '@agent/contracts'
import type { Page } from '@playwright/test'

/**
 * Run Trace 浏览器验收使用的确定性 fixture。
 *
 * 所有响应都严格符合公共 `AdminRunDetail` contract，由 `page.route()` 提供：
 * 不启动 API 进程、不连数据库、不调用模型 Provider，也不向组件注入生产中
 * 不存在的数据结构。
 */

export const RUN_ID = 'run-e2e-1'

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
  return createDetail([
    historyStep(),
    samplingStep(3, 'run-e2e-1:sampling-1', 'tool_calls'),
    toolStep(4),
    samplingStep(5, 'run-e2e-1:sampling-2', 'stop'),
    assistantOutputStep(7),
  ])
}

/** 回喂给模型的 search_articles observation：文章标题里夹带 HTML 与脚本，页面只能按原文显示，不能解析执行。 */
export const UNTRUSTED_OBSERVATION = '共找到 1 篇匹配文章，以下是 1 条精简结果：\n[{"sourceId":301,"title":"<b>不应加粗</b> SEO 指南<script>window.__observationExecuted = true</script>"}]'

/**
 * #152 之后的 Run：tool Step 带参数与 observation，采样 Step 带中间文本与 reasoning。
 * 第 1 轮有两个工具调用，用来验证在同类条目之间切换时折叠状态不被带过去。
 */
export function createModelVisibleContentDetail(): AdminRunDetail {
  const detail = createDetail([
    historyStep(),
    samplingStep(3, 'run-e2e-1:sampling-1', 'tool_calls'),
    toolStep(4),
    { ...toolStep(5), callId: 'call-2' },
    samplingStep(6, 'run-e2e-1:sampling-2', 'stop'),
    assistantOutputStep(8),
  ])

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
      default:
        return item
    }
  })

  return detail
}

function createDetail(timeline: AdminRunTimelineItem[]): AdminRunDetail {
  return {
    id: RUN_ID,
    conversationId: 'conversation-e2e',
    status: 'COMPLETED',
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
    durationMs: 5_000,
    startedAt: START,
    endedAt: END,
    createdAt: START,
    assistantMessageId: 'message-assistant',
    updatedAt: END,
    messages: [{
      id: 'message-user',
      role: 'USER',
      status: 'COMPLETED',
      contentPreview: '站内有哪些 SEO 指南？',
      createdAt: START,
      updatedAt: START,
    }],
    timeline,
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
    toolName: 'search_articles',
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
