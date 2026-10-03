import type { LlmModelOption } from '../types/llm'
import assert from 'node:assert/strict'
import { afterEach, it, onTestFinished, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { fetchLlmBalance, fetchLlmModels } from '../api/llm'
import { useLlmRuntime } from './useLlmRuntime'

vi.mock('../api/llm', () => ({ fetchLlmModels: vi.fn(), fetchLlmBalance: vi.fn() }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ locale: ref('zh-CN'), t: (key: string) => key }) }))
afterEach(() => vi.resetAllMocks())
const model: LlmModelOption = { id: 'model-a', displayName: 'A', isDefault: true, reasoningEffort: null, reasoningEffortOptions: [] }

it('挂载与下拉重复打开共享在途列表，失败保留旧选项并解除 loading，下次打开重新读取', async () => {
  vi.mocked(fetchLlmBalance).mockResolvedValue(null)
  let resolve!: (models: LlmModelOption[]) => void
  vi.mocked(fetchLlmModels).mockImplementation(() => new Promise((done) => {
    resolve = done
  }))
  const scope = effectScope()
  onTestFinished(() => scope.stop())
  const runtime = scope.run(useLlmRuntime)!
  const first = runtime.loadModels()
  assert.equal(runtime.loadModels(), first)
  assert.equal(runtime.modelsLoading.value, true)
  assert.equal(vi.mocked(fetchLlmModels).mock.calls.length, 1)
  resolve([model])
  await first
  assert.equal(runtime.modelsLoading.value, false)
  assert.equal(runtime.selectedModel.value, model.id)

  vi.mocked(fetchLlmModels).mockRejectedValueOnce(new Error('offline'))
  await runtime.loadModels()
  assert.equal(runtime.modelsLoading.value, false)
  assert.equal(runtime.modelError.value, 'runtime.errors.models')
  assert.deepEqual(runtime.models.value, [model])
  assert.equal(runtime.selectedModel.value, model.id)

  vi.mocked(fetchLlmModels).mockResolvedValueOnce([{ ...model, id: 'model-b' }])
  await runtime.loadModels()
  assert.equal(runtime.modelError.value, '')
  assert.equal(runtime.selectedModel.value, 'model-b')
  assert.equal(vi.mocked(fetchLlmModels).mock.calls.length, 3)
})

it('模型被拒后的强制纠正排在旧请求之后，旧 finally 不解除新加载', async () => {
  vi.mocked(fetchLlmBalance).mockResolvedValue(null)
  const responses: Array<(models: LlmModelOption[]) => void> = []
  vi.mocked(fetchLlmModels).mockImplementation(() => new Promise(resolve => responses.push(resolve)))
  const scope = effectScope()
  onTestFinished(() => scope.stop())
  const runtime = scope.run(useLlmRuntime)!
  const initial = runtime.loadModels()
  responses[0]!([model])
  await initial
  const staleRefresh = runtime.loadModels()
  const correction = runtime.loadModels(true)
  assert.equal(staleRefresh, correction)
  runtime.loadModels(true)
  responses[1]!([{ ...model, id: 'stale' }])
  await vi.waitFor(() => assert.equal(responses.length, 3))
  assert.equal(runtime.modelsLoading.value, true)
  assert.equal(runtime.selectedModel.value, model.id, '纠正前的迟到响应不能发布旧列表')
  responses[2]!([{ ...model, id: 'model-b' }])
  await correction
  assert.equal(runtime.modelsLoading.value, false)
  assert.equal(runtime.selectedModel.value, 'model-b')
  assert.equal(runtime.modelNotice.value, 'runtime.modelReplaced')
})

it('余额刷新共享等待，失败后可重试且保留已知余额', async () => {
  vi.mocked(fetchLlmModels).mockResolvedValue([model])
  let reject!: (error: Error) => void
  vi.mocked(fetchLlmBalance).mockImplementation(() => new Promise((_resolve, fail) => {
    reject = fail
  }))
  const scope = effectScope()
  onTestFinished(() => scope.stop())
  const runtime = scope.run(useLlmRuntime)!
  const refresh = runtime.refreshBalance()
  assert.equal(runtime.refreshBalance(), refresh)
  assert.equal(vi.mocked(fetchLlmBalance).mock.calls.length, 1)
  assert.equal(runtime.balanceStatus.value, 'loading')
  reject(new Error('offline'))
  await refresh
  assert.equal(runtime.balanceStatus.value, 'error')
  vi.mocked(fetchLlmBalance).mockResolvedValueOnce({ isAvailable: true, balances: [{ currency: 'CNY', totalBalance: '12', grantedBalance: '0', toppedUpBalance: '12' }] })
  await runtime.refreshBalance()
  assert.equal(runtime.balanceStatus.value, 'success')
  assert.equal(runtime.balanceLabel.value, '¥12.00')
  vi.mocked(fetchLlmBalance).mockRejectedValueOnce(new Error('offline'))
  await runtime.refreshBalance()
  assert.equal(runtime.balanceStatus.value, 'error')
  assert.equal(runtime.balanceLabel.value, '¥12.00')
})

it('卸载后忽略迟到列表和余额，也不重新发起请求', async () => {
  let resolve!: (models: LlmModelOption[]) => void
  let finishBalance!: (value: null) => void
  vi.mocked(fetchLlmModels).mockImplementation(() => new Promise((done) => {
    resolve = done
  }))
  vi.mocked(fetchLlmBalance).mockImplementation(() => new Promise((done) => {
    finishBalance = done
  }))
  const scope = effectScope()
  const runtime = scope.run(useLlmRuntime)!
  const models = runtime.loadModels()
  const balance = runtime.refreshBalance()
  scope.stop()
  resolve([model])
  finishBalance(null)
  await Promise.all([models, balance])
  assert.deepEqual(runtime.models.value, [])
  assert.equal(runtime.balanceHidden.value, false)
  await Promise.all([runtime.loadModels(), runtime.refreshBalance()])
  assert.equal(vi.mocked(fetchLlmModels).mock.calls.length, 1)
  assert.equal(vi.mocked(fetchLlmBalance).mock.calls.length, 1)
})
