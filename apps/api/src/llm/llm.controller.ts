import type { ProviderBalanceResponse } from '@agent/ai'
import type { ChatModelOption } from '@agent/contracts'

import { Controller, Get, Inject } from '@nestjs/common'
import { LlmModelConfigService } from './llm-model-config.service.js'
import { LLMService } from './llm.service.js'

@Controller('llm')
export class LLMController {
  constructor(
    @Inject(LLMService)
    private readonly llmService: LLMService,
    @Inject(LlmModelConfigService)
    private readonly llmModelConfigService: LlmModelConfigService,
  ) {}

  /** 前台模型下拉：Admin 勾选「前台可见」的模型行。 */
  @Get('models')
  listModels(): Promise<ChatModelOption[]> {
    return this.llmModelConfigService.listVisibleModels()
  }

  /** 自有 DeepSeek 官方账号（https）的余额；没有这样的账号或端点失败时为 null。 */
  @Get('balance')
  async getUserBalance(): Promise<ProviderBalanceResponse | null> {
    // 密钥解不开的官方账号在 resolveBalanceProvider 里已跳过，这里只剩「有没有」。
    const provider = await this.llmModelConfigService.resolveBalanceProvider()

    return provider ? await this.llmService.getProviderBalance(provider) : null
  }
}
