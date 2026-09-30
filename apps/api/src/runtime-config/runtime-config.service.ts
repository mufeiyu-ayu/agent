import type { AdminRuntimeConfig } from '@agent/contracts'
import type { RuntimeConfig } from '../generated/prisma/client.js'
import type { UpdateRuntimeConfigDto } from './dto/update-runtime-config.dto.js'
import { Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common'

import { Prisma } from '../generated/prisma/client.js'
import { LlmModelConfigService } from '../llm/llm-model-config.service.js'
import { PrismaService } from '../prisma/prisma.service.js'

/** 单行表的固定主键；migration 插入这一行，CHECK 约束保证不会有第二行。 */
const RUNTIME_CONFIG_ID = 1

/** 前台对话也会看到这句，不带表名等运维细节；细节只进日志。 */
const CONFIG_MISSING = '运行配置缺失，请联系管理员'
const CONFIG_READ_FAILED = '读取运行配置失败，请稍后重试'

/** 单次问答的运行限制：不限轮数与工具调用次数（#218），只有时限兜底。 */
export interface RunLimits {
  /** 正常执行阶段的最长时间，单位毫秒。 */
  readonly runDeadlineMs: number
}

/** 联网搜索的 Serper Key：没配，或主密钥更换后解不开，都只让搜索失败，不影响对话。 */
export type SerperApiKey
  = | { status: 'set', value: string }
    | { status: 'missing' }
    | { status: 'undecryptable' }

/** 一次问答开始前读取的运行配置快照：整个 Run 只用这一份，后台修改对下一次问答生效。 */
export interface RuntimeConfigSnapshot {
  limits: RunLimits
  /** 上下文压缩保留最近原文的 token 数；实际取 min(它, 模型单次输入上限的 1/4)（#220）。 */
  compactionKeepRecentTokens: number
  debugCaptureModelIo: boolean
  serperApiKey: SerperApiKey
}

/**
 * 运行配置的读写（Issue #216）：只有一行，没有环境变量兜底；行缺失或读库失败都明确报错。
 * 不缓存：每次问答查一次库，与模型配置一致。Serper Key 的加解密经 `LlmModelConfigService` 的 cipher。
 */
@Injectable()
export class RuntimeConfigService {
  private readonly logger = new Logger(RuntimeConfigService.name)

  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(LlmModelConfigService)
    private readonly llmModelConfigService: LlmModelConfigService,
  ) {}

  /** 问答开始前调用：在写入任何消息之前失败，调用方直接把 503 交给全局过滤器。 */
  async loadSnapshot(): Promise<RuntimeConfigSnapshot> {
    const row = await this.requireRow()

    return {
      limits: {
        runDeadlineMs: row.runDeadlineMs,
      },
      compactionKeepRecentTokens: row.compactionKeepRecentTokens,
      debugCaptureModelIo: row.debugCaptureModelIo,
      serperApiKey: this.decryptSerperApiKey(row.serperApiKeyEncrypted),
    }
  }

  async getForAdmin(): Promise<AdminRuntimeConfig> {
    return toAdminRuntimeConfig(await this.requireRow())
  }

  /** 只 UPDATE 固定的那一行，从不插入：并发保存在行锁上串行，后提交的为准，不会多出行。 */
  async update(input: UpdateRuntimeConfigDto): Promise<AdminRuntimeConfig> {
    const { serperApiKey, ...values } = input

    try {
      const row = await this.prismaService.runtimeConfig.update({
        where: { id: RUNTIME_CONFIG_ID },
        data: {
          ...omitUndefined(values),
          // 空串与省略同义：管理台表单留空就是不改。
          ...(serperApiKey ? toSerperApiKeyColumns(this.llmModelConfigService.encryptApiKey(serperApiKey)) : {}),
        },
      })

      return toAdminRuntimeConfig(row)
    }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025')
        throw this.missing()

      throw error
    }
  }

  private async requireRow(): Promise<RuntimeConfig> {
    let row: RuntimeConfig | null

    try {
      row = await this.prismaService.runtimeConfig.findUnique({ where: { id: RUNTIME_CONFIG_ID } })
    }
    catch (error) {
      this.logger.error(`${CONFIG_READ_FAILED}：${error instanceof Error ? error.message : String(error)}`)

      throw new ServiceUnavailableException(CONFIG_READ_FAILED)
    }

    // 不回退到默认值：配置只有数据库一个来源。
    if (!row)
      throw this.missing()

    return row
  }

  private missing(): ServiceUnavailableException {
    this.logger.error('运行配置缺失：数据库里没有 RuntimeConfig 行（id = 1），请执行数据库迁移或按迁移里的默认值补回这一行')

    return new ServiceUnavailableException(CONFIG_MISSING)
  }

  private decryptSerperApiKey(encrypted: string | null): SerperApiKey {
    if (!encrypted)
      return { status: 'missing' }

    try {
      return { status: 'set', value: this.llmModelConfigService.decryptApiKey(encrypted) }
    }
    catch {
      // 原因由 web_search 在真正要用时写日志，没用到搜索的问答不受影响。
      return { status: 'undecryptable' }
    }
  }
}

function toSerperApiKeyColumns(encrypted: { apiKeyEncrypted: string, apiKeyLast4: string }) {
  return { serperApiKeyEncrypted: encrypted.apiKeyEncrypted, serperApiKeyLast4: encrypted.apiKeyLast4 }
}

function toAdminRuntimeConfig(row: RuntimeConfig): AdminRuntimeConfig {
  return {
    runDeadlineMs: row.runDeadlineMs,
    compactionKeepRecentTokens: row.compactionKeepRecentTokens,
    debugCaptureModelIo: row.debugCaptureModelIo,
    serperApiKeyLast4: row.serperApiKeyLast4,
    updatedAt: row.updatedAt.toISOString(),
  }
}

function omitUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>
}
