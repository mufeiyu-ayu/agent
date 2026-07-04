import type { ChatStreamEvent } from '@agent/contracts'
import { Body, Controller, HttpStatus, Inject, Post, Res } from '@nestjs/common'

// DTO classes are required at runtime for Nest decorator metadata.
// eslint-disable-next-line ts/consistent-type-imports
import { SeoChatDto } from './dto/seo-chat.dto.js'
import { SeoService } from './seo.service.js'

interface StreamResponse {
  readonly destroyed: boolean
  readonly writableEnded: boolean
  end: () => void
  flushHeaders: () => void
  on: (event: 'close', listener: () => void) => void
  setHeader: (name: string, value: string) => void
  status: (statusCode: number) => StreamResponse
  write: (chunk: string) => void
}

@Controller('seo')
export class SeoController {
  constructor(
    @Inject(SeoService)
    private readonly seoService: SeoService,
  ) {}

  @Post('chat')
  chat(
    @Body() body: SeoChatDto,
  ) {
    return this.seoService.chat(body)
  }

  @Post('chat/stream')
  async chatStream(
    @Body() body: SeoChatDto,
    @Res() response: StreamResponse,
  ): Promise<void> {
    const abortController = new AbortController()

    response.on('close', () => {
      if (!response.writableEnded) {
        abortController.abort()
      }
    })

    response.status(HttpStatus.OK)
    response.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    response.setHeader('Cache-Control', 'no-cache, no-transform')
    response.setHeader('Connection', 'keep-alive')
    response.flushHeaders()

    try {
      for await (const event of this.seoService.chatStream(body, {
        signal: abortController.signal,
      })) {
        if (response.destroyed) {
          abortController.abort()
          break
        }

        writeNdjsonEvent(response, event)
      }
    }
    finally {
      if (!response.destroyed) {
        response.end()
      }
    }
  }
}

function writeNdjsonEvent(response: StreamResponse, event: ChatStreamEvent): void {
  response.write(`${JSON.stringify(event)}\n`)
}
