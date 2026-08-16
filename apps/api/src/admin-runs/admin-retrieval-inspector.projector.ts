import type {
  AdminGroundedAnswerRejectionCode,
  AdminGroundedCitationSummary,
  AdminGroundedFinalizationFailureReason,
  AdminGroundedFinalizationSamplingFailure,
  AdminGroundedFinalizationStep,
  AdminGroundedFinalizationSummary,
  AdminGroundedFinalizationValidation,
  AdminRetrievalCallSummary,
  AdminRetrievalInspector,
  AdminRetrievalSourceRef,
  AdminRetrievalStrategy,
  AdminRunTimelineItem,
  AdminRunTokenUsage,
  AgentRunStatus,
  AgentStepStatus,
  MessageEvidenceAvailability,
  MessageGroundingOutcome,
  MessageGroundingV1,
} from '@agent/contracts'
import type { GroundedAnswerRejectionCode } from '../agent-runtime/grounding/grounded-answer.contract.js'
import type { GroundedFinalizationSamplingFailure } from '../agent-runtime/grounding/grounded-answer.finalizer.js'
import type { PersistedMessageGrounding } from '../agent-runtime/grounding/message-grounding.projector.js'

import { AGENT_STEP_TYPES } from '../agent-runtime/agent-run-recorder.service.js'
import { GROUNDED_FINALIZATION_MAX_ATTEMPTS } from '../agent-runtime/grounding/grounded-answer.finalizer.js'
import { toOwnedMessageGroundingV1 } from '../agent-runtime/grounding/message-grounding.projector.js'
import { getArticleDetailDefinition } from '../tools/articles/get-article-detail.tool.js'
import { searchArticlesDefinition } from '../tools/articles/search-articles.tool.js'
import { retrieveArticleContextDefinition } from '../tools/retrieval/retrieve-article-context.tool.js'
import {
  elapsedMs,
  readAllowedString,
  readBoolean,
  readNonNegativeInteger,
  readObject,
} from './admin-run.projector.js'

/**
 * Run 级 Retrieval / Grounding 审计投影。
 *
 * 三条硬边界：
 * 1. 只读取已持久化的 typed metadata（Step input/output 与 MessageGrounding），
 *    绝不从 `inputSummary` / `outputSummary` / Observation / 模型正文反解析；
 * 2. 输出字段是 allowlist：excerpt、正文、raw arguments、embedding、distance、
 *    Provider payload、内部 `citationKey` 一律不进入公共 contract；
 * 3. 任何一层不一致都只会降级，绝不把不完整事实静默升级成完整成功。
 */

/** 单个 Run 最多投影的 evidence-eligible call 数量。 */
export const ADMIN_RETRIEVAL_MAX_CALLS = 20

/** 单个 call 最多投影的安全 source / chunk 引用数量。 */
export const ADMIN_RETRIEVAL_MAX_REFS_PER_CALL = 5

const MAX_QUERY_CHARS = 200
const MAX_TITLE_CHARS = 200
const MAX_SECTION_PATH_CHARS = 200
const MAX_CHUNK_ID_CHARS = 200
const MAX_STRATEGY_NAME_CHARS = 64
const MAX_STRATEGY_VERSION_CHARS = 32
const MAX_LANGUAGE_CODE_CHARS = 32

/**
 * evidence-eligible Tool 的唯一事实来源是 Tool Definition 自己声明的 policy。
 *
 * 这里刻意不手抄工具名常量：`search_articles@1` 是 `discovery_only`，
 * 一旦有人改动某个工具的 policy，这份 allowlist 会自动跟随，不会出现
 * 「Admin 仍按旧 policy 归类证据调用」的静默漂移。
 */
const EVIDENCE_ELIGIBLE_TOOLS = new Map(
  [
    retrieveArticleContextDefinition,
    getArticleDetailDefinition,
    searchArticlesDefinition,
  ]
    .filter(definition => definition.evidencePolicy === 'eligible')
    .map(definition => [definition.name, definition.version] as const),
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
  status: AgentStepStatus
  input: unknown
  output: unknown
  startedAt: Date | null
  endedAt: Date | null
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
  runStatus: AgentRunStatus
  steps: AdminRetrievalStepRecord[]
  timeline: AdminRunTimelineItem[]
  assistantMessage: AdminRetrievalMessageRecord | null
}

/** 解析后的 finalization metadata；`trusted` 为 false 时其余字段不可用于判定完整性。 */
interface FinalizationMetadata {
  trusted: boolean
  evidenceAvailability: MessageEvidenceAvailability | null
  registryRefCount: number | null
  registryTruncated: boolean | null
  eligibleToolCallCount: number | null
  eligibleToolFailureCount: number | null
  attemptCount: number | null
  outcome: MessageGroundingOutcome | null
  citationCount: number | null
  citationIntegrity: 'validated' | null
  faithfulnessStatus: 'not_evaluated' | null
  schemaVersion: number | null
  failureReason: AdminGroundedFinalizationFailureReason | null
  rejectionCode: AdminGroundedAnswerRejectionCode | null
  samplingFailure: AdminGroundedFinalizationSamplingFailure | null
  usage: AdminRunTokenUsage | null
  recordedDurationMs: number | null
}

export function projectAdminRetrievalInspector(
  input: AdminRetrievalInspectorInput,
): AdminRetrievalInspector {
  const timelineById = new Map(input.timeline.map(item => [item.id, item]))
  const eligibleSteps = input.steps
    .filter(step => step.type === AGENT_STEP_TYPES.toolExecution)
    .filter(step => isEvidenceEligibleStep(step, timelineById.get(step.id)))
    .sort((left, right) => left.sequence - right.sequence)
  const callsTruncated = eligibleSteps.length > ADMIN_RETRIEVAL_MAX_CALLS
  const retrievalCalls = eligibleSteps
    .slice(0, ADMIN_RETRIEVAL_MAX_CALLS)
    .map(step => projectRetrievalCall(step, timelineById.get(step.id)))

  const finalizationSteps = input.steps
    .filter(step => step.type === AGENT_STEP_TYPES.groundedFinalization)
    .sort((left, right) => left.sequence - right.sequence)
  // Runtime 每个 Run 最多创建一个 finalization Step；出现多个说明数据不可信。
  const duplicatedFinalization = finalizationSteps.length > 1
  const finalizationStep = finalizationSteps.at(-1)
  const finalizationMetadata = finalizationStep
    ? readFinalizationMetadata(finalizationStep)
    : null
  const finalization = finalizationStep && finalizationMetadata
    ? toFinalizationSummary(
        finalizationStep,
        finalizationMetadata,
        duplicatedFinalization,
      )
    : null

  const groundingRowPresent = Boolean(input.assistantMessage?.grounding)
  const grounding = input.assistantMessage
    ? toOwnedMessageGroundingV1(
        input.assistantMessage,
        input.assistantMessage.grounding,
      )
    : null
  const citations = grounding
    ? projectCitations(grounding, retrievalCalls)
    : null

  const callsTrusted = retrievalCalls.every(call => call.metadataTrusted)
  const refsTruncated = retrievalCalls.some(call => call.refsTruncated)
  const evidenceRefCount = callsTrusted
    ? countDistinctRefs(retrievalCalls)
    : null
  const candidateCount = callsTrusted
    ? sumSourceCounts(retrievalCalls)
    : null

  return {
    availability: resolveAvailability({
      runStatus: input.runStatus,
      hasEligibleCall: eligibleSteps.length > 0,
      hasFinalizationStep: finalizationSteps.length > 0,
      groundingRowPresent,
      callsTrusted,
      callsTruncated,
      refsTruncated,
      evidenceRefCount,
      finalization,
      grounding,
      citations,
    }),
    retrievalCalls,
    callsTruncated,
    candidateCount,
    evidenceRefCount,
    finalization,
    citations,
  }
}

/**
 * `grounded_finalization` 的 typed timeline 投影。
 *
 * metadata 不可信时返回 `null`，由调用方回落到既有 Generic fallback，
 * 而不是给出一份看起来完整的假 Step。
 */
