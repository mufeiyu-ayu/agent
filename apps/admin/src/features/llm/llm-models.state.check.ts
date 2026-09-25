import type { AdminLlmModel, AdminLlmModelTestResult, AdminLlmProvider } from '@agent/contracts'
import assert from 'node:assert/strict'

import { createLlmModelsState } from './llm-models.state'

interface FetchCall {
  url: string
  method: string
  body: unknown
}

void main()

async function main(): Promise<void> {
  const originalFetch = globalThis.fetch

  try {
    await checkStaleTestResultsAreDropped()
    await checkAbortedFetchIsSilent()
    await checkFailedBatchReleasesRemainingNames()
    await checkProviderUpdateReloadsModels()
    await checkCredentialChangeDropsTestResults()
  }
  finally {
    globalThis.fetch = originalFetch
  }

  console.log('admin llm models state checks passed')
}

/**
 * AC-02：A 的测试还在路上就关弹窗，再给 B 拉取并测试同名模型；A 的响应晚到，
 * 结果、测试中状态与随新建提交的 importTestResults 都只来自 B。
 */
async function checkStaleTestResultsAreDropped(): Promise<void> {
  const calls: FetchCall[] = []
  const staleResponse = deferred<Response>()
  let testRequests = 0

  globalThis.fetch = async (input, init) => {
    const call = recordCall(calls, input, init)

    if (call.url.endsWith('/providers/test-models')) {
      testRequests += 1
      // 最坏情况：A 的响应不理会 abort 照样回来，只能靠代次丢弃。
      return testRequests === 1
        ? staleResponse.promise
        : jsonResponse({ results: [testResult('m', false, 'B 的结论')] })
    }
    if (call.url.endsWith('/providers/fetch-models'))
      return jsonResponse({ models: ['m'] })
    if (call.url.endsWith('/providers') && call.method === 'POST')
      return jsonResponse({ id: 'provider-b' })

    return jsonResponse([])
  }

  const state = createLlmModelsState()

  // 打开 A 的弹窗并勾选 m：测试发出，结果未回。
  state.clearFetchedModelNames()
  const staleTest = state.testModels({ providerId: 'provider-a', baseUrl: 'https://a.example/v1', apiKey: '', useProxy: false }, ['m'])
  assert.deepEqual([...state.testingWireNames.value], ['m'])

  // 关掉 A，打开新建弹窗（弹窗把表单凭据报给页面），用 B 的凭据拉取并测试同名模型。
  state.clearFetchedModelNames()
  state.setFormCredentials({ family: 'openai', baseUrl: 'https://b.example/v1', apiKey: 'sk-b', useProxy: false })
  assert.equal(state.testingWireNames.value.size, 0)
  await state.fetchModelNames({ baseUrl: 'https://b.example/v1', apiKey: 'sk-b', useProxy: false })
  await state.testModels({ baseUrl: 'https://b.example/v1', apiKey: 'sk-b', useProxy: false }, ['m'])

  // A 的旧响应这时才回来。
  staleResponse.resolve(jsonResponse({ results: [testResult('m', true, null)] }))
  await staleTest

  assert.deepEqual(state.modelTestResults.value, { m: testResult('m', false, 'B 的结论') })
  assert.equal(state.testingWireNames.value.size, 0)

  await state.createProvider({
    family: 'openai',
    note: 'B',
    baseUrl: 'https://b.example/v1',
    apiKey: 'sk-b',
    enabled: true,
    useProxy: false,
    importWireNames: ['m'],
  })
  const create = calls.find(call => call.url.endsWith('/providers') && call.method === 'POST')

  assert.deepEqual(
    (create?.body as { importTestResults?: AdminLlmModelTestResult[] }).importTestResults,
    [testResult('m', false, 'B 的结论')],
  )
}

