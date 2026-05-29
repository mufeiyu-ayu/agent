import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common'
import type { ApiErrorResponse } from '../types/api-response.type.js'
import type { HttpResponseLike, RequestWithId } from '../utils/http-request.util.js'
import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common'

import { getRequestId, getRequestPath } from '../utils/http-request.util.js'

interface HttpExceptionResponse {
  statusCode?: number
  message?: string | string[]
  error?: string
  details?: unknown
}

interface NormalizedException {
  statusCode: number
  message: string
  error: string
  details: unknown
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name)

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp()
    const response = context.getResponse<HttpResponseLike>()
    const request = context.getRequest<RequestWithId>()
    const statusCode = getExceptionStatusCode(exception)
    const normalizedException = normalizeException(exception, statusCode)

    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        normalizedException.message,
        exception instanceof Error ? exception.stack : undefined,
      )
    }

    const payload: ApiErrorResponse = {
      success: false,
      code: statusCode,
      message: normalizedException.message,
      error: {
        statusCode,
        error: normalizedException.error,
        details: normalizedException.details,
      },
      timestamp: new Date().toISOString(),
      path: getRequestPath(request),
    }
    const requestId = getRequestId(request)

    if (requestId) {
      payload.requestId = requestId
    }

    response.status(statusCode).json(payload)
  }
}

function getExceptionStatusCode(exception: unknown): number {
  if (exception instanceof HttpException) {
    return exception.getStatus()
  }

  return HttpStatus.INTERNAL_SERVER_ERROR
}

function normalizeException(exception: unknown, statusCode: number): NormalizedException {
  if (exception instanceof HttpException) {
    const response = exception.getResponse()

    if (typeof response === 'string') {
      return {
        statusCode,
        message: response,
        error: getDefaultError(statusCode),
        details: [],
      }
    }

    if (isHttpExceptionResponse(response)) {
      const details = response.details ?? (Array.isArray(response.message) ? response.message : [])

      return {
        statusCode: response.statusCode ?? statusCode,
        message: getMessage(response.message, getDefaultMessage(statusCode)),
        error: response.error ?? getDefaultError(statusCode),
        details,
      }
    }
  }

  return {
    statusCode,
    message: getDefaultMessage(statusCode),
    error: getDefaultError(statusCode),
    details: [],
  }
}

function isHttpExceptionResponse(value: unknown): value is HttpExceptionResponse {
  return typeof value === 'object' && value !== null
}

function getMessage(message: string | string[] | undefined, fallback: string): string {
  if (Array.isArray(message)) {
    return message.join('; ')
  }

  return message ?? fallback
}

function getDefaultMessage(statusCode: number): string {
  if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
    return '服务器内部错误'
  }

  return '请求处理失败'
}

function getDefaultError(statusCode: number): string {
  return HttpStatus[statusCode] ?? 'Error'
}
