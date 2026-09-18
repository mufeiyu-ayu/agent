import type {
  AdminGroundedAnswerRejectionCode,
  AdminGroundedCitationSummary,
  AdminGroundedFinalizationFailureReason,
  AdminGroundedFinalizationSamplingFailure,
  AdminGroundedFinalizationStep,
  AdminRetrievalCallSummary,
  AdminRetrievalInspector,
  AdminRetrievalSourceRef,
  AdminRetrievalStrategy,
  AgentStepStatus,
  MessageEvidenceAvailability,
  MessageGroundingOutcome,
  MessageGroundingV1,
} from '@agent/contracts'
import type { GroundedAnswerRejectionCode } from '../../agent-runtime/grounding/grounded-answer.contract.js'
import type { GroundedFinalizationSamplingFailure } from '../../agent-runtime/grounding/grounded-answer.finalizer.js'
import type { PersistedMessageGrounding } from '../../agent-runtime/grounding/message-grounding.projector.js'

import { toOwnedMessageGroundingV1 } from '../../agent-runtime/grounding/message-grounding.projector.js'
import { AGENT_STEP_TYPES } from '../../agent-runtime/lifecycle/agent-run-recorder.service.js'
import { getArticleDetailDefinition } from '../../tools/articles/get-article-detail.tool.js'
import { searchArticlesDefinition } from '../../tools/articles/search-articles.tool.js'
import { retrieveArticleContextDefinition } from '../../tools/retrieval/retrieve-article-context.tool.js'
import {
  readAllowedString,
  readNonNegativeInteger,
  readObject,
  readPositiveInteger,
  readString,
  toPreview,
} from './safe-readers.js'
import {
  aggregateSamplingUsage,
  projectTokenUsage,
  readFinalizationAttempts,
} from './sampling-usage.projector.js'

/**
 * Run 级 Retrieval / Grounding 投影。
 *
 * 只读取已持久化的 typed metadata（Step input / output 与 MessageGrounding），
 * 字段能读就读，读不出就 null；excerpt、正文、raw arguments、embedding、
 * Provider payload、内部 `citationKey` 一律不进入公共 contract。
 */

const MAX_QUERY_CHARS = 200
const MAX_TITLE_CHARS = 200
const MAX_SECTION_PATH_CHARS = 200
const MAX_CHUNK_ID_CHARS = 200
const MAX_STRATEGY_NAME_CHARS = 64
const MAX_STRATEGY_VERSION_CHARS = 32
const MAX_LANGUAGE_CODE_CHARS = 32

/**
 * evidence-eligible Tool 的唯一事实来源是 Tool Definition 自己声明的 policy：
 * 改动某个工具的 policy 时这份表自动跟随，不会出现 Admin 按旧 policy 归类的漂移。
 */
const TOOL_EVIDENCE_POLICIES = new Map(
  [
    retrieveArticleContextDefinition,
    getArticleDetailDefinition,
    searchArticlesDefinition,
  ].map(definition => [definition.name, definition.evidencePolicy] as const),
)

const EVIDENCE_AVAILABILITIES: MessageEvidenceAvailability[] = [
  'available',
  'partial',
  'none',
  'unavailable',
]
const GROUNDING_OUTCOMES: MessageGroundingOutcome[] = [
  'answered',
  'insufficient_evidence',
  'conflicting_evidence',
]
const FINALIZATION_FAILURE_REASONS: AdminGroundedFinalizationFailureReason[] = [
  'validation_failed',
  'sampling_incomplete',
  'finalization_incomplete',
]
const REJECTION_CODES: AdminGroundedAnswerRejectionCode[] = [
  'answer_empty',
  'answer_too_long',
  'arguments_too_large',
  'citation_key_invalid',
  'citation_keys_too_many',
  'citation_required_for_answered',
  'citations_not_allowed_without_evidence',
  'conflicting_requires_two_sources',
  'malformed_json',
  'outcome_not_allowed_for_availability',
  'schema_invalid',
  'submission_missing',
  'unknown_citation_key',
]
const SAMPLING_FAILURES: AdminGroundedFinalizationSamplingFailure[] = [
  'extra_event_after_completion',
  'missing_response_completed',
  'missing_submission',
  'multiple_submissions',
  'stream_failed',
  'unexpected_finish_reason',
  'unknown_tool_call',
]

