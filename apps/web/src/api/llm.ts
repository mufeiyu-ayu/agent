import type { DeepSeekBalanceResponse, DeepSeekModelInfo, DeepSeekModelsResponse, LlmBalanceState, LlmModelOption } from '../types/llm'

import { FALLBACK_DEEPSEEK_MODELS } from '../types/llm'
import { http } from './http'

const supportedModelIds = new Set(FALLBACK_DEEPSEEK_MODELS.map(model => model.id))

export async function fetchLlmModels(): Promise<LlmModelOption[]> {
  const response = await http.get<DeepSeekModelsResponse>('/api/llm/models')
  const models = response.data.data
    .filter(isSupportedDeepSeekModel)
    .map(toLlmModelOption)

  return models.length > 0 ? models : FALLBACK_DEEPSEEK_MODELS
}

export async function fetchLlmBalance(): Promise<LlmBalanceState> {
  const response = await http.get<DeepSeekBalanceResponse>('/api/llm/balance')

  return {
    isAvailable: response.data.is_available,
    balances: response.data.balance_infos.map(item => ({
      currency: item.currency,
      totalBalance: item.total_balance,
      grantedBalance: item.granted_balance,
      toppedUpBalance: item.topped_up_balance,
    })),
  }
}

function isSupportedDeepSeekModel(model: DeepSeekModelInfo): boolean {
  return supportedModelIds.has(model.id as LlmModelOption['id'])
}

function toLlmModelOption(model: DeepSeekModelInfo): LlmModelOption {
  const fallback = FALLBACK_DEEPSEEK_MODELS.find(item => item.id === model.id)

  if (!fallback) {
    return {
      id: model.id as LlmModelOption['id'],
      label: model.id,
      ownedBy: model.owned_by,
    }
  }

  return {
    id: fallback.id,
    label: fallback.label,
    ownedBy: model.owned_by,
  }
}
