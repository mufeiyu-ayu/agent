import type { AdminModelRef } from '@agent/contracts'
import type { PrismaService } from '../prisma/prisma.service.js'
import { LLM_PROVIDER_FAMILIES } from '@agent/contracts'

import { toAllowedString } from './projection/safe-readers.js'

/** 采样快照里的模型身份：modelId 来自 #142 之后的快照，resolvedModel 是当时发给服务商的 wire name。 */
export interface ModelKey {
  modelId: string | null
  resolvedModel: string | null
}

/**
 * 按 modelId 关联模型行得出显示名与家族，运行列表与概览共用。同名 wire name 挂在不同服务商下
 * 是不同的行，所以不按 wire name 关联：旧采样没有 modelId 时只显示 wire name，
 * 模型行已删除时显示 wire name 并标 deleted。返回数组与 keys 一一对应。
 */
export async function resolveAdminModelRefs(
  prisma: PrismaService,
  keys: ReadonlyArray<ModelKey | null>,
): Promise<Array<AdminModelRef | null>> {
  const modelIds = [...new Set(keys.flatMap(key => (key?.modelId ? [key.modelId] : [])))]
  const rows = modelIds.length === 0
    ? []
    : await prisma.llmModel.findMany({
        where: { id: { in: modelIds } },
        select: {
          id: true,
          displayName: true,
          wireName: true,
          provider: { select: { family: true } },
        },
      })
  const rowById = new Map(rows.map(row => [row.id, row]))

  return keys.map((key) => {
    // 快照里两项都没有：没有可显示的模型，与没有采样的 Run 一样按「未记录」处理。
    if (!key || (!key.modelId && !key.resolvedModel))
      return null

    const row = key.modelId ? rowById.get(key.modelId) : undefined
    if (row) {
      return {
        modelId: row.id,
        displayName: row.displayName,
        wireName: row.wireName,
        family: toAllowedString(row.provider.family, LLM_PROVIDER_FAMILIES),
        deleted: false,
      }
    }

    const wireName = key.resolvedModel ?? key.modelId ?? ''
    return {
      modelId: key.modelId,
      displayName: wireName,
      wireName,
      family: null,
      deleted: key.modelId !== null,
    }
  })
}
