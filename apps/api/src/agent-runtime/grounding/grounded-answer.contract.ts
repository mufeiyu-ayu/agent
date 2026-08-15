import type { MessageGroundingOutcome } from '@agent/contracts'
import type { ModelToolSpec } from '../../llm/model-tool-spec.types.js'

/**
 * `submit_grounded_answer@1`：Evidence-backed 回答的终态结构化输出契约。
 *
 * 它不是普通业务 Tool：
 * - 不执行任何外部副作用，不进入 ToolInvocationService，不产生 Tool Result；
 * - 不消耗 action Tool budget，只在 finalization sampling 里作为 typed output channel；
 * - 只用它约束模型输出，而不是去解析 Markdown 里任意的 `[1]`。
 *
 * 选 function/tool-shaped schema 而不是宽松 JSON mode：当前 Provider adapter 已经
 * 具备 Tool Call 分片拼装与 call identity，而 JSON mode 仍可能返回空内容或被截断。
 */

export const SUBMIT_GROUNDED_ANSWER_TOOL_NAME = 'submit_grounded_answer'
export const SUBMIT_GROUNDED_ANSWER_TOOL_VERSION = '1'

/** 单次提交的回答正文字符上限，避免终态输出成为无界写入面。 */
export const GROUNDED_ANSWER_MAX_CHARS = 16_000

/** 模型可以提交的 citationKey 数量上限（去重前）。 */
export const GROUNDED_ANSWER_MAX_CITATION_KEYS = 5

/** 单个 citationKey 的字符上限；服务端生成的 key 固定为 36 字符。 */
export const GROUNDED_ANSWER_CITATION_KEY_MAX_CHARS = 64

/** 终态结构化输出 JSON 的字符上限，超过即视为格式异常。 */
export const GROUNDED_ANSWER_ARGUMENTS_MAX_CHARS = 64_000

export const GROUNDED_ANSWER_OUTCOMES = [
  'answered',
  'insufficient_evidence',
  'conflicting_evidence',
] as const satisfies readonly MessageGroundingOutcome[]

export interface SubmitGroundedAnswerInputV1 {
  answer: string
  outcome: MessageGroundingOutcome
  citationKeys: string[]
}

/** 模型可见的终态输出说明；不包含任何服务端执行能力。 */
export const submitGroundedAnswerToolSpec: ModelToolSpec = {
  name: SUBMIT_GROUNDED_ANSWER_TOOL_NAME,
  description: '提交本轮最终回答及其引用。这是本次回答唯一的提交方式，必须调用它，不要直接输出普通文本。',
  inputSchema: {
    type: 'object',
    properties: {
      answer: {
        type: 'string',
        description: `面向用户的最终回答正文，最多 ${GROUNDED_ANSWER_MAX_CHARS} 个字符。不要在正文里编造来源编号或链接。`,
      },
      outcome: {
        type: 'string',
        description: 'answered：证据足以支撑回答；insufficient_evidence：证据不足以确认，不要补全；conflicting_evidence：多个真实来源相互冲突。',
      },
      citationKeys: {
        type: 'array',
        items: { type: 'string' },
        description: `实际支撑本回答的证据 citationKey，最多 ${GROUNDED_ANSWER_MAX_CITATION_KEYS} 个；只能从提供的证据清单里原样复制，不得使用 sourceId、chunkId、slug、URL 或自编编号。`,
      },
    },
    required: ['answer', 'outcome', 'citationKeys'],
    additionalProperties: false,
  },
}

/** 校验失败的安全类别；只有它会被回传给模型，不携带内部细节或 Registry 内容。 */
export type GroundedAnswerRejectionCode
  = | 'answer_empty'
    | 'answer_too_long'
    | 'arguments_too_large'
    | 'citation_key_invalid'
    | 'citation_keys_too_many'
    | 'citation_required_for_answered'
    | 'conflicting_requires_two_sources'
    | 'citations_not_allowed_without_evidence'
    | 'malformed_json'
    | 'outcome_not_allowed_for_availability'
    | 'schema_invalid'
    | 'unknown_citation_key'

export class GroundedAnswerRejectedError extends Error {
  constructor(readonly code: GroundedAnswerRejectionCode) {
    super(`grounded answer rejected: ${code}`)
    this.name = 'GroundedAnswerRejectedError'
  }
}

/**
 * 解析模型提交的终态输出 JSON。
 *
 * 只做结构与体积校验；引用身份与 outcome/availability 的一致性由 validator 负责。
 *
 * @throws GroundedAnswerRejectedError 结构非法时抛出安全类别错误。
 */
export function parseSubmitGroundedAnswerInput(
  rawArgumentsJson: string,
): SubmitGroundedAnswerInputV1 {
  if ([...rawArgumentsJson].length > GROUNDED_ANSWER_ARGUMENTS_MAX_CHARS)
    throw new GroundedAnswerRejectedError('arguments_too_large')

  let parsed: unknown

  try {
    parsed = JSON.parse(rawArgumentsJson)
  }
  catch {
    throw new GroundedAnswerRejectedError('malformed_json')
  }

  if (!isPlainObject(parsed))
    throw new GroundedAnswerRejectedError('schema_invalid')

  const keys = Object.keys(parsed)

  if (
    keys.length !== 3
    || !keys.every(key => key === 'answer' || key === 'outcome' || key === 'citationKeys')
  ) {
    throw new GroundedAnswerRejectedError('schema_invalid')
  }

  const { answer, outcome, citationKeys } = parsed

  if (typeof answer !== 'string')
    throw new GroundedAnswerRejectedError('schema_invalid')

  if (answer.trim().length === 0)
    throw new GroundedAnswerRejectedError('answer_empty')

  if ([...answer].length > GROUNDED_ANSWER_MAX_CHARS)
    throw new GroundedAnswerRejectedError('answer_too_long')

  if (
    typeof outcome !== 'string'
    || !(GROUNDED_ANSWER_OUTCOMES as readonly string[]).includes(outcome)
  ) {
    throw new GroundedAnswerRejectedError('schema_invalid')
  }

  if (!Array.isArray(citationKeys))
    throw new GroundedAnswerRejectedError('schema_invalid')

  if (citationKeys.length > GROUNDED_ANSWER_MAX_CITATION_KEYS)
    throw new GroundedAnswerRejectedError('citation_keys_too_many')

  for (const citationKey of citationKeys) {
    if (
      typeof citationKey !== 'string'
      || citationKey.length === 0
      || citationKey.length > GROUNDED_ANSWER_CITATION_KEY_MAX_CHARS
    ) {
      throw new GroundedAnswerRejectedError('citation_key_invalid')
    }
  }

  return {
    answer,
    outcome: outcome as MessageGroundingOutcome,
    citationKeys: citationKeys as string[],
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false

  const prototype = Object.getPrototypeOf(value)

  return prototype === Object.prototype || prototype === null
}
