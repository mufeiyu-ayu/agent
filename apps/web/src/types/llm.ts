export type LlmRuntimeStatus = 'idle' | 'loading' | 'success' | 'error'

export type DeepSeekModelId = 'deepseek-v4-flash' | 'deepseek-v4-pro'

export interface LlmModelOption {
  id: DeepSeekModelId
  label: string
  ownedBy: string
}

export interface DeepSeekModelInfo {
  id: string
  object: 'model'
  owned_by: string
}

export interface DeepSeekModelsResponse {
  object: 'list'
  data: DeepSeekModelInfo[]
}

export interface DeepSeekBalanceInfo {
  currency: 'CNY' | 'USD' | string
  total_balance: string
  granted_balance: string
  topped_up_balance: string
}

export interface DeepSeekBalanceResponse {
  is_available: boolean
  balance_infos: DeepSeekBalanceInfo[]
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

export const FALLBACK_DEEPSEEK_MODELS: LlmModelOption[] = [
  {
    id: 'deepseek-v4-flash',
    label: 'DeepSeek V4 Flash',
    ownedBy: 'deepseek',
  },
  {
    id: 'deepseek-v4-pro',
    label: 'DeepSeek V4 Pro',
    ownedBy: 'deepseek',
  },
]
