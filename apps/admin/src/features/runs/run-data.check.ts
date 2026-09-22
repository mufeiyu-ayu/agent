import type {
  AdminContextInspector,
  AdminRetrievalCallSummary,
  AdminRetrievalInspector,
  AdminRunDetail,
  AdminRunListItem,
  AdminRunListResponse,
  AdminRunTimelineItem,
  AdminRunTokenUsage,
  ApiErrorResponse,
  ApiSuccessResponse,
} from '@agent/contracts'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createPinia, setActivePinia } from 'pinia'

import { i18n } from '@/i18n'
import {
  AdminRunApiError,
  fetchAdminRunDetail,
  fetchAdminRuns,
  formatAdminRunError,
  serializeAdminRunQuery,
} from './run-api'
import { createRunDetailState } from './run-detail.state'
import { defaultRunListPageSize, useRunListStore } from './run-list.store'
import {
  formatDateTime,
  formatPercentage,
  formatTime,
  formatTokens,
} from './run.utils'
import {
  createRetrievalCallCards,
  createRetrievalInspectorCounts,
  resolveCallStatusTone,
  toTagColor,
} from './trace/retrieval-inspector.presenter'
import {
  createRunTraceProjection,
  filterTraceRecords,
  getVisibleTraceRecords,
  resolveTraceRequestModel,
  resolveTraceSelection,
} from './trace/run-trace.presenter'

void main()

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch

  try {
    await checkQuerySerialization()
    await checkApiErrors()
    await checkListStateAndRaceFencing()
    await checkDetailStateAndRaceFencing()
    checkPartialTraceAndInspectors()
    checkRunTraceProjection()
    checkRetrievalInspector()
    checkProductionSources()
    console.log('admin run data checks passed')
  }
  finally {
    globalThis.fetch = originalFetch
  }
}

function checkPartialTraceAndInspectors(): void {
  const detail = createRunningDetail()
  const sampling = detail.timeline[1]!

  assert.equal(detail.status, 'RUNNING')
  assert.equal(formatDateTime(detail.endedAt), '—')
  assert.equal(formatTokens(detail.usage.totalTokens), '—')
  assert.equal(formatTime('2026-08-09T16:00:00.000Z', 'en-US'), '00:00:00')
  assert.equal(detail.messages.length, 1)
  assert.equal(sampling.status, 'RUNNING')
  assert.equal(sampling.endedAt, null)
  assert.equal(
    sampling.kind === 'known' && sampling.type === 'model_sampling'
      ? sampling.contextInspector.outcome
      : undefined,
    null,
  )

  assert.equal(formatPercentage(0, 'en-US'), '0%')
  assert.equal(formatPercentage(null, 'en-US'), '—')
}

