import type {
  AdminContextInspector,
  AdminRunDetail,
  AdminRunListItem,
  AdminRunListResponse,
  AdminRunTimelineItem,
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
  formatRequestedModel,
  formatTime,
  formatTokens,
  getDefaultTimelineItem,
  getTimelineInspectorLabel,
} from './run.utils'

void main()

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch

  try {
    await checkQuerySerialization()
    await checkApiErrors()
    await checkListStateAndRaceFencing()
    await checkDetailStateAndRaceFencing()
    checkPartialTraceAndInspectors()
    checkProductionSources()
    console.log('admin run data checks passed')
  }
  finally {
    globalThis.fetch = originalFetch
  }
}

function checkPartialTraceAndInspectors(): void {
  const detail = createRunningDetail()
  const generic = detail.timeline[0]!
  const sampling = detail.timeline[1]!

  assert.equal(detail.status, 'RUNNING')
  assert.equal(formatDateTime(detail.endedAt), '—')
  assert.equal(formatTokens(detail.totalTokens), '—')
  assert.equal(formatRequestedModel(detail.requestedModel), 'Default request')
  assert.equal(formatTime('2026-08-09T16:00:00.000Z', 'en-US'), '00:00:00')
  assert.equal(detail.messages.length, 1)
  assert.equal(sampling.status, 'RUNNING')
  assert.equal(sampling.endedAt, null)
  assert.equal(
    sampling.kind === 'known' && sampling.type === 'model_sampling'
      ? sampling.contextInspector.availability
      : null,
    'partial',
  )
  assert.equal(getDefaultTimelineItem(detail.timeline)?.id, sampling.id)
  assert.equal(getTimelineInspectorLabel(generic), 'Generic Inspector')

  const knownInspectorLabels = {
    assistant_output: 'Assistant Output Inspector',
    load_conversation_history: 'Conversation History Inspector',
    model_sampling: 'Model Sampling Inspector',
    receive_user_message: 'User Message Inspector',
    tool_execution: 'Tool Execution Inspector',
  } as const

  for (const [type, label] of Object.entries(knownInspectorLabels)) {
    assert.equal(getTimelineInspectorLabel({
      kind: 'known',
      type,
    } as AdminRunTimelineItem), label)
  }

  const safeRaw = JSON.stringify(detail.safeRawData)
  assert.doesNotMatch(safeRaw, /"(?:input|output)":/)
  assert.doesNotMatch(safeRaw, /reasoning|authorization|api[_-]?key/i)

  const directFinal = createContextInspector()
  assert.equal(directFinal.toolExchangeCount, 0)
  assert.deepEqual(directFinal.observations, [])
  assert.equal(formatPercentage(0, 'en-US'), '0%')
  assert.equal(formatPercentage(null, 'en-US'), '—')
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

  assert.equal(existsSync(new URL('./run.mocks.ts', import.meta.url)), false)
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
    inputSummary: '未识别 Step 的 input 已省略',
    outputSummary: '未识别 Step 的 output 已省略',
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
    inputSummary: 'samplingIndex=1, requestedModel=null',
    outputSummary: null,
    hasError: false,
    samplingIndex: 1,
    samplingAttemptId: 'sampling-running-1',
    requestedModel: null,
    providerItemCount: null,
    toolCount: 1,
    finishReason: null,
    usage: null,
    toolCallCount: null,
    textChars: null,
    intermediateTextChars: null,
    recordedDurationMs: null,
    contextInspector: createContextInspector({
      availability: 'partial',
      outcome: 'unavailable',
      estimatedInputTokens: null,
      budgetUsageRatio: null,
      providerItemCount: null,
      historyCandidateCount: null,
      historyIncludedCount: null,
      historyExcludedCount: null,
      samplingHistoryExcludedCount: null,
      toolExchangeCount: null,
      observations: null,
    }),
  }

  return {
    id: 'run-running',
    conversationId: 'conversation-running',
    userMessageId: 'message-user-running',
    assistantMessageId: null,
    status: 'RUNNING',
    questionPreview: '验证 RUNNING partial trace',
    requestedModel: null,
    samplingCount: 1,
    toolCallCount: 0,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
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
    safeRawData: {
      agentRun: {
        id: 'run-running',
        conversationId: 'conversation-running',
        userMessageId: 'message-user-running',
        assistantMessageId: null,
        status: 'RUNNING',
        startedAt,
        endedAt: null,
        createdAt: startedAt,
        updatedAt: '2026-08-09T00:00:00.020Z',
      },
      agentSteps: [generic, sampling].map(item => ({
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

function createContextInspector(
  overrides: Partial<AdminContextInspector> = {},
): AdminContextInspector {
  return {
    availability: 'available',
    outcome: 'success',
    resolvedModel: 'deepseek-v4-flash',
    requestedModel: null,
    estimatorStrategyId: 'deepseek-v4-official-b5968e9',
    contextWindowTokens: 1_000_000,
    applicationInputCapTokens: 262_144,
    outputReserveTokens: 65_536,
    safetyMarginTokens: 16_384,
    resolvedInputBudgetTokens: 262_144,
    estimatedInputTokens: 0,
    budgetUsageRatio: 0,
    prePlanItemCount: 1,
    providerItemCount: 1,
    historyCandidateCount: 0,
    historyIncludedCount: 0,
    historyExcludedCount: 0,
    initialHistoryExcludedReason: null,
    samplingHistoryExcludedCount: 0,
    toolExchangeCount: 0,
    observations: [],
    ...overrides,
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
    safeRawData: {
      ...detail.safeRawData,
      agentRun: {
        ...detail.safeRawData.agentRun,
        id,
        status,
        endedAt,
      },
    },
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
    requestedModel: null,
    samplingCount: 1,
    toolCallCount: 0,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
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
