import type {
  AdminLlmModel,
  AdminLlmModelInput,
  AdminLlmModelTestResult,
  AdminLlmProvider,
  AdminLlmProviderInput,
} from '@agent/contracts'
import type { ComputedRef, Ref } from 'vue'
import { computed, ref, shallowRef } from 'vue'

import { formatAdminRunError } from '../shared/admin-api'
import {
  createLlmProvider,
  deleteLlmModel,
  deleteLlmProvider,
  fetchAllLlmModels,
  fetchLlmProviderModelNames,
  fetchLlmProviders,
  importLlmProviderModels,
  previewLlmProviderModels,
  probeLlmModels,
  testLlmProviderModels,
  testLlmProviderModelsOf,
  updateLlmModel,
  updateLlmProvider,
} from './llm-api'

/**
 * 「模型」页的状态与动作（Issue #142）。
 *
 * 读操作的错误进 `providersError` / `modelsError` 由页面展示；
 * 写操作直接抛出，页面用 message 提示，列表随后按服务端结果刷新。
 */
export interface LlmModelsState {
  providers: Ref<AdminLlmProvider[]>
  providersLoading: Ref<boolean>
  providersError: ComputedRef<string>
  selectedProviderId: Ref<string | null>
  selectedProvider: ComputedRef<AdminLlmProvider | null>

  /** 全部服务商的模型；按服务商筛选由页面做。 */
  models: Ref<AdminLlmModel[]>
  modelsLoading: Ref<boolean>
  modelsError: ComputedRef<string>

  /** 服务商弹窗里拉取回来的候选模型名与加载态。 */
  fetchedModelNames: Ref<string[]>
  fetchingModels: Ref<boolean>
  clearFetchedModelNames: () => void
  /** 勾选后自动测试的逐个结果，按 wireName 取；重新拉取时清空。 */
  modelTestResults: Ref<Record<string, AdminLlmModelTestResult>>

  /** 任一写操作进行中为 true，表单提交按钮据此禁用。 */
  submitting: Ref<boolean>

  loadProviders: () => Promise<void>
  selectProvider: (providerId: string | null) => void
  createProvider: (input: AdminLlmProviderInput) => Promise<void>
  updateProvider: (providerId: string, input: Partial<AdminLlmProviderInput>) => Promise<void>
  deleteProvider: (providerId: string) => Promise<void>

  loadModels: () => Promise<void>
  updateModel: (modelId: string, input: Partial<AdminLlmModelInput>) => Promise<void>
  deleteModel: (modelId: string) => Promise<void>
  setDefaultModel: (modelId: string) => Promise<void>
  /** 重测已入库的模型；进行中的 id 在 probingModelIds 里，表格据此转圈。 */
  probeModels: (modelIds: string[]) => Promise<void>
  probingModelIds: Ref<Set<string>>

  /** 用还没存库的地址与密钥拉模型名（新增服务商前验证）。 */
  previewModelNames: (input: { baseUrl: string, apiKey: string }) => Promise<void>
  /** 编辑服务商时用库里的密钥拉；baseUrl 是表单里还没保存的地址。 */
  fetchModelNamesOf: (providerId: string, baseUrl: string) => Promise<void>
  /**
   * 对勾中的模型各发一条最短对话；新增用表单密钥，编辑且密钥留空时传 providerId 用库里那把。
   * 按服务端上限分批；某批请求失败时把该批全部记为失败原因，不让名字停在「测试中」。
   */
  testModels: (
    source: { baseUrl: string, apiKey: string } | { providerId: string, baseUrl: string },
    wireNames: string[],
  ) => Promise<void>
  /** 已发起、结果还没回来的模型名。 */
  testingWireNames: Ref<Set<string>>
  /** 编辑服务商时把弹窗里勾选的模型导入该服务商；返回导入 / 跳过条数供页面提示。 */
  importModels: (wireNames: string[], providerId: string) => Promise<{ imported: number, skipped: number }>

  cancel: () => void
}

/** 与服务端 `TestAdminLlmModelsDto` 的 `ArrayMaxSize(50)` 对齐。 */
const TEST_BATCH_SIZE = 50

