import type {
  ChatStreamOptions,
  ModelInputItem,
  ModelStreamEvent,
  ProviderBalanceResponse,
} from '@agent/ai'
import type { LlmFamilyCompat, ReasoningEffort } from '@agent/contracts'
import type { LlmProviderCredentials } from './llm-model-config.service.js'
import { LLMApiError, LLMError, LLMInvalidRequestError, LLMNetworkError, OpenAICompatibleClient } from '@agent/ai'
import { familyCompatOf } from '@agent/contracts'
import { Inject, Injectable, Logger } from '@nestjs/common'

import { LLMRuntimeConfigService } from './llm-runtime-config.service.js'

/**
 * 探活、拉取模型、查余额的整体时间上界。SDK 的 timeout 只管到响应头、按尝试次数叠加，
 * 对 Retry-After 也不设上限，探活还要读完整条流；一个 signal 把重试、退避与读流一起框住。
 */
const METADATA_CALL_TIMEOUT_MS = 30_000

/**
 * LLMService 是业务门面：按调用方给的 Provider 凭据构造 `OpenAICompatibleClient`，
 * 具体模型 SDK 和协议适配放在 `@agent/ai`。
 *
 * 不做 client 缓存：`OpenAICompatibleClient` 只是三字段配置的持有者，每次请求都会新建 SDK 实例；
 * 凭据由 Run 开始时的快照传入，后台改 key 只影响之后解析的 Run。
 */
/** 探测已入库模型行时对齐真实 Run 的参数；省略即最保守：不发 thinking、不要求 reasoning_content。 */
export interface ProbeModelOptions {
  compat?: LlmFamilyCompat
  reasoningEffort?: ReasoningEffort | null
  maxOutputTokens?: number
}

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
    const signal = AbortSignal.timeout(METADATA_CALL_TIMEOUT_MS)
    let response: unknown

    try {
      response = await this.createClient(provider).listModels({ signal })
    }
    catch (error) {
      // GET /models 回 4xx（404 / 405 / 400 等）多半也是地址没填到 /v1：给同一条提示并带上状态码，
      // 上游 body 只留在 detail 里。
      if ((error instanceof LLMApiError || error instanceof LLMInvalidRequestError) && !signal.aborted)
        throw new LLMApiError(modelsNotListed((error.detail as { status?: unknown } | undefined)?.status), error)

      throw toTimeoutError(error, signal)
    }

    const data = (response as { data?: unknown } | null)?.data

    if (!Array.isArray(data))
      throw new LLMApiError(modelsNotListed())

    return data.flatMap(item => (
      typeof (item as { id?: unknown })?.id === 'string' ? [(item as { id: string }).id] : []
    ))
  }

  /**
   * Admin 探测：对一个模型发一条最短的流式对话，流能正常结束就算通，不看有没有正文
   * （开思考的模型 16 个 token 可能全被思考吃掉，content 为空不代表接口不通）。
   * 已入库的行按它真实 Run 的参数探测（thinking 家族、reasoning_effort、max_tokens），
   * 配错的值在这里就暴露；存库前的预览没有行，按最保守的参数探。失败原因原样带回给管理台。
   */
  async probeModel(
    provider: LlmProviderCredentials,
    wireName: string,
    options: ProbeModelOptions = {},
  ): Promise<{ ok: true } | { ok: false, error: string }> {
    const signal = AbortSignal.timeout(METADATA_CALL_TIMEOUT_MS)

    try {
      const events = this.createClient(provider).chatStream(
        [{ type: 'message', role: 'user', content: 'hi' }],
        {
          request: {
            model: wireName,
            contextWindowTokens: 0,
            maxOutputTokens: options.maxOutputTokens ?? 16,
            compat: options.compat ?? familyCompatOf('other'),
            ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
          },
          signal,
        },
      )

      for await (const _event of events) {
        // 只消费到流结束；adapter 在缺 finish reason 或协议异常时会抛 LLMApiError。
      }

      return { ok: true }
    }
    catch (error) {
      const failure = toTimeoutError(error, signal)

      if (!(failure instanceof LLMError))
        throw failure

      return { ok: false, error: failure.message }
    }
  }

  /**
   * 官方 DeepSeek 账号的余额；404 等 LLMError 与形状不符都归一为 null。
   * 上游响应只投影成 `ProviderBalanceResponse` 声明的字段，不把原文透传给前台。
   */
  async getProviderBalance(
    provider: LlmProviderCredentials,
  ): Promise<ProviderBalanceResponse | null> {
    const signal = AbortSignal.timeout(METADATA_CALL_TIMEOUT_MS)

    try {
      return toProviderBalance(await this.createClient(provider).getUserBalance({ signal }))
    }
    catch (error) {
      const failure = toTimeoutError(error, signal)

      if (!(failure instanceof LLMError))
        throw failure

      this.logger.warn(`余额查询失败：${failure.message}`)

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

/** `/user/balance` 只取声明的字段：整体形状不符为 null；币种不认识或余额不是字符串的项丢掉。 */
function toProviderBalance(payload: unknown): ProviderBalanceResponse | null {
  const record = payload as Partial<Record<keyof ProviderBalanceResponse, unknown>> | null

  if (typeof record?.is_available !== 'boolean' || !Array.isArray(record.balance_infos))
    return null

  return {
    is_available: record.is_available,
    balance_infos: record.balance_infos.flatMap((value: unknown) => {
      const item = value as Record<string, unknown> | null

      if (
        (item?.currency !== 'CNY' && item?.currency !== 'USD')
        || typeof item.total_balance !== 'string'
        || typeof item.granted_balance !== 'string'
        || typeof item.topped_up_balance !== 'string'
      ) {
        return []
      }

      return [{
        currency: item.currency,
        total_balance: item.total_balance,
        granted_balance: item.granted_balance,
        topped_up_balance: item.topped_up_balance,
      }]
    }),
  }
}

function modelsNotListed(status?: unknown): string {
  const code = typeof status === 'number' ? `（HTTP ${status}）` : ''

  return `服务商的 /models 没有返回模型列表${code}，请检查 baseUrl 是否填到 /v1`
}

/** 30s 上界触发时换成明确的超时原因；其他错误原样返回。 */
function toTimeoutError(error: unknown, signal: AbortSignal): unknown {
  return signal.aborted
    ? new LLMNetworkError(new Error(`请求超时（${METADATA_CALL_TIMEOUT_MS / 1000}s 内未完成）`))
    : error
}
