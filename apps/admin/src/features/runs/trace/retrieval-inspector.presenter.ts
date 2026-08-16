import type { AdminRetrievalInspector } from '@agent/contracts'

/**
 * Retrieval Inspector 的展示投影。
 *
 * 只做计数与派生，不重建任何事实：所有输入都来自服务端 typed contract，
 * 前端不解析 Step 的安全摘要文本，也不解析原始 JSON。
 */
export interface RetrievalInspectorCounts {
  /** evidence-eligible 调用次数（已受 20 条上限约束）。 */
  callCount: number
  failedCallCount: number
  /** Tool 声明的候选总数；任一 call 元数据不可信时为 null。 */
  candidateCount: number | null
  /** 去重后的可投影 evidence 身份数量；任一 call 元数据不可信时为 null。 */
  evidenceRefCount: number | null
  /** 最终被引用的不同来源数量；Grounding 不可用时为 null。 */
  citedSourceCount: number | null
  citationCount: number | null
  matchedCitationCount: number | null
  unmatchedCitationCount: number | null
  untrustedCallCount: number
}

export function createRetrievalInspectorCounts(
  inspector: AdminRetrievalInspector,
): RetrievalInspectorCounts {
  const citations = inspector.citations

  return {
    callCount: inspector.retrievalCalls.length,
    failedCallCount: inspector.retrievalCalls.filter(
      call => call.ok === false,
    ).length,
    candidateCount: inspector.candidateCount,
    evidenceRefCount: inspector.evidenceRefCount,
    citedSourceCount: citations === null
      ? null
      : new Set(citations.map(citation => citation.sourceId)).size,
    citationCount: citations?.length ?? null,
    matchedCitationCount: citations === null
      ? null
      : citations.filter(citation => citation.correlation === 'matched').length,
    unmatchedCitationCount: citations === null
      ? null
      : citations.filter(citation => citation.correlation === 'unmatched').length,
    untrustedCallCount: inspector.retrievalCalls.filter(
      call => !call.metadataTrusted,
    ).length,
  }
}

/** 状态标签色；与 Grounding 的 evidenceAvailability 分层，不共用色值语义。 */
export function resolveAvailabilityTone(
  availability: AdminRetrievalInspector['availability'],
): 'success' | 'warning' | 'error' | 'neutral' {
  switch (availability) {
    case 'available':
      return 'success'
    case 'partial':
      return 'warning'
    case 'unavailable':
      return 'error'
    case 'not_applicable':
      return 'neutral'
  }
}