function checkRunTraceProjection(): void {
  const directFinal = createTraceDetail(0)
  const directProjection = createRunTraceProjection(directFinal)

  assert.deepEqual(
    directProjection.records.map(record => record.item.sequence),
    [1, 2, 3, 4],
  )
  assert.equal(directProjection.requestGroups.length, 1)
  assert.equal(directProjection.requestGroups[0]?.number, 1)
  assert.deepEqual(directProjection.requestGroups[0]?.toolRecordIds, [])
  assert.equal(directProjection.defaultSelectionId, 'trace-model-1')
  // 旧库的 receive_user_message 投影为 generic，事件类型不再是 USER。
  assert.equal(
    directProjection.records.find(record => record.id === 'trace-user')?.eventType,
    'GENERIC',
  )
  assert.equal(
    directProjection.records.find(record => record.eventType === 'OUTPUT')?.messagePreview,
    '助手可见回答 preview',
  )
  const directSamplingRecord = directProjection.records.find(
    record => record.id === 'trace-model-1',
  )!
  assert.equal(
    directSamplingRecord.item.kind === 'known'
    && directSamplingRecord.item.type === 'model_sampling'
      ? directSamplingRecord.item.contextInspector.resolvedModel
      : null,
    'deepseek-v4-flash',
  )
  assert.equal(
    resolveTraceRequestModel(directProjection.requestGroups[0]!, 'Unavailable'),
    'deepseek-v4-flash',
  )
  assert.deepEqual(
    directSamplingRecord.item.kind === 'known'
    && directSamplingRecord.item.type === 'model_sampling'
      ? directSamplingRecord.item.usage
      : null,
    {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      reasoningTokens: 0,
      promptCacheHitTokens: 0,
      promptCacheMissTokens: 0,
    },
  )
  assert.deepEqual(
    [...new Set(directProjection.overviewSpans.map(span => span.lane))],
    ['input', 'model'],
  )
  assert.equal(
    directProjection.overviewSpans.some(span => span.recordId === 'trace-output'),
    false,
  )

  const oneToolProjection = createRunTraceProjection(createTraceDetail(1))
  assert.equal(oneToolProjection.requestGroups.length, 2)
  assert.deepEqual(oneToolProjection.requestGroups.map(group => group.number), [1, 2])
  assert.deepEqual(oneToolProjection.requestGroups[0]?.toolRecordIds, ['trace-tool-1'])
  assert.equal(
    oneToolProjection.records.find(record => record.id === 'trace-tool-1')?.requestId,
    oneToolProjection.requestGroups[0]?.id,
  )
  assert.equal(
    oneToolProjection.overviewSpans.find(span => span.recordId === 'trace-tool-1')?.lane,
    'tools',
  )

  const missingModel = createTraceDetail(0)
  const missingModelSampling = missingModel.timeline.find(item => item.id === 'trace-model-1')!
  if (missingModelSampling.kind === 'known' && missingModelSampling.type === 'model_sampling')
    missingModelSampling.contextInspector.resolvedModel = null
  assert.equal(
    resolveTraceRequestModel(
      createRunTraceProjection(missingModel).requestGroups[0]!,
      'Unavailable',
    ),
    'Unavailable',
  )

  const twoTool = createTraceDetail(2)
  const twoToolProjection = createRunTraceProjection(twoTool)
  assert.equal(twoToolProjection.requestGroups.length, 3)
  assert.deepEqual(
    twoToolProjection.requestGroups.map(group => group.toolRecordIds),
    [['trace-tool-1'], ['trace-tool-2'], []],
  )

  const firstGroup = twoToolProjection.requestGroups[0]!
  const collapsed = new Set([firstGroup.id])
  const collapsedRecords = getVisibleTraceRecords(twoToolProjection, '', collapsed)
  assert.equal(collapsedRecords.some(record => record.id === 'trace-tool-1'), false)
  assert.equal(collapsedRecords.some(record => record.id === firstGroup.samplingRecordId), true)
  assert.equal(
    resolveTraceSelection(twoToolProjection, collapsedRecords, 'trace-tool-1'),
    firstGroup.samplingRecordId,
  )

  const searchedRecords = getVisibleTraceRecords(
    twoToolProjection,
    '  SEARCH_ARTICLES  ',
    collapsed,
  )
  assert.deepEqual(
    searchedRecords.map(record => record.id),
    [firstGroup.samplingRecordId, 'trace-tool-1'],
  )
  assert.equal(
    resolveTraceSelection(twoToolProjection, searchedRecords, 'trace-output'),
    firstGroup.samplingRecordId,
  )
  assert.deepEqual(filterTraceRecords(twoToolProjection.records, 'deepseek-v4-flash').map(
    record => record.id,
  ), ['trace-model-1', 'trace-model-2', 'trace-model-3'])
  // 搜索只用 typed 字段：finishReason 与 tool code 可搜，摘要文本已不存在。
  assert.deepEqual(filterTraceRecords(twoToolProjection.records, 'tool_calls').map(
    record => record.id,
  ), ['trace-model-1', 'trace-model-2'])
  const noResults = getVisibleTraceRecords(twoToolProjection, 'does-not-exist', collapsed)
  assert.deepEqual(noResults, [])
  assert.equal(resolveTraceSelection(twoToolProjection, noResults, 'trace-tool-1'), undefined)

  const duplicateAssociation = createTraceDetail(2)
  const duplicateSamplings = duplicateAssociation.timeline.filter(
    item => item.kind === 'known' && item.type === 'model_sampling',
  ).sort((left, right) => left.sequence - right.sequence)
  duplicateSamplings[1]!.samplingAttemptId = duplicateSamplings[0]!.samplingAttemptId
  duplicateSamplings[2]!.samplingAttemptId = null
  const duplicateProjection = createRunTraceProjection(duplicateAssociation)

  assert.equal(duplicateProjection.requestGroups.length, 3)
  assert.equal(duplicateProjection.requestGroups[2]?.samplingAttemptId, null)
  assert.deepEqual(
    duplicateProjection.records
      .filter(record => record.eventType === 'TOOL')
      .map(record => [record.id, record.requestId, record.unlinked]),
    [
      ['trace-tool-1', null, true],
      ['trace-tool-2', null, true],
    ],
  )

  const unmatchedAssociation = createTraceDetail(1)
  const unmatchedTool = unmatchedAssociation.timeline.find(
    item => item.kind === 'known' && item.type === 'tool_execution',
  )!
  if (unmatchedTool.kind === 'known' && unmatchedTool.type === 'tool_execution')
    unmatchedTool.samplingAttemptId = 'orphan-attempt'
  assertFirstToolUnlinked(unmatchedAssociation)

  const nullAssociation = createTraceDetail(1)
  const nullTool = nullAssociation.timeline.find(item => item.id === 'trace-tool-1')!
  if (nullTool.kind === 'known' && nullTool.type === 'tool_execution')
    nullTool.samplingAttemptId = null
  assertFirstToolUnlinked(nullAssociation)

  const beforeAssociation = createTraceDetail(1)
  const beforeTool = beforeAssociation.timeline.find(item => item.id === 'trace-tool-1')!
  const owningSampling = beforeAssociation.timeline.find(item => item.id === 'trace-model-1')!
  beforeTool.sequence = owningSampling.sequence - 1
  assertFirstToolUnlinked(beforeAssociation)

  const crossedAssociation = createTraceDetail(1)
  const crossedTool = crossedAssociation.timeline.find(item => item.id === 'trace-tool-1')!
  const nextSampling = crossedAssociation.timeline.find(item => item.id === 'trace-model-2')!
  crossedTool.sequence = nextSampling.sequence + 1
  assertFirstToolUnlinked(crossedAssociation)

  const equalAssociation = createTraceDetail(1)
  const equalTool = equalAssociation.timeline.find(item => item.id === 'trace-tool-1')!
  const equalSampling = equalAssociation.timeline.find(item => item.id === 'trace-model-1')!
  equalTool.sequence = equalSampling.sequence
  assertFirstToolUnlinked(equalAssociation)

  const partialTiming = createTraceDetail(1)
  partialTiming.status = 'RUNNING'
  partialTiming.endedAt = null
  partialTiming.durationMs = null
  const runningSampling = partialTiming.timeline.find(
    item => item.id === 'trace-model-2',
  )!
  runningSampling.status = 'RUNNING'
  runningSampling.endedAt = null
  runningSampling.durationMs = null
  if (runningSampling.kind === 'known' && runningSampling.type === 'model_sampling')
    runningSampling.usage = null
  const zeroTool = partialTiming.timeline.find(item => item.id === 'trace-tool-1')!
  zeroTool.endedAt = zeroTool.startedAt
  zeroTool.durationMs = 0
  const missingTiming = partialTiming.timeline.find(item => item.id === 'trace-history')!
  missingTiming.startedAt = null
  missingTiming.endedAt = null
  missingTiming.durationMs = null
  const partialProjection = createRunTraceProjection(partialTiming)

  assert.equal(
    partialProjection.overviewSpans.find(span => span.recordId === 'trace-model-2')?.marker,
    true,
  )
  assert.equal(
    partialProjection.overviewSpans.find(span => span.recordId === 'trace-tool-1')?.marker,
    true,
  )
  assert.equal(
    partialProjection.overviewSpans.find(span => span.recordId === 'trace-tool-1')?.durationMs,
    0,
  )
  assert.equal(
    partialProjection.overviewSpans.find(span => span.recordId === 'trace-history')?.startedAtMs,
    null,
  )
  const partialSamplingRecord = partialProjection.records.find(
    record => record.id === 'trace-model-2',
  )!
  assert.equal(
    partialSamplingRecord.item.kind === 'known'
    && partialSamplingRecord.item.type === 'model_sampling'
      ? partialSamplingRecord.item.usage
      : undefined,
    null,
  )
  assert.equal(partialProjection.timelineEndMs, Date.parse('2026-08-09T00:00:00.400Z'))

  const genericWithForbiddenData = {
    id: 'trace-generic',
    kind: 'generic',
    sequence: 99,
    type: 'future_step',
    title: 'Future safe title',
    status: 'COMPLETED',
    startedAt: null,
    endedAt: null,
    durationMs: null,
    hasError: false,
    prompt: 'FORBIDDEN_PROMPT_VALUE',
    reasoning: 'FORBIDDEN_REASONING_VALUE',
    rawArgumentsJson: 'FORBIDDEN_ARGUMENT_VALUE',
    observationBody: 'FORBIDDEN_OBSERVATION_VALUE',
  } as AdminRunTimelineItem
  twoTool.timeline.push(genericWithForbiddenData)
  const safeProjection = createRunTraceProjection(twoTool)

  assert.equal(safeProjection.records.at(-1)?.eventType, 'GENERIC')
  assert.match(safeProjection.records.at(-1)?.content ?? '', /Future safe title/)
  assert.deepEqual(filterTraceRecords(safeProjection.records, 'FORBIDDEN'), [])
  assert.deepEqual(
    filterTraceRecords(safeProjection.records, '助手可见回答').map(record => record.id),
    ['trace-output'],
  )
}

