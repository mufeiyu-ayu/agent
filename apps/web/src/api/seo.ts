import type { GenerateSeoRequest, GenerateSeoResponse } from '../types/seo'

import { http } from './http'

export async function generateSeoContent(payload: GenerateSeoRequest): Promise<GenerateSeoResponse> {
  const response = await http.post<GenerateSeoResponse>('/api/seo/generate', payload)

  return response.data
}
