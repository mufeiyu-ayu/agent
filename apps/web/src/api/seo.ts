import type { SeoChatRequest, SeoChatResponse } from '@agent/contracts'

import { http } from './http'

export async function chatWithSeoAgent(payload: SeoChatRequest): Promise<SeoChatResponse> {
  const response = await http.post<SeoChatResponse>('/api/seo/chat', payload)

  return response.data
}