function assertFirstToolUnlinked(detail: AdminRunDetail): void {
  const projection = createRunTraceProjection(detail)
  const tool = projection.records.find(record => record.id === 'trace-tool-1')

  assert.deepEqual(
    [tool?.requestId, tool?.unlinked, projection.requestGroups[0]?.toolRecordIds],
    [null, true, []],
  )
}

function checkProductionSources(): void {
  const sources = [
    new URL('../../views/RunsView.vue', import.meta.url),
    new URL('../../views/RunDetailView.vue', import.meta.url),
    new URL('./run-api.ts', import.meta.url),
    new URL('./run-detail.state.ts', import.meta.url),
    new URL('./run-list.store.ts', import.meta.url),
  ].map(path => readFileSync(path, 'utf8'))

  for (const source of sources)
    assert.doesNotMatch(source, /run\.mocks|mockRunList|getMockRunDetail/)

  const requestInspectorSource = readFileSync(
    new URL('./trace/inspectors/RequestInspector.vue', import.meta.url),
    'utf8',
  )
  assert.doesNotMatch(requestInspectorSource, /inputSummary|outputSummary|safeIo/)
  assert.doesNotMatch(requestInspectorSource, /props\.item\.(?:input|output)\b/)
  assert.doesNotMatch(
    requestInspectorSource,
    /props\.item\.(?:prompt|reasoning|rawArguments|observationBody)\b/,
  )

  const debugJsonPaneSource = readFileSync(
    new URL('./trace/inspectors/DebugJsonPane.vue', import.meta.url),
    'utf8',
  )
  assert.match(debugJsonPaneSource, /responseState === 'partial'/)
  assert.match(debugJsonPaneSource, /capture\.state === 'empty'/)
  assert.match(debugJsonPaneSource, /responseCapture/)
  assert.match(debugJsonPaneSource, /state: props\.capture\.state/)
  assert.match(debugJsonPaneSource, /debugCapture\.emptyResponse/)

  const ledgerSource = readFileSync(
    new URL('./trace/RunTraceLedger.vue', import.meta.url),
    'utf8',
  )
  assert.match(ledgerSource, /resolveTraceRequestModel/)
  assert.doesNotMatch(ledgerSource, /sampling\.requestedModel|formatRequestedModel/)

  assert.equal(existsSync(new URL('./run.mocks.ts', import.meta.url)), false)

  // Retrieval 视图必须只消费 typed contract：不得解析原始 JSON。
  const retrievalInspectorSource = readFileSync(
    new URL('./trace/inspectors/RetrievalInspector.vue', import.meta.url),
    'utf8',
  )
  assert.match(retrievalInspectorSource, /inspector\.retrievalCalls/)
  assert.match(retrievalInspectorSource, /inspector\.citations/)
  assert.doesNotMatch(retrievalInspectorSource, /inputSummary|outputSummary|safeRawData/)
  assert.doesNotMatch(retrievalInspectorSource, /citationKey|excerpt|slug|distance|embedding/)
  assert.doesNotMatch(retrievalInspectorSource, /JSON\.parse|JSON\.stringify/)
  // 三态色调必须走 presenter 纯函数，不得回到「非 false 即绿」的二元判断。
  assert.match(retrievalInspectorSource, /resolveCallStatusTone/)
  assert.doesNotMatch(retrievalInspectorSource, /ok === false \? 'red' : 'green'/)
  // 证据引用身份数是三态：未知必须走「未记录」占位，不得用 ?? 0 顶替。
  assert.match(retrievalInspectorSource, /show\(counts\.value\.evidenceRefCount\)/)
  assert.doesNotMatch(retrievalInspectorSource, /evidenceRefCount \?\? 0/)

  const presenterSource = readFileSync(
    new URL('./trace/retrieval-inspector.presenter.ts', import.meta.url),
    'utf8',
  )
  assert.doesNotMatch(presenterSource, /inputSummary|outputSummary|safeRawData/)
}

