import type {
  ChatStreamOptions,
  ModelInputItem,
  ModelStreamEvent,
  ProviderBalanceResponse,
} from '@agent/ai'
import type { ReasoningEffort } from '@agent/contracts'
import type { LlmProviderCredentials } from './llm-model-config.service.js'
import { LLMApiError, LLMError, OpenAICompatibleClient } from '@agent/ai'
import { Inject, Injectable, Logger } from '@nestjs/common'

import { LLMRuntimeConfigService } from './llm-runtime-config.service.js'

/**
 * LLMService 是业务门面：按调用方给的 Provider 凭据构造 `OpenAICompatibleClient`，
 * 具体模型 SDK 和协议适配放在 `@agent/ai`。
 *
 * 不做 client 缓存：`OpenAICompatibleClient` 只是三字段配置的持有者，每次请求都会新建 SDK 实例；
 * 凭据由 Run 开始时的快照传入，后台改 key 只影响之后解析的 Run。
 */
@Injectable()
export class LLMService {
  private readonly logger = new Logger(LLMService.name)

  constructor(
    @Inject(LLMRuntimeConfigService)
    private readonly runtimeConfigService: LLMRuntimeConfigService,
  ) {}

  /**
   * 发送一次 streaming chat 请求，逐条返回项目内部模型事件。
   *
   * 该方法只适配模型侧 OpenAI-compatible SSE，不暴露原始 chunk 给业务层。
   *
   * @param provider - 本次 Run 快照的 Provider 凭据
   * @param messages - Runtime 组装的普通消息、Tool Call 和 Tool Result 输入
   * @param options  - 已解析的请求配置、工具说明与 AbortSignal
   */
  chatStream(
    provider: LlmProviderCredentials,
    messages: ModelInputItem[],
    options: ChatStreamOptions,
  ): AsyncGenerator<ModelStreamEvent> {
    return this.createClient(provider).chatStream(messages, options)
  }

  /** Admin「拉取模型」：只取名字，能力字段由人填；中转站返回别的形状时明确报错而不是 500。 */
  async listProviderModelNames(provider: LlmProviderCredentials): Promise<string[]> {
    const response: unknown = await this.createClient(provider).listModels()
    const data = (response as { data?: unknown } | null)?.data

    if (!Array.isArray(data))
      throw new LLMApiError('服务商的 /models 没有返回模型列表，请检查 baseUrl 是否填到 /v1')

    return data.flatMap(item => (
      typeof (item as { id?: unknown })?.id === 'string' ? [(item as { id: string }).id] : []
    ))
  }

  /**
   * Admin 探测：对一个模型发一条最短的流式对话，流能正常结束就算通，不看有没有正文
   * （默认开思考的模型 16 个 token 可能全被思考吃掉，content 为空不代表接口不通）。
   * 不发 thinking 参数；已入库的行带上它配置的 reasoning_effort，配错值能在这里暴露。失败原因原样带回给管理台。
   */
  async probeModel(
    provider: LlmProviderCredentials,
    wireName: string,
    reasoningEffort?: ReasoningEffort,
  ): Promise<{ ok: true } | { ok: false, error: string }> {
    try {
      const events = this.createClient(provider).chatStream(
        [{ type: 'message', role: 'user', content: 'hi' }],
        {
          request: {
            model: wireName,
            contextWindowTokens: 0,
            maxOutputTokens: 16,
            reasoning: false,
            ...(reasoningEffort ? { reasoningEffort } : {}),
          },
        },
      )

      for await (const _event of events) {
        // 只消费到流结束；adapter 在缺 finish reason 或协议异常时会抛 LLMApiError。
      }

      return { ok: true }
    }
    catch (error) {
      if (!(error instanceof LLMError))
        throw error

      return { ok: false, error: error.message }
    }
  }

  /**
   * 默认 Provider 的余额：只有 DeepSeek 官方提供；404 等 LLMError 归一为 null。
   * 响应形状不在这里校验，由消费方（Admin `parseProviderBalance`、前台 `fetchLlmBalance`）各自容错。
   */
  async getProviderBalance(
    provider: LlmProviderCredentials,
  ): Promise<ProviderBalanceResponse | null> {
    try {
      return await this.createClient(provider).getUserBalance()
    }
    catch (error) {
      if (!(error instanceof LLMError))
        throw error

      this.logger.warn(`余额查询失败：${error.message}`)

      return null
    }
  }

  private createClient(provider: LlmProviderCredentials): OpenAICompatibleClient {
    return new OpenAICompatibleClient({
      apiKey: provider.apiKey,
      baseUrl: provider.baseUrl,
      captureModelIO: this.runtimeConfigService.value.captureModelIO,
    })
  }
}
