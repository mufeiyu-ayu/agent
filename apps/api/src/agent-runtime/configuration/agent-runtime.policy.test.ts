import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import {
  AgentRuntimePolicyError,
  DEFAULT_AGENT_RUNTIME_POLICY,
  resolveAgentRuntimePolicy,
} from './agent-runtime.policy.js'

describe('resolveAgentRuntimePolicy', () => {
  it('缺省时使用 50/1000 candidate policy、3 轮 sampling、2 次工具和 600 秒 Run deadline', () => {
    assert.deepEqual(resolveAgentRuntimePolicy({}), DEFAULT_AGENT_RUNTIME_POLICY)
    assert.deepEqual(DEFAULT_AGENT_RUNTIME_POLICY, {
      historyCandidateBatchSize: 50,
      historyCandidateHardLimit: 1_000,
      maxSamplingRounds: 3,
      maxToolCalls: 2,
      runDeadlineMs: 600_000,
    })
  })

  it('接受合法覆盖和零次工具调用', () => {
    assert.deepEqual(resolveAgentRuntimePolicy({
      SEO_CHAT_HISTORY_CANDIDATE_BATCH_SIZE: '100',
      SEO_CHAT_HISTORY_CANDIDATE_HARD_LIMIT: '500',
      AGENT_MAX_SAMPLING_ROUNDS: '4',
      AGENT_MAX_TOOL_CALLS: '3',
      AGENT_RUN_DEADLINE_MS: '2147483647',
    }), {
      historyCandidateBatchSize: 100,
      historyCandidateHardLimit: 500,
      maxSamplingRounds: 4,
      maxToolCalls: 3,
      runDeadlineMs: 2_147_483_647,
    })
    assert.deepEqual(resolveAgentRuntimePolicy({
      AGENT_MAX_SAMPLING_ROUNDS: '1',
      AGENT_MAX_TOOL_CALLS: '0',
    }), {
      historyCandidateBatchSize: 50,
      historyCandidateHardLimit: 1_000,
      maxSamplingRounds: 1,
      maxToolCalls: 0,
      runDeadlineMs: 600_000,
    })
  })

  it('拒绝空值、小数、非安全整数和超出范围的配置', () => {
    const invalidValuesByName = {
      SEO_CHAT_HISTORY_CANDIDATE_BATCH_SIZE: ['', '0', '1', '49', '-1', '1.5', 'NaN', 'Infinity', '1001'],
      SEO_CHAT_HISTORY_CANDIDATE_HARD_LIMIT: ['', '0', '1', '49', '-1', '1.5', 'NaN', 'Infinity', '1001'],
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

  it('要求 candidate batch size 不大于 hard limit', () => {
    assert.throws(
      () => resolveAgentRuntimePolicy({
        SEO_CHAT_HISTORY_CANDIDATE_BATCH_SIZE: '51',
        SEO_CHAT_HISTORY_CANDIDATE_HARD_LIMIT: '50',
      }),
      error => error instanceof AgentRuntimePolicyError
        && error.message.includes('SEO_CHAT_HISTORY_CANDIDATE_BATCH_SIZE')
        && error.message.includes('SEO_CHAT_HISTORY_CANDIDATE_HARD_LIMIT'),
    )
  })

  it('旧 SEO_CHAT_HISTORY_LIMIT 不再参与 candidate 或最终选择配置', () => {
    assert.deepEqual(
      resolveAgentRuntimePolicy({ SEO_CHAT_HISTORY_LIMIT: '1' }),
      DEFAULT_AGENT_RUNTIME_POLICY,
    )
  })
})
