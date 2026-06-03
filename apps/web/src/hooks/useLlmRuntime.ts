import type { ApiErrorResponse } from '../api/http'
import type { LlmBalanceInfo, LlmBalanceState, LlmModelOption, LlmRuntimeStatus } from '../types/llm'

import { isAxiosError } from 'axios'
import { computed, ref } from 'vue'

import { fetchLlmBalance, fetchLlmModels } from '../api/llm'
import { FALLBACK_DEEPSEEK_MODELS } from '../types/llm'

export function useLlmRuntime() {
  const models = ref<LlmModelOption[]>([...FALLBACK_DEEPSEEK_MODELS])
  const selectedModel = ref<LlmModelOption['id']>(FALLBACK_DEEPSEEK_MODELS[0].id)
  const balance = ref<LlmBalanceState | null>(null)
  const modelStatus = ref<LlmRuntimeStatus>('idle')
  const balanceStatus = ref<LlmRuntimeStatus>('idle')
  const modelError = ref('')
  const balanceError = ref('')

  const balanceLabel = computed(() => {
    if (balanceStatus.value === 'loading' && !balance.value)
      return 'Loading balance'

    const preferredBalance = readPreferredBalance(balance.value)

    if (!preferredBalance)
      return 'Balance --'

    return formatBalanceLabel(preferredBalance)
  })

  const balanceAvailable = computed(() => balance.value?.isAvailable ?? false)
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
      models.value = [...FALLBACK_DEEPSEEK_MODELS]
      ensureSelectedModelExists()
      modelError.value = getRuntimeErrorMessage(error, '模型列表读取失败，已使用默认 DeepSeek 模型')
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
      balanceError.value = getRuntimeErrorMessage(error, '余额读取失败，请稍后重试')
      balanceStatus.value = 'error'
    }
  }

  function ensureSelectedModelExists() {
    const exists = models.value.some(model => model.id === selectedModel.value)

    if (!exists)
      selectedModel.value = models.value[0]?.id ?? FALLBACK_DEEPSEEK_MODELS[0].id
  }

  void loadModels()
  void refreshBalance()

  return {
    models,
    selectedModel,
    balance,
    balanceLabel,
    balanceAvailable,
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

function formatBalanceLabel(balance: LlmBalanceInfo): string {
  const symbol = balance.currency === 'CNY'
    ? '¥'
    : balance.currency === 'USD'
      ? '$'
      : `${balance.currency} `
  const numericValue = Number(balance.totalBalance)

  if (Number.isNaN(numericValue))
    return `${symbol}${balance.totalBalance}`

  return `${symbol}${numericValue.toLocaleString(undefined, {
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
