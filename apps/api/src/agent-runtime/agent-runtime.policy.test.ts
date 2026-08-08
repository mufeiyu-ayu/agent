import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import {
  AgentRuntimePolicyError,
  DEFAULT_AGENT_RUNTIME_POLICY,
  resolveAgentRuntimePolicy,
} from './agent-runtime.policy.js'

describe('resolveAgentRuntimePolicy', () => {
  it('缺省时使用 40 条历史、3 轮 sampling、2 次工具和 600 秒 Run deadline', () => {
    assert.deepEqual(resolveAgentRuntimePolicy({}), DEFAULT_AGENT_RUNTIME_POLICY)
    assert.deepEqual(DEFAULT_AGENT_RUNTIME_POLICY, {
      historyLimit: 40,
      maxSamplingRounds: 3,
      maxToolCalls: 2,
      runDeadlineMs: 600_000,
    })
  })

  it('接受合法覆盖和零次工具调用', () => {
    assert.deepEqual(resolveAgentRuntimePolicy({
      SEO_CHAT_HISTORY_LIMIT: '1000',
      AGENT_MAX_SAMPLING_ROUNDS: '4',
      AGENT_MAX_TOOL_CALLS: '3',
      AGENT_RUN_DEADLINE_MS: '2147483647',
    }), {
      historyLimit: 1_000,
      maxSamplingRounds: 4,
      maxToolCalls: 3,
      runDeadlineMs: 2_147_483_647,
    })
    assert.deepEqual(resolveAgentRuntimePolicy({
      AGENT_MAX_SAMPLING_ROUNDS: '1',
      AGENT_MAX_TOOL_CALLS: '0',
    }), {
      historyLimit: 40,
      maxSamplingRounds: 1,
      maxToolCalls: 0,
      runDeadlineMs: 600_000,
    })
  })

  it('拒绝非法十进制整数、非安全整数和超出计时器范围的 deadline', () => {
    const invalidValuesByName = {
      SEO_CHAT_HISTORY_LIMIT: ['', '0', '-1', '1.5', '1e2', 'NaN', 'Infinity', '1001'],
      AGENT_MAX_SAMPLING_ROUNDS: ['', '0', '-1', '1.5', '1e2', 'NaN', 'Infinity', '9007199254740992'],
      AGENT_MAX_TOOL_CALLS: ['', '-1', '1.5', '1e2', 'NaN', 'Infinity', '9007199254740992'],
      AGENT_RUN_DEADLINE_MS: ['', '0', '-1', '1.5', '1e2', 'NaN', 'Infinity', '2147483648'],
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

  it('要求 maxToolCalls 严格小于 maxSamplingRounds', () => {
    for (const env of [
      {
        AGENT_MAX_SAMPLING_ROUNDS: '2',
        AGENT_MAX_TOOL_CALLS: '2',
      },
      {
        AGENT_MAX_SAMPLING_ROUNDS: '2',
        AGENT_MAX_TOOL_CALLS: '3',
      },
    ]) {
      assert.throws(
        () => resolveAgentRuntimePolicy(env),
        error => error instanceof AgentRuntimePolicyError
          && error.message.includes('AGENT_MAX_TOOL_CALLS')
          && error.message.includes('AGENT_MAX_SAMPLING_ROUNDS'),
      )
    }
  })
})
