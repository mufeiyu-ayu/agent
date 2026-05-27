import { http } from './http'

export interface DemoResponse {
  message: string
  timestamp: string
}

export async function getDemoMessage() {
  const response = await http.get<DemoResponse>('/api/demo')

  return response.data
}
