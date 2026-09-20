import { Global, Module } from '@nestjs/common'

import { PrismaModule } from '../prisma/prisma.module.js'
import { LlmModelConfigService } from './llm-model-config.service.js'
import { LLMRuntimeConfigService } from './llm-runtime-config.service.js'
import { LLMController } from './llm.controller.js'
import { LLMService } from './llm.service.js'

/**
 * LLM 模块 — 全局模块。
 * 使用 @Global() 装饰器，让 LLMService / LlmModelConfigService 可以在任何模块中直接注入。
 *
 * Provider client 不再是启动期单例：模型与密钥来自数据库，`LLMService` 按 Provider 行按需构造。
 */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [LLMController],
  providers: [
    LLMRuntimeConfigService,
    LlmModelConfigService,
    LLMService,
  ],
  // LLMRuntimeConfigService 持有明文主密钥，只给本模块内的 cipher 用，不对外导出。
  exports: [LLMService, LlmModelConfigService],
})
export class LlmModule {}
