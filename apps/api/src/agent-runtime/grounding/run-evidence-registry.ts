import type { MessageEvidenceAvailability } from '@agent/contracts'
import type { ToolEvidenceRef } from '../../tools/core/tool-evidence.js'
import { randomUUID } from 'node:crypto'

import { normalizeToolEvidenceProjection } from '../../tools/core/tool-evidence.js'

/**
 * 单次 Run 的 Grounding Session 与 Evidence Registry。
 *
 * 它回答两个问题：
 * 1. 本次 Run 到底有哪些「可以被引用」的真实证据；
 * 2. 证据链整体处于什么可用状态（zero-hit 与工具故障必须区分）。
 *
 * Session 在第一次调用 evidence-eligible Tool 时建立，zero-hit、not found 和
 * Tool failure 同样会建立 Session —— 「检索过但没结果」和「没检索过」是不同事实。
 */

/** Registry 在单次 Run 内最多保留的证据引用数量。 */
export const RUN_EVIDENCE_REGISTRY_MAX_REFS = 10

/** Registry 中的一条证据；`citationKey` 只在本 Run 内有效且对模型不透明。 */
export interface RunEvidenceEntry extends ToolEvidenceRef {
  citationKey: string
  /** 提交该证据的 Tool 执行序号，从 1 开始；用于确定性排序。 */
  toolSequence: number
  toolName: string
}

/** 交给 finalization 模型的安全投影：不含内部排序信号，也不含正文。 */
export interface RunEvidenceModelProjection {
  citationKey: string
  sourceId: number
  chunkId: string | null
  granularity: ToolEvidenceRef['granularity']
  title: string
  languageCode: string
  sectionPath: string | null
  excerpt: string | null
}

export interface RunEvidenceRegistrySummary {
  refCount: number
  registryTruncated: boolean
  eligibleToolCallCount: number
  eligibleToolFailureCount: number
  evidenceAvailability: MessageEvidenceAvailability
}

interface RecordEligibleToolOutcomeInput {
  toolName: string
  ok: boolean
  evidence?: unknown
}

export class RunEvidenceRegistry {
  private readonly entries: RunEvidenceEntry[] = []
  private readonly entriesByCitationKey = new Map<string, RunEvidenceEntry>()
  private readonly seenIdentities = new Set<string>()
  private eligibleToolCallCount = 0
  private eligibleToolFailureCount = 0
  private truncated = false

  /**
   * 记录一次 evidence-eligible Tool 的执行结果。
   *
   * 失败调用不携带证据，但必须计入：它决定 `partial` 与 `unavailable` 的区别。
   */
  recordEligibleToolOutcome(input: RecordEligibleToolOutcomeInput): void {
    this.eligibleToolCallCount += 1

    if (!input.ok) {
      this.eligibleToolFailureCount += 1
      return
    }

    const toolSequence = this.eligibleToolCallCount

    // Tool 的类型断言在这里不被信任：逐条 fail closed 校验后才可能进入 Registry。
    for (const ref of normalizeToolEvidenceProjection(input.evidence)) {
      const identity = toEvidenceIdentity(ref)

      // 同一 source/chunk 稳定去重：先到先得，后到者不覆盖也不提升优先级。
      if (this.seenIdentities.has(identity))
        continue

      if (this.entries.length >= RUN_EVIDENCE_REGISTRY_MAX_REFS) {
        // 超限必须留痕，不能静默丢弃。
        this.truncated = true
        continue
      }

      this.seenIdentities.add(identity)

      const entry: RunEvidenceEntry = {
        ...ref,
        strategy: { ...ref.strategy },
        citationKey: createCitationKey(),
        toolSequence,
        toolName: input.toolName,
      }

      this.entries.push(entry)
      this.entriesByCitationKey.set(entry.citationKey, entry)
    }
  }

  /** 按 Tool 执行序 → Tool 内 rank → 稳定身份排序的证据列表。 */
  list(): RunEvidenceEntry[] {
    return [...this.entries]
      .sort(compareEvidenceEntries)
      .map(entry => ({ ...entry, strategy: { ...entry.strategy } }))
  }

  /** 只按 Run-scoped citationKey 查找；模型提交的其它标识一律无法命中。 */
  resolve(citationKey: string): RunEvidenceEntry | undefined {
    const entry = this.entriesByCitationKey.get(citationKey)

    return entry
      ? { ...entry, strategy: { ...entry.strategy } }
      : undefined
  }

  /** 交给 finalization 模型的安全投影，顺序与 `list()` 一致。 */
  toModelProjection(): RunEvidenceModelProjection[] {
    return this.list().map(entry => ({
      citationKey: entry.citationKey,
      sourceId: entry.sourceId,
      chunkId: entry.chunkId,
      granularity: entry.granularity,
      title: entry.title,
      languageCode: entry.languageCode,
      sectionPath: entry.sectionPath,
      excerpt: entry.excerpt,
    }))
  }

  summary(): RunEvidenceRegistrySummary {
    return {
      refCount: this.entries.length,
      registryTruncated: this.truncated,
      eligibleToolCallCount: this.eligibleToolCallCount,
      eligibleToolFailureCount: this.eligibleToolFailureCount,
      evidenceAvailability: this.evidenceAvailability(),
    }
  }

  /**
   * 证据可用性完全由服务端的 Tool 执行事实派生，模型不能提交或覆盖。
   *
   * 这样 zero-hit（`none`）与 Provider / 数据库 / 超时故障（`unavailable`）
   * 就不会被混成同一种状态。
   */
  evidenceAvailability(): MessageEvidenceAvailability {
    if (this.entries.length > 0) {
      return this.eligibleToolFailureCount > 0 ? 'partial' : 'available'
    }

    return this.eligibleToolFailureCount > 0 ? 'unavailable' : 'none'
  }
}

function compareEvidenceEntries(
  left: RunEvidenceEntry,
  right: RunEvidenceEntry,
): number {
  if (left.toolSequence !== right.toolSequence)
    return left.toolSequence - right.toolSequence

  // rank 缺失（例如 article detail）排在同一 Tool 的有序候选之后。
  const leftRank = left.rank ?? Number.MAX_SAFE_INTEGER
  const rightRank = right.rank ?? Number.MAX_SAFE_INTEGER

  if (leftRank !== rightRank)
    return leftRank - rightRank

  if (left.sourceId !== right.sourceId)
    return left.sourceId - right.sourceId

  return (left.chunkId ?? '').localeCompare(right.chunkId ?? '')
}

function toEvidenceIdentity(ref: ToolEvidenceRef): string {
  return `${ref.sourceId}:${ref.chunkId ?? ''}`
}

/**
 * 生成对模型不透明的 Run-scoped citationKey。
 *
 * 刻意不包含 sourceId、chunkId 或 slug：模型不能通过猜测标识来伪造引用，
 * 也不能把历史消息里见过的编号当成本轮证据。
 */
function createCitationKey(): string {
  return `evk_${randomUUID().replaceAll('-', '')}`
}