function checkRetrievalInspector(): void {
  const traceDetail = createTraceDetail(1)
  const cards = createRetrievalCallCards(traceDetail.retrievalInspector, traceDetail.timeline)
  const counts = createRetrievalInspectorCounts(cards, traceDetail.retrievalInspector.citations)

  // 工具身份与执行结果按 stepId 从 timeline 的 tool step 取。
  assert.equal(cards.length, 1)
  assert.equal(cards[0]?.stepId, 'trace-tool-1')
  assert.equal(cards[0]?.callId, 'trace-call-1')
  assert.equal(cards[0]?.toolName, 'search_articles')
  assert.equal(cards[0]?.ok, true)
  assert.equal(cards[0]?.code, null)
  assert.equal(cards[0]?.truncated, false)
  // candidate、evidence 与 cited 必须分别可读，不能互相顶替。
  assert.equal(counts.callCount, 1)
  assert.equal(counts.failedCallCount, 0)
  assert.equal(counts.candidateCount, 3)
  assert.equal(counts.evidenceRefCount, 3)
  assert.equal(counts.citedSourceCount, 2)
  assert.equal(counts.citationCount, 2)
  assert.equal(counts.matchedCitationCount, 2)

  // stepId 在 timeline 里找不到 tool step 时，工具身份与结果为 null。
  const orphanCards = createRetrievalCallCards(traceDetail.retrievalInspector, [])
  assert.equal(orphanCards[0]?.toolName, null)
  assert.equal(orphanCards[0]?.ok, null)
  assert.equal(resolveCallStatusTone(orphanCards[0]!.ok), 'neutral')

  const runningDetail = createRunningDetail()
  const runningCounts = createRetrievalInspectorCounts(
    createRetrievalCallCards(runningDetail.retrievalInspector, runningDetail.timeline),
    runningDetail.retrievalInspector.citations,
  )

  assert.equal(runningCounts.citationCount, null)
  assert.equal(runningCounts.citedSourceCount, null)
  assert.equal(runningCounts.matchedCitationCount, null)

  const unmatchedCounts = createRetrievalInspectorCounts(
    cards,
    [{ ...availableCitations()[0]!, matchedCallIds: [] }],
  )

  assert.equal(unmatchedCounts.matchedCitationCount, 0)
  assert.equal(unmatchedCounts.citationCount, 1)

  checkCallStatusTone()
  checkCandidateCountRendering(traceDetail.timeline)
  checkEvidenceRefCountRendering(createTraceDetail(2).timeline)
}

/**
 * Tool 调用结果必须是三态。
 *
 * `ok=null` 表示结果未记录：既不能显示成功文案，也不能沿用成功色。
 */
function checkCallStatusTone(): void {
  assert.equal(resolveCallStatusTone(true), 'success')
  assert.equal(resolveCallStatusTone(false), 'error')
  assert.equal(resolveCallStatusTone(null), 'neutral')

  assert.equal(toTagColor(resolveCallStatusTone(true)), 'green')
  assert.equal(toTagColor(resolveCallStatusTone(false)), 'red')
  assert.equal(toTagColor(resolveCallStatusTone(null)), 'default')
  assert.notEqual(toTagColor(resolveCallStatusTone(null)), 'green')
}

/** zero-hit 的 0 与「候选数量未记录」的 null 必须走不同的展示分支。 */
function checkCandidateCountRendering(timeline: AdminRunTimelineItem[]): void {
  const zeroHit = createRetrievalInspector({
    retrievalCalls: [{
      ...createAvailableRetrievalInspector().retrievalCalls[0]!,
      sourceCount: 0,
      chunkEvidenceCount: 0,
      refs: [],
    }],
  })
  const unknown = createRetrievalInspector({
    retrievalCalls: [{
      ...createAvailableRetrievalInspector().retrievalCalls[0]!,
      sourceCount: null,
      chunkEvidenceCount: null,
      strategy: null,
      refs: [],
    }],
  })
  const failedTimeline = timeline.map(item => (
    item.kind === 'known' && item.type === 'tool_execution'
      ? { ...item, ok: false, code: 'timeout' as const }
      : item
  ))

  const zeroHitCards = createRetrievalCallCards(zeroHit, timeline)
  const unknownCards = createRetrievalCallCards(unknown, timeline)
  const failedCards = createRetrievalCallCards(unknown, failedTimeline)

  assert.equal(createRetrievalInspectorCounts(zeroHitCards, zeroHit.citations).candidateCount, 0)
  assert.equal(createRetrievalInspectorCounts(zeroHitCards, zeroHit.citations).evidenceRefCount, 0)
  assert.equal(createRetrievalInspectorCounts(unknownCards, unknown.citations).candidateCount, null)
  assert.equal(createRetrievalInspectorCounts(unknownCards, unknown.citations).evidenceRefCount, null)
  assert.equal(createRetrievalInspectorCounts(failedCards, unknown.citations).failedCallCount, 1)
  assert.equal(resolveCallStatusTone(failedCards[0]!.ok), 'error')
}

/**
 * 证据引用身份数必须区分「明确记录为 0」与「没有摘要、数量未知」。
 *
 * `get_article_detail` 命中时只提交 evidence 不写 summary，presenter 收到
 * `sourceCount=null`、`refs=[]`；Registry 实际可能已有 1 条 article 证据，
 * 不能把它显示成确定的 0，也不能把已知 call 的数量当成整个 Run 的总数。
 */
