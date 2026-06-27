import { Global, Module } from '@nestjs/common'
import { OpenAICompatibleClient } from './clients/openai-compatible.client.js'
import { LLMController } from './llm.controller.js'
import { LLMService } from './llm.service.js'

/**
 * LLM 模块 — 全局模块。
 * 使用 @Global() 装饰器，让 LLMService 可以在任何模块中直接注入，无需重复 import。
 */
@Global()
@Module({
  controllers: [LLMController],
  providers: [OpenAICompatibleClient, LLMService],
  exports: [LLMService],
})
export class LlmModule {}
