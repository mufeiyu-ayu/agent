import type {
  AdminLlmFetchModelsResponse,
  AdminLlmImportModelsResponse,
  AdminLlmModel,
  AdminLlmProvider,
  AdminLlmTestModelsResponse,
  LlmProviderFamily,
  ReasoningEffort,
} from '@agent/contracts'
import type { LlmModel, LlmProvider } from '../generated/prisma/client.js'
import type { LlmProviderCredentials } from '../llm/llm-model-config.service.js'
import type {
  AdminLlmCredentialsDto,
  AdminLlmModelTestResultDto,
  CreateAdminLlmProviderDto,
  ProbeAdminLlmModelsDto,
  TestAdminLlmModelsDto,
  UpdateAdminLlmModelDto,
  UpdateAdminLlmProviderDto,
} from './dto/admin-llm.dto.js'
import { LLMAuthError } from '@agent/ai'
import { familyCompatOf, LLM_PROVIDER_FAMILIES, reasoningEffortsOf } from '@agent/contracts'

import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import { Prisma } from '../generated/prisma/client.js'
import { LlmModelConfigService } from '../llm/llm-model-config.service.js'
import { LlmModelUnavailableError } from '../llm/llm.errors.js'
import { LLMService } from '../llm/llm.service.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { resolveImportedModelDefaults } from './llm-model-presets.js'

type ProviderWithCount = LlmProvider & { _count: { models: number } }

/** 同时探测的模型数：够快，又不至于一下把中转站的限流打满。 */
const PROBE_CONCURRENCY = 4