/** AC-03：拉取中离开页面（cancel）或重新打开弹窗（clear），拉取静默结束，不把 AbortError 抛给页面。 */
async function checkAbortedFetchIsSilent(): Promise<void> {
  globalThis.fetch = async (_input, init) => new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      reject(new DOMException('signal is aborted without reason', 'AbortError'))
    }, { once: true })
  })

  for (const interrupt of ['cancel', 'clearFetchedModelNames'] as const) {
    const state = createLlmModelsState()
    const fetching = state.fetchModelNames({ baseUrl: 'https://a.example/v1', apiKey: 'sk-a', useProxy: false })

    assert.equal(state.fetchingModels.value, true)
    state[interrupt]()
    await fetching
    assert.deepEqual(state.fetchedModelNames.value, [])
  }

  // 测试请求被新一代中止时同样静默，也不把这一批记成失败。
  const state = createLlmModelsState()
  const testing = state.testModels({ baseUrl: 'https://a.example/v1', apiKey: 'sk-a', useProxy: false }, ['m'])

  state.clearFetchedModelNames()
  await testing
  assert.deepEqual(state.modelTestResults.value, {})
}

/** 超过一批时首批请求失败：这批与没发出的批次都记失败，不停在「测试中」。 */
async function checkFailedBatchReleasesRemainingNames(): Promise<void> {
  let requests = 0

  globalThis.fetch = async () => {
    requests += 1
    return new Response(JSON.stringify({ success: false, code: 502, message: '上游网关故障' }), { status: 502 })
  }

  const state = createLlmModelsState()
  const names = Array.from({ length: 51 }, (_, index) => `m-${index}`)

  await assert.rejects(state.testModels({ baseUrl: 'https://a.example/v1', apiKey: 'sk-a', useProxy: false }, names))
  assert.equal(requests, 1)
  assert.equal(state.testingWireNames.value.size, 0)
  assert.equal(Object.keys(state.modelTestResults.value).length, 51)
  assert.equal(state.modelTestResults.value['m-50']?.error, '上游网关故障')
}

/** AC-01 的前端一半：家族 / 地址 / 密钥 / 使用代理变了才重载模型表，只改备注或启用状态不重载。 */
async function checkProviderUpdateReloadsModels(): Promise<void> {
  const calls: FetchCall[] = []

  globalThis.fetch = async (input, init) => {
    const call = recordCall(calls, input, init)

    if (call.url.endsWith('/models') && call.method === 'GET')
      return jsonResponse([model('model-1', null)])
    if (call.url.endsWith('/providers') && call.method === 'GET')
      return jsonResponse([provider('provider-1', 'deepseek', 'https://g.example/v1')])

    return jsonResponse({ id: 'provider-1' })
  }

  const state = createLlmModelsState()
  await state.loadProviders()
  state.models.value = [model('model-1', 'high')]

  await state.updateProvider('provider-1', { enabled: false })
  // 编辑弹窗总会带上家族与地址：值没变就不重载。
  await state.updateProvider('provider-1', { family: 'deepseek', note: '改备注', baseUrl: 'https://g.example/v1', enabled: true })
  assert.equal(calls.filter(call => call.url.endsWith('/models')).length, 0)
  assert.equal(state.models.value[0]?.reasoningEffort, 'high')

  await state.updateProvider('provider-1', { family: 'gemini', note: 'n', baseUrl: 'https://g.example/v1', enabled: true })
  assert.equal(calls.filter(call => call.url.endsWith('/models')).length, 1)
  assert.equal(state.models.value[0]?.reasoningEffort, null)

  // #179：切换「使用代理」服务端会清探活结论，模型表同样重载；勾选没变不重载，也不提交这个字段。
  await state.updateProvider('provider-1', { useProxy: false, note: '只改备注' })
  assert.equal(calls.filter(call => call.url.endsWith('/models')).length, 1)
  assert.deepEqual(calls.at(-2)?.body, { note: '只改备注' })
  await state.updateProvider('provider-1', { useProxy: true })
  assert.equal(calls.filter(call => call.url.endsWith('/models')).length, 2)
}

/**
 * #170 / #179：弹窗里测过模型后改了家族、地址、密钥或「使用代理」，拉到的名单与测出的结论都作废；
 * 不重新测试就确定时，新建请求里不带改动前的结论。只差末尾斜杠不算改动。
 */
