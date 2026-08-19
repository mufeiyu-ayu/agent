import type { ModelStreamEvent } from '../../llm/model-stream.types.js'
import type { ToolEvidenceRef } from '../../tools/core/tool-evidence.js'
import type { GroundedFinalizationAttemptSummary } from './grounded-answer.finalizer.js'
import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，不为 finalizer 引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import {
  GroundedFinalizationFailedError,
  GroundedFinalizationSamplingError,
  runGroundedFinalization,
} from './grounded-answer.finalizer.js'
import { RunEvidenceRegistry } from './run-evidence-registry.js'

function chunkRef(overrides: Partial<ToolEvidenceRef> = {}): ToolEvidenceRef {
  return {
    sourceId: 301,
    chunkId: 'article-301-chunk-0',
    granularity: 'chunk',
    title: 'SEO 基础',
    slug: 'seo-basics',
    languageCode: 'zh-cn',
    sectionPath: 'Section 0',
    excerpt: '候选片段',
    rank: 1,
    strategy: { name: 'hybrid_rrf', version: '1' },
    ...overrides,
  }
}

function createRegistry(): RunEvidenceRegistry {
  const registry = new RunEvidenceRegistry()

  registry.recordEligibleToolOutcome({
    toolName: 'retrieve_article_context',
    ok: true,
    evidence: { refs: [chunkRef()] },
  })

  return registry
}

async function* toModelStream(
  events: ModelStreamEvent[],
): AsyncGenerator<ModelStreamEvent> {
  for (const event of events)
    yield event
}

function submissionStream(citationKeys: string[]): ModelStreamEvent[] {
  return [
    {
      type: 'tool_call_completed',
      toolCall: {
        providerCallId: 'finalization-call',
        name: 'submit_grounded_answer',
        argumentsJson: JSON.stringify({
          answer: '基于站内资料的回答。',
          outcome: 'answered',
          citationKeys,
        }),
        index: 0,
      },
      reasoningContent: '收口最终回答。',
    },
    { type: 'usage', usage: { inputTokens: 21, outputTokens: 9, totalTokens: 30 } },
    { type: 'response_completed', finishReason: 'tool_calls' },
  ]
}

describe('runGroundedFinalization post-sampling 可用性复核', () => {
  /**
   * 模型流已经完整结束、usage 也已收到，此时用户 Abort 或 Run deadline 生效。
   *
   * 这一次模型调用是既成事实，绝不能因为紧接着的可用性复核失败而变成 0 attempt。
   */
  it('模型流成功结束后 Abort 生效时仍然记录 attempt 与 usage', async () => {
    const registry = createRegistry()
    const citationKey = registry.list()[0]!.citationKey
    const attempts: GroundedFinalizationAttemptSummary[] = []
    const abortError = new DOMException('aborted', 'AbortError')
    const sampleCalls: number[] = []
    let availabilityChecks = 0

    await assert.rejects(
      runGroundedFinalization({
        draft: '草稿',
        registry,
        assertAvailable: () => {
          availabilityChecks += 1
          // 第一次（发起调用前）通过；第二次（模型流结束后）中断。
          if (availabilityChecks >= 2)
            throw abortError
        },
        onAttempt: summary => attempts.push(summary),
        sample: () => {
          sampleCalls.push(sampleCalls.length + 1)
          return toModelStream(submissionStream([citationKey]))
        },
      }),
      (error: unknown) => {
        // 原始 Abort 必须原样抛出，不被转换成 sampling failure。
        assert.equal(error, abortError)
        assert.equal(error instanceof GroundedFinalizationSamplingError, false)
        return true
      },
    )

    assert.equal(attempts.length, 1)

    const [attempt] = attempts

    assert.equal(attempt?.attempt, 1)
    assert.equal(attempt?.ok, false)
    assert.deepEqual(attempt?.usage, {
      inputTokens: 21,
      outputTokens: 9,
      totalTokens: 30,
    })
    assert.equal(attempt?.submittedCitationKeyCount, 0)
    assert.equal(typeof attempt?.durationMs, 'number')
    // 既不是模型内容错误，也不是流故障。
    assert.equal(attempt?.rejectionCode, undefined)
    assert.equal(attempt?.samplingFailure, undefined)
    // 不消耗 correction：没有第二次模型调用。
    assert.deepEqual(sampleCalls, [1])
  })

  it('模型流成功结束后 deadline 生效时行为一致', async () => {
    const registry = createRegistry()
    const citationKey = registry.list()[0]!.citationKey
    const attempts: GroundedFinalizationAttemptSummary[] = []
    const deadlineError = new Error('Agent Run 已达到执行时限。')
    let availabilityChecks = 0
    let sampleCount = 0

    await assert.rejects(
      runGroundedFinalization({
        draft: '草稿',
        registry,
        assertAvailable: () => {
          availabilityChecks += 1
          if (availabilityChecks >= 2)
            throw deadlineError
        },
        onAttempt: summary => attempts.push(summary),
        sample: () => {
          sampleCount += 1
          return toModelStream(submissionStream([citationKey]))
        },
      }),
      (error: unknown) => {
        assert.equal(error, deadlineError)
        return true
      },
    )

    assert.equal(attempts.length, 1)
    assert.equal(attempts[0]?.ok, false)
    assert.deepEqual(attempts[0]?.usage, {
      inputTokens: 21,
      outputTokens: 9,
      totalTokens: 30,
    })
    assert.equal(sampleCount, 1)
  })

  it('模型调用发起前 Abort 时不记录任何 attempt', async () => {
    const registry = createRegistry()
    const attempts: GroundedFinalizationAttemptSummary[] = []
    const abortError = new DOMException('aborted', 'AbortError')
    let sampleCount = 0

    await assert.rejects(
      runGroundedFinalization({
        draft: '草稿',
        registry,
        assertAvailable: () => {
          throw abortError
        },
        onAttempt: summary => attempts.push(summary),
        sample: () => {
          sampleCount += 1
          return toModelStream([])
        },
      }),
      (error: unknown) => {
        assert.equal(error, abortError)
        return true
      },
    )

    assert.deepEqual(attempts, [])
    assert.equal(sampleCount, 0)
  })

  it('可用性一直正常时正常返回，并只记录一条成功 attempt', async () => {
    const registry = createRegistry()
    const citationKey = registry.list()[0]!.citationKey
    const attempts: GroundedFinalizationAttemptSummary[] = []

    const result = await runGroundedFinalization({
      draft: '草稿',
      registry,
      assertAvailable: () => {},
      onAttempt: summary => attempts.push(summary),
      sample: () => toModelStream(submissionStream([citationKey])),
    })

    assert.equal(result.validated.grounding.outcome, 'answered')
    assert.equal(attempts.length, 1)
    assert.equal(attempts[0]?.ok, true)
    assert.equal(attempts[0]?.submittedCitationKeyCount, 1)
  })
})

