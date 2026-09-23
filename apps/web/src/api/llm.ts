import type { LlmBalanceState, LlmModelOption, ProviderBalanceResponse } from '../types/llm'

import { http } from './http'

export async function fetchLlmModels(): Promise<LlmModelOption[]> {
  const response = await http.get<LlmModelOption[]>('/api/llm/models')

  return response.data
}

/** 后台没有 DeepSeek 官方账号或查询失败时为 null，侧栏据此隐藏余额行。 */
export async function fetchLlmBalance(): Promise<LlmBalanceState | null> {
  const response = await http.get<ProviderBalanceResponse | null>('/api/llm/balance')
  const balance = response.data

  // 服务商可能对 /user/balance 返回 200 + 别的 JSON：形状不符与 null 同样按「无余额」处理。
  if (!balance || typeof balance.is_available !== 'boolean' || !Array.isArray(balance.balance_infos))
    return null

  return {
    isAvailable: balance.is_available,
    balances: balance.balance_infos.map(item => ({
      currency: item.currency,
      totalBalance: item.total_balance,
      grantedBalance: item.granted_balance,
      toppedUpBalance: item.topped_up_balance,
    })),
  }
}
