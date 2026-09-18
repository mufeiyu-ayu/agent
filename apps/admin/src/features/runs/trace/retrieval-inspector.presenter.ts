import type {
  AdminRetrievalCallSummary,
  AdminRetrievalInspector,
  AdminRetrievalSourceRef,
  AdminRunTimelineItem,
  AdminToolExecutionStep,
  AdminToolResultCode,
} from '@agent/contracts'

/**
 * Retrieval Inspector 的展示投影。
 *
 * 只做关联、计数与派生，不重建任何事实：call 摘要来自服务端 typed contract，
 * 工具身份与执行结果按 `stepId` 从 timeline 的 tool step 取。
 */
export interface RetrievalCallCard extends AdminRetrievalCallSummary {
  callId: string | null
  toolName: string | null
  ok: boolean | null
  code: AdminToolResultCode | null
  truncated: boolean | null
}

export interface RetrievalInspectorCounts {
  callCount: number
  failedCallCount: number
  /** 各 call 声明候选数之和；任一 call 未记录时为 null。 */
  candidateCount: number | null
  /** 去重后的 `sourceId:chunkId` 引用身份数量；任一 call 的引用无法确认时为 null。 */
  evidenceRefCount: number | null
  /** 最终被引用的不同来源数量；Grounding 不可用时为 null。 */
  citedSourceCount: number | null
  citationCount: number | null
  matchedCitationCount: number | null
}

export function createRetrievalCallCards(
  inspector: AdminRetrievalInspector,
  timeline: readonly AdminRunTimelineItem[],
): RetrievalCallCard[] {
  const toolSteps = new Map<string, AdminToolExecutionStep>()

  for (const item of timeline) {
    if (item.kind === 'known' && item.type === 'tool_execution')
      toolSteps.set(item.id, item)
  }

  return inspector.retrievalCalls.map((call) => {
    const step = toolSteps.get(call.stepId)

    return {
      ...call,
      callId: step?.callId ?? null,
      toolName: step?.toolName ?? null,
      ok: step?.ok ?? null,
      code: step?.code ?? null,
      truncated: step?.truncated ?? null,
    }
  })
}

export function createRetrievalInspectorCounts(
  cards: readonly RetrievalCallCard[],
  citations: AdminRetrievalInspector['citations'],
): RetrievalInspectorCounts {
  return {
    callCount: cards.length,
    failedCallCount: cards.filter(card => card.ok === false).length,
    candidateCount: cards.some(card => card.sourceCount === null)
      ? null
      : cards.reduce((total, card) => total + (card.sourceCount ?? 0), 0),
    evidenceRefCount: cards.some(card => !hasRecordedRefs(card))
      ? null
      : new Set(
        cards
          .filter(card => card.ok !== false)
          .flatMap(card => card.refs.map(toRefIdentity)),
      ).size,
    citedSourceCount: citations === null
      ? null
      : new Set(citations.map(citation => citation.sourceId)).size,
    citationCount: citations?.length ?? null,
    matchedCitationCount: citations === null
      ? null
      : citations.filter(citation => citation.matchedCallIds.length > 0).length,
  }
}

/**
 * 一次 call 提交给 Registry 的引用是否已完整记录。
 *
 * 明确失败的调用不向 Registry 提交任何引用：0 是可确认的事实，计数时也不把它的 refs
 * 计入。成功调用只有在 typed summary 存在且 refs 条数等于声明的 `sourceCount` 时才算
 * 完整：projector 会逐条跳过非法 ref、工具 summary 也可能只写前 N 条，两者都不改
 * `sourceCount`，只看它非 null 会得到一个确定但偏小的数字。成功但没有 summary
 * （如 `get_article_detail` 命中时只提交 evidence 不写 summary）或结果未记录时，
 * 数量未知，不能用 0 顶替。
 */
function hasRecordedRefs(card: RetrievalCallCard): boolean {
  return card.ok === false
    || (card.sourceCount !== null && card.refs.length === card.sourceCount)
}

/** 引用身份；与服务端 `projectCitations` 关联 `matchedCallIds` 的口径一致。 */
export function toRefIdentity(ref: AdminRetrievalSourceRef): string {
  return `${ref.sourceId}:${ref.chunkId ?? ''}`
}

export type InspectorTone = 'success' | 'warning' | 'error' | 'neutral'

/**
 * Tool 调用结果的三态色调。
 *
 * `ok` 为 `null` 表示结果未记录，既不是成功也不是失败：必须用中性色，
 * 不能因为 Step 状态是 COMPLETED 就当成绿色的成功。
 */
export function resolveCallStatusTone(ok: boolean | null): InspectorTone {
  if (ok === null)
    return 'neutral'

  return ok ? 'success' : 'error'
}

/** 把语义色调映射为 ant-design-vue Tag 的 color 值。 */
export function toTagColor(tone: InspectorTone): string {
  return {
    success: 'green',
    warning: 'orange',
    error: 'red',
    neutral: 'default',
  }[tone]
}
