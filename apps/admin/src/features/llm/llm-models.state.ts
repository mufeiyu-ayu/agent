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

/** 服务商弹窗里决定「测出的结论还算不算数」的三项；编辑时密钥留空表示用库里那把。 */
type ProviderCredentials = Pick<AdminLlmProviderInput, 'family' | 'baseUrl' | 'apiKey'>

/**
 * 地址比较忽略末尾斜杠，与服务端 admin-llm.service 一致；表单值另外先 trim（提交给服务端的也是 trim 后的值）。
 */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '')
}

function credentialsKey(credentials: ProviderCredentials): string {
  return JSON.stringify([credentials.family, normalizeBaseUrl(credentials.baseUrl), credentials.apiKey?.trim() ?? ''])
}

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
  /**
   * 弹窗测试的代次：每次清空换一代并中止上一代的请求。晚到的旧结果一律丢弃，
   * 不会串进下一次打开的弹窗，也不会随新建 / 导入写进别的服务商的 lastProbe*。
   */
  let testGeneration = new AbortController()

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
    testGeneration.abort()
    testGeneration = new AbortController()
    fetchedModelNames.value = []
    modelTestResults.value = {}
    testingWireNames.value = new Set()
  }

  /** 弹窗表单当前的家族 / 地址 / 密钥；变了就清掉按旧配置拉到的名单与测出的结论，它们不能随新配置导入。 */
  let formCredentials: string | undefined

  function setFormCredentials(credentials: ProviderCredentials): void {
    const key = credentialsKey(credentials)

    if (key === formCredentials)
      return
    formCredentials = key
    clearFetchedModelNames()
  }

  /**
   * 弹窗里已测过的结果，导入时随行写进 lastProbe*；没测过的名字不带。
   * 提交的凭据与测出这些结论时的表单凭据对不上（有路径没经过 setFormCredentials）时一条都不带。
   */
  function pickTestResults(wireNames: string[], credentials: ProviderCredentials): AdminLlmModelTestResult[] {
    if (credentialsKey(credentials) !== formCredentials)
      return []

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

  /** 用表单凭据拉模型名：同一时间只保留最后一次的结果；被中止（重新拉取、关弹窗、离开页面）时静默结束。 */
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
    catch (error) {
      if (!controller.signal.aborted)
        throw error
    }
    finally {
      if (controllers.fetch === controller)
        fetchingModels.value = false
    }
  }

  /**
   * 对勾中的模型各发一条最短对话。按服务端上限分批；
   * 某批请求失败时把这批与还没发的批次都记为失败原因，不让名字停在「测试中」。
   * 这一代被清空后，剩下的批次不再发，已发出的结果与错误都丢弃。
   */
  async function testModels(input: AdminLlmCredentialsInput, wireNames: string[]): Promise<void> {
    const generation = testGeneration
    const pending = wireNames.filter(name => !testingWireNames.value.has(name))

    if (pending.length === 0)
      return

    testingWireNames.value = new Set([...testingWireNames.value, ...pending])

    const record = (results: AdminLlmModelTestResult[]) => {
      if (generation.signal.aborted)
        return

      modelTestResults.value = {
        ...modelTestResults.value,
        ...Object.fromEntries(results.map(result => [result.wireName, result])),
      }
      const remaining = new Set(testingWireNames.value)
      for (const result of results)
        remaining.delete(result.wireName)
      testingWireNames.value = remaining
    }

    for (let start = 0; start < pending.length && !generation.signal.aborted; start += TEST_BATCH_SIZE) {
      const batch = pending.slice(start, start + TEST_BATCH_SIZE)

      try {
        record((await testLlmModelNames({ ...input, wireNames: batch }, { signal: generation.signal })).results)
      }
      catch (error) {
        if (generation.signal.aborted)
          return

        const message = formatAdminRunError(error)

        record(pending.slice(start).map(wireName => ({ wireName, ok: false, error: message })))
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
    setFormCredentials,
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
        importTestResults: pickTestResults(input.importWireNames ?? [], input),
      })
      await Promise.all([loadProviders(), loadModels()])
      selectProvider(created.id)
    }),
    /**
     * 家族、地址或密钥变了，服务端会改模型行（清不兼容的强度、清探活结论），模型表跟着重载；
     * 只改备注或启用状态时不动模型表。
     */
    updateProvider: (providerId: string, input: Partial<AdminLlmProviderInput>) => submit(async () => {
      const current = providers.value.find(provider => provider.id === providerId)
      const touchesModels = (input.family !== undefined && input.family !== current?.family)
        || (input.baseUrl !== undefined && input.baseUrl !== current?.baseUrl)
        || Boolean(input.apiKey)

      await updateLlmProvider(providerId, input)
      await (touchesModels ? Promise.all([loadProviders(), loadModels()]) : loadProviders())
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
    importModels: (wireNames: string[], providerId: string, credentials: ProviderCredentials) => submit(async () => {
      const result = await importLlmProviderModels(providerId, wireNames, pickTestResults(wireNames, credentials))
      await Promise.all([loadModels(), loadProviders()])

      return result
    }),

    cancel: () => {
      for (const controller of Object.values(controllers))
        controller?.abort()
      clearFetchedModelNames()
    },
  }
}

export type LlmModelsState = ReturnType<typeof createLlmModelsState>
