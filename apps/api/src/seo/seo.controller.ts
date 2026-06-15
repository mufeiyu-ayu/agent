import { Body, Controller, Inject, Post } from '@nestjs/common'

import { createAppValidationPipe } from '../common/pipes/app-validation.pipe.js'
import { SeoChatDto } from './dto/seo-chat.dto.js'
import { SeoService } from './seo.service.js'

@Controller('api/seo')
export class SeoController {
  constructor(
    @Inject(SeoService)
    private readonly seoService: SeoService,
  ) {}

  @Post('chat')
  chat(
    @Body(createAppValidationPipe({ expectedType: SeoChatDto }))
    body: SeoChatDto,
  ) {
    return this.seoService.chat(body)
  }
}
