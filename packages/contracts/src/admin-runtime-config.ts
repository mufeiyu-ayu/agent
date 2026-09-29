/**
 * 管理台「运行配置」的读写契约（Issue #216）：全站只有一份，每次问答开始时读一次作为快照。
 * 数值上下限由服务端 DTO 校验，管理台表单用同一组常量做前置校验。
 */

/** 各项的闭区间；上限受 PostgreSQL INTEGER 与 Node 定时器上限（2^31 − 1）约束。 */
export const RUNTIME_CONFIG_LIMITS = {
  maxSamplingRounds: { min: 1, max: 2_147_483_647 },
  maxToolCalls: { min: 0, max: 2_147_483_647 },
  runDeadlineMs: { min: 1, max: 2_147_483_647 },
  historyCandidateHardLimit: { min: 50, max: 1_000 },
} as const

export interface AdminRuntimeConfig {
  /** 单次问答最多调用模型几轮。 */
  maxSamplingRounds: number
  /** 单次问答最多执行几次工具调用，按 call 计；0 表示不给模型工具。 */
  maxToolCalls: number
  /** 单次问答正常执行阶段的最长时间，单位毫秒。 */
  runDeadlineMs: number
  /** 一次查询最多读取的历史候选条数。 */
  historyCandidateHardLimit: number
  /** 是否抓取模型原始请求 / 响应 JSON。 */
  debugCaptureModelIo: boolean
  /** Serper API Key 的尾四位；没配为 null，明文永不返回。 */
  serperApiKeyLast4: string | null
  updatedAt: string
}

export interface AdminRuntimeConfigInput {
  maxSamplingRounds: number
  maxToolCalls: number
  runDeadlineMs: number
  historyCandidateHardLimit: number
  debugCaptureModelIo: boolean
  /** 省略或空串表示不改。 */
  serperApiKey?: string
}
