import type {
  ChatMessage,
  ChatOptions,
  ChatStreamOptions,
  DeepSeekBalanceResponse,
  DeepSeekModelsResponse,
} from './llm.types.js'
import type { ModelStreamEvent } from './model-stream.types.js'
import { Inject, Injectable } from '@nestjs/common'

import { OpenAICompatibleClient } from './clients/openai-compatible.client.js'

/** LLMService 是业务门面；具体模型 SDK 和协议适配放在 client 层。 */
@Injectable()
export class LLMService {
  constructor(
    @Inject(OpenAICompatibleClient)
    private readonly llmClient: OpenAICompatibleClient,
  ) {}

  async listModels(): Promise<DeepSeekModelsResponse> {
    return await this.llmClient.listModels()
  }

  async getUserBalance(): Promise<DeepSeekBalanceResponse> {
    return await this.llmClient.getUserBalance()
  }

  /**
   * 发送一次 chat 请求，返回模型回复的纯文本（choices[0].message.content）。
   *
   * @param messages  - 消息数组（system / user / assistant）
   * @param options   - 可选：覆盖 model、temperature、maxTokens、responseFormat
   * @returns 模型回复的字符串内容
   */
  async chat(messages: ChatMessage[], options?: ChatOptions): Promise<string> {
    return await this.llmClient.chat(messages, options)
  }

  /**
   * 发送一次 streaming chat 请求，逐条返回项目内部模型事件。
   *
   * 该方法只适配模型侧 OpenAI-compatible SSE，不暴露原始 chunk 给业务层。
   *
   * @param messages - 消息数组（system / user / assistant）
   * @param options  - 可选：覆盖模型参数，并可传入 AbortSignal 中止读取
   * @returns 按模型输出顺序 yield 的文本、Tool Call、usage 和完成事件
   */
  chatStream(
    messages: ChatMessage[],
    options?: ChatStreamOptions,
  ): AsyncGenerator<ModelStreamEvent> {
    return this.llmClient.chatStream(messages, options)
  }
}
