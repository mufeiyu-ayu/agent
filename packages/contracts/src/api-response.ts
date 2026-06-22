export interface ApiResponseMeta {
  timestamp: string
  path: string
  requestId?: string
}

export interface ApiSuccessResponse<T = unknown> extends ApiResponseMeta {
  success: true
  code: 0
  message: string
  data: T | null
}

export interface ApiErrorPayload {
  statusCode: number
  error: string
  details?: unknown
}

export interface ApiErrorResponse extends ApiResponseMeta {
  success: false
  code: number
  message: string
  error: ApiErrorPayload
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse
