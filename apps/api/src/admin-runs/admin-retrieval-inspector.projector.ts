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
const MAX_IDENTIFIER_CHARS = 128
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
const REGISTERED_TOOLS = [
  retrieveArticleContextDefinition,
  getArticleDetailDefinition,
  searchArticlesDefinition,
] as const

/**
 * `name@version` → evidence policy 的完整 identity map。
 *
 * 刻意保留 non-eligible 工具：只有 exact known identity 才能被明确判定为
 * discovery-only；「已知工具名但版本缺失 / 漂移」不是已确认的 discovery-only，
 * 而是 identity 不完整，必须单独归类。
 */
const TOOL_EVIDENCE_POLICIES = new Map(
  REGISTERED_TOOLS.map(
    definition => [
      toToolIdentity(definition.name, definition.version),
      definition.evidencePolicy,
    ] as const,
  ),
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
  /** 本 Run 真实关联的助手消息 ID；用于复核 finalization Step 的归属。 */
  assistantMessageId: string | null
  steps: AdminRetrievalStepRecord[]
  timeline: AdminRunTimelineItem[]
  assistantMessage: AdminRetrievalMessageRecord | null
}

/** 解析后的 finalization metadata；`trusted` 为 false 时其余字段不可用于判定完整性。 */
interface FinalizationMetadata {
  trusted: boolean
  /** Step 仍在进行、尚未写入 output 的合法中间态；不是数据损坏。 */
  pending: boolean
  assistantMessageId: string | null
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
  const toolSteps = input.steps
    .filter(step => step.type === AGENT_STEP_TYPES.toolExecution)
    .sort((left, right) => left.sequence - right.sequence)
  const classifications = toolSteps.map(
    step => classifyToolStep(step, timelineById.get(step.id)),
  )
  // 无法安全确认 Tool identity 的 Step 会让「本 Run 到底发生了几次证据调用」
  // 变成未知；不得为了凑数从 summary 文本或数组位置猜测。
  const unclassifiableToolStepCount = classifications.filter(
    classification => classification === 'unclassifiable',
  ).length
  const eligibleSteps = toolSteps.filter(
    (_, index) => classifications[index] === 'eligible',
  )
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
    ? readFinalizationMetadata(finalizationStep, input.assistantMessageId)
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
  // Run 级总数只计算一次，availability 与公共 contract 必须看到同一个数字。
  // 存在无法分类的 Tool Step 时，本 Run 的 Tool 集合本身就不完整：已识别调用
  // 的局部数字不是全 Run 审计总数，只能是「未知」，不能写成确定的 0。
  const candidateCount = unclassifiableToolStepCount > 0
    ? null
    : sumSourceCounts(retrievalCalls)
  const evidenceRefCount = unclassifiableToolStepCount > 0
    ? null
    : countDistinctRefs(retrievalCalls)