export function createLlmModelsState(): LlmModelsState {
  const providers = shallowRef<AdminLlmProvider[]>([])
  const providersLoading = ref(false)
  const providersErrorCause = shallowRef<unknown>()
  const selectedProviderId = ref<string | null>(null)

  const models = shallowRef<AdminLlmModel[]>([])
  const modelsLoading = ref(false)
  const modelsErrorCause = shallowRef<unknown>()

  const fetchedModelNames = shallowRef<string[]>([])
  const fetchingModels = ref(false)
  const modelTestResults = shallowRef<Record<string, AdminLlmModelTestResult>>({})
  const testingWireNames = shallowRef(new Set<string>())
  const probingModelIds = shallowRef(new Set<string>())
  const submitting = ref(false)

  let providersController: AbortController | undefined
  let modelsController: AbortController | undefined
  let fetchController: AbortController | undefined

  const selectedProvider = computed(
    () => providers.value.find(item => item.id === selectedProviderId.value) ?? null,
  )

  async function loadProviders(): Promise<void> {
    providersController?.abort()
    const controller = new AbortController()
    providersController = controller
    providersLoading.value = true
    providersErrorCause.value = undefined

    try {
      const items = await fetchLlmProviders({ signal: controller.signal })

      if (controller.signal.aborted)
        return

      providers.value = items
    }
    catch (error) {
      if (!controller.signal.aborted)
        providersErrorCause.value = error
    }
    finally {
      if (providersController === controller)
        providersLoading.value = false
    }
  }

  function selectProvider(providerId: string | null): void {
    selectedProviderId.value = providerId
  }

  async function loadModels(): Promise<void> {
    modelsController?.abort()
    const controller = new AbortController()
    modelsController = controller
    modelsLoading.value = true
    modelsErrorCause.value = undefined

    try {
      const items = await fetchAllLlmModels({ signal: controller.signal })

      if (controller.signal.aborted)
        return

      models.value = items
    }
    catch (error) {
      if (!controller.signal.aborted)
        modelsErrorCause.value = error
    }
    finally {
      if (modelsController === controller)
        modelsLoading.value = false
    }
  }

  /** 弹窗里已测过的结果，导入时随行写进 lastProbe*；没测过的名字不带。 */
  function pickTestResults(wireNames: string[]): AdminLlmModelTestResult[] {
    return wireNames.flatMap((name) => {
      const result = modelTestResults.value[name]

      return result ? [result] : []
    })
  }

  /** 三种来源的拉取共用：同一时间只保留最后一次的结果。 */
  async function loadCandidates(
    request: (signal: AbortSignal) => Promise<{ models: string[] }>,
  ): Promise<void> {
    fetchController?.abort()
    const controller = new AbortController()
    fetchController = controller
    fetchingModels.value = true
    fetchedModelNames.value = []
    modelTestResults.value = {}
    testingWireNames.value = new Set()

    try {
      const response = await request(controller.signal)

      if (!controller.signal.aborted)
        fetchedModelNames.value = response.models
    }
    finally {
      if (fetchController === controller)
        fetchingModels.value = false
    }
  }

  /** 写操作共用：置 submitting，成功后刷新受影响的列表。 */
  async function submit(operation: () => Promise<void>): Promise<void> {
    submitting.value = true

    try {
      await operation()
    }
    finally {
      submitting.value = false
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
    clearFetchedModelNames: () => {
      fetchController?.abort()
      fetchedModelNames.value = []
      modelTestResults.value = {}
      testingWireNames.value = new Set()
    },
    modelTestResults,
    testingWireNames,
    submitting,

    loadProviders,
    selectProvider,
    createProvider: input => submit(async () => {
      const created = await createLlmProvider({
        ...input,
        importTestResults: pickTestResults(input.importWireNames ?? []),
      })
      await Promise.all([loadProviders(), loadModels()])
      selectProvider(created.id)
    }),
    updateProvider: (providerId, input) => submit(async () => {
      await updateLlmProvider(providerId, input)
      await loadProviders()
    }),
    deleteProvider: providerId => submit(async () => {
      await deleteLlmProvider(providerId)
      await Promise.all([loadProviders(), loadModels()])
      if (selectedProviderId.value === providerId)
        selectProvider(null)
    }),

    loadModels,
    updateModel: (modelId, input) => submit(async () => {
      await updateLlmModel(modelId, input)
      await loadModels()
    }),
    deleteModel: modelId => submit(async () => {
      await deleteLlmModel(modelId)
      await Promise.all([loadModels(), loadProviders()])
    }),
    setDefaultModel: modelId => submit(async () => {
      await updateLlmModel(modelId, { isDefault: true })
      await loadModels()
    }),
    probeModels: async (modelIds) => {
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
    },
    probingModelIds,

    previewModelNames: input => loadCandidates(signal => previewLlmProviderModels(input, { signal })),
    testModels: async (source, wireNames) => {
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
          const response = 'providerId' in source
            ? await testLlmProviderModelsOf(source.providerId, batch, source.baseUrl)
            : await testLlmProviderModels({ ...source, wireNames: batch })

          record(response.results)
        }
        catch (error) {
          const message = formatAdminRunError(error)

          record(batch.map(wireName => ({ wireName, ok: false, error: message })))
          throw error
        }
      }
    },
    fetchModelNamesOf: (providerId, baseUrl) => loadCandidates(signal => fetchLlmProviderModelNames(providerId, baseUrl, { signal })),
    importModels: async (wireNames, providerId) => {
      submitting.value = true

      try {
        const result = await importLlmProviderModels(providerId, wireNames, pickTestResults(wireNames))
        await Promise.all([loadModels(), loadProviders()])

        return result
      }
      finally {
        submitting.value = false
      }
    },

    cancel: () => {
      providersController?.abort()
      modelsController?.abort()
      fetchController?.abort()
    },
  }
}
