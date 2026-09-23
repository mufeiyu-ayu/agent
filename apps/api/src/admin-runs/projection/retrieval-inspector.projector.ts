import type {
  AdminGroundedCitationSummary,
  AdminGroundedFinalizationStep,
  AdminRetrievalCallSummary,
  AdminRetrievalInspector,
  AdminRetrievalSourceRef,
  AdminRetrievalStrategy,
  AdminRunKnownTimelineItemBase,
  MessageGroundingV1,
} from '@agent/contracts'
import type { PersistedMessageGrounding } from '../../agent-runtime/grounding/message-grounding.projector.js'
import {
  ADMIN_GROUNDED_ANSWER_REJECTION_CODES,
  ADMIN_GROUNDED_FINALIZATION_FAILURE_REASONS,
  ADMIN_GROUNDED_FINALIZATION_SAMPLING_FAILURES,
  MESSAGE_EVIDENCE_AVAILABILITIES,
  MESSAGE_GROUNDING_OUTCOMES,
} from '@agent/contracts'

import { toOwnedMessageGroundingV1 } from '../../agent-runtime/grounding/message-grounding.projector.js'
import { AGENT_STEP_TYPES } from '../../agent-runtime/lifecycle/agent-run-recorder.service.js'
import { TOOL_DEFINITIONS } from '../../tools/tool-definitions.js'
import {
  readAllowedString,
  readBoolean,
  readNonNegativeInteger,
  readObject,
  readString,
  readText,
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
 * 字段能读就读，读不出就 null；参数只取 `query`，excerpt、embedding、Provider payload、
 * 内部 `citationKey` 一律不进入这里。参数与 observation 原文在 timeline 的 tool Step 上。
 */

const MAX_QUERY_CHARS = 200
const MAX_TITLE_CHARS = 200
const MAX_SECTION_PATH_CHARS = 200
const MAX_CHUNK_ID_CHARS = 200
const MAX_STRATEGY_NAME_CHARS = 64
const MAX_STRATEGY_VERSION_CHARS = 32
const MAX_LANGUAGE_CODE_CHARS = 32

export interface AdminRetrievalStepRecord {
  id: string
  sequence: number
  type: string
  input: unknown
  output: unknown
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
    // evidence-eligible 的唯一事实来源是 Tool Definition 自己声明的 policy，Admin 不另抄一份。
    .filter(({ input: toolInput }) => {
      const toolName = readString(toolInput, 'toolName')
      return TOOL_DEFINITIONS.find(definition => definition.name === toolName)
        ?.evidencePolicy === 'eligible'
    })
    .map(({ step, input: toolInput }) => ({
      callId: readString(toolInput, 'callId'),
      summary: projectRetrievalCall(step, toolInput),
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

/**
 * `grounded_finalization` 的 typed timeline 投影：逐字段读取 output；`base` 由调用方的 `knownStepBase()` 算好。
 * availability 与引用数在 Step 开始时已写进 input，RUNNING 期间 output 还没有，回退读 input。
 */
export function projectGroundedFinalizationStep(
  step: AdminRetrievalStepRecord,
  base: AdminRunKnownTimelineItemBase,
): AdminGroundedFinalizationStep {
  const input = readObject(step.input)
  const output = readObject(step.output)
  const attempts = readFinalizationAttempts(step.output)

  return {
    ...base,
    type: AGENT_STEP_TYPES.groundedFinalization,
    evidenceAvailability: readAllowedString(
      output,
      'evidenceAvailability',
      MESSAGE_EVIDENCE_AVAILABILITIES,
    ) ?? readAllowedString(input, 'evidenceAvailability', MESSAGE_EVIDENCE_AVAILABILITIES),
    outcome: readAllowedString(output, 'outcome', MESSAGE_GROUNDING_OUTCOMES),
    attemptCount: readNonNegativeInteger(output, 'attemptCount'),
    registryRefCount: readNonNegativeInteger(output, 'registryRefCount')
      ?? readNonNegativeInteger(input, 'registryRefCount'),
    registryTruncated: readBoolean(output, 'registryTruncated'),
    eligibleToolCallCount: readNonNegativeInteger(output, 'eligibleToolCallCount'),
    eligibleToolFailureCount: readNonNegativeInteger(output, 'eligibleToolFailureCount'),
    failureReason: readAllowedString(
      output,
      'failureReason',
      ADMIN_GROUNDED_FINALIZATION_FAILURE_REASONS,
    ),
    rejectionCode: readAllowedString(
      output,
      'rejectionCode',
      ADMIN_GROUNDED_ANSWER_REJECTION_CODES,
    ),
    samplingFailure: readAllowedString(
      output,
      'samplingFailure',
      ADMIN_GROUNDED_FINALIZATION_SAMPLING_FAILURES,
    ),
    usage: attempts.length > 0
      ? aggregateSamplingUsage(
          attempts.map(attempt => projectTokenUsage(readObject(attempt))),
        )
      : null,
  }
}

function projectRetrievalCall(
  step: AdminRetrievalStepRecord,
  toolInput: Record<string, unknown> | null,
): AdminRetrievalCallSummary {
  const summary = readObject(readObject(step.output)?.toolSummary)

  return {
    stepId: step.id,
    query: readString(readToolArguments(toolInput), 'query', MAX_QUERY_CHARS),
    strategy: readStrategy(summary?.strategy),
    sourceCount: readNonNegativeInteger(summary, 'sourceCount'),
    chunkEvidenceCount: readNonNegativeInteger(summary, 'chunkEvidenceCount'),
    refs: readSourceRefs(summary?.sources),
  }
}

/**
 * 解析 tool Step 落库的参数 JSON 文本；未落库（旧 Run、Step 未收口）或不是 JSON 对象时为 null。
 * 未校验参数的形状是 `{"arguments": raw}`，自然读不出 query。
 */
function readToolArguments(
  toolInput: Record<string, unknown> | null,
): Record<string, unknown> | null {
  const argumentsJson = readText(toolInput, 'arguments')

  if (argumentsJson === null)
    return null

  try {
    return readObject(JSON.parse(argumentsJson))
  }
  catch {
    return null
  }
}

/**
 * 逐条读取来源身份；不是数组返回空数组，单条读不出则跳过该条。
 *
 * `chunkId` 缺省或 null 才是 article 粒度；其他读不出的值不能退化成 null，
 * 否则损坏的 chunk ref 会与同 sourceId 的 article 级 Citation 假关联。
 */
function readSourceRefs(value: unknown): AdminRetrievalSourceRef[] {
  if (!Array.isArray(value))
    return []

  const refs: AdminRetrievalSourceRef[] = []

  for (const candidate of value) {
    const object = readObject(candidate)
    const sourceId = readNonNegativeInteger(object, 'sourceId')
    const chunkId = readChunkIdentity(object)

    // sourceId 从 1 起算，0 不是合法身份。
    if (sourceId === null || sourceId === 0 || chunkId === undefined)
      continue

    refs.push({ sourceId, chunkId })
  }

  return refs
}

/**
 * `chunkId` 是身份字段，口径与 `grounding.ts` 的 Citation 一致：非空且不超过
 * `MAX_CHUNK_ID_CHARS` 的字符串原样保留，不做 preview 的空白折叠、trim 或截断，
 * 否则 `" chunk-a "`、`""`、超长 ID 会被改写成另一个能与 Citation 关联的身份。
 * 200 的上限与 `tools/core/tool-evidence.ts` 的 Registry 入口一致；调整任一处需同步。
 *
 * @returns `null` 表示 article 粒度（缺省或 null）；`undefined` 表示身份非法，调用方跳过整条 ref。
 */
function readChunkIdentity(
  object: Record<string, unknown> | null,
): string | null | undefined {
  const value = object?.chunkId

  if (value === undefined || value === null)
    return null

  return typeof value === 'string'
    && value.length > 0
    && [...value].length <= MAX_CHUNK_ID_CHARS
    ? value
    : undefined
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