async function checkCredentialChangeDropsTestResults(): Promise<void> {
  const calls: FetchCall[] = []

  globalThis.fetch = async (input, init) => {
    const call = recordCall(calls, input, init)

    if (call.url.endsWith('/providers/test-models'))
      return jsonResponse({ results: [testResult('m', true, null)] })
    if (call.url.endsWith('/providers/fetch-models'))
      return jsonResponse({ models: ['m'] })
    if (call.url.endsWith('/providers') && call.method === 'POST')
      return jsonResponse({ id: 'provider-new' })

    return jsonResponse([])
  }

  const state = createLlmModelsState()
  const oldCredentials = { family: 'openai', baseUrl: 'https://old.example/v1', apiKey: 'sk-old', useProxy: false } as const

  state.setFormCredentials(oldCredentials)
  await state.fetchModelNames(oldCredentials)
  await state.testModels(oldCredentials, ['m'])
  state.setFormCredentials({ ...oldCredentials, baseUrl: 'https://old.example/v1/' })
  assert.deepEqual(state.modelTestResults.value, { m: testResult('m', true, null) })

  for (const changed of [
    { ...oldCredentials, baseUrl: 'https://new.example/v1' },
    { ...oldCredentials, apiKey: 'sk-new' },
    { ...oldCredentials, family: 'grok' as const },
    { ...oldCredentials, useProxy: true },
  ]) {
    state.setFormCredentials(oldCredentials)
    await state.fetchModelNames(oldCredentials)
    await state.testModels(oldCredentials, ['m'])
    state.setFormCredentials(changed)
    assert.deepEqual(state.fetchedModelNames.value, [])
    assert.deepEqual(state.modelTestResults.value, {})
  }

  await state.createProvider({
    family: 'grok',
    note: 'new',
    baseUrl: 'https://old.example/v1',
    apiKey: 'sk-old',
    enabled: true,
    useProxy: false,
    importWireNames: ['m'],
  })
  const create = calls.find(call => call.url.endsWith('/providers') && call.method === 'POST')

  assert.deepEqual((create?.body as { importTestResults?: AdminLlmModelTestResult[] }).importTestResults, [])

  // 绕过 setFormCredentials 的路径：结论还在，但提交的凭据与测出它们时的表单凭据不同，照样一条都不带。
  calls.length = 0
  state.setFormCredentials(oldCredentials)
  await state.fetchModelNames(oldCredentials)
  await state.testModels(oldCredentials, ['m'])
  await state.importModels(['m'], 'provider-old', { ...oldCredentials, apiKey: 'sk-other' })
  const imported = calls.find(call => call.url.includes('/import-models'))

  assert.ok(imported, 'imported')

  assert.deepEqual((imported.body as { testResults: AdminLlmModelTestResult[] }).testResults, [])
}

function recordCall(calls: FetchCall[], input: string | URL | Request, init?: RequestInit): FetchCall {
  const call = {
    url: String(input),
    method: init?.method ?? 'GET',
    body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
  }

  calls.push(call)
  return call
}

function testResult(wireName: string, ok: boolean, error: string | null): AdminLlmModelTestResult {
  return { wireName, ok, error }
}

function provider(id: string, family: AdminLlmProvider['family'], baseUrl: string): AdminLlmProvider {
  return {
    id,
    family,
    note: 'n',
    baseUrl,
    apiKeyLast4: '1234',
    enabled: true,
    useProxy: false,
    modelCount: 1,
    createdAt: '2026-09-23T00:00:00.000Z',
    updatedAt: '2026-09-23T00:00:00.000Z',
  }
}

function model(id: string, reasoningEffort: AdminLlmModel['reasoningEffort']): AdminLlmModel {
  return {
    id,
    providerId: 'provider-1',
    wireName: 'm',
    displayName: 'm',
    contextWindowTokens: 65_536,
    maxOutputTokens: 8_192,
    reasoningEffort,
    visible: true,
    isDefault: false,
    sortOrder: 0,
    lastProbeOk: null,
    lastProbeError: null,
    lastProbedAt: null,
    createdAt: '2026-09-23T00:00:00.000Z',
    updatedAt: '2026-09-23T00:00:00.000Z',
  }
}

function jsonResponse(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, code: 200, message: 'ok', data }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

function deferred<T>(): { promise: Promise<T>, resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })

  return { promise, resolve }
}