describe('runGroundedFinalization 模型不服从（正常 stop、未调用提交工具）', () => {
  function plainTextStream(): ModelStreamEvent[] {
    return [
      { type: 'text_delta', delta: '我直接用普通文本回答了。' },
      { type: 'usage', usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8 } },
      { type: 'response_completed', finishReason: 'stop' },
    ]
  }

  it('首次不服从消耗 correction，第二次成功提交则正常返回', async () => {
    const registry = createRegistry()
    const citationKey = registry.list()[0]!.citationKey
    const attempts: GroundedFinalizationAttemptSummary[] = []
    const systemPrompts: string[] = []
    let sampleCount = 0

    const result = await runGroundedFinalization({
      draft: '草稿',
      registry,
      assertAvailable: () => {},
      onAttempt: summary => attempts.push(summary),
      sample: (items) => {
        sampleCount += 1
        systemPrompts.push((items[0] as { content: string }).content)

        return sampleCount === 1
          ? toModelStream(plainTextStream())
          : toModelStream(submissionStream([citationKey]))
      },
    })

    assert.equal(result.validated.grounding.outcome, 'answered')
    assert.equal(sampleCount, 2)
    assert.equal(attempts.length, 2)
    // 不服从是「模型说错了」：记 rejectionCode，不是 samplingFailure。
    assert.equal(attempts[0]?.ok, false)
    assert.equal(attempts[0]?.rejectionCode, 'submission_missing')
    assert.equal(attempts[0]?.samplingFailure, undefined)
    // 真实发生的调用用量不丢。
    assert.deepEqual(attempts[0]?.usage, {
      inputTokens: 5,
      outputTokens: 3,
      totalTokens: 8,
    })
    assert.equal(attempts[1]?.ok, true)
    // correction prompt 必须点名「没有调用提交工具」而不是泛化的校验失败。
    assert.match(systemPrompts[1] ?? '', /没有调用提交工具/)
  })

  it('correction 后仍不服从时按校验失败收口，保留两条 attempt', async () => {
    const registry = createRegistry()
    const attempts: GroundedFinalizationAttemptSummary[] = []
    let sampleCount = 0

    await assert.rejects(
      runGroundedFinalization({
        draft: '草稿',
        registry,
        assertAvailable: () => {},
        onAttempt: summary => attempts.push(summary),
        sample: () => {
          sampleCount += 1
          return toModelStream(plainTextStream())
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof GroundedFinalizationFailedError)
        assert.equal(error.rejectionCode, 'submission_missing')
        assert.equal(error.attempts.length, 2)
        return true
      },
    )

    assert.equal(sampleCount, 2)
    assert.deepEqual(
      attempts.map(attempt => attempt.rejectionCode),
      ['submission_missing', 'submission_missing'],
    )
  })

  it('stop 但存在提交调用时仍按采样故障收口，不消耗 correction', async () => {
    const registry = createRegistry()
    const citationKey = registry.list()[0]!.citationKey
    const attempts: GroundedFinalizationAttemptSummary[] = []
    let sampleCount = 0

    await assert.rejects(
      runGroundedFinalization({
        draft: '草稿',
        registry,
        assertAvailable: () => {},
        onAttempt: summary => attempts.push(summary),
        sample: () => {
          sampleCount += 1

          const events = submissionStream([citationKey]).map(event => (
            event.type === 'response_completed'
              ? { ...event, finishReason: 'stop' as const }
              : event
          ))

          return toModelStream(events)
        },
      }),
      (error: unknown) => {
        assert.ok(error instanceof GroundedFinalizationSamplingError)
        assert.equal(error.failure, 'unexpected_finish_reason')
        return true
      },
    )

    assert.equal(sampleCount, 1)
    assert.equal(attempts[0]?.samplingFailure, 'unexpected_finish_reason')
  })
})