function checkEvidenceRefCountRendering(timeline: AdminRunTimelineItem[]): void {
  const knownCall = createAvailableRetrievalInspector().retrievalCalls[0]!
  const detailCall: AdminRetrievalCallSummary = {
    stepId: 'trace-tool-2',
    query: null,
    strategy: null,
    sourceCount: null,
    chunkEvidenceCount: null,
    refs: [],
  }
  const overlappingCall: AdminRetrievalCallSummary = {
    ...knownCall,
    stepId: 'trace-tool-2',
    sourceCount: 2,
    chunkEvidenceCount: 1,
    refs: [
      { sourceId: 11, chunkId: 'chunk-a' },
      { sourceId: 21, chunkId: null },
    ],
  }
  const counts = (
    retrievalCalls: AdminRetrievalCallSummary[],
    calls: AdminRunTimelineItem[] = timeline,
  ) => createRetrievalInspectorCounts(
    createRetrievalCallCards(createRetrievalInspector({ retrievalCalls }), calls),
    null,
  )
  const withToolStep = (
    id: string,
    patch: Partial<Extract<AdminRunTimelineItem, { type: 'tool_execution' }>>,
  ) => timeline.map(item => (
    item.kind === 'known' && item.type === 'tool_execution' && item.id === id
      ? { ...item, ...patch }
      : item
  ))

  // 成功、有 evidence、无 summary：数量未知，不是 0。
  assert.equal(counts([detailCall]).evidenceRefCount, null)
  // 所有摘要完整：按 sourceId:chunkId 精确去重（11:chunk-a 重复只算一次）。
  assert.equal(counts([knownCall, overlappingCall]).evidenceRefCount, 4)
  // 已知与未知混合：不能把已知的 3 当成总数。
  assert.equal(counts([knownCall, detailCall]).evidenceRefCount, null)
  // summary 声明 5 条却只投影出 3 条（非法 ref 被跳过或只写了前 N 条）：数量未知，不是偏小的 3。
  assert.equal(
    counts([{ ...knownCall, sourceCount: 5 }]).evidenceRefCount,
    null,
  )
  // 明确失败的调用不向 Registry 提交引用，0 是可确认的事实，总数仍为已知的 3。
  assert.equal(
    counts([knownCall, detailCall], withToolStep('trace-tool-2', { ok: false, code: 'timeout' }))
      .evidenceRefCount,
    3,
  )
  // 失败调用即使带着 summary refs 也不向 Registry 提交引用：不计入，总数仍是已知的 3。
  assert.equal(
    counts(
      [knownCall, { ...overlappingCall, refs: [{ sourceId: 31, chunkId: 'chunk-x' }], sourceCount: 1 }],
      withToolStep('trace-tool-2', { ok: false, code: 'timeout' }),
    ).evidenceRefCount,
    3,
  )
  // 运行中 / 结果未记录（ok=null）且无摘要：未知。
  assert.equal(
    counts([knownCall, detailCall], withToolStep('trace-tool-2', { ok: null, status: 'RUNNING' }))
      .evidenceRefCount,
    null,
  )
  // 在 timeline 找不到 tool step（ok=null）同样是未知。
  assert.equal(counts([detailCall], []).evidenceRefCount, null)
}

function createRetrievalInspector(
  overrides: Partial<AdminRetrievalInspector> = {},
): AdminRetrievalInspector {
  return {
    ...createAvailableRetrievalInspector(),
    ...overrides,
  }
}

function createAvailableRetrievalInspector(): AdminRetrievalInspector {
  return {
    retrievalCalls: [{
      stepId: 'trace-tool-1',
      query: null,
      strategy: { name: 'hybrid_rrf', version: '2' },
      sourceCount: 3,
      chunkEvidenceCount: 2,
      refs: [
        { sourceId: 11, chunkId: 'chunk-a' },
        { sourceId: 12, chunkId: null },
        { sourceId: 13, chunkId: 'chunk-c' },
      ],
    }],
    citations: availableCitations(),
  }
}

function availableCitations(): NonNullable<AdminRetrievalInspector['citations']> {
  return [
    {
      citationId: 'cit_00000000000000000000000000000001',
      sourceId: 11,
      chunkId: 'chunk-a',
      title: '示例文章 1',
      sectionPath: '指南 / 基础',
      languageCode: 'zh-CN',
      strategy: { name: 'hybrid_rrf', version: '2' },
      matchedCallIds: ['trace-call-1'],
    },
    {
      citationId: 'cit_00000000000000000000000000000002',
      sourceId: 12,
      chunkId: null,
      title: '示例文章 2',
      sectionPath: null,
      languageCode: 'zh-CN',
      strategy: { name: 'hybrid_rrf', version: '2' },
      matchedCallIds: ['trace-call-1'],
    },
  ]
}

function createPartialRetrievalInspector(): AdminRetrievalInspector {
  return {
    ...createAvailableRetrievalInspector(),
    citations: null,
  }
}

async function checkQuerySerialization(): Promise<void> {
  const search = new URLSearchParams(serializeAdminRunQuery({
    page: 2,
    pageSize: 8,
    status: 'FAILED',
    query: '  run-35  ',
    dateFrom: '2026-08-01',
    dateTo: '2026-08-09',
  }))

  assert.deepEqual(Object.fromEntries(search), {
    page: '2',
    pageSize: '8',
    status: 'FAILED',
    query: 'run-35',
    dateFrom: '2026-08-01T00:00:00+08:00',
    dateTo: '2026-08-09T23:59:59.999+08:00',
  })
  assert.equal(serializeAdminRunQuery({ query: '   ' }), '')
  assert.throws(
    () => serializeAdminRunQuery({ dateFrom: '2026-02-30' }),
    RangeError,
  )

  let requestedUrl = ''
  globalThis.fetch = async (input) => {
    requestedUrl = String(input)
    return jsonResponse(successEnvelope(createListResponse('real-run')))
  }

  await fetchAdminRuns({ page: 1, pageSize: 8 })
  assert.equal(requestedUrl, '/api/admin/runs?page=1&pageSize=8')
}

