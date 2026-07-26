import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import {
  DEFAULT_AGENT_RUNTIME_POLICY,
  resolveAgentRuntimePolicy,
} from './agent-runtime.policy.js'

describe('resolveAgentRuntimePolicy', () => {
  it('缺省时使用最近 40 条历史消息', () => {
    assert.deepEqual(resolveAgentRuntimePolicy({}), DEFAULT_AGENT_RUNTIME_POLICY)
    assert.equal(DEFAULT_AGENT_RUNTIME_POLICY.historyLimit, 40)
  })

  it('接受边界内覆盖并拒绝非法或过大的历史条数', () => {
    assert.equal(
      resolveAgentRuntimePolicy({ SEO_CHAT_HISTORY_LIMIT: '1000' }).historyLimit,
      1_000,
    )

    for (const value of ['', '0', '-1', '1.5', '1e2', '1001']) {
      assert.throws(
        () => resolveAgentRuntimePolicy({ SEO_CHAT_HISTORY_LIMIT: value }),
        /SEO_CHAT_HISTORY_LIMIT/,
      )
    }
  })
})
