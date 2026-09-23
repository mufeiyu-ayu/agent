import type { ApiErrorResponse, ReasoningEffort } from '@agent/contracts'
import type { LlmBalanceInfo, LlmBalanceState, LlmModelOption, LlmRuntimeStatus } from '../types/llm'

import { isAxiosError } from 'axios'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { fetchLlmBalance, fetchLlmModels } from '../api/llm'

export function useLlmRuntime() {
  const { locale, t } = useI18n()
  const models = ref<LlmModelOption[]>([])
  /** 选中的模型行 id；后台没有可见模型时为 null，请求里不带 model 由后端取默认。 */
  const selectedModel = ref<string | null>(null)
  /** 用户显式选的思考强度；null 不发送，由后端按模型行当前的默认值决定。换模型时回到 null。 */
  const selectedReasoningEffort = ref<ReasoningEffort | null>(null)
  const balance = ref<LlmBalanceState | null>(null)
  const balanceStatus = ref<LlmRuntimeStatus>('idle')
  const modelError = ref('')
  /** 原选中模型失效被自动换掉后的新 id；用户改选或下一次请求开始后清除。 */
  const replacedModel = ref<{ id: string | null } | null>(null)
  let modelsRequestId = 0

  const selectedModelOption = computed(() => models.value.find(model => model.id === selectedModel.value))

  watch(selectedModelOption, (option, previous) => {
    const effort = selectedReasoningEffort.value

    // 刷新后的同一行可能换了家族：显式选的强度不再可选时也回到 null。
    if (option?.id !== previous?.id || (effort && !option?.reasoningEffortOptions.includes(effort)))
      selectedReasoningEffort.value = null
  })

  watch(selectedModel, (id) => {
    if (replacedModel.value && replacedModel.value.id !== id)
      replacedModel.value = null
  })

  const modelNotice = computed(() => {
    if (!replacedModel.value)
      return ''

    const name = selectedModelOption.value?.displayName

    return name ? t('runtime.modelReplaced', { name }) : t('runtime.modelUnavailable')
  })

  const balanceLabel = computed(() => {
    if (balanceStatus.value === 'loading' && !balance.value)
      return t('runtime.balance.loading')

    const preferredBalance = readPreferredBalance(balance.value)

    if (!preferredBalance)
      return t('runtime.balance.empty')

    return formatBalanceLabel(preferredBalance, locale.value)
  })

  const balanceAvailable = computed(() => balance.value?.isAvailable ?? false)
  /** 服务商不提供余额时整行隐藏，而不是一直显示「余额 --」。 */
  const balanceHidden = computed(() => balanceStatus.value === 'success' && balance.value === null)

  /**
   * 挂载时、打开模型下拉时、发送因模型不可用被拒后都重新拉取：管理台隐藏 / 删除模型或停用服务商后，
   * 前台不刷新页面也能纠正选中项。失败时保留已有列表，只给出错误提示。
   */
  async function loadModels() {
    const requestId = ++modelsRequestId

    try {
      const nextModels = await fetchLlmModels()

      if (requestId !== modelsRequestId)
        return

      models.value = nextModels
      modelError.value = ''
      ensureSelectedModelExists()
    }
    catch (error) {
      if (requestId === modelsRequestId)
        modelError.value = getRuntimeErrorMessage(error, t('runtime.errors.models'))
    }
  }

  async function refreshBalance() {
    balanceStatus.value = 'loading'

    try {
      balance.value = await fetchLlmBalance()
      balanceStatus.value = 'success'
    }
    catch {
      balanceStatus.value = 'error'
    }
  }

  /** 初始（或当前选项消失时）优先选 Admin 设的默认模型，其次列表第一条。 */
  function ensureSelectedModelExists() {
    const exists = models.value.some(model => model.id === selectedModel.value)

    if (exists)
      return

    const hadSelection = selectedModel.value !== null

    selectedModel.value = models.value.find(model => model.isDefault)?.id
      ?? models.value[0]?.id
      ?? null

    if (hadSelection)
      replacedModel.value = { id: selectedModel.value }
  }

  function dismissModelNotice() {
    replacedModel.value = null
  }

  void loadModels()
  void refreshBalance()

  return {
    models,
    selectedModel,
    selectedReasoningEffort,
    balanceLabel,
    balanceAvailable,
    balanceHidden,
    balanceStatus,
    modelError,
    modelNotice,
    loadModels,
    dismissModelNotice,
    refreshBalance,
  }
}

function readPreferredBalance(balance: LlmBalanceState | null): LlmBalanceInfo | null {
  if (!balance || balance.balances.length === 0)
    return null

  return balance.balances.find(item => item.currency === 'CNY')
    ?? balance.balances.find(item => item.currency === 'USD')
    ?? balance.balances[0]
}

function formatBalanceLabel(balance: LlmBalanceInfo, locale: string): string {
  const symbol = balance.currency === 'CNY'
    ? '¥'
    : balance.currency === 'USD'
      ? '$'
      : `${balance.currency} `
  const numericValue = Number(balance.totalBalance)

  if (Number.isNaN(numericValue))
    return `${symbol}${balance.totalBalance}`

  return `${symbol}${numericValue.toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`
}

function getRuntimeErrorMessage(error: unknown, fallback: string): string {
  if (!isAxiosError<ApiErrorResponse>(error))
    return fallback

  const message = error.response?.data?.message

  return typeof message === 'string' ? message : fallback
}