async function checkApiErrors(): Promise<void> {
  globalThis.fetch = async () => {
    throw new TypeError('Failed to fetch')
  }
  let networkError: unknown
  await assert.rejects(
    fetchAdminRuns({}),
    (error: unknown) => {
      networkError = error
      assert.ok(error instanceof AdminRunApiError)
      assert.equal(error.status, 0)
      assert.ok(error.cause instanceof TypeError)
      return true
    },
  )
  i18n.global.locale.value = 'en-US'
  assert.equal(formatAdminRunError(networkError), 'Unable to connect to the Admin API.')
  i18n.global.locale.value = 'zh-CN'
  assert.equal(formatAdminRunError(networkError), '无法连接 Admin API。')

  globalThis.fetch = async () => jsonResponse(errorEnvelope(404, 'Agent Run 不存在'), 404)

  await assert.rejects(
    fetchAdminRunDetail('missing/run'),
    (error: unknown) => {
      assert.ok(error instanceof AdminRunApiError)
      assert.equal(error.status, 404)
      assert.equal(error.message, 'Agent Run 不存在')
      return true
    },
  )

  globalThis.fetch = async () => new Response('not-json', { status: 500 })
  let localError: unknown
  await assert.rejects(
    fetchAdminRuns({}),
    (error: unknown) => {
      localError = error
      assert.ok(error instanceof AdminRunApiError)
      assert.equal(error.status, 500)
      assert.match(error.message, /HTTP 500/)
      return true
    },
  )

  i18n.global.locale.value = 'en-US'
  assert.equal(formatAdminRunError(localError), 'Admin API request failed (HTTP 500).')
  i18n.global.locale.value = 'zh-CN'
}

async function checkListStateAndRaceFencing(): Promise<void> {
  setActivePinia(createPinia())
  const store = useRunListStore()
  assert.equal(store.loading, false)
  assert.equal(store.error, '')
  assert.equal(store.pageSize, defaultRunListPageSize)
  assert.equal(store.pagination.totalItems, 0)

  const requests: Array<{
    url: string
    resolve: (response: Response) => void
  }> = []
  globalThis.fetch = input => new Promise<Response>((resolve) => {
    requests.push({ url: String(input), resolve })
  })

  const firstLoad = store.load()
  assert.equal(store.loading, true)
  const secondLoad = store.setPage(2)
  assert.equal(requests.length, 2)
  assert.match(requests[0]!.url, /page=1/)
  assert.match(requests[1]!.url, /page=2/)

  requests[1]!.resolve(jsonResponse(successEnvelope(createListResponse('new-run', 2, 2))))
  await secondLoad
  assert.equal(store.loading, false)
  assert.equal(store.items[0]?.id, 'new-run')
  assert.equal(store.pagination.page, 2)

  requests[0]!.resolve(jsonResponse(successEnvelope(createListResponse('stale-run', 1))))
  await firstLoad
  assert.equal(store.items[0]?.id, 'new-run')
  assert.equal(store.pagination.page, 2)

  let pageSizeUrl = ''
  globalThis.fetch = async (input) => {
    pageSizeUrl = String(input)
    return jsonResponse(successEnvelope(createListResponse('sized-run')))
  }
  await store.setPageSize(20)
  assert.equal(store.pageSize, 20)
  assert.equal(store.currentPage, 1)
  assert.match(pageSizeUrl, /page=1/)
  assert.match(pageSizeUrl, /pageSize=20/)

  store.draftFilters.status = 'FAILED'
  globalThis.fetch = async () => jsonResponse(errorEnvelope(503, 'API 暂不可用'), 503)
  await store.applyFilters()
  assert.equal(store.loading, false)
  assert.equal(store.error, 'API 暂不可用')
  assert.equal(store.items.length, 0)
  assert.equal(store.summary.totalRuns, 0)
  assert.equal(store.pagination.totalItems, 0)

  globalThis.fetch = async () => jsonResponse(successEnvelope(createListResponse('retry-run')))
  await store.retry()
  assert.equal(store.error, '')
  assert.equal(store.items[0]?.id, 'retry-run')

  store.draftFilters.status = 'COMPLETED'
  store.dateRange = ['2026-08-01', '2026-08-09']
  const applyRequest = deferredResponse()
  globalThis.fetch = async (input) => {
    assert.match(String(input), /status=COMPLETED/)
    assert.match(String(input), /dateFrom=2026-08-01T00%3A00%3A00%2B08%3A00/)
    return applyRequest.promise
  }
  const applying = store.applyFilters()
  assert.equal(store.currentPage, 1)
  applyRequest.resolve(jsonResponse(successEnvelope(createListResponse('filtered-run'))))
  await applying
  assert.equal(store.items[0]?.id, 'filtered-run')

  const overflowRequests: string[] = []
  globalThis.fetch = async (input) => {
    overflowRequests.push(String(input))
    return jsonResponse(successEnvelope(
      overflowRequests.length === 1
        ? createListResponse('out-of-range', 9, 2)
        : createListResponse('last-page', 2, 2),
    ))
  }
  await store.setPage(9)
  assert.equal(overflowRequests.length, 2)
  assert.match(overflowRequests[1]!, /page=2/)
  assert.equal(store.currentPage, 2)
  assert.equal(store.items[0]?.id, 'last-page')

  globalThis.fetch = async () => jsonResponse(successEnvelope(createEmptyListResponse()))
  const emptyLoad = store.resetFilters()
  assert.equal(store.loading, true)
  await emptyLoad
  assert.equal(store.loading, false)
  assert.equal(store.items.length, 0)
  assert.equal(store.summary.totalRuns, 0)
  assert.equal(store.pagination.totalPages, 0)
  assert.equal(store.currentPage, 1)
}