@Injectable()
export class AdminLlmService {
  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(LLMService)
    private readonly llmService: LLMService,
    @Inject(LlmModelConfigService)
    private readonly llmModelConfigService: LlmModelConfigService,
  ) {}

  // ─── Provider ────────────────────────────────

  async listProviders(): Promise<AdminLlmProvider[]> {
    const providers = await this.prismaService.llmProvider.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { models: true } } },
    })

    return providers.map(toAdminLlmProvider)
  }

  /** 用表单凭据打 `/models`，只返回名字；拉不通就在弹窗里改。 */
  async fetchModelNames(input: AdminLlmCredentialsDto): Promise<AdminLlmFetchModelsResponse> {
    const credentials = await this.resolveCredentials(input)

    try {
      const models = await this.llmService.listProviderModelNames(credentials)

      return { models: [...new Set(models)].sort() }
    }
    catch (error) {
      // 管理员填错密钥是客户端错误，按 400 回给弹窗改，而不是当成上游网关故障 502。
      if (error instanceof LLMAuthError)
        throw new BadRequestException(error.message)

      throw error
    }
  }

  /** 对勾选的模型各发一条最短对话，逐个回报通不通；并发有限，失败不抛。 */
  async testModelNames(input: TestAdminLlmModelsDto): Promise<AdminLlmTestModelsResponse> {
    return this.probeWireNames(await this.resolveCredentials(input), input.wireNames)
  }

  /** 服务商与预览时勾选的模型同一事务写入：任一失败都不留半截配置。 */
  async createProvider(input: CreateAdminLlmProviderDto): Promise<AdminLlmProvider> {
    const { importWireNames = [], importTestResults = [], ...providerInput } = input
    const wireNames = dedupeWireNames(importWireNames)
    const probeColumns = toProbeColumnsByWireName(importTestResults)

    const provider = await this.prismaService.$transaction(async (tx) => {
      const created = await tx.llmProvider.create({
        data: {
          family: providerInput.family,
          note: providerInput.note,
          baseUrl: normalizeBaseUrl(providerInput.baseUrl),
          ...this.llmModelConfigService.encryptApiKey(providerInput.apiKey),
          enabled: providerInput.enabled,
        },
      })

      if (wireNames.length > 0) {
        await tx.llmModel.createMany({
          data: wireNames.map(wireName => ({
            providerId: created.id,
            wireName,
            ...resolveImportedModelDefaults(providerInput.family, wireName),
            ...probeColumns.get(wireName),
          })),
        })
      }

      return { ...created, _count: { models: wireNames.length } }
    })

    return toAdminLlmProvider(provider)
  }

  async updateProvider(
    providerId: string,
    input: UpdateAdminLlmProviderDto,
  ): Promise<AdminLlmProvider> {
    const current = await this.requireProvider(providerId)
    const nextFamily = input.family ?? current.family

    const provider = await this.prismaService.$transaction(async (tx) => {
      // 家族变了，其下模型行里新家族不认的 reasoning_effort 一并清空，避免之后每个 Run 都被上游 400。
      if (nextFamily !== current.family) {
        await tx.llmModel.updateMany({
          where: { providerId, reasoningEffort: { not: null, notIn: [...reasoningEffortsOf(nextFamily)] } },
          data: { reasoningEffort: null },
        })
      }

      return tx.llmProvider.update({
        where: { id: providerId },
        data: {
          ...(input.family === undefined ? {} : { family: input.family }),
          ...(input.note === undefined ? {} : { note: input.note }),
          ...(input.baseUrl === undefined ? {} : { baseUrl: normalizeBaseUrl(input.baseUrl) }),
          ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
          // 空串与省略同义：管理台编辑表单留空就是不改密钥。
          ...(input.apiKey ? this.llmModelConfigService.encryptApiKey(input.apiKey) : {}),
        },
        include: { _count: { select: { models: true } } },
      })
    })

    return toAdminLlmProvider(provider)
  }

  async deleteProvider(providerId: string): Promise<{ id: string }> {
    await this.requireProvider(providerId)
    // 模型行随 Provider 级联删除（schema onDelete: Cascade）。
    await this.prismaService.llmProvider.delete({ where: { id: providerId } })

    return { id: providerId }
  }

  /** 按勾选批量建行；已存在的 wireName 跳过，不覆盖人改过的数值与测试状态。 */
  async importModels(
    providerId: string,
    wireNames: string[],
    testResults: AdminLlmModelTestResultDto[] = [],
  ): Promise<AdminLlmImportModelsResponse> {
    const provider = await this.requireProvider(providerId)

    const requested = dedupeWireNames(wireNames)
    const probeColumns = toProbeColumnsByWireName(testResults)

    if (requested.length === 0)
      return { imported: 0, skipped: 0 }

    // 交给唯一索引跳过已存在的 wireName：不先查后写，并发建行也不会撞成 500。
    const { count } = await this.prismaService.llmModel.createMany({
      data: requested.map(wireName => ({
        providerId,
        wireName,
        ...resolveImportedModelDefaults(toFamily(provider.family), wireName),
        ...probeColumns.get(wireName),
      })),
      skipDuplicates: true,
    })

    return { imported: count, skipped: requested.length - count }
  }

  // ─── Model ───────────────────────────────────

  /** 管理台右侧默认列全部服务商的模型，按服务商筛选在前端做。 */
  async listAllModels(): Promise<AdminLlmModel[]> {
    const models = await this.prismaService.llmModel.findMany({
      orderBy: [{ provider: { createdAt: 'asc' } }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    })

    return models.map(toAdminLlmModel)
  }

  async updateModel(
    modelId: string,
    input: UpdateAdminLlmModelDto,
  ): Promise<AdminLlmModel> {
    const current = await this.requireModel(modelId)
    // DTO 实例上没传的字段是值为 undefined 的自有属性，直接展开会把 current 覆盖成 undefined。
    const patch = omitUndefined(input)

    // 局部更新按合并后的整行校验：输出上限与上下文、默认与可见、强度与家族的约束不能被拆开绕过。
    assertModelRowValid({ ...current, ...patch, family: current.provider.family })

    const model = await this.rejectDuplicateWireName(patch.wireName ?? current.wireName, () =>
      this.prismaService.$transaction(async (tx) => {
        // 一条语句改全表：两个并发的「设为默认」在行锁上串行，最后提交的赢，不会留下两个默认。
        if (patch.isDefault)
          await tx.$executeRaw`UPDATE "LlmModel" SET "isDefault" = ("id" = ${modelId})`

        return tx.llmModel.update({ where: { id: modelId }, data: patch })
      }))

    return toAdminLlmModel(model)
  }

  /**
   * 重测已入库的模型：每条发一条最短对话，结果写回行（ok / 原因 / 时间）。
   * Provider 密钥解不开的按失败记原因，不中断其他行。
   */
  async probeModels(input: ProbeAdminLlmModelsDto): Promise<AdminLlmModel[]> {
    const models = await this.prismaService.llmModel.findMany({
      where: { id: { in: [...new Set(input.modelIds)] } },
      include: { provider: true },
    })

    const updated = await mapWithConcurrency(models, PROBE_CONCURRENCY, async (model) => {
      const outcome = await this.probeStoredModel(model)

      return this.prismaService.llmModel.update({
        where: { id: model.id },
        data: {
          lastProbeOk: outcome.ok,
          lastProbeError: outcome.ok ? null : outcome.error,
          lastProbedAt: new Date(),
        },
      })
    })

    return updated.map(toAdminLlmModel)
  }

  async deleteModel(modelId: string): Promise<{ id: string }> {
    await this.requireModel(modelId)
    await this.prismaService.llmModel.delete({ where: { id: modelId } })

    return { id: modelId }
  }

  /** 按该行真实 Run 的参数探测；任何异常都记进这一行，不让一条异常把整批 probe 打成 500。 */
  private async probeStoredModel(
    model: LlmModel & { provider: LlmProvider },
  ): Promise<{ ok: true } | { ok: false, error: string }> {
    if (!model.provider.enabled)
      return { ok: false, error: '服务商已停用' }

    try {
      return await this.llmService.probeModel(
        this.llmModelConfigService.toCredentials(model.provider),
        model.wireName,
        {
          compat: familyCompatOf(model.provider.family),
          reasoningEffort: toReasoningEffort(model.reasoningEffort),
          maxOutputTokens: model.maxOutputTokens,
        },
      )
    }
    catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  private async probeWireNames(
    credentials: Parameters<LLMService['probeModel']>[0],
    wireNames: string[],
  ): Promise<AdminLlmTestModelsResponse> {
    const names = dedupeWireNames(wireNames)
    const results = await mapWithConcurrency(names, PROBE_CONCURRENCY, async (wireName) => {
      const outcome = await this.llmService.probeModel(credentials, wireName)

      return { wireName, ok: outcome.ok, error: outcome.ok ? null : outcome.error }
    })

    return { results }
  }

  /**
   * 拉清单 / 测模型的凭据：表单给了 apiKey 就用它，否则按 providerId 取库里的密钥；
   * 地址一律用表单当前值（编辑时可能还没保存）。主密钥更换后旧密文解不开：提示重填密钥，而不是 500。
   */
  private async resolveCredentials(input: AdminLlmCredentialsDto): Promise<LlmProviderCredentials> {
    const baseUrl = normalizeBaseUrl(input.baseUrl)

    if (input.apiKey)
      return { providerId: input.providerId ?? 'preview', baseUrl, apiKey: input.apiKey }
    if (!input.providerId)
      throw new BadRequestException('请填写 API Key')

    const provider = await this.requireProvider(input.providerId)

    try {
      return { ...this.llmModelConfigService.toCredentials(provider), baseUrl }
    }
    catch (error) {
      if (error instanceof LlmModelUnavailableError)
        throw new BadRequestException(error.message)

      throw error
    }
  }

  private async requireProvider(providerId: string): Promise<LlmProvider> {
    const provider = await this.prismaService.llmProvider.findUnique({ where: { id: providerId } })

    if (!provider)
      throw new NotFoundException('服务商不存在')

    return provider
  }

  private async requireModel(modelId: string): Promise<LlmModel & { provider: LlmProvider }> {
    const model = await this.prismaService.llmModel.findUnique({
      where: { id: modelId },
      include: { provider: true },
    })

    if (!model)
      throw new NotFoundException('模型不存在')

    return model
  }

  /** 直接依赖 `providerId + wireName` 唯一索引：并发写入也只会得到 409，不做先查后写。 */
  private async rejectDuplicateWireName<T>(wireName: string, write: () => Promise<T>): Promise<T> {
    try {
      return await write()
    }
    catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException(`该服务商下已存在模型 ${wireName}`)

      throw error
    }
  }
}