// 契约漂移守卫：Runtime 新增安全类别而公共 contract 未同步时，这里会编译失败，
// 而不是等到线上把未知类别静默投影成 null。
type AssertAssignable<Actual extends Expected, Expected> = Actual
type AssertRejectionCodes = AssertAssignable<
  GroundedAnswerRejectionCode,
  AdminGroundedAnswerRejectionCode
>
type AssertSamplingFailures = AssertAssignable<
  GroundedFinalizationSamplingFailure,
  AdminGroundedFinalizationSamplingFailure
>
export type AdminRetrievalContractGuards = [
  AssertRejectionCodes,
  AssertSamplingFailures,
]

export interface AdminRetrievalStepRecord {
  id: string
  sequence: number
  type: string
  input: unknown
  output: unknown
}

/** `knownStepBase()` 已经产出的通用字段；避免在两个 projector 里重复计算。 */
export interface AdminGroundedFinalizationStepBase {
  kind: 'known'
  id: string
  sequence: number
  title: string
  status: AgentStepStatus
  startedAt: string | null
  endedAt: string | null
  durationMs: number | null
  hasError: boolean
}

export interface AdminRetrievalMessageRecord {
  role: string
  status: string
  grounding?: PersistedMessageGrounding | null
}

export interface AdminRetrievalInspectorInput {
  steps: AdminRetrievalStepRecord[]
  assistantMessage: AdminRetrievalMessageRecord | null
}

export function projectAdminRetrievalInspector(
  input: AdminRetrievalInspectorInput,
): AdminRetrievalInspector {
  const calls = input.steps
    .filter(step => step.type === AGENT_STEP_TYPES.toolExecution)
    .sort((left, right) => left.sequence - right.sequence)
    .map(step => ({ step, input: readObject(step.input) }))
    .filter(({ input: toolInput }) => {
      const toolName = readString(toolInput, 'toolName')
      return toolName !== null
        && TOOL_EVIDENCE_POLICIES.get(toolName) === 'eligible'
    })
    .map(({ step, input: toolInput }) => ({
      callId: readString(toolInput, 'callId'),
      summary: projectRetrievalCall(step),
    }))
  const grounding = input.assistantMessage
    ? toOwnedMessageGroundingV1(
        input.assistantMessage,
        input.assistantMessage.grounding,
      )
    : null

  return {
    retrievalCalls: calls.map(call => call.summary),
    citations: grounding ? projectCitations(grounding, calls) : null,
  }
}

/** `grounded_finalization` 的 typed timeline 投影：逐字段读取 output。 */
export function projectGroundedFinalizationStep(
  step: AdminRetrievalStepRecord,
  base: AdminGroundedFinalizationStepBase,
): AdminGroundedFinalizationStep {
  const output = readObject(step.output)
  const attempts = readFinalizationAttempts(step.output)

  return {
    ...base,
    type: AGENT_STEP_TYPES.groundedFinalization,
    evidenceAvailability: readAllowedString(
      output,
      'evidenceAvailability',
      EVIDENCE_AVAILABILITIES,
    ),
    outcome: readAllowedString(output, 'outcome', GROUNDING_OUTCOMES),
    attemptCount: readNonNegativeInteger(output, 'attemptCount'),
    registryRefCount: readNonNegativeInteger(output, 'registryRefCount'),
    failureReason: readAllowedString(
      output,
      'failureReason',
      FINALIZATION_FAILURE_REASONS,
    ),
    rejectionCode: readAllowedString(output, 'rejectionCode', REJECTION_CODES),
    samplingFailure: readAllowedString(output, 'samplingFailure', SAMPLING_FAILURES),
    usage: attempts.length > 0
      ? aggregateSamplingUsage(
          attempts.map(attempt => projectTokenUsage(readObject(attempt))),
        )
      : null,
  }
}

