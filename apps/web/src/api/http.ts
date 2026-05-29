import axios from 'axios'

export interface ApiSuccessResponse<T> {
  success: true
  code: 0
  message: string
  data: T | null
  timestamp: string
  path: string
  requestId?: string
}

export const http = axios.create({
  timeout: 10000,
})

http.interceptors.response.use((response) => {
  const payload = response.data

  if (isApiSuccessResponse<unknown>(payload)) {
    response.data = payload.data
  }

  return response
})

function isApiSuccessResponse<T>(value: unknown): value is ApiSuccessResponse<T> {
  return (
    typeof value === 'object'
    && value !== null
    && 'success' in value
    && 'code' in value
    && 'data' in value
  )
}
