import type { ApiSuccessResponse as ApiSuccessResponseContract } from '@agent/contracts'
import axios from 'axios'

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

function isApiSuccessResponse<T>(value: unknown): value is ApiSuccessResponseContract<T> {
  return (
    typeof value === 'object'
    && value !== null
    && 'success' in value
    && 'code' in value
    && 'data' in value
  )
}
