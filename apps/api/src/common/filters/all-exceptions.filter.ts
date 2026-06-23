import type { ApiErrorResponse } from '@agent/contracts'
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common'
import type { HttpResponseLike, RequestWithId } from '../utils/http-request.util.js'
import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common'

import {
  LLMApiError,
  LLMAuthError,
  LLMBalanceError,
  LLMError,
  LLMInvalidRequestError,
  LLMNetworkError,
  LLMRateLimitError,
  LLMServerError,
} from '../../llm/llm.types.js'
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
    const requestId = getRequestId(request)
    const requestPath = getRequestPath(request)
    const isAiException = exception instanceof LLMError
    const logMessage = formatExceptionLogMessage({
      message: normalizedException.message,
      path: requestPath,
      requestId,
      statusCode,
    })

    if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        logMessage,
        exception instanceof Error ? exception.stack : undefined,
      )
    }
    else if (isAiException) {
      this.logger.warn(logMessage)
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
      path: requestPath,
    }

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

  if (exception instanceof LLMRateLimitError) {
    return HttpStatus.TOO_MANY_REQUESTS
  }

  if (exception instanceof LLMError) {
    return getAiGatewayStatusCode(exception)
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

  if (exception instanceof LLMError) {
    return normalizeAiException(exception, statusCode)
  }

  return {
    statusCode,
    message: getDefaultMessage(statusCode),
    error: getDefaultError(statusCode),
    details: [],
  }
}

function getAiGatewayStatusCode(exception: LLMError): number {
  if (exception instanceof LLMRateLimitError) {
    return HttpStatus.TOO_MANY_REQUESTS
  }

  if (exception instanceof LLMNetworkError || exception instanceof LLMServerError) {
    return HttpStatus.SERVICE_UNAVAILABLE
  }

  return HttpStatus.BAD_GATEWAY
}

function normalizeAiException(
  exception: LLMError,
  statusCode: number,
): NormalizedException {
  return {
    statusCode,
    message: getAiExceptionMessage(exception),
    error: getDefaultError(statusCode),
    details: [],
  }
}

function getAiExceptionMessage(exception: LLMError): string {
  if (exception instanceof LLMAuthError) {
    return 'AI 服务认证失败，请检查服务端模型配置'
  }

  if (exception instanceof LLMBalanceError) {
    return 'AI 服务账户余额不足，请检查模型平台账户状态'
  }

  if (exception instanceof LLMRateLimitError) {
    return 'AI 服务请求过于频繁，请稍后重试'
  }

  if (exception instanceof LLMInvalidRequestError) {
    return 'AI 服务请求参数异常，请稍后重试'
  }

  if (exception instanceof LLMNetworkError) {
    return 'AI 服务暂时不可用，请稍后重试'
  }

  if (exception instanceof LLMServerError) {
    return 'AI 服务繁忙，请稍后重试'
  }

  if (exception instanceof LLMApiError) {
    return 'AI 服务返回异常，请稍后重试'
  }

  return 'AI 服务异常，请稍后重试'
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

function formatExceptionLogMessage(input: {
  message: string
  path: string
  requestId: string | undefined
  statusCode: number
}): string {
  const requestId = input.requestId ?? 'no-request-id'

  return `[${requestId}] ${input.statusCode} ${input.path} - ${input.message}`
}
