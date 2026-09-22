import type { LLMModelProfile } from '@agent/ai'
import type { ChatModelOption, ReasoningEffort } from '@agent/contracts'
import type { ApiKeyCipher } from './api-key-cipher.js'
import { familyCompatOf, reasoningEffortsOf } from '@agent/contracts'
import { Inject, Injectable } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service.js'
import { createApiKeyCipher, toApiKeyLast4 } from './api-key-cipher.js'
import { LLMRuntimeConfigService } from './llm-runtime-config.service.js'
import { LlmModelUnavailableError } from './llm.errors.js'

/** 造 Provider client 需要的凭据，随 Run 开始时的快照传递；后台改 key 只影响之后解析的 Run。 */
export interface LlmProviderCredentials {
  providerId: string
  baseUrl: string
  apiKey: string
}

/** 一次 Run 开始时解析并快照的模型配置；整个 Run 只用这一份。 */
export interface ResolvedLlmModel {
  modelId: string
  provider: LlmProviderCredentials
  profile: LLMModelProfile
}

/** 读数据库里的模型配置并持有唯一一份密钥 cipher；Admin 的写操作在 admin-llm 模块，加密经这里。 */
@Injectable()
export class LlmModelConfigService {
  private readonly cipher: ApiKeyCipher

  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(LLMRuntimeConfigService)
    runtimeConfigService: LLMRuntimeConfigService,
  ) {
    this.cipher = createApiKeyCipher(runtimeConfigService.value.secretKey)
  }

  /** Admin 写入 Provider 时用：加密后的密文与回显用的尾四位。 */
  encryptApiKey(apiKey: string): { apiKeyEncrypted: string, apiKeyLast4: string } {
    return {
      apiKeyEncrypted: this.cipher.encrypt(apiKey),
      apiKeyLast4: toApiKeyLast4(apiKey),
    }
  }

  /** 前台模型下拉：只列 visible 且 Provider 启用的行。 */
  async listVisibleModels(): Promise<ChatModelOption[]> {
    const models = await this.prismaService.llmModel.findMany({
      where: { visible: true, provider: { enabled: true } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        displayName: true,
        isDefault: true,
        reasoningEffort: true,
        provider: { select: { family: true } },
      },
    })

    return models.map(({ provider, reasoningEffort, ...model }) => ({
      ...model,
      reasoningEffort: reasoningEffort as ReasoningEffort | null,
      reasoningEffortOptions: reasoningEffortsOf(provider.family),
    }))
  }

  /**
   * 把请求里的模型行 id 解析成本次 Run 的完整配置；省略 id 时取默认模型。
   * 不存在、不可见、Provider 停用或请求的 reasoningEffort 不属于该家族都视为不可用，由调用方转成 400。
   */
  async resolveModel(modelId?: string, reasoningEffort?: ReasoningEffort): Promise<ResolvedLlmModel> {
    const model = await this.prismaService.llmModel.findFirst({
      where: modelId ? { id: modelId } : { isDefault: true },
      include: { provider: true },
    })

    if (!model) {
      throw new LlmModelUnavailableError(
        modelId ? '请求的模型不存在' : '后台尚未设置默认模型，请先在管理台配置',
      )
    }
    if (!model.visible)
      throw new LlmModelUnavailableError('请求的模型未对前台开放')
    if (!model.provider.enabled)
      throw new LlmModelUnavailableError('请求的模型所属服务商已停用')
    if (reasoningEffort && !reasoningEffortsOf(model.provider.family).includes(reasoningEffort))
      throw new LlmModelUnavailableError(`请求的模型不支持思考强度 ${reasoningEffort}`)

    return {
      modelId: model.id,
      provider: this.toCredentials(model.provider),
      profile: {
        wireName: model.wireName,
        contextWindowTokens: model.contextWindowTokens,
        maxOutputTokens: model.maxOutputTokens,
        compat: familyCompatOf(model.provider.family),
        reasoningEffort: model.reasoningEffort as ReasoningEffort | null,
      },
    }
  }

  /**
   * 默认模型所属 Provider 的凭据；余额面板用，没有可用的默认模型时为 null。
   * 余额端点只有 DeepSeek 官方提供，其他家族直接返回 null，不去中转站白打一次 /user/balance。
   */
  async resolveDefaultProvider(): Promise<LlmProviderCredentials | null> {
    const model = await this.prismaService.llmModel.findFirst({
      // 与 resolveModel 同一口径：默认模型必须可见且 Provider 启用。
      where: { isDefault: true, visible: true, provider: { enabled: true, family: 'deepseek' } },
      include: { provider: true },
    })

    return model ? this.toCredentials(model.provider) : null
  }

  /**
   * 余额只有 DeepSeek 官方端点提供：优先自有账号（启用且 baseUrl 指向 api.deepseek.com 的 DeepSeek Provider），
   * 没有再退回默认模型所属的 DeepSeek Provider；中转站没有余额接口，走到那里也只会得到 null。
   */
  async resolveBalanceProvider(): Promise<LlmProviderCredentials | null> {
    const providers = await this.prismaService.llmProvider.findMany({
      where: { enabled: true, family: 'deepseek' },
      orderBy: { createdAt: 'asc' },
    })
    const own = providers.find(provider => isDeepSeekOfficialBaseUrl(provider.baseUrl))

    if (own) {
      try {
        return this.toCredentials(own)
      }
      catch (error) {
        // 自有账号的密钥解不开（主密钥更换后）：退回默认 Provider，不让整个余额入口失效。
        if (!(error instanceof LlmModelUnavailableError))
          throw error
      }
    }

    return this.resolveDefaultProvider()
  }

  toCredentials(provider: {
    id: string
    baseUrl: string
    apiKeyEncrypted: string
  }): LlmProviderCredentials {
    return {
      providerId: provider.id,
      baseUrl: provider.baseUrl,
      apiKey: this.decryptOrUnavailable(provider.apiKeyEncrypted),
    }
  }

  /** `AGENT_SECRET_KEY` 更换后旧密文无法认证：按「模型不可用」上报，提示重填密钥。 */
  private decryptOrUnavailable(apiKeyEncrypted: string): string {
    try {
      return this.cipher.decrypt(apiKeyEncrypted)
    }
    catch {
      throw new LlmModelUnavailableError('主密钥已更换，请在管理台重新填写该服务商的 API Key')
    }
  }
}

/** 官方端点按主机名精确匹配，避免大小写或路径里含同名子串的中转地址误判。 */
function isDeepSeekOfficialBaseUrl(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.toLowerCase() === 'api.deepseek.com'
  }
  catch {
    return false
  }
}
