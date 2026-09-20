import type { ApiErrorResponse, DeepSeekReasoningEffort } from '@agent/contracts'
import type { LlmBalanceInfo, LlmBalanceState, LlmModelOption, LlmRuntimeStatus } from '../types/llm'

import { DEFAULT_DEEPSEEK_REASONING_EFFORT } from '@agent/contracts'
import { isAxiosError } from 'axios'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { fetchLlmBalance, fetchLlmModels } from '../api/llm'

export function useLlmRuntime() {
  const { locale, t } = useI18n()
  const models = ref<LlmModelOption[]>([])
  /** 选中的模型行 id；后台没有可见模型时为 null，请求里不带 model 由后端取默认。 */
  const selectedModel = ref<string | null>(null)
  const selectedReasoningEffort = ref<DeepSeekReasoningEffort>(
    DEFAULT_DEEPSEEK_REASONING_EFFORT,
  )
  const balance = ref<LlmBalanceState | null>(null)
  const modelStatus = ref<LlmRuntimeStatus>('idle')
  const balanceStatus = ref<LlmRuntimeStatus>('idle')
  const modelError = ref('')
  const balanceError = ref('')

  /** 只有思考模型才展示思考强度；非思考模型的请求不带 reasoningEffort。 */
  const selectedModelReasoning = computed(() => (
    models.value.find(model => model.id === selectedModel.value)?.reasoning ?? false
  ))

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
  const isRefreshingBalance = computed(() => balanceStatus.value === 'loading')

  async function loadModels() {
    modelStatus.value = 'loading'
    modelError.value = ''

    try {
      models.value = await fetchLlmModels()
      ensureSelectedModelExists()
      modelStatus.value = 'success'
    }
    catch (error) {
      models.value = []
      ensureSelectedModelExists()
      modelError.value = getRuntimeErrorMessage(error, t('runtime.errors.models'))
      modelStatus.value = 'error'
    }
  }

  async function refreshBalance() {
    balanceStatus.value = 'loading'
    balanceError.value = ''

    try {
      balance.value = await fetchLlmBalance()
      balanceStatus.value = 'success'
    }
    catch (error) {
      balanceError.value = getRuntimeErrorMessage(error, t('runtime.errors.balance'))
      balanceStatus.value = 'error'
    }
  }

  /** 初始（或当前选项消失时）优先选 Admin 设的默认模型，其次列表第一条。 */
  function ensureSelectedModelExists() {
    const exists = models.value.some(model => model.id === selectedModel.value)

    if (!exists) {
      selectedModel.value = models.value.find(model => model.isDefault)?.id
        ?? models.value[0]?.id
        ?? null
    }
  }

  void loadModels()
  void refreshBalance()

  return {
    models,
    selectedModel,
    selectedModelReasoning,
    selectedReasoningEffort,
    balance,
    balanceLabel,
    balanceAvailable,
    balanceHidden,
    balanceStatus,
    modelStatus,
    balanceError,
    modelError,
    isRefreshingBalance,
    loadModels,
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
