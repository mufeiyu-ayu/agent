import type {
  MessageCitationV1,
  MessageGroundingV1,
} from '@agent/contracts'
import type { SubmitGroundedAnswerInputV1 } from './grounded-answer.contract.js'
import type { RunEvidenceEntry, RunEvidenceRegistry } from './run-evidence-registry.js'
import { randomUUID } from 'node:crypto'

import {
  MESSAGE_GROUNDING_MAX_CITATIONS,
  MESSAGE_GROUNDING_SCHEMA_VERSION,
} from '@agent/contracts'
import { GroundedAnswerRejectedError } from './grounded-answer.contract.js'

/**
 * 终态输出的服务端校验。
 *
 * 这里只证明「引用身份属于本次 Run 的真实证据」，不证明回答内容忠实于证据；
 * 后者在 v1 明确标记为 `not_evaluated`，不做过度承诺。
 */

export interface ValidatedGroundedAnswer {
  answer: string
  grounding: MessageGroundingV1
}

/**
 * 校验模型提交的终态输出，并生成可持久化的 Grounding。
 *
 * @throws GroundedAnswerRejectedError 任一规则不满足时以安全类别 fail closed。
 */
export function validateGroundedAnswer(
  input: SubmitGroundedAnswerInputV1,
  registry: RunEvidenceRegistry,
): ValidatedGroundedAnswer {
  const evidenceAvailability = registry.evidenceAvailability()
  // 先稳定去重再计数：重复提交同一 key 不应该被当成两条独立证据。
  const citationKeys = [...new Set(input.citationKeys)]

  if (citationKeys.length > MESSAGE_GROUNDING_MAX_CITATIONS)
    throw new GroundedAnswerRejectedError('citation_keys_too_many')

  const entries: RunEvidenceEntry[] = []

  for (const citationKey of citationKeys) {
    const entry = registry.resolve(citationKey)

    // 未知 key、跨 Run key、以及用 sourceId / chunkId / slug / URL 冒充 key
    // 在这里是同一种失败：Registry 里查不到就没有成功路径。
    if (!entry)
      throw new GroundedAnswerRejectedError('unknown_citation_key')

    entries.push(entry)
  }

  const hasEvidence
    = evidenceAvailability === 'available' || evidenceAvailability === 'partial'

  // 没有有效证据时不允许挂任何引用：zero-hit 与工具故障都不得产出 Citation。
  if (!hasEvidence && entries.length > 0)
    throw new GroundedAnswerRejectedError('citations_not_allowed_without_evidence')

  switch (input.outcome) {
    case 'answered':
      if (!hasEvidence)
        throw new GroundedAnswerRejectedError('outcome_not_allowed_for_availability')
      if (entries.length === 0)
        throw new GroundedAnswerRejectedError('citation_required_for_answered')
      break

    case 'conflicting_evidence': {
      if (!hasEvidence)
        throw new GroundedAnswerRejectedError('outcome_not_allowed_for_availability')

      const distinctSourceIds = new Set(entries.map(entry => entry.sourceId))

      // 冲突必须是「不同来源之间」的冲突；同一篇文章的两个 chunk 不算。
      if (distinctSourceIds.size < 2)
        throw new GroundedAnswerRejectedError('conflicting_requires_two_sources')
      break
    }

    case 'insufficient_evidence':
      // 任何 availability 都允许 insufficient；上面已经限制了 0 citation 的情况。
      break
  }

  return {
    answer: input.answer,
    grounding: {
      schemaVersion: MESSAGE_GROUNDING_SCHEMA_VERSION,
      evidenceAvailability,
      outcome: input.outcome,
      citationIntegrity: 'validated',
      faithfulnessStatus: 'not_evaluated',
      citations: entries.map(toMessageCitation),
    },
  }
}

/**
 * Registry 条目到公共 Citation 的投影。
 *
 * `citationId` 是新生成的公开 ID，与内部 `citationKey` 无关，也不由它派生，
 * 避免公共 API 泄漏 Run-scoped 引用凭据。
 */
function toMessageCitation(entry: RunEvidenceEntry): MessageCitationV1 {
  return {
    citationId: `cit_${randomUUID().replaceAll('-', '')}`,
    sourceId: entry.sourceId,
    chunkId: entry.chunkId,
    granularity: entry.granularity,
    title: entry.title,
    slug: entry.slug,
    languageCode: entry.languageCode,
    sectionPath: entry.sectionPath,
    excerpt: entry.excerpt,
    rank: entry.rank,
    // 当前没有任何 allowlisted 的公开文章路由，因此 href 恒为 null。
    href: resolveCitationHref(),
    strategy: { ...entry.strategy },
  }
}

/**
 * 公共 href 只能由服务端根据持久化 slug 与 allowlisted internal route 派生。
 *
 * 当前 Web 只有 `/` 与 `/workspace` 两条路由，没有真实的文章详情页，
 * 因此这里一律返回 null，而不是拼一个并不存在的地址。
 */
function resolveCitationHref(): string | null {
  return null
}
