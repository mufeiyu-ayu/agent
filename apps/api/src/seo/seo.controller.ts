import { Body, Controller, Inject, Post, Res } from '@nestjs/common'

import { createAppValidationPipe } from '../common/pipes/app-validation.pipe.js'
import {
  LLMApiError,
  LLMAuthError,
  LLMBalanceError,
  LLMInvalidRequestError,
  LLMNetworkError,
  LLMRateLimitError,
  LLMServerError,
} from '../llm/llm.types.js'
import { GenerateSeoDto } from './dto/generate-seo.dto.js'
import { SeoStreamService } from './seo-stream.service.js'
import { SeoService } from './seo.service.js'
import { SeoGenerationOutputError } from './types/seo.types.js'

interface SseResponse {
  setHeader: (name: string, value: string) => void
  write: (chunk: string) => void
  end: () => void
  flushHeaders?: () => void
}

@Controller('api/seo')
export class SeoController {
  constructor(
    @Inject(SeoService)
    private readonly seoService: SeoService,
    @Inject(SeoStreamService)
    private readonly seoStreamService: SeoStreamService,
  ) {}

  @Post('generate')
  generateSeoContent(
    @Body(createAppValidationPipe({ expectedType: GenerateSeoDto }))
    body: GenerateSeoDto,
  ) {
    return this.seoService.generateSeoContent(body)
  }

  @Post('generate/stream')
  async streamGenerateSeoContent(
    @Body(createAppValidationPipe({ expectedType: GenerateSeoDto }))
    body: GenerateSeoDto,
    @Res() response: SseResponse,
  ) {
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
    response.setHeader('Cache-Control', 'no-cache, no-transform')
    response.setHeader('Connection', 'keep-alive')
    response.flushHeaders?.()

    try {
      for await (const event of this.seoStreamService.generateSeoContentStream(body)) {
        writeSseEvent(response, event.type, event.type === 'result' ? event.data : event)
      }
    }
    catch (error) {
      writeSseEvent(response, 'error', {
        message: getStreamErrorMessage(error),
      })
    }
    finally {
      response.end()
    }
  }
}

function writeSseEvent(response: SseResponse, event: string, data: unknown): void {
  response.write(`event: ${event}\n`)
  response.write(`data: ${JSON.stringify(data)}\n\n`)
}

function getStreamErrorMessage(error: unknown): string {
  if (error instanceof LLMAuthError) {
    return 'AI 服务认证失败，请检查服务端模型配置'
  }

  if (error instanceof LLMBalanceError) {
    return 'AI 服务账户余额不足，请检查模型平台账户状态'
  }

  if (error instanceof LLMRateLimitError) {
    return 'AI 服务请求过于频繁，请稍后重试'
  }

  if (error instanceof LLMInvalidRequestError) {
    return 'AI 服务请求参数异常，请稍后重试'
  }

  if (error instanceof LLMNetworkError) {
    return 'AI 服务暂时不可用，请稍后重试'
  }

  if (error instanceof LLMServerError) {
    return 'AI 服务繁忙，请稍后重试'
  }

  if (error instanceof LLMApiError) {
    return 'AI 服务返回异常，请稍后重试'
  }

  if (error instanceof SeoGenerationOutputError) {
    return 'AI 返回格式异常，请重试'
  }

  return 'AI 服务异常，请稍后重试'
}
