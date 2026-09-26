import assert from 'node:assert/strict'
import { describe, it } from 'vitest'

import {
  AgentRuntimePolicyError,
  DEFAULT_AGENT_RUNTIME_POLICY,
  resolveAgentRuntimePolicy,
} from './agent-runtime.policy.js'

describe('resolveAgentRuntimePolicy', () => {
  it('缺省时使用 1000 条 candidate hard limit、10 轮 sampling、8 次工具和 600 秒 Run deadline', () => {
    assert.deepEqual(resolveAgentRuntimePolicy({}), DEFAULT_AGENT_RUNTIME_POLICY)
    assert.deepEqual(DEFAULT_AGENT_RUNTIME_POLICY, {
      historyCandidateHardLimit: 1_000,
      maxSamplingRounds: 10,
      maxToolCalls: 8,
      runDeadlineMs: 600_000,
    })
  })

  it('接受合法覆盖和零次工具调用', () => {
    assert.deepEqual(resolveAgentRuntimePolicy({
      AGENT_HISTORY_CANDIDATE_HARD_LIMIT: '500',
      AGENT_MAX_SAMPLING_ROUNDS: '4',
      AGENT_MAX_TOOL_CALLS: '3',
      AGENT_RUN_DEADLINE_MS: '2147483647',
    }), {
      historyCandidateHardLimit: 500,
      maxSamplingRounds: 4,
      maxToolCalls: 3,
      runDeadlineMs: 2_147_483_647,
    })
    assert.deepEqual(resolveAgentRuntimePolicy({
      AGENT_MAX_SAMPLING_ROUNDS: '1',
      AGENT_MAX_TOOL_CALLS: '0',
    }), {
      historyCandidateHardLimit: 1_000,
      maxSamplingRounds: 1,
      maxToolCalls: 0,
      runDeadlineMs: 600_000,
    })
  })

  it('拒绝空值、小数、非安全整数和超出范围的配置', () => {
    const invalidValuesByName = {
      AGENT_HISTORY_CANDIDATE_HARD_LIMIT: ['', '0', '1', '49', '-1', '1.5', 'NaN', 'Infinity', '1001'],
      AGENT_MAX_SAMPLING_ROUNDS: ['', '0', '-1', '1.5', 'NaN', 'Infinity', '9007199254740992'],
      AGENT_MAX_TOOL_CALLS: ['', '-1', '1.5', 'NaN', 'Infinity', '9007199254740992'],
      AGENT_RUN_DEADLINE_MS: ['', '0', '-1', '1.5', 'NaN', 'Infinity', '2147483648'],
    } satisfies Record<string, string[]>

    for (const [name, values] of Object.entries(invalidValuesByName)) {
      for (const value of values) {
        assert.throws(
          () => resolveAgentRuntimePolicy({ [name]: value }),
          error => error instanceof AgentRuntimePolicyError
            && error.message.includes(name),
        )
      }
    }
  })

  it('两个上限相互独立：maxToolCalls 大于等于 maxSamplingRounds 也可以启动', () => {
    for (const [rounds, calls] of [['2', '2'], ['2', '3'], ['1', '8']]) {
      assert.deepEqual(resolveAgentRuntimePolicy({
        AGENT_MAX_SAMPLING_ROUNDS: rounds,
        AGENT_MAX_TOOL_CALLS: calls,
      }), {
        historyCandidateHardLimit: 1_000,
        maxSamplingRounds: Number(rounds),
        maxToolCalls: Number(calls),
        runDeadlineMs: 600_000,
      })
    }
  })

  it('旧 SEO_CHAT_HISTORY_LIMIT / SEO_CHAT_HISTORY_CANDIDATE_HARD_LIMIT 不再读取', () => {
    assert.deepEqual(
      resolveAgentRuntimePolicy({
        SEO_CHAT_HISTORY_LIMIT: '1',
        SEO_CHAT_HISTORY_CANDIDATE_HARD_LIMIT: '500',
      }),
      DEFAULT_AGENT_RUNTIME_POLICY,
    )
  })
})