async function checkDetailStateAndRaceFencing(): Promise<void> {
  let currentRunId = 'run-success'
  const state = createRunDetailState(() => currentRunId)

  globalThis.fetch = async () => jsonResponse(successEnvelope(
    createDetail('run-success', 'COMPLETED'),
  ))
  const loading = state.load()
  assert.equal(state.loading.value, true)
  await loading
  assert.equal(state.loading.value, false)
  assert.equal(state.run.value?.id, 'run-success')
  assert.equal(state.run.value?.status, 'COMPLETED')
  assert.equal(state.notFound.value, false)
  assert.equal(state.error.value, '')

  for (const status of ['RUNNING', 'COMPLETED', 'FAILED', 'ABORTED'] as const) {
    currentRunId = `run-${status.toLowerCase()}`
    globalThis.fetch = async () => jsonResponse(successEnvelope(
      createDetail(currentRunId, status),
    ))
    await state.load()
    assert.equal(state.run.value?.status, status)
  }

  currentRunId = 'run-missing'
  globalThis.fetch = async () => jsonResponse(errorEnvelope(404, 'Agent Run 不存在'), 404)
  await state.load()
  assert.equal(isUndefined(state.run.value), true)
  assert.equal(state.notFound.value, true)
  assert.equal(state.error.value, '')

  currentRunId = 'run-retry'
  globalThis.fetch = async () => jsonResponse(errorEnvelope(503, 'API 暂不可用'), 503)
  await state.load()
  assert.equal(state.notFound.value, false)
  assert.equal(state.error.value, 'API 暂不可用')

  globalThis.fetch = async () => jsonResponse(successEnvelope(
    createDetail('run-retry', 'COMPLETED'),
  ))
  await state.retry()
  assert.equal(state.error.value, '')
  assert.equal(state.run.value?.id, 'run-retry')

  const requests: Array<{
    url: string
    resolve: (response: Response) => void
  }> = []
  globalThis.fetch = input => new Promise<Response>((resolve) => {
    requests.push({ url: String(input), resolve })
  })

  currentRunId = 'run-old'
  const oldLoad = state.load()
  currentRunId = 'run-new'
  const newLoad = state.load()
  assert.equal(requests.length, 2)
  assert.match(requests[0]!.url, /run-old$/)
  assert.match(requests[1]!.url, /run-new$/)

  requests[1]!.resolve(jsonResponse(successEnvelope(createDetail('run-new', 'RUNNING'))))
  await newLoad
  assert.equal(state.run.value?.id, 'run-new')
  assert.equal(state.loading.value, false)

  requests[0]!.resolve(jsonResponse(successEnvelope(createDetail('run-old', 'COMPLETED'))))
  await oldLoad
  assert.equal(state.run.value?.id, 'run-new')
  assert.equal(state.run.value?.status, 'RUNNING')

  currentRunId = 'run-route-old'
  const routeOldRequest = deferredResponse()
  globalThis.fetch = async () => routeOldRequest.promise
  const routeOldLoad = state.load()
  currentRunId = 'run-route-new'
  routeOldRequest.resolve(jsonResponse(successEnvelope(
    createDetail('run-route-old', 'COMPLETED'),
  )))
  await routeOldLoad
  assert.equal(isUndefined(state.run.value), true)

  globalThis.fetch = async () => jsonResponse(successEnvelope(
    createDetail('run-route-new', 'COMPLETED'),
  ))
  await state.load()
  assert.equal(state.run.value?.id, 'run-route-new')

  state.cancel()
}

function createTraceDetail(toolCount: 0 | 1 | 2): AdminRunDetail {
  const timeline: AdminRunTimelineItem[] = [
    // 旧库仍可能带 receive_user_message：服务端投影为 generic。
    {
      id: 'trace-user',
      kind: 'generic',
      sequence: 1,
      type: 'receive_user_message',
      title: '接收用户消息',
      status: 'COMPLETED',
      ...traceTiming(1),
      hasError: false,
    },
    {
      id: 'trace-history',
      kind: 'known',
      sequence: 2,
      type: 'load_conversation_history',
      title: '加载会话上下文',
      status: 'COMPLETED',
      ...traceTiming(2),
      hasError: false,
      messageCount: 2,
    },
  ]
  let sequence = 3

  for (let index = 1; index <= toolCount + 1; index += 1) {
    const samplingAttemptId = `run-trace:sampling-${index}`
    const finishReason = index <= toolCount ? 'tool_calls' : 'stop'

    timeline.push({
      id: `trace-model-${index}`,
      kind: 'known',
      sequence,
      type: 'model_sampling',
      title: '模型采样',
      status: 'COMPLETED',
      ...traceTiming(sequence),
      hasError: false,
      samplingIndex: index,
      samplingAttemptId,
      finishReason,
      usage: index === 1
        ? {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            reasoningTokens: 0,
            promptCacheHitTokens: 0,
            promptCacheMissTokens: 0,
          }
        : {
            inputTokens: index * 10,
            outputTokens: index * 2,
            totalTokens: index * 12,
            reasoningTokens: index,
            promptCacheHitTokens: index * 3,
            promptCacheMissTokens: index * 7,
          },
      toolCallCount: finishReason === 'tool_calls' ? 1 : 0,
      debugRequestBody: null,
      debugRawResponse: null,
      contextInspector: createContextInspector({
        estimatedInputTokens: index * 100,
      }),
    })
    sequence += 1

    if (index > toolCount)
      continue

    const toolName = index === 1 ? 'search_articles' : 'get_article_detail'
    timeline.push({
      id: `trace-tool-${index}`,
      kind: 'known',
      sequence,
      type: 'tool_execution',
      title: '执行工具',
      status: 'COMPLETED',
      ...traceTiming(sequence),
      hasError: false,
      callId: `trace-call-${index}`,
      toolName,
      samplingAttemptId,
      ok: true,
      code: null,
      originalChars: 24,
      observationChars: 24,
      truncated: false,
    })
    sequence += 1
  }

  const runEndedAt = traceTimestamp(sequence * 100)
  timeline.push({
    id: 'trace-output',
    kind: 'known',
    sequence,
    type: 'assistant_output',
    title: '生成助手回复',
    status: 'COMPLETED',
    startedAt: traceTimestamp((sequence - 1) * 100),
    endedAt: runEndedAt,
    durationMs: 100,
    hasError: false,
    assistantMessageId: 'trace-assistant-message',
  })

  return {
    id: 'run-trace',
    conversationId: 'trace-conversation',
    assistantMessageId: 'trace-assistant-message',
    status: 'COMPLETED',
    questionPreview: '用户可见问题 preview',
    samplingCount: toolCount + 1,
    toolCallCount: toolCount,
    usage: emptyUsage(),
    durationMs: Date.parse(runEndedAt) - Date.parse(traceTimestamp(0)),
    startedAt: traceTimestamp(0),
    endedAt: runEndedAt,
    createdAt: traceTimestamp(0),
    updatedAt: runEndedAt,
    messages: [
      {
        id: 'trace-user-message',
        role: 'USER',
        status: 'COMPLETED',
        contentPreview: '用户可见问题 preview',
        createdAt: traceTimestamp(0),
        updatedAt: traceTimestamp(0),
      },
      {
        id: 'trace-assistant-message',
        role: 'ASSISTANT',
        status: 'COMPLETED',
        contentPreview: '助手可见回答 preview',
        createdAt: traceTimestamp(100),
        updatedAt: runEndedAt,
      },
    ],
    // 反转输入，确保 presenter 而不是 fixture 顺序决定 Ledger。
    timeline: [...timeline].reverse(),
    retrievalInspector: createAvailableRetrievalInspector(),
  }
}

