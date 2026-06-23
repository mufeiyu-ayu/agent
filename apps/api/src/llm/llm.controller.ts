import { Controller, Get, Inject } from '@nestjs/common'

import { LLMService } from './llm.service.js'

@Controller('llm')
export class LLMController {
  constructor(
    @Inject(LLMService)
    private readonly llmService: LLMService,
  ) {}

  @Get('models')
  listModels() {
    return this.llmService.listModels()
  }

  @Get('balance')
  getUserBalance() {
    return this.llmService.getUserBalance()
  }
}