export function projectGroundedFinalizationStep(
  step: AdminRetrievalStepRecord,
  base: AdminGroundedFinalizationStepBase,
): AdminGroundedFinalizationStep | null {
  const metadata = readFinalizationMetadata(step)

  if (!metadata.trusted)
    return null

  const input = readObject(step.input)

  return {
    ...base,
    type: AGENT_STEP_TYPES.groundedFinalization,
    assistantMessageId: readBoundedString(
      input?.assistantMessageId,
      MAX_CHUNK_ID_CHARS,
    ),
    evidenceAvailability: metadata.evidenceAvailability,
    outcome: metadata.outcome,
    attemptCount: metadata.attemptCount,
    maxAttempts: GROUNDED_FINALIZATION_MAX_ATTEMPTS,
    registryRefCount: metadata.registryRefCount,
    registryTruncated: metadata.registryTruncated,
    citationCount: metadata.citationCount,
    validation: resolveValidation(metadata, step.status),
    failureReason: metadata.failureReason,
    inputSummary: summarize([
      ['evidenceAvailability', metadata.evidenceAvailability],
      ['registryRefCount', metadata.registryRefCount],
      ['registryTruncated', metadata.registryTruncated],
    ]),
    outputSummary: summarize([
      ['attemptCount', metadata.attemptCount],
      ['outcome', metadata.outcome],
      ['citationCount', metadata.citationCount],
      ['failureReason', metadata.failureReason],
    ]),
  }
}

function isEvidenceEligibleStep(
  step: AdminRetrievalStepRecord,
  item: AdminRunTimelineItem | undefined,
): boolean {
  // 只信任已经通过既有 tool_execution 校验的 typed item；malformed Step 的
  // toolName 本身就不可信，不能凭它把一次调用归入证据链。
  if (item?.kind !== 'known' || item.type !== AGENT_STEP_TYPES.toolExecution)
    return isEligibleToolIdentity(readObject(step.input))

  return isEligibleTool(item.toolName, item.toolVersion)
}

function isEligibleToolIdentity(input: Record<string, unknown> | null): boolean {
  const toolName = typeof input?.toolName === 'string' ? input.toolName : null
  const toolVersion = typeof input?.toolVersion === 'string'
    ? input.toolVersion
    : null

  return isEligibleTool(toolName, toolVersion)
}

function isEligibleTool(
  toolName: string | null,
  toolVersion: string | null,
): boolean {
  return toolName !== null
    && EVIDENCE_ELIGIBLE_TOOLS.get(toolName) === toolVersion
}

function projectRetrievalCall(
  step: AdminRetrievalStepRecord,
  item: AdminRunTimelineItem | undefined,
): AdminRetrievalCallSummary {
  const known = item?.kind === 'known'
    && item.type === AGENT_STEP_TYPES.toolExecution
    ? item
    : null
  const output = readObject(step.output)
  const hasToolSummary = output !== null && Object.hasOwn(output, 'toolSummary')
  const summary = hasToolSummary ? readToolSummary(output.toolSummary) : null
  // 三种情况必须分开：base metadata 损坏（不可信）、成功但工具本就没有提交
  // summary（可信但无计数）、提交了 summary 却不合法（不可信）。
  const metadataTrusted = known !== null && (!hasToolSummary || summary !== null)
  const refs = summary?.refs.slice(0, ADMIN_RETRIEVAL_MAX_REFS_PER_CALL) ?? []

  return {
    stepId: step.id,
    sequence: step.sequence,
    status: step.status,
    callId: known?.callId ?? null,
    toolName: known?.toolName ?? null,
    toolVersion: known?.toolVersion ?? null,
    samplingAttemptId: known?.samplingAttemptId ?? null,
    // v1 没有任何工具把 query 写进 typed metadata；不得从 raw arguments 反解析。
    query: summary?.query ?? null,
    strategy: summary?.strategy ?? null,
    ok: known?.ok ?? null,
    code: known?.code ?? null,
    sourceCount: summary?.sourceCount ?? null,
    chunkEvidenceCount: summary?.chunkEvidenceCount ?? null,
    evidenceRefCount: summary ? summary.refs.length : null,
    originalChars: known?.originalChars ?? null,
    observationChars: known?.observationChars ?? null,
    truncated: known?.truncated ?? null,
    recordedDurationMs: known?.recordedDurationMs ?? null,
    durationMs: elapsedMs(step.startedAt, step.endedAt),
    refs,
    refsTruncated: summary !== null
      && summary.refs.length > ADMIN_RETRIEVAL_MAX_REFS_PER_CALL,
    metadataTrusted,
  }
}

interface ToolSummaryMetadata {
  query: string | null
  strategy: AdminRetrievalStrategy | null
  sourceCount: number
  chunkEvidenceCount: number
  refs: AdminRetrievalSourceRef[]
}

/**
 * 严格读取 Tool 自愿提交的 Step Summary。
 *
 * 任何一处类型、数量或跨字段不一致都返回 `null`：Admin 宁可显示「计数不可用」，
 * 也不能显示一份自相矛盾却看起来完整的证据摘要。
 */
function readToolSummary(value: unknown): ToolSummaryMetadata | null {
  const summary = readObject(value)

  if (!summary)
    return null

  const sourceCount = readNonNegativeInteger(summary, 'sourceCount')
  const chunkEvidenceCount = readNonNegativeInteger(summary, 'chunkEvidenceCount')

  if (sourceCount === null || chunkEvidenceCount === null)
    return null

  if (chunkEvidenceCount > sourceCount)
    return null

  const strategy = readStrategy(summary.strategy)

  if (strategy === undefined)
    return null

  if (!Array.isArray(summary.sources))
    return null

  const refs: AdminRetrievalSourceRef[] = []
  const identities = new Set<string>()

  for (const candidate of summary.sources) {
    const ref = readSourceRef(candidate)

    if (!ref || identities.has(toRefIdentity(ref)))
      return null

    identities.add(toRefIdentity(ref))
    refs.push(ref)
  }

  // summary 只保留前 N 条引用，因此 refs 可以少于 sourceCount，但绝不可能更多。
  if (refs.length > sourceCount)
    return null

  if (refs.filter(ref => ref.chunkId !== null).length > chunkEvidenceCount)
    return null

  const query = Object.hasOwn(summary, 'query')
    ? readBoundedString(summary.query, MAX_QUERY_CHARS)
    : null

  if (Object.hasOwn(summary, 'query') && query === null)
    return null

  return {
    query,
    strategy,
    sourceCount,
    chunkEvidenceCount,
    refs,
  }
}

function readSourceRef(value: unknown): AdminRetrievalSourceRef | null {
  const candidate = readObject(value)

  if (!candidate)
    return null

  const sourceId = readNonNegativeInteger(candidate, 'sourceId')

  if (sourceId === null || sourceId === 0)
    return null

  if (!Object.hasOwn(candidate, 'chunkId'))
    return { sourceId, chunkId: null }

  const chunkId = readBoundedString(candidate.chunkId, MAX_CHUNK_ID_CHARS)

  return chunkId === null ? null : { sourceId, chunkId }
}

/**
 * @returns 合法 strategy；缺省时为 `null`；存在但非法时为 `undefined`（整份 summary 作废）。
 */
function readStrategy(
  value: unknown,
): AdminRetrievalStrategy | null | undefined {
  if (value === undefined)
    return null

  const strategy = readObject(value)

  if (!strategy)
    return undefined

  const name = readBoundedString(strategy.name, MAX_STRATEGY_NAME_CHARS)
  const version = readBoundedString(strategy.version, MAX_STRATEGY_VERSION_CHARS)

  return name !== null && version !== null ? { name, version } : undefined
}