function traceTiming(sequence: number): {
  startedAt: string
  endedAt: string
  durationMs: number
} {
  const startedAtMs = (sequence - 1) * 100
  return {
    startedAt: traceTimestamp(startedAtMs),
    endedAt: traceTimestamp(startedAtMs + 50),
    durationMs: 50,
  }
}

function traceTimestamp(offsetMs: number): string {
  return new Date(Date.parse('2026-08-09T00:00:00.000Z') + offsetMs).toISOString()
}

function createRunningDetail(): AdminRunDetail {
  const startedAt = '2026-08-09T00:00:00.000Z'
  const generic: AdminRunTimelineItem = {
    id: 'step-generic',
    kind: 'generic',
    sequence: 1,
    type: 'future_context_step',
    title: 'Future safe step',
    status: 'COMPLETED',
    startedAt,
    endedAt: '2026-08-09T00:00:00.010Z',
    durationMs: 10,
    hasError: false,
  }
  const sampling: AdminRunTimelineItem = {
    id: 'step-sampling',
    kind: 'known',
    sequence: 2,
    type: 'model_sampling',
    title: '模型采样中',
    status: 'RUNNING',
    startedAt: '2026-08-09T00:00:00.010Z',
    endedAt: null,
    durationMs: null,
    hasError: false,
    samplingIndex: 1,
    samplingAttemptId: 'sampling-running-1',
    finishReason: null,
    usage: null,
    toolCallCount: null,
    debugRequestBody: null,
    debugRawResponse: null,
    contextInspector: createContextInspector({
      outcome: null,
      estimatedInputTokens: null,
    }),
  }

  return {
    id: 'run-running',
    conversationId: 'conversation-running',
    assistantMessageId: null,
    status: 'RUNNING',
    questionPreview: '验证 RUNNING partial trace',
    samplingCount: 1,
    toolCallCount: 0,
    usage: emptyUsage(),
    durationMs: null,
    startedAt,
    endedAt: null,
    createdAt: startedAt,
    updatedAt: '2026-08-09T00:00:00.020Z',
    messages: [{
      id: 'message-user-running',
      role: 'USER',
      status: 'COMPLETED',
      contentPreview: '验证 RUNNING partial trace',
      createdAt: startedAt,
      updatedAt: startedAt,
    }],
    timeline: [generic, sampling],
    retrievalInspector: createPartialRetrievalInspector(),
  }
}

function createContextInspector(
  overrides: Partial<AdminContextInspector> = {},
): AdminContextInspector {
  return {
    outcome: 'success',
    resolvedModel: 'deepseek-v4-flash',
    providerId: 'provider-deepseek',
    modelId: 'model-deepseek-v4-flash',
    resolvedInputBudgetTokens: 262_144,
    estimatedInputTokens: 0,
    ...overrides,
  }
}

function emptyUsage(): AdminRunTokenUsage {
  return {
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    reasoningTokens: null,
    promptCacheHitTokens: null,
    promptCacheMissTokens: null,
  }
}

function createDetail(
  id: string,
  status: AdminRunDetail['status'],
): AdminRunDetail {
  const detail = createRunningDetail()
  const endedAt = status === 'RUNNING' ? null : '2026-08-09T00:00:00.100Z'

  return {
    ...detail,
    id,
    status,
    durationMs: status === 'RUNNING' ? null : 100,
    endedAt,
  }
}

function createListResponse(id: string, page = 1, totalPages = 1): AdminRunListResponse {
  return {
    items: [createListItem(id)],
    pagination: {
      page,
      pageSize: 8,
      totalItems: totalPages,
      totalPages,
    },
    summary: {
      totalRuns: 1,
      statusCounts: {
        RUNNING: 0,
        COMPLETED: 1,
        FAILED: 0,
        ABORTED: 0,
      },
    },
  }
}

function createEmptyListResponse(): AdminRunListResponse {
  return {
    items: [],
    pagination: {
      page: 1,
      pageSize: defaultRunListPageSize,
      totalItems: 0,
      totalPages: 0,
    },
    summary: {
      totalRuns: 0,
      statusCounts: {
        RUNNING: 0,
        COMPLETED: 0,
        FAILED: 0,
        ABORTED: 0,
      },
    },
  }
}

function createListItem(id: string): AdminRunListItem {
  return {
    id,
    conversationId: `${id}-conversation`,
    status: 'COMPLETED',
    questionPreview: '真实问题摘要',
    samplingCount: 1,
    toolCallCount: 0,
    usage: emptyUsage(),
    durationMs: 100,
    startedAt: '2026-08-09T00:00:00.000Z',
    endedAt: '2026-08-09T00:00:00.100Z',
    createdAt: '2026-08-09T00:00:00.000Z',
  }
}

function successEnvelope<T>(data: T): ApiSuccessResponse<T> {
  return {
    success: true,
    code: 0,
    message: 'ok',
    data,
    timestamp: '2026-08-09T00:00:00.000Z',
    path: '/api/admin/runs',
  }
}

function errorEnvelope(status: number, message: string): ApiErrorResponse {
  return {
    success: false,
    code: status,
    message,
    error: {
      statusCode: status,
      error: 'Error',
    },
    timestamp: '2026-08-09T00:00:00.000Z',
    path: '/api/admin/runs',
  }
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

function deferredResponse(): {
  promise: Promise<Response>
  resolve: (response: Response) => void
} {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function isUndefined(value: unknown): boolean {
  return value === undefined
}
