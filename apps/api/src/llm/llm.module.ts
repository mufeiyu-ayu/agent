import { OpenAICompatibleClient } from '@agent/ai'
import { Global, Module } from '@nestjs/common'
import { LLMRuntimeConfigService } from './llm-runtime-config.service.js'
import { LLMController } from './llm.controller.js'
import { LLMService } from './llm.service.js'

/**
 * LLM 模块 — 全局模块。
 * 使用 @Global() 装饰器，让 LLMService 可以在任何模块中直接注入，无需重复 import。
 *
 * `OpenAICompatibleClient` 来自零 Nest 的 `@agent/ai`，构造参数是纯配置对象；
 * DI 只在这里的 `useFactory` 边缘接上。
 */
@Global()
@Module({
  controllers: [LLMController],
  providers: [
    LLMRuntimeConfigService,
    {
      provide: OpenAICompatibleClient,
      useFactory: (runtimeConfigService: LLMRuntimeConfigService) =>
        new OpenAICompatibleClient(runtimeConfigService.value),
      inject: [LLMRuntimeConfigService],
    },
    LLMService,
  ],
  exports: [LLMService, LLMRuntimeConfigService],
})
export class LlmModule {}