function readFinalizationMetadata(
  step: AdminRetrievalStepRecord,
): FinalizationMetadata {
  const untrusted: FinalizationMetadata = {
    trusted: false,
    evidenceAvailability: null,
    registryRefCount: null,
    registryTruncated: null,
    eligibleToolCallCount: null,
    eligibleToolFailureCount: null,
    attemptCount: null,
    outcome: null,
    citationCount: null,
    citationIntegrity: null,
    faithfulnessStatus: null,
    schemaVersion: null,
    failureReason: null,
    rejectionCode: null,
    samplingFailure: null,
    usage: null,
    recordedDurationMs: null,
  }
  const output = readObject(step.output)
  const input = readObject(step.input)

  if (!output)
    return untrusted

  const evidenceAvailability = readAllowedString(
    output,
    'evidenceAvailability',
    EVIDENCE_AVAILABILITIES,
  )
  const registryRefCount = readNonNegativeInteger(output, 'registryRefCount')
  const registryTruncated = readBoolean(output, 'registryTruncated')
  const eligibleToolCallCount = readNonNegativeInteger(
    output,
    'eligibleToolCallCount',
  )
  const eligibleToolFailureCount = readNonNegativeInteger(
    output,
    'eligibleToolFailureCount',
  )
  const attemptCount = readNonNegativeInteger(output, 'attemptCount')

  if (
    evidenceAvailability === null
    || registryRefCount === null
    || registryTruncated === null
    || eligibleToolCallCount === null
    || eligibleToolFailureCount === null
    || attemptCount === null
  ) {
    return untrusted
  }

  // Registry 的 availability 完全由 refCount 与失败次数派生；不满足这组不变量
  // 说明 metadata 被改写或来自未知契约版本。
  if (
    eligibleToolFailureCount > eligibleToolCallCount
    || eligibleToolCallCount === 0
    || evidenceAvailability !== deriveEvidenceAvailability(
      registryRefCount,
      eligibleToolFailureCount,
    )
  ) {
    return untrusted
  }

  // 启动时写入的 input 与收口时写入的 output 必须描述同一份 Registry。
  if (input !== null && !isConsistentFinalizationInput(input, {
    evidenceAvailability,
    registryRefCount,
    registryTruncated,
  })) {
    return untrusted
  }

  const attempts = readAttempts(output.attempts, attemptCount)

  if (!attempts)
    return untrusted

  const groundingKeys = [
    'outcome',
    'citationCount',
    'citationIntegrity',
    'faithfulnessStatus',
    'schemaVersion',
  ]
  const hasGroundingBlock = groundingKeys.some(key => Object.hasOwn(output, key))
  const outcome = readAllowedString(output, 'outcome', GROUNDING_OUTCOMES)
  const citationCount = readNonNegativeInteger(output, 'citationCount')
  const citationIntegrity = readAllowedString(
    output,
    'citationIntegrity',
    ['validated'] as const,
  )
  const faithfulnessStatus = readAllowedString(
    output,
    'faithfulnessStatus',
    ['not_evaluated'] as const,
  )
  const schemaVersion = readNonNegativeInteger(output, 'schemaVersion')

  if (hasGroundingBlock) {
    if (
      outcome === null
      || citationCount === null
      || citationIntegrity === null
      || faithfulnessStatus === null
      || schemaVersion !== 1
    ) {
      return untrusted
    }

    // 没有证据时不允许挂引用；与 `parseMessageGroundingV1` 同一套语义。
    const hasEvidence = evidenceAvailability === 'available'
      || evidenceAvailability === 'partial'

    if (!hasEvidence && citationCount > 0)
      return untrusted

    if (outcome === 'answered' && (!hasEvidence || citationCount < 1))
      return untrusted

    if (outcome === 'conflicting_evidence' && (!hasEvidence || citationCount < 2))
      return untrusted

    if (citationCount > registryRefCount)
      return untrusted
  }

  const failureReason = Object.hasOwn(output, 'failureReason')
    ? readAllowedString(output, 'failureReason', FINALIZATION_FAILURE_REASONS)
    : null

  if (Object.hasOwn(output, 'failureReason') && failureReason === null)
    return untrusted

  const rejectionCode = readAllowedString(output, 'rejectionCode', REJECTION_CODES)
  const samplingFailure = readAllowedString(
    output,
    'samplingFailure',
    SAMPLING_FAILURES,
  )

  if (
    (Object.hasOwn(output, 'rejectionCode') && rejectionCode === null)
    || (Object.hasOwn(output, 'samplingFailure') && samplingFailure === null)
    || (failureReason === 'validation_failed' && rejectionCode === null)
    || (failureReason === 'sampling_incomplete' && samplingFailure === null)
    || (failureReason === 'finalization_incomplete'
      && (rejectionCode !== null || samplingFailure !== null))
    || (failureReason === null
      && (rejectionCode !== null || samplingFailure !== null))
  ) {
    return untrusted
  }

  return {
    trusted: true,
    evidenceAvailability,
    registryRefCount,
    registryTruncated,
    eligibleToolCallCount,
    eligibleToolFailureCount,
    attemptCount,
    outcome: hasGroundingBlock ? outcome : null,
    citationCount: hasGroundingBlock ? citationCount : null,
    citationIntegrity: hasGroundingBlock ? citationIntegrity : null,
    faithfulnessStatus: hasGroundingBlock ? faithfulnessStatus : null,
    schemaVersion: hasGroundingBlock ? schemaVersion : null,
    failureReason,
    rejectionCode,
    samplingFailure,
    usage: attempts.usage,
    recordedDurationMs: attempts.recordedDurationMs,
  }
}

