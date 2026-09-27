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

/** 不带查询串：它会进错误响应与日志，而 Google 回调的查询串里有授权码。 */
export function getRequestPath(request: HttpRequestLike): string {
  return (request.originalUrl || request.url || '').split('?')[0]!
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
