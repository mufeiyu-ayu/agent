import type { NestMiddleware } from '@nestjs/common'
import type { HttpRequestLike, HttpResponseLike, NextFunction, RequestWithId } from '../utils/http-request.util.js'
import { randomUUID } from 'node:crypto'
import { Injectable } from '@nestjs/common'

import { getRequestHeader } from '../utils/http-request.util.js'

@Injectable()
export class RequestIdMiddleware implements NestMiddleware<HttpRequestLike, HttpResponseLike> {
  use(request: HttpRequestLike, response: HttpResponseLike, next: NextFunction): void {
    const requestId = getIncomingRequestId(request) ?? randomUUID()
    const requestWithId = request as RequestWithId

    requestWithId.requestId = requestId
    response.setHeader('x-request-id', requestId)
    next()
  }
}

function getIncomingRequestId(request: HttpRequestLike): string | undefined {
  const value = getRequestHeader(request, 'x-request-id')

  if (!value) {
    return undefined
  }

  const requestId = value.trim()

  return requestId.length > 0 ? requestId : undefined
}