function isConsistentFinalizationInput(
  input: Record<string, unknown>,
  output: {
    evidenceAvailability: MessageEvidenceAvailability
    registryRefCount: number
    registryTruncated: boolean
  },
): boolean {
  const keys = ['evidenceAvailability', 'registryRefCount', 'registryTruncated']

  if (!keys.some(key => Object.hasOwn(input, key)))
    return true

  return readAllowedString(input, 'evidenceAvailability', EVIDENCE_AVAILABILITIES)
    === output.evidenceAvailability
    && readNonNegativeInteger(input, 'registryRefCount')
    === output.registryRefCount
    && readBoolean(input, 'registryTruncated') === output.registryTruncated
}

function deriveEvidenceAvailability(
  registryRefCount: number,
  eligibleToolFailureCount: number,
): MessageEvidenceAvailability {
  if (registryRefCount > 0)
    return eligibleToolFailureCount > 0 ? 'partial' : 'available'

  return eligibleToolFailureCount > 0 ? 'unavailable' : 'none'
}

interface FinalizationAttemptAggregate {
  usage: AdminRunTokenUsage | null
  recordedDurationMs: number | null
}

/**
 * 读取 attempts 并做 all-or-nothing 聚合。
 *
 * 任何一次 attempt 的 usage 不完整，整个 finalization 的 Token 汇总就是 `null`：
 * 半份 Token 数字比没有数字更危险。
 */
function readAttempts(
  value: unknown,
  attemptCount: number,
): FinalizationAttemptAggregate | null {
  if (!Array.isArray(value) || value.length !== attemptCount)
    return null

  if (value.length > GROUNDED_FINALIZATION_MAX_ATTEMPTS)
    return null

  let inputTokens = 0
  let outputTokens = 0
  let totalTokens = 0
  let usageComplete = value.length > 0
  let recordedDurationMs = 0
  let durationComplete = true

  for (const [index, candidate] of value.entries()) {
    const attempt = readObject(candidate)

    if (!attempt || typeof attempt.ok !== 'boolean')
      return null

    if (readNonNegativeInteger(attempt, 'attempt') !== index + 1)
      return null

    if (readNonNegativeInteger(attempt, 'submittedCitationKeyCount') === null)
      return null

    const durationMs = readNonNegativeInteger(attempt, 'durationMs')

    if (durationMs === null)
      durationComplete = false
    else
      recordedDurationMs += durationMs

    const usage = readObject(attempt.usage)
    const attemptInput = readNonNegativeInteger(usage, 'inputTokens')
    const attemptOutput = readNonNegativeInteger(usage, 'outputTokens')
    const attemptTotal = readNonNegativeInteger(usage, 'totalTokens')

    if (
      attemptInput === null
      || attemptOutput === null
      || attemptTotal === null
    ) {
      usageComplete = false
      continue
    }

    inputTokens += attemptInput
    outputTokens += attemptOutput
    totalTokens += attemptTotal
  }

  return {
    usage: usageComplete
      && Number.isSafeInteger(inputTokens)
      && Number.isSafeInteger(outputTokens)
      && Number.isSafeInteger(totalTokens)
      ? { inputTokens, outputTokens, totalTokens }
      : null,
    recordedDurationMs: durationComplete && Number.isSafeInteger(recordedDurationMs)
      ? recordedDurationMs
      : null,
  }
}

