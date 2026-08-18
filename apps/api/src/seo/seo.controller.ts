import type { ChatStreamEvent } from '@agent/contracts'
import { Body, Controller, HttpStatus, Inject, Logger, Post, Res } from '@nestjs/common'

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
  private readonly logger = new Logger(SeoController.name)

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
        // 断连后不能 break：break 会触发 generator.return()，让 runtime 的
        // yield 点以 return 语义恢复、跳过 catch 收口路径。abort 信号由
        // 'close' 监听统一触发；这里继续 drain（不再写出），让 runtime 走
        // 正常 ABORTED 收口并产出 run_aborted 审计事件。runtime 的 finally
        // 兜底只保障其他消费者 return() 时的 DB 终态，不能替代 drain。
        if (!response.destroyed) {
          writeNdjsonEvent(response, event)
        }
      }
    }
    catch (error) {
      // NDJSON 流已开始写出，异常不能再交给全局异常过滤器（会对已结束的
      // response 再写 JSON）；runtime 在抛出终态化异常前已 best-effort
      // 向流写入 error 事件，这里只记录。
      this.logger.error(
        'SEO chat 流式收口异常',
        error instanceof Error ? error.stack : String(error),
      )
    }
    finally {
      if (!response.destroyed && !response.writableEnded) {
        response.end()
      }
    }
  }
}

function writeNdjsonEvent(response: StreamResponse, event: ChatStreamEvent): void {
  response.write(`${JSON.stringify(event)}\n`)
}
