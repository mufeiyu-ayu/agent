import type {
  ChatStreamOptions,
  ModelInputItem,
  ModelStreamEvent,
  ProviderBalanceResponse,
} from '@agent/ai'
import type { AdminLlmProxyStatus, LlmFamilyCompat, ReasoningEffort } from '@agent/contracts'
import type { Dispatcher, ProxyAgent } from 'undici'
import type { LlmProviderCredentials } from './llm-model-config.service.js'
import type { OutboundProxyConfig } from './outbound-proxy.js'
import { LLMApiError, LLMError, LLMInvalidRequestError, LLMNetworkError, OpenAICompatibleClient } from '@agent/ai'
import { familyCompatOf } from '@agent/contracts'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { Agent } from 'undici'

import { LLMRuntimeConfigService } from './llm-runtime-config.service.js'
import { LlmProxyError } from './llm.errors.js'
import { createOutboundProxyAgent } from './outbound-proxy.js'

/**
 * 探活、拉取模型、查余额的整体时间上界。SDK 的 timeout 只管到响应头、按尝试次数叠加，
 * 对 Retry-After 也不设上限，探活还要读完整条流；一个 signal 把重试、退避与读流一起框住。
 */
const METADATA_CALL_TIMEOUT_MS = 30_000

const PROXY_NOT_CONFIGURED = '该服务商设置为经代理访问，但本机未配置 OUTBOUND_PROXY_URL'

/**
 * 走 ProxyAgent 时进程自己只建到代理的 TCP 连接（到服务商的连接由代理在隧道里建），这些连接阶段错误就是代理本身的问题
 * （端口没开、梯子没启动、主机不可达）。ECONNRESET 也可能是隧道里的 TLS 被断，只有端口对得上代理时才算。
 */
const PROXY_CONNECT_ERROR_CODES = new Set(['ECONNREFUSED', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENOTFOUND', 'UND_ERR_CONNECT_TIMEOUT'])

/** 探测已入库模型行时对齐真实 Run 的参数；省略即最保守：不发 thinking、不要求 reasoning_content。 */
export interface ProbeModelOptions {
  compat?: LlmFamilyCompat
  reasoningEffort?: ReasoningEffort | null
  maxOutputTokens?: number
}

/**
 * LLMService 是业务门面：按调用方给的 Provider 凭据构造 `OpenAICompatibleClient`，
 * 具体模型 SDK 和协议适配放在 `@agent/ai`。
 *
 * 不做 client 缓存：`OpenAICompatibleClient` 只是几个字段的配置持有者，每次请求都会新建 SDK 实例；
 * 凭据由 Run 开始时的快照传入，后台改 key 只影响之后解析的 Run。
 *
 * 出口按服务商的 `useProxy` 显式指定：勾选的走进程内共用的代理 agent，没勾的走直连 agent，都不经进程的全局 dispatcher。
 */
@Injectable()
export class LLMService {
  private readonly logger = new Logger(LLMService.name)
  private readonly proxy: OutboundProxyConfig | null
  /** 进程内唯一的代理 agent：勾选「使用代理」的服务商共用。 */
  private readonly proxyAgent: ProxyAgent | null
  private readonly directAgent = new Agent()

  constructor(
    @Inject(LLMRuntimeConfigService)
    private readonly runtimeConfigService: LLMRuntimeConfigService,
  ) {
    this.proxy = runtimeConfigService.value.outboundProxy
    this.proxyAgent = this.proxy ? createOutboundProxyAgent(this.proxy) : null
  }

  /** 管理台表单用：只给去掉凭据的 `协议://主机:端口`。 */
  getProxyStatus(): AdminLlmProxyStatus {
    return { configured: this.proxy !== null, address: this.proxy?.address ?? null }
  }

  /**
   * 发送一次 streaming chat 请求，逐条返回项目内部模型事件。
   *
   * 该方法只适配模型侧 OpenAI-compatible SSE，不暴露原始 chunk 给业务层。
   *
   * @param provider - 本次 Run 快照的 Provider 凭据
   * @param messages - Runtime 组装的普通消息、Tool Call 和 Tool Result 输入
   * @param options  - 已解析的请求配置、工具说明与 AbortSignal
   */
  async* chatStream(
    provider: LlmProviderCredentials,
    messages: ModelInputItem[],
    options: ChatStreamOptions,
  ): AsyncGenerator<ModelStreamEvent> {
    try {
      yield* this.createClient(provider).chatStream(messages, options)
    }
    catch (error) {
      // 调用方 abort 之后的失败由 runtime 按取消来源归因，不加代理上下文。
      throw options.signal?.aborted ? error : this.withProxyContext(provider, error)
    }
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

      throw toTimeoutError(this.withProxyContext(provider, error), signal)
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
      const failure = toTimeoutError(this.withProxyContext(provider, error), signal)

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
      const failure = toTimeoutError(this.withProxyContext(provider, error), signal)

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
      fetchOptions: { dispatcher: this.dispatcherFor(provider) },
    })
  }

  /** 勾选了但本机没配代理时直接失败，不静默改成直连。 */
  private dispatcherFor(provider: LlmProviderCredentials): Dispatcher {
    if (!provider.useProxy)
      return this.directAgent
    if (!this.proxyAgent)
      throw new LlmProxyError(PROXY_NOT_CONFIGURED)

    return this.proxyAgent
  }

  /** 经代理的网络失败在文案里带出代理地址：一眼分清是代理没起来还是服务商连不上。 */
  private withProxyContext(provider: LlmProviderCredentials, error: unknown): unknown {
    if (!provider.useProxy || !this.proxy || !(error instanceof LLMNetworkError) || error instanceof LlmProxyError)
      return error

    const failure = new LlmProxyError(describeProxyFailure(this.proxy, error), error)

    // 文案只留地址与错误码；底层原文（407 / TLS / undici 文案）进服务端日志，URL 里的凭据先去掉。
    this.logger.warn({
      event: 'llm_proxy_failure',
      providerId: provider.providerId,
      message: failure.message,
      cause: describeCauseChain(error),
    })

    return failure
  }
}

