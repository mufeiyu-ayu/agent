import type { ApiSuccessResponse } from '@agent/contracts'
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common'
import type { Observable } from 'rxjs'
import type { RequestWithId } from '../utils/http-request.util.js'
import { Injectable } from '@nestjs/common'
import { map } from 'rxjs'

import { getRequestId, getRequestPath } from '../utils/http-request.util.js'

@Injectable()
export class ResponseTransformInterceptor<T> implements NestInterceptor<T, ApiSuccessResponse<T>> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<ApiSuccessResponse<T>> {
    const request = context.switchToHttp().getRequest<RequestWithId>()

    return next.handle().pipe(
      map((data) => {
        if (isApiSuccessResponse<T>(data)) {
          return data
        }

        const requestId = getRequestId(request)
        const response: ApiSuccessResponse<T> = {
          success: true,
          code: 0,
          message: 'ok',
          data: data ?? null,
          timestamp: new Date().toISOString(),
          path: getRequestPath(request),
        }

        if (requestId) {
          response.requestId = requestId
        }

        return response
      }),
    )
  }
}

function isApiSuccessResponse<T>(value: T | ApiSuccessResponse<T>): value is ApiSuccessResponse<T> {
  return (
    typeof value === 'object'
    && value !== null
    && 'success' in value
    && 'code' in value
    && 'timestamp' in value
  )
}