function toFinalizationSummary(
  step: AdminRetrievalStepRecord,
  metadata: FinalizationMetadata,
  duplicated: boolean,
): AdminGroundedFinalizationSummary {
  const trusted = metadata.trusted && !duplicated

  return {
    stepId: step.id,
    sequence: step.sequence,
    status: step.status,
    schemaVersion: metadata.schemaVersion,
    evidenceAvailability: metadata.evidenceAvailability,
    outcome: metadata.outcome,
    attemptCount: metadata.attemptCount,
    maxAttempts: GROUNDED_FINALIZATION_MAX_ATTEMPTS,
    registryRefCount: metadata.registryRefCount,
    registryTruncated: metadata.registryTruncated,
    eligibleToolCallCount: metadata.eligibleToolCallCount,
    eligibleToolFailureCount: metadata.eligibleToolFailureCount,
    validation: trusted
      ? resolveValidation(metadata, step.status)
      : 'unavailable',
    failureReason: metadata.failureReason,
    rejectionCode: metadata.rejectionCode,
    samplingFailure: metadata.samplingFailure,
    citationCount: metadata.citationCount,
    citationIntegrity: metadata.citationIntegrity,
    faithfulnessStatus: metadata.faithfulnessStatus,
    usage: metadata.usage,
    recordedDurationMs: metadata.recordedDurationMs,
    durationMs: elapsedMs(step.startedAt, step.endedAt),
    metadataTrusted: trusted,
  }
}

function resolveValidation(
  metadata: FinalizationMetadata,
  status: AgentStepStatus,
): AdminGroundedFinalizationValidation {
  if (!metadata.trusted)
    return 'unavailable'

  // 校验通过后 Run 才被中断的情况同时带 grounding 与 failureReason：
  // 引用校验本身确实通过了，失败原因单列，不能因此改写成 failed。
  if (metadata.outcome !== null)
    return 'passed'

  if (metadata.failureReason !== null)
    return 'failed'

  return status === 'RUNNING' || status === 'PENDING' ? 'pending' : 'unavailable'
}

function projectCitations(
  grounding: MessageGroundingV1,
  calls: AdminRetrievalCallSummary[],
): AdminGroundedCitationSummary[] {
  const refIndex = new Map<string, string[]>()

  for (const call of calls) {
    if (!call.metadataTrusted || call.callId === null)
      continue

    for (const ref of call.refs) {
      const identity = toRefIdentity(ref)
      const callIds = refIndex.get(identity) ?? []

      if (!callIds.includes(call.callId))
        callIds.push(call.callId)

      refIndex.set(identity, callIds)
    }
  }

  return grounding.citations.map((citation, index) => {
    // 只用真实持久化身份关联；不按 title、rank 或数组位置猜来源。
    const matchedCallIds = refIndex.get(
      toRefIdentity({ sourceId: citation.sourceId, chunkId: citation.chunkId }),
    ) ?? []

    return {
      sequence: index + 1,
      citationId: citation.citationId,
      sourceId: citation.sourceId,
      chunkId: citation.chunkId,
      granularity: citation.granularity,
      title: toBoundedPreview(citation.title, MAX_TITLE_CHARS),
      sectionPath: citation.sectionPath === null
        ? null
        : toBoundedPreview(citation.sectionPath, MAX_SECTION_PATH_CHARS),
      languageCode: toBoundedPreview(
        citation.languageCode,
        MAX_LANGUAGE_CODE_CHARS,
      ),
      strategy: {
        name: toBoundedPreview(citation.strategy.name, MAX_STRATEGY_NAME_CHARS),
        version: toBoundedPreview(
          citation.strategy.version,
          MAX_STRATEGY_VERSION_CHARS,
        ),
      },
      correlation: matchedCallIds.length > 0 ? 'matched' : 'unmatched',
      matchedCallIds,
    }
  })
}

