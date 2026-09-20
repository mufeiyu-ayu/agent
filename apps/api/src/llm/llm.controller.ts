import type { ProviderBalanceResponse } from '@agent/ai'
import type { ChatModelOption } from '@agent/contracts'
import type { LlmProviderCredentials } from './llm-model-config.service.js'

import { Controller, Get, Inject } from '@nestjs/common'
import { LlmModelConfigService } from './llm-model-config.service.js'
import { LlmModelUnavailableError } from './llm.errors.js'
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

  /** 默认模型所属 Provider 的余额；没有默认模型或 Provider 不提供余额端点时为 null。 */
  @Get('balance')
  async getUserBalance(): Promise<ProviderBalanceResponse | null> {
    let provider: LlmProviderCredentials | null

    try {
      provider = await this.llmModelConfigService.resolveDefaultProvider()
    }
    catch (error) {
      // 主密钥更换后默认 Provider 的密钥解不开：余额按无处理，对话入口会给出明确的 400。
      if (error instanceof LlmModelUnavailableError)
        return null

      throw error
    }

    return provider ? await this.llmService.getProviderBalance(provider) : null
  }
}
