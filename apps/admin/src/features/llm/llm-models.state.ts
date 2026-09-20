import type {
  AdminLlmCredentialsInput,
  AdminLlmModel,
  AdminLlmModelInput,
  AdminLlmModelTestResult,
  AdminLlmProvider,
  AdminLlmProviderInput,
} from '@agent/contracts'
import type { Ref } from 'vue'
import { computed, ref, shallowRef } from 'vue'

import { formatAdminRunError } from '../shared/admin-api'
import {
  createLlmProvider,
  deleteLlmModel,
  deleteLlmProvider,
  fetchAllLlmModels,
  fetchLlmModelNames,
  fetchLlmProviders,
  importLlmProviderModels,
  probeLlmModels,
  testLlmModelNames,
  updateLlmModel,
  updateLlmProvider,
} from './llm-api'

/** 与服务端 `TestAdminLlmModelsDto` 的 `ArrayMaxSize(50)` 对齐。 */
const TEST_BATCH_SIZE = 50

/**
 * 「模型接入」页的状态与动作（Issue #142）。
 *
 * 读操作的错误进 `providersError` / `modelsError` 由页面展示；
 * 写操作直接抛出，页面用 message 提示，列表随后按服务端结果刷新。
 */
export function createLlmModelsState() {
  const providers = shallowRef<AdminLlmProvider[]>([])
  const providersLoading = ref(false)
  const providersErrorCause = shallowRef<unknown>()
  const selectedProviderId = ref<string | null>(null)

  /** 全部服务商的模型；按服务商筛选由页面做。 */
  const models = shallowRef<AdminLlmModel[]>([])
  const modelsLoading = ref(false)
  const modelsErrorCause = shallowRef<unknown>()

  /** 服务商弹窗里拉取回来的候选模型名与加载态。 */
  const fetchedModelNames = shallowRef<string[]>([])
  const fetchingModels = ref(false)
  /** 勾选后自动测试的逐个结果，按 wireName 取；重新拉取时清空。 */
  const modelTestResults = shallowRef<Record<string, AdminLlmModelTestResult>>({})
  /** 已发起、结果还没回来的模型名。 */
  const testingWireNames = shallowRef(new Set<string>())
  /** 正在重测的模型 id，表格据此转圈。 */
  const probingModelIds = shallowRef(new Set<string>())
  /** 任一写操作进行中为 true，表单提交按钮据此禁用。 */
  const submitting = ref(false)

  const controllers = { providers: undefined, models: undefined, fetch: undefined } as Record<
    'providers' | 'models' | 'fetch',
    AbortController | undefined
  >

  const selectedProvider = computed(
    () => providers.value.find(item => item.id === selectedProviderId.value) ?? null,
  )

  /** 列表加载共用：新一次请求取消上一次，只有最后一次的结果与错误落到状态里。 */
  async function loadList<T>(
    key: 'providers' | 'models',
    target: Ref<T[]>,
    loading: Ref<boolean>,
    errorCause: Ref<unknown>,
    request: (signal: AbortSignal) => Promise<T[]>,
  ): Promise<void> {
    controllers[key]?.abort()
    const controller = new AbortController()
    controllers[key] = controller
    loading.value = true
    errorCause.value = undefined

    try {
      const items = await request(controller.signal)

      if (!controller.signal.aborted)
        target.value = items
    }
    catch (error) {
      if (!controller.signal.aborted)
        errorCause.value = error
    }
    finally {
      if (controllers[key] === controller)
        loading.value = false
    }
  }

  const loadProviders = () => loadList('providers', providers, providersLoading, providersErrorCause, signal => fetchLlmProviders({ signal }))
  const loadModels = () => loadList('models', models, modelsLoading, modelsErrorCause, signal => fetchAllLlmModels({ signal }))

  function selectProvider(providerId: string | null): void {
    selectedProviderId.value = providerId
  }

  function clearFetchedModelNames(): void {
    controllers.fetch?.abort()
    fetchedModelNames.value = []
    modelTestResults.value = {}
    testingWireNames.value = new Set()
  }

  /** 弹窗里已测过的结果，导入时随行写进 lastProbe*；没测过的名字不带。 */
  function pickTestResults(wireNames: string[]): AdminLlmModelTestResult[] {
    return wireNames.flatMap((name) => {
      const result = modelTestResults.value[name]

      return result ? [result] : []
    })
  }

  /** 写操作共用：置 submitting，成功后由 operation 自己刷新受影响的列表。 */
  async function submit<T>(operation: () => Promise<T>): Promise<T> {
    submitting.value = true

    try {
      return await operation()
    }
    finally {
      submitting.value = false
    }
  }

  /** 用表单凭据拉模型名：同一时间只保留最后一次的结果。 */
  async function fetchModelNames(input: AdminLlmCredentialsInput): Promise<void> {
    clearFetchedModelNames()
    const controller = new AbortController()
    controllers.fetch = controller
    fetchingModels.value = true

    try {
      const response = await fetchLlmModelNames(input, { signal: controller.signal })

      if (!controller.signal.aborted)
        fetchedModelNames.value = response.models
    }
    finally {
      if (controllers.fetch === controller)
        fetchingModels.value = false
    }
  }

  /**
   * 对勾中的模型各发一条最短对话。按服务端上限分批；
   * 某批请求失败时把该批全部记为失败原因，不让名字停在「测试中」。
   */
  async function testModels(input: AdminLlmCredentialsInput, wireNames: string[]): Promise<void> {
    const pending = wireNames.filter(name => !testingWireNames.value.has(name))

    if (pending.length === 0)
      return

    testingWireNames.value = new Set([...testingWireNames.value, ...pending])

    const record = (results: AdminLlmModelTestResult[]) => {
      modelTestResults.value = {
        ...modelTestResults.value,
        ...Object.fromEntries(results.map(result => [result.wireName, result])),
      }
      const remaining = new Set(testingWireNames.value)
      for (const result of results)
        remaining.delete(result.wireName)
      testingWireNames.value = remaining
    }

    for (let start = 0; start < pending.length; start += TEST_BATCH_SIZE) {
      const batch = pending.slice(start, start + TEST_BATCH_SIZE)

      try {
        record((await testLlmModelNames({ ...input, wireNames: batch })).results)
      }
      catch (error) {
        const message = formatAdminRunError(error)

        record(batch.map(wireName => ({ wireName, ok: false, error: message })))
        throw error
      }
    }
  }

  async function probeModels(modelIds: string[]): Promise<void> {
    probingModelIds.value = new Set([...probingModelIds.value, ...modelIds])

    try {
      const probed = await probeLlmModels(modelIds)
      const byId = new Map(probed.map(model => [model.id, model]))

      // 只替换测过的行，不打断用户正在看的列表。
      models.value = models.value.map(model => byId.get(model.id) ?? model)
    }
    finally {
      const remaining = new Set(probingModelIds.value)
      for (const id of modelIds)
        remaining.delete(id)
      probingModelIds.value = remaining
    }
  }

  return {
    providers,
    providersLoading,
    providersError: computed(() => (
      providersErrorCause.value === undefined ? '' : formatAdminRunError(providersErrorCause.value)
    )),
    selectedProviderId,
    selectedProvider,
    models,
    modelsLoading,
    modelsError: computed(() => (
      modelsErrorCause.value === undefined ? '' : formatAdminRunError(modelsErrorCause.value)
    )),
    fetchedModelNames,
    fetchingModels,
    clearFetchedModelNames,
    modelTestResults,
    testingWireNames,
    probingModelIds,
    submitting,

    loadProviders,
    loadModels,
    selectProvider,
    fetchModelNames,
    testModels,
    probeModels,

    createProvider: (input: AdminLlmProviderInput) => submit(async () => {
      const created = await createLlmProvider({
        ...input,
        importTestResults: pickTestResults(input.importWireNames ?? []),
      })
      await Promise.all([loadProviders(), loadModels()])
      selectProvider(created.id)
    }),
    updateProvider: (providerId: string, input: Partial<AdminLlmProviderInput>) => submit(async () => {
      await updateLlmProvider(providerId, input)
      await loadProviders()
    }),
    deleteProvider: (providerId: string) => submit(async () => {
      await deleteLlmProvider(providerId)
      await Promise.all([loadProviders(), loadModels()])
      if (selectedProviderId.value === providerId)
        selectProvider(null)
    }),
    updateModel: (modelId: string, input: Partial<AdminLlmModelInput>) => submit(async () => {
      await updateLlmModel(modelId, input)
      await loadModels()
    }),
    deleteModel: (modelId: string) => submit(async () => {
      await deleteLlmModel(modelId)
      await Promise.all([loadModels(), loadProviders()])
    }),
    setDefaultModel: (modelId: string) => submit(async () => {
      await updateLlmModel(modelId, { isDefault: true })
      await loadModels()
    }),
    /** 编辑服务商时把弹窗里勾选的模型导入该服务商；返回导入 / 跳过条数供页面提示。 */
    importModels: (wireNames: string[], providerId: string) => submit(async () => {
      const result = await importLlmProviderModels(providerId, wireNames, pickTestResults(wireNames))
      await Promise.all([loadModels(), loadProviders()])

      return result
    }),

    cancel: () => {
      for (const controller of Object.values(controllers))
        controller?.abort()
    },
  }
}

export type LlmModelsState = ReturnType<typeof createLlmModelsState>