interface AvailabilityInput {
  runStatus: AgentRunStatus
  hasEligibleCall: boolean
  hasFinalizationStep: boolean
  groundingRowPresent: boolean
  callsTrusted: boolean
  callsTruncated: boolean
  refsTruncated: boolean
  evidenceRefCount: number | null
  finalization: AdminGroundedFinalizationSummary | null
  grounding: MessageGroundingV1 | null
  citations: AdminGroundedCitationSummary[] | null
}

/**
 * Inspector availability 的唯一判定规则。
 *
 * 它衡量的是「后台能不能完整、可信地审计这次 Run」，与 Grounding 的
 * `evidenceAvailability`（本次 Run 到底有没有证据）严格分层：
 * zero-hit 与 Tool 故障只要审计事实完整，依然是 `available`。
 */
function resolveAvailability(input: AvailabilityInput): AdminRetrievalInspector['availability'] {
  if (
    !input.hasEligibleCall
    && !input.hasFinalizationStep
    && !input.groundingRowPresent
  ) {
    return 'not_applicable'
  }

  const hasTrustedFact = (input.hasEligibleCall && input.callsTrusted)
    || input.finalization?.metadataTrusted === true
    || input.citations !== null

  if (!hasTrustedFact)
    return 'unavailable'

  const finalization = input.finalization
  const complete = input.runStatus === 'COMPLETED'
    && input.hasEligibleCall
    && input.callsTrusted
    && !input.callsTruncated
    && !input.refsTruncated
    && finalization !== null
    && finalization.metadataTrusted
    && finalization.status === 'COMPLETED'
    && finalization.validation === 'passed'
    && input.grounding !== null
    && input.citations !== null
    && input.citations.every(citation => citation.correlation === 'matched')
    // 投影出的 evidence 身份数必须等于 Registry 记录的真实数量，否则说明
    // 有 call 没有提交可审计的引用（legacy 或无 summary 的工具）。
    && input.evidenceRefCount === finalization.registryRefCount
    && isConsistentWithGrounding(finalization, input.grounding)

  return complete ? 'available' : 'partial'
}

function isConsistentWithGrounding(
  finalization: AdminGroundedFinalizationSummary,
  grounding: MessageGroundingV1,
): boolean {
  return finalization.schemaVersion === grounding.schemaVersion
    && finalization.evidenceAvailability === grounding.evidenceAvailability
    && finalization.outcome === grounding.outcome
    && finalization.citationCount === grounding.citations.length
    && finalization.citationIntegrity === grounding.citationIntegrity
    && finalization.faithfulnessStatus === grounding.faithfulnessStatus
}

function countDistinctRefs(calls: AdminRetrievalCallSummary[]): number {
  const identities = new Set<string>()

  for (const call of calls) {
    for (const ref of call.refs)
      identities.add(toRefIdentity(ref))
  }

  return identities.size
}

function sumSourceCounts(calls: AdminRetrievalCallSummary[]): number {
  return calls.reduce(
    (total, call) => total + (call.sourceCount ?? 0),
    0,
  )
}

function toRefIdentity(ref: AdminRetrievalSourceRef): string {
  return `${ref.sourceId}:${ref.chunkId ?? ''}`
}

function readBoundedString(value: unknown, maxChars: number): string | null {
  if (typeof value !== 'string')
    return null

  const normalized = value.replace(/\s+/g, ' ').trim()

  return normalized.length > 0 && [...normalized].length <= maxChars
    ? normalized
    : null
}

function toBoundedPreview(value: string, maxChars: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  const characters = [...normalized]

  return characters.length <= maxChars
    ? normalized
    : `${characters.slice(0, maxChars - 1).join('')}…`
}

function summarize(
  entries: Array<[label: string, value: string | number | boolean | null]>,
): string | null {
  const values = entries
    .filter((entry): entry is [string, string | number | boolean] => entry[1] !== null)
    .map(([label, value]) => `${label}=${value}`)

  return values.length > 0 ? values.join(', ') : null
}
