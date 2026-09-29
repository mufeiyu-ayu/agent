import type { RunLimits, RuntimeConfigSnapshot } from './runtime-config.service.js'

/** 测试用的运行配置快照：取值等于 migration 插入的默认行，没配 Serper Key。 */
export function createRuntimeConfigSnapshot(
  overrides: Partial<Omit<RuntimeConfigSnapshot, 'limits'>> & { limits?: Partial<RunLimits> } = {},
): RuntimeConfigSnapshot {
  const { limits, ...rest } = overrides

  return {
    limits: {
      historyCandidateHardLimit: 1_000,
      maxSamplingRounds: 10,
      maxToolCalls: 8,
      runDeadlineMs: 600_000,
      ...limits,
    },
    debugCaptureModelIo: false,
    serperApiKey: { status: 'missing' },
    ...rest,
  }
}
