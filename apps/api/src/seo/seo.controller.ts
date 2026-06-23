import { Body, Controller, Inject, Post } from '@nestjs/common'

// DTO classes are required at runtime for Nest decorator metadata.
// eslint-disable-next-line ts/consistent-type-imports
import { SeoChatDto } from './dto/seo-chat.dto.js'
import { SeoService } from './seo.service.js'

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
}