  return {
    availability: resolveAvailability({
      runStatus: input.runStatus,
      hasEligibleCall: eligibleSteps.length > 0,
      hasFinalizationStep: finalizationSteps.length > 0,
      groundingRowPresent,
      callsTrusted,
      callsTruncated,
      refsTruncated,
      unclassifiableToolStepCount,
      eligibleStepCount: eligibleSteps.length,
      knownFailedEligibleCount: retrievalCalls.filter(
        call => call.ok === false,
      ).length,
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
  assistantMessageId: string | null,
): AdminGroundedFinalizationStep | null {
  const metadata = readFinalizationMetadata(step, assistantMessageId)

  // 仍在进行的 Step 也是 typed 事实：input 合法就照实投影为 pending，
  // 不与「metadata 损坏」共用 Generic fallback。
  if (!metadata.trusted && !metadata.pending)
    return null

  return {
    ...base,
    type: AGENT_STEP_TYPES.groundedFinalization,
    assistantMessageId: metadata.assistantMessageId,
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

type ToolStepClassification = 'eligible' | 'not_eligible' | 'unclassifiable'

/**
 * 判定一次 Tool 执行是否属于证据链。
 *
 * 唯一依据是持久化的 typed identity（`toolName` + `toolVersion`）与 Tool Definition
 * 声明的 evidence policy。既不从 summary 文本、数组位置或标题猜测，也不因为
 * Step 状态是 COMPLETED 就假设它成功产出了证据。
 *
 * identity 读不出来时返回 `unclassifiable`：这时「本 Run 发生了几次证据调用」
 * 是未知的，Inspector 不能再声明审计完整。
 */
function classifyToolStep(
  step: AdminRetrievalStepRecord,
  item: AdminRunTimelineItem | undefined,
): ToolStepClassification {
  const known = item?.kind === 'known'
    && item.type === AGENT_STEP_TYPES.toolExecution
    ? item
    : null
  const input = readObject(step.input)
  const toolName = known?.toolName
    ?? (typeof input?.toolName === 'string' && input.toolName.trim().length > 0
      ? input.toolName
      : null)
  const toolVersion = known?.toolVersion
    ?? (typeof input?.toolVersion === 'string' && input.toolVersion.trim().length > 0
      ? input.toolVersion
      : null)

  // 版本缺失、版本漂移或工具名未注册都不是「已确认的 discovery-only」，
  // 而是 identity 不完整：不能默认按不参与证据链处理。
  if (toolName === null || toolVersion === null)
    return 'unclassifiable'

  const policy = TOOL_EVIDENCE_POLICIES.get(
    toToolIdentity(toolName, toolVersion),
  )

  if (policy === undefined)
    return 'unclassifiable'

  return policy === 'eligible' ? 'eligible' : 'not_eligible'
}

function toToolIdentity(name: string, version: string): string {
  return `${name}@${version}`
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
  // Runtime 只在 `toolResult.ok === true` 时才生成并持久化 toolSummary。
  // 失败或结果未记录的调用带着 summary，说明数据被改写过：即便结构合法也
  // 一律不采信，否则伪造的 candidate / refs 会混进证据链。
  const summaryAllowed = known?.ok === true
  const summary = hasToolSummary && summaryAllowed
    ? readToolSummary(output.toolSummary)
    : null
  // 四种情况必须分开：base metadata 损坏（不可信）、成功但工具本就没有提交
  // summary（可信但无计数）、成功且 summary 合法（可信）、
  // summary 出现在不该出现的位置或不合法（不可信）。
  const metadataTrusted = known !== null
    && (!hasToolSummary || (summaryAllowed && summary !== null))
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

/**
 * 严格读取 finalization Step 的 typed metadata。
 *
 * 校验按真实 Runtime 状态机展开（`runGroundedFinalization` +
 * `toFinalizationStepOutput`），而不是只做字段类型检查：
 *
 * - 成功 attempt 必然是最后一条（`runGroundedFinalization` 成功即 return）；
 * - sampling 故障 attempt 必然是最后一条（立即抛 `GroundedFinalizationSamplingError`）；
 * - Grounding block 只在 durable 投影成功后写入，此时最后一条 attempt 必须成功；
 * - 引用校验通过后 replay / commit / terminalization 仍可能失败，
 *   因此 Grounding block 允许与 `finalization_incomplete` 共存；
 * - `validated` 输出未能通过 durable 投影时会以 `schema_invalid` 收口，
 *   这是唯一一种「有成功 attempt 却仍是 validation_failed」的合法路径。
 *
 * 任意不变量不成立即整份 metadata 不可信，绝不静默升级成完整成功。
 */
function readFinalizationMetadata(
  step: AdminRetrievalStepRecord,
  runAssistantMessageId: string | null,
): FinalizationMetadata {
  const untrusted: FinalizationMetadata = {
    trusted: false,
    pending: false,
    assistantMessageId: null,
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
  // Runtime 在 startStep 就写入完整 Registry 快照与归属；缺任意一项都说明这份
  // finalization 不是当前 schema 下的真实记录。
  const registryInput = readFinalizationInput(step.input, runAssistantMessageId)

  if (!registryInput)
    return untrusted

  // Recorder 的每一次 output 写入都与终态 status 在同一条 update 里发生
  // （`startStep` 只写 input）。因此「尚未收口的 Step 却已经有 output」
  // 是不可能的持久化状态，必须在解析之前就整份拒绝，而不是先解析再降级。
  if (isUnfinishedStep(step.status)) {
    if (step.output !== null)
      return untrusted

    return {
      ...untrusted,
      pending: true,
      assistantMessageId: registryInput.assistantMessageId,
      evidenceAvailability: registryInput.evidenceAvailability,
      registryRefCount: registryInput.registryRefCount,
      registryTruncated: registryInput.registryTruncated,
    }
  }

  const output = readObject(step.output)

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
  if (
    registryInput.evidenceAvailability !== evidenceAvailability
    || registryInput.registryRefCount !== registryRefCount
    || registryInput.registryTruncated !== registryTruncated
  ) {
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
    || !isConsistentFailureCategory({
      failureReason,
      rejectionCode,
      samplingFailure,
    })
  ) {
    return untrusted
  }

  if (!isConsistentFinalizationOutcome({
    attempts,
    citationCount: hasGroundingBlock ? citationCount : null,
    failureReason,
    hasGroundingBlock,
    rejectionCode,
    samplingFailure,
    status: step.status,
  })) {
    return untrusted
  }

  return {
    trusted: true,
    pending: false,
    assistantMessageId: registryInput.assistantMessageId,
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

interface FinalizationInputFacts {
  assistantMessageId: string
  evidenceAvailability: MessageEvidenceAvailability
  registryRefCount: number
  registryTruncated: boolean
}

/**
 * finalization Step 的 input 是当前 schema 下的必要事实，不是可选装饰。
 *
 * 缺失、类型非法或 `assistantMessageId` 不属于本 Run 时一律返回 `null`：
 * 归属不明的 finalization 不能被当作这次 Run 的审计依据。
 */
function readFinalizationInput(
  value: unknown,
  runAssistantMessageId: string | null,
): FinalizationInputFacts | null {
  const input = readObject(value)

  if (!input)
    return null

  const assistantMessageId = readBoundedString(
    input.assistantMessageId,
    MAX_IDENTIFIER_CHARS,
  )
  const evidenceAvailability = readAllowedString(
    input,
    'evidenceAvailability',
    EVIDENCE_AVAILABILITIES,
  )
  const registryRefCount = readNonNegativeInteger(input, 'registryRefCount')
  const registryTruncated = readBoolean(input, 'registryTruncated')

  if (
    assistantMessageId === null
    || evidenceAvailability === null
    || registryRefCount === null
    || registryTruncated === null
    || runAssistantMessageId === null
    || assistantMessageId !== runAssistantMessageId
  ) {
    return null
  }

  return {
    assistantMessageId,
    evidenceAvailability,
    registryRefCount,
    registryTruncated,
  }
}

function isUnfinishedStep(status: AgentStepStatus): boolean {
  return status === 'PENDING' || status === 'RUNNING'
}

/**
 * 顶层失败类别与其安全子类别的唯一合法矩阵。
 *
 * 三条收口路径互斥且各自只携带自己的类别字段：
 * `GroundedFinalizationFailedError` 只带 rejectionCode，
 * `GroundedFinalizationSamplingError` 只带 samplingFailure，
 * 其它中断两者都不带。因此这里既检查必填，也检查其余类别必须为空。
 */
function isConsistentFailureCategory(input: {
  failureReason: AdminGroundedFinalizationFailureReason | null
  rejectionCode: AdminGroundedAnswerRejectionCode | null
  samplingFailure: AdminGroundedFinalizationSamplingFailure | null
}): boolean {
  switch (input.failureReason) {
    case 'validation_failed':
      return input.rejectionCode !== null && input.samplingFailure === null

    case 'sampling_incomplete':
      return input.samplingFailure !== null && input.rejectionCode === null

    case 'finalization_incomplete':
    case null:
      return input.rejectionCode === null && input.samplingFailure === null
  }
}

interface FinalizationOutcomeInput {
  attempts: FinalizationAttemptAggregate
  citationCount: number | null
  failureReason: AdminGroundedFinalizationFailureReason | null
  hasGroundingBlock: boolean
  rejectionCode: AdminGroundedAnswerRejectionCode | null
  samplingFailure: AdminGroundedFinalizationSamplingFailure | null
  status: AgentStepStatus
}

/**
 * attempt 状态机与顶层收口结果的一致性。
 *
 * 这里拦截的是「结构合法但 Runtime 不可能产生」的组合，例如 0 次 attempt 却
 * 声称回答已通过引用校验，或唯一一次 attempt 失败却带着完整 Grounding block。
 */
function isConsistentFinalizationOutcome(
  input: FinalizationOutcomeInput,
): boolean {
  const { attempts } = input
  const last = attempts.entries.at(-1)

  // finalization Step 只有走 `completeRun` 的成功提交路径才会变成 COMPLETED，
  // 而那条路径写入的 output 必然带 Grounding block、不带 failureReason，
  // 且对应一次成功的 attempt。
  if (input.status === 'COMPLETED'
    && (input.failureReason !== null || !input.hasGroundingBlock)) {
    return false
  }

  if (input.hasGroundingBlock) {
    // Grounding block 只可能在某次 attempt 通过校验之后写入。
    if (!last || !last.ok)
      return false

    // 最终引用数不可能多于该次 attempt 实际提交的 citationKey 数（校验会去重）。
    if (
      input.citationCount !== null
      && input.citationCount > last.submittedCitationKeyCount
    ) {
      return false
    }

    // 校验已经通过，之后只可能因为 replay / commit / 终态事务失败而收口。
    return input.failureReason === null
      || input.failureReason === 'finalization_incomplete'
  }

  // 没有 Grounding block 时，成功 attempt 只可能对应 durable 投影被拒的
  // `schema_invalid` 路径；其余情况都不允许出现成功 attempt。
  if (attempts.successCount > 0) {
    return input.failureReason === 'validation_failed'
      && input.rejectionCode === 'schema_invalid'
      && last?.ok === true
  }

  switch (input.failureReason) {
    case 'validation_failed':
      // 普通内容拒绝必须真正用尽 correction 预算才会收口：`runGroundedFinalization`
      // 只在 for 循环跑满后才抛 GroundedFinalizationFailedError。
      return last !== undefined
        && attempts.entries.length === GROUNDED_FINALIZATION_MAX_ATTEMPTS
        && attempts.entries.every(entry => (
          entry.ok === false
          && entry.rejectionCode !== null
          && entry.samplingFailure === null
        ))
        && last.rejectionCode === input.rejectionCode

    case 'sampling_incomplete':
      // 采样故障立即收口：必然是最后一次 attempt，且与顶层一致。
      return last !== undefined
        && last.ok === false
        && last.samplingFailure !== null
        && last.samplingFailure === input.samplingFailure
        && last.rejectionCode === null

    case 'finalization_incomplete':
      // 模型调用前中断可以是 0 attempt。
      if (last === undefined)
        return true

      // 采样故障与成功都会走各自的收口路径，不可能落到这里。
      if (last.samplingFailure !== null || last.ok === true)
        return false

      // 最后一次是内容拒绝且预算已经用尽时，finalizer 必然抛
      // GroundedFinalizationFailedError，唯一正确的顶层类别是 validation_failed。
      return !(last.rejectionCode !== null
        && attempts.entries.length >= GROUNDED_FINALIZATION_MAX_ATTEMPTS)

    case null:
      // 既没有结论也没有失败原因：只有尚未收口的 Step 才允许。
      return isUnfinishedStep(input.status)
  }
}

function deriveEvidenceAvailability(
  registryRefCount: number,
  eligibleToolFailureCount: number,
): MessageEvidenceAvailability {
  if (registryRefCount > 0)
    return eligibleToolFailureCount > 0 ? 'partial' : 'available'

  return eligibleToolFailureCount > 0 ? 'unavailable' : 'none'
}

interface FinalizationAttemptFacts {
  attempt: number
  ok: boolean
  rejectionCode: AdminGroundedAnswerRejectionCode | null
  samplingFailure: AdminGroundedFinalizationSamplingFailure | null
  submittedCitationKeyCount: number
}

interface FinalizationAttemptAggregate {
  entries: FinalizationAttemptFacts[]
  successCount: number
  usage: AdminRunTokenUsage | null
  recordedDurationMs: number | null
}

/**
 * 读取 attempts，校验 attempt 级状态机，并做 all-or-nothing 聚合。
 *
 * attempt 级不变量直接来自 `runGroundedFinalization`：
 * - 成功 attempt 立即 return，因此最多一次成功且必然在末尾；
 * - sampling 故障立即抛出，因此带 `samplingFailure` 的 attempt 必然在末尾；
 * - 同一次 attempt 不可能既是内容拒绝又是采样故障；
 * - 成功 attempt 不带任何失败类别。
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

  const entries: FinalizationAttemptFacts[] = []
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

    const submittedCitationKeyCount = readNonNegativeInteger(
      attempt,
      'submittedCitationKeyCount',
    )

    if (submittedCitationKeyCount === null)
      return null

    const rejectionCode = Object.hasOwn(attempt, 'rejectionCode')
      ? readAllowedString(attempt, 'rejectionCode', REJECTION_CODES)
      : null
    const samplingFailure = Object.hasOwn(attempt, 'samplingFailure')
      ? readAllowedString(attempt, 'samplingFailure', SAMPLING_FAILURES)
      : null

    const previous = index > 0 ? entries[index - 1] : undefined

    if (
      (Object.hasOwn(attempt, 'rejectionCode') && rejectionCode === null)
      || (Object.hasOwn(attempt, 'samplingFailure') && samplingFailure === null)
      // 内容拒绝与采样故障是两条互斥路径。
      || (rejectionCode !== null && samplingFailure !== null)
      // 成功 attempt 不携带任何失败类别。
      || (attempt.ok === true
        && (rejectionCode !== null || samplingFailure !== null))
      // 只有 correction rejection 会继续下一次 attempt：成功、采样故障与
      // Abort / deadline 都在记录 attempt 后立即 return 或 throw。因此每个
      // 非末尾 attempt 必须恰好是一次带 rejectionCode 的内容拒绝。
      || (previous !== undefined
        && !(previous.ok === false
          && previous.rejectionCode !== null
          && previous.samplingFailure === null))
    ) {
      return null
    }

    entries.push({
      attempt: index + 1,
      ok: attempt.ok,
      rejectionCode,
      samplingFailure,
      submittedCitationKeyCount,
    })

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
    entries,
    successCount: entries.filter(entry => entry.ok).length,
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
    validation: trusted || metadata.pending
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
  // 尚未写入 output 的进行中 Step 是合法中间态，不是数据损坏。
  if (metadata.pending)
    return 'pending'

  if (!metadata.trusted)
    return 'unavailable'

  // 校验通过后 Run 才被中断的情况同时带 grounding 与 failureReason：
  // 引用校验本身确实通过了，失败原因单列，不能因此改写成 failed。
  if (metadata.outcome !== null)
    return 'passed'

  if (metadata.failureReason !== null)
    return 'failed'

  return isUnfinishedStep(status) ? 'pending' : 'unavailable'
}

function projectCitations(
  grounding: MessageGroundingV1,
  calls: AdminRetrievalCallSummary[],
): AdminGroundedCitationSummary[] {
  const refIndex = new Map<string, string[]>()

  for (const call of calls) {
    // 只有明确成功的调用才可能真正向 Evidence Registry 贡献引用。
    // 这里与 projector 的 summary 采信规则双层防守：即便未来某个 projector
    // 漂移，失败调用伪造的 refs 也无法把 Citation 变成 matched。
    if (!call.metadataTrusted || call.ok !== true || call.callId === null)
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
  /** 无法确认 Tool identity 的 tool_execution Step 数量。 */
  unclassifiableToolStepCount: number
  /** 本 Run 实际识别到的 evidence-eligible Tool Step 数量（未受投影上限裁剪）。 */
  eligibleStepCount: number
  /** 其中已经可以明确判定为失败的调用数量。 */
  knownFailedEligibleCount: number
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
    // 存在无法确认身份的 Tool 调用时，「本 Run 是否进入过检索链路」本身就未知，
    // 不能说成「未进入检索链路」。
    && input.unclassifiableToolStepCount === 0
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
    // 存在无法分类的 Tool Step 时，「本 Run 发生了几次证据调用」就是未知的。
    && input.unclassifiableToolStepCount === 0
    && finalization !== null
    && finalization.metadataTrusted
    && finalization.status === 'COMPLETED'
    && finalization.validation === 'passed'
    // 引用校验通过之后的 replay / commit / 终态失败同样不是完整成功。
    && finalization.failureReason === null
    && input.grounding !== null
    && input.citations !== null
    && input.citations.every(citation => citation.correlation === 'matched')
    // 投影出的 evidence 身份数必须等于 Registry 记录的真实数量，否则说明
    // 有 call 没有提交可审计的引用（legacy 或无 summary 的工具）。
    && input.evidenceRefCount === finalization.registryRefCount
    && isConsistentWithGrounding(finalization, input.grounding)
    && isConsistentWithToolSteps(finalization, input)

  return complete ? 'available' : 'partial'
}

/**
 * finalization 自报的证据调用统计必须与真实 AgentStep 事实吻合。
 *
 * Registry 会把「Tool 成功但 evidence 投影缺失 / 损坏」也计成失败，因此失败数
 * 只能要求不少于 Step 层面已经明确可判定的失败数，不能要求完全相等。
 */
function isConsistentWithToolSteps(
  finalization: AdminGroundedFinalizationSummary,
  input: AvailabilityInput,
): boolean {
  return finalization.eligibleToolCallCount === input.eligibleStepCount
    && finalization.eligibleToolFailureCount !== null
    && finalization.eligibleToolFailureCount >= input.knownFailedEligibleCount
    && finalization.eligibleToolFailureCount <= input.eligibleStepCount
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

/**
 * 去重后的 evidence 身份数量。
 *
 * 「成功但没有提交可审计引用」（legacy / 无 summary 的工具）与「明确失败因而
 * 没有引用」是两件事：前者数量未知，返回 `null`；后者确实是 0，可以计入。
 */
function countDistinctRefs(calls: AdminRetrievalCallSummary[]): number | null {
  const identities = new Set<string>()

  for (const call of calls) {
    if (!hasConfirmedRefs(call))
      return null

    for (const ref of call.refs)
      identities.add(toRefIdentity(ref))
  }

  return identities.size
}

/**
 * 候选总数。
 *
 * 只要有一次调用的候选数量无法从合法 typed summary 确认（timeout、执行失败、
 * legacy 无 summary、summary 损坏），整体就是未知，不能用 0 顶替。
 */
function sumSourceCounts(calls: AdminRetrievalCallSummary[]): number | null {
  let total = 0

  for (const call of calls) {
    if (!call.metadataTrusted || call.sourceCount === null)
      return null

    total += call.sourceCount
  }

  return Number.isSafeInteger(total) ? total : null
}

function hasConfirmedRefs(call: AdminRetrievalCallSummary): boolean {
  if (!call.metadataTrusted)
    return false

  // 明确失败的调用不会向 Registry 贡献任何引用，这个 0 是可确认的事实。
  return call.sourceCount !== null || call.ok === false
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
