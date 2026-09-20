import type { LLMModelProfile } from '@agent/ai'
import type { ChatModelOption } from '@agent/contracts'
import type { ApiKeyCipher } from './api-key-cipher.js'
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
      select: { id: true, displayName: true, reasoning: true, isDefault: true },
    })

    return models
  }

  /**
   * 把请求里的模型行 id 解析成本次 Run 的完整配置；省略 id 时取默认模型。
   * 不存在、不可见或 Provider 停用都视为不可用，由调用方转成 400。
   */
  async resolveModel(modelId?: string): Promise<ResolvedLlmModel> {
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

    return {
      modelId: model.id,
      provider: this.toCredentials(model.provider),
      profile: {
        wireName: model.wireName,
        contextWindowTokens: model.contextWindowTokens,
        maxOutputTokens: model.maxOutputTokens,
        reasoning: model.reasoning,
      },
    }
  }

  /** 默认模型所属 Provider 的凭据；余额面板用，没有可用的默认模型时为 null。 */
  async resolveDefaultProvider(): Promise<LlmProviderCredentials | null> {
    const model = await this.prismaService.llmModel.findFirst({
      // 与 resolveModel 同一口径：默认模型必须可见且 Provider 启用。
      where: { isDefault: true, visible: true, provider: { enabled: true } },
      include: { provider: true },
    })

    return model ? this.toCredentials(model.provider) : null
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
