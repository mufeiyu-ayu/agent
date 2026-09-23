import type { ChatModelOption } from '@agent/contracts'

export type LlmRuntimeStatus = 'idle' | 'loading' | 'success' | 'error'

/** 前台模型下拉的一项，来自 Admin 勾选「前台可见」的模型行。 */
export type LlmModelOption = ChatModelOption

export interface ProviderBalanceInfo {
  currency: 'CNY' | 'USD' | string
  total_balance: string
  granted_balance: string
  topped_up_balance: string
}

/** DeepSeek 官方账号（https）的余额；没有这样的账号时为 null。 */
export interface ProviderBalanceResponse {
  is_available: boolean
  balance_infos: ProviderBalanceInfo[]
}

export interface LlmBalanceInfo {
  currency: string
  totalBalance: string
  grantedBalance: string
  toppedUpBalance: string
}

export interface LlmBalanceState {
  isAvailable: boolean
  balances: LlmBalanceInfo[]
}
