/**
 * Provider 元数据接口（`/models`、`/user/balance`）的响应形状。
 * 字段名沿用 OpenAI-compatible 与 DeepSeek 的 wire 命名，不做转换。
 */

export interface ProviderModelInfo {
  id: string
  object?: string
  owned_by?: string
}

export interface ProviderModelsResponse {
  object: 'list'
  data: ProviderModelInfo[]
}

export interface ProviderBalanceInfo {
  currency: 'CNY' | 'USD'
  total_balance: string
  granted_balance: string
  topped_up_balance: string
}

/** DeepSeek `/user/balance` 的响应；其他 Provider 通常没有这个端点。 */
export interface ProviderBalanceResponse {
  is_available: boolean
  balance_infos: ProviderBalanceInfo[]
}