function projectRetrievalCall(
  step: AdminRetrievalStepRecord,
): AdminRetrievalCallSummary {
  const summary = readObject(readObject(step.output)?.toolSummary)

  return {
    stepId: step.id,
    query: readString(summary, 'query', MAX_QUERY_CHARS),
    strategy: readStrategy(summary?.strategy),
    sourceCount: readNonNegativeInteger(summary, 'sourceCount'),
    chunkEvidenceCount: readNonNegativeInteger(summary, 'chunkEvidenceCount'),
    refs: readSourceRefs(summary?.sources),
  }
}

/**
 * 逐条读取来源身份；不是数组返回空数组，单条读不出则跳过该条。
 *
 * `chunkId` 缺省或 null 才是 article 粒度；其他非字符串值不能退化成 null，
 * 否则损坏的 chunk ref 会与同 sourceId 的 article 级 Citation 假关联。
 */
function readSourceRefs(value: unknown): AdminRetrievalSourceRef[] {
  if (!Array.isArray(value))
    return []

  const refs: AdminRetrievalSourceRef[] = []

  for (const candidate of value) {
    const object = readObject(candidate)
    const sourceId = readPositiveInteger(object, 'sourceId')
    const chunkId = object?.chunkId === undefined || object.chunkId === null
      ? null
      : readString(object, 'chunkId', MAX_CHUNK_ID_CHARS)

    if (sourceId === null || (chunkId === null && object?.chunkId != null))
      continue

    refs.push({ sourceId, chunkId })
  }

  return refs
}

function readStrategy(value: unknown): AdminRetrievalStrategy | null {
  const strategy = readObject(value)
  const name = readString(strategy, 'name', MAX_STRATEGY_NAME_CHARS)
  const version = readString(strategy, 'version', MAX_STRATEGY_VERSION_CHARS)

  return name !== null && version !== null ? { name, version } : null
}

function projectCitations(
  grounding: MessageGroundingV1,
  calls: Array<{ callId: string | null, summary: AdminRetrievalCallSummary }>,
): AdminGroundedCitationSummary[] {
  const callIdsByRef = new Map<string, string[]>()

  for (const call of calls) {
    if (call.callId === null)
      continue

    for (const ref of call.summary.refs) {
      const identity = toRefIdentity(ref)
      const callIds = callIdsByRef.get(identity) ?? []

      if (!callIds.includes(call.callId))
        callIds.push(call.callId)

      callIdsByRef.set(identity, callIds)
    }
  }

  return grounding.citations.map(citation => ({
    citationId: citation.citationId,
    sourceId: citation.sourceId,
    chunkId: citation.chunkId,
    title: toPreview(citation.title, MAX_TITLE_CHARS),
    sectionPath: citation.sectionPath === null
      ? null
      : toPreview(citation.sectionPath, MAX_SECTION_PATH_CHARS),
    languageCode: toPreview(citation.languageCode, MAX_LANGUAGE_CODE_CHARS),
    strategy: {
      name: toPreview(citation.strategy.name, MAX_STRATEGY_NAME_CHARS),
      version: toPreview(citation.strategy.version, MAX_STRATEGY_VERSION_CHARS),
    },
    // 只用真实持久化身份关联；不按 title、rank 或数组位置猜来源。
    matchedCallIds: callIdsByRef.get(
      toRefIdentity({ sourceId: citation.sourceId, chunkId: citation.chunkId }),
    ) ?? [],
  }))
}

function toRefIdentity(ref: AdminRetrievalSourceRef): string {
  return `${ref.sourceId}:${ref.chunkId ?? ''}`
}