/**
 * 用户文案只带代理地址与错误码，不带底层原文（可能含上游主机名或代理原始地址）；原异常留在 detail。
 * 连不上的是代理本身时单独说明；隧道建立之后的失败（上游断流等）只说明经过了哪个代理，不归咎于代理。
 */
function describeProxyFailure(proxy: OutboundProxyConfig, error: LLMNetworkError): string {
  let cause: unknown = error
  let code: string | undefined
  let timedOut = false

  // LLMNetworkError（原异常在 detail）→ SDK APIConnectionError → fetch TypeError → net 的连接错误；
  // localhost 双栈时最后一层是 AggregateError，逐个看 errors。
  for (let depth = 0; cause instanceof Error && depth < 8; depth++) {
    timedOut ||= cause.name === 'APIConnectionTimeoutError'
    for (const candidate of cause instanceof AggregateError ? [cause, ...cause.errors] : [cause]) {
      const { code: candidateCode, port, hostname } = candidate as Error & { code?: unknown, port?: unknown, hostname?: unknown }

      if (typeof candidateCode !== 'string')
        continue
      if (
        PROXY_CONNECT_ERROR_CODES.has(candidateCode)
        || (candidateCode === 'ECONNRESET' && (port === proxy.port || hostname === proxy.hostname))
      ) {
        return `代理 ${proxy.address} 连接失败（${candidateCode}），请确认代理已启动、端口正确`
      }
      code ??= candidateCode
    }

    cause = cause instanceof LLMError ? cause.detail : cause.cause
  }

  if (timedOut)
    return `经代理 ${proxy.address} 访问服务商超时，请检查代理与服务商是否可达`

  return `经代理 ${proxy.address} 访问服务商失败${code ? `（${code}）` : ''}，请检查代理与服务商是否可达`
}

/** 服务端日志用：沿 detail / cause 取各层 `name: message`，去掉 URL 里的 `user:pass@`。 */
function describeCauseChain(error: LLMNetworkError): string[] {
  const chain: string[] = []
  let cause: unknown = error.detail

  for (let depth = 0; cause instanceof Error && depth < 8; depth++) {
    chain.push(`${cause.name}: ${cause.message}`.replace(/\/\/[^/\s@]+@/g, '//'))
    cause = cause instanceof LLMError ? cause.detail : cause.cause
  }

  return chain
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
