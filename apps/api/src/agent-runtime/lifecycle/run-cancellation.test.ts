import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { AgentRunDeadlineExceededError } from '../agent-runtime.errors.js'
import {
  createRunCancellation,
} from './run-cancellation.js'

describe('createRunCancellation', () => {
  it('传入已经 aborted 的 userSignal 时立即取得 user 终止权', () => {
    const userController = new AbortController()
    const reason = new Error('用户已取消')

    userController.abort(reason)
    const cancellation = createRunCancellation(userController.signal, 1_000)

    assert.equal(cancellation.source, 'user')
    assert.equal(cancellation.reason, reason)
    assert.equal(cancellation.signal.aborted, true)
    assert.equal(cancellation.signal.reason, reason)
    cancellation.dispose()
  })

  it('普通执行阶段只保留第一个终止原因', () => {
    const cancellation = createRunCancellation(undefined, 1_000)
    const failure = new Error('模型失败')

    cancellation.claimFailure(failure)
    cancellation.claimDeadline()

    assert.equal(cancellation.source, 'failure')
    assert.equal(cancellation.reason, failure)
    assert.equal(cancellation.signal.reason, failure)
    cancellation.dispose()
  })

  it('COMMIT 成功时忽略 completing 期间迟到的用户取消', () => {
    const userController = new AbortController()
    const cancellation = createRunCancellation(userController.signal, 1_000)

    cancellation.claimCompletion()
    userController.abort(new Error('COMMIT 期间取消'))

    assert.equal(cancellation.source, 'completing')
    assert.equal(cancellation.signal.aborted, false)

    cancellation.claimCompleted()

    assert.equal(cancellation.source, 'completed')
    assert.equal(cancellation.signal.aborted, false)
    cancellation.dispose()
  })

  it('COMMIT 失败时优先恢复 completing 期间先到的 deadline', () => {
    const cancellation = createRunCancellation(undefined, 1_000)
    const deadline = new AgentRunDeadlineExceededError()

    cancellation.claimCompletion()
    cancellation.claimDeadline(deadline)
    cancellation.claimCompletionFailure('failure', new Error('COMMIT 失败'))

    assert.equal(cancellation.source, 'deadline')
    assert.equal(cancellation.reason, deadline)
    assert.equal(cancellation.signal.reason, deadline)
    cancellation.dispose()
  })

  it('没有 pending 原因时使用 COMMIT 自身失败原因', () => {
    const cancellation = createRunCancellation(undefined, 1_000)
    const failure = new Error('COMMIT 失败')

    cancellation.claimCompletion()
    cancellation.claimCompletionFailure('failure', failure)

    assert.equal(cancellation.source, 'failure')
    assert.equal(cancellation.reason, failure)
    assert.equal(cancellation.signal.reason, failure)
    cancellation.dispose()
  })

  it('主动检查可以补偿尚未执行的 deadline timer', () => {
    const cancellation = createRunCancellation(undefined, 0)

    assert.throws(
      () => cancellation.throwIfUnavailable(),
      AgentRunDeadlineExceededError,
    )
    assert.equal(cancellation.source, 'deadline')
    cancellation.dispose()
  })

  it('dispose 后不再响应外部 userSignal', () => {
    const userController = new AbortController()
    const cancellation = createRunCancellation(userController.signal, 1_000)

    cancellation.dispose()
    userController.abort(new Error('已经结束'))

    assert.equal(cancellation.source, undefined)
    assert.equal(cancellation.signal.aborted, false)
  })
})
