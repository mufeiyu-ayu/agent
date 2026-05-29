export interface HttpRequestLike {
  originalUrl?: string
  url?: string
  headers?: Record<string, string | string[] | undefined>
  requestId?: string
}

export interface HttpResponseLike {
  setHeader: (name: string, value: string) => void
  status: (statusCode: number) => {
    json: (payload: unknown) => unknown
  }
}

export type NextFunction = (error?: unknown) => void

export type RequestWithId = HttpRequestLike & {
  requestId?: string
}

export function getRequestPath(request: HttpRequestLike): string {
  return request.originalUrl || request.url || ''
}

export function getRequestId(request: RequestWithId): string | undefined {
  return request.requestId
}

export function getRequestHeader(request: HttpRequestLike, name: string): string | undefined {
  const value = request.headers?.[name.toLowerCase()]

  if (Array.isArray(value)) {
    return value[0]
  }

  return value
}