/**
 * 模型行的跨字段约束：输出上限必须小于上下文窗口（否则每个 Run 都在创建后才因预算失败）；
 * 默认模型必须对前台可见（与 resolveModel / resolveDefaultProvider 的口径一致）；
 * reasoning_effort 只能取所属家族的值。
 */
function assertModelRowValid(row: {
  contextWindowTokens: number
  maxOutputTokens: number
  visible: boolean
  isDefault: boolean
  reasoningEffort: string | null
  family: string
}): void {
  if (row.maxOutputTokens >= row.contextWindowTokens)
    throw new BadRequestException('maxOutputTokens 必须小于 contextWindowTokens')
  if (row.isDefault && !row.visible)
    throw new BadRequestException('默认模型必须对前台可见')

  const allowed = reasoningEffortsOf(row.family)

  if (row.reasoningEffort && !(allowed as readonly string[]).includes(row.reasoningEffort)) {
    throw new BadRequestException(
      allowed.length === 0
        ? `${row.family} 家族不支持 reasoning_effort`
        : `${row.family} 家族的 reasoning_effort 只能是 ${allowed.join(' / ')}`,
    )
  }
}

/** 列是自由字符串，写入时已按家族校验过；这里只收窄类型。 */
function toReasoningEffort(value: string | null): ReasoningEffort | null {
  return value as ReasoningEffort | null
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  operation: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = Array.from({ length: items.length })
  let next = 0

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (next < items.length) {
      const index = next++

      results[index] = await operation(items[index] as T)
    }
  }))

  return results
}

function omitUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>
}

/**
 * 弹窗里 test-models 的结果随导入写进行的 lastProbe* 列：建行时就带上，不用再测一遍
 * （紧接着重测会撞中转站限流，把刚看到的 ok 变成 429）。同名多条以最后一条为准。
 */
function toProbeColumnsByWireName(
  testResults: AdminLlmModelTestResultDto[],
): Map<string, { lastProbeOk: boolean, lastProbeError: string | null, lastProbedAt: Date }> {
  const probedAt = new Date()

  return new Map(testResults.map(result => [result.wireName, {
    lastProbeOk: result.ok,
    lastProbeError: result.ok ? null : (result.error ?? '测试失败'),
    lastProbedAt: probedAt,
  }]))
}

function dedupeWireNames(wireNames: string[]): string[] {
  return [...new Set(wireNames.map(name => name.trim()).filter(Boolean))]
}

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.replace(/\/+$/, '')

  if (!normalized)
    throw new BadRequestException('baseUrl 不能为空')

  return normalized
}

/** 列是自由字符串（Prisma 无跨包 enum），读出来按 contracts 的清单收口，不认识的当 other。 */
function toFamily(value: string): LlmProviderFamily {
  return (LLM_PROVIDER_FAMILIES as readonly string[]).includes(value)
    ? value as LlmProviderFamily
    : 'other'
}

function toAdminLlmProvider(provider: ProviderWithCount): AdminLlmProvider {
  return {
    id: provider.id,
    family: toFamily(provider.family),
    note: provider.note,
    baseUrl: provider.baseUrl,
    apiKeyLast4: provider.apiKeyLast4,
    enabled: provider.enabled,
    modelCount: provider._count.models,
    createdAt: provider.createdAt.toISOString(),
    updatedAt: provider.updatedAt.toISOString(),
  }
}

function toAdminLlmModel(model: LlmModel): AdminLlmModel {
  return {
    id: model.id,
    providerId: model.providerId,
    wireName: model.wireName,
    displayName: model.displayName,
    contextWindowTokens: model.contextWindowTokens,
    maxOutputTokens: model.maxOutputTokens,
    reasoningEffort: toReasoningEffort(model.reasoningEffort),
    visible: model.visible,
    isDefault: model.isDefault,
    sortOrder: model.sortOrder,
    lastProbeOk: model.lastProbeOk,
    lastProbeError: model.lastProbeError,
    lastProbedAt: model.lastProbedAt?.toISOString() ?? null,
    createdAt: model.createdAt.toISOString(),
    updatedAt: model.updatedAt.toISOString(),
  }
}
