import type { GroundedAnswerSmokeSummary } from './grounded-answer.smoke.cli.js'
import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，不为 smoke 门禁引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import {
  assertGroundedAnswerSmoke,
  emitGroundedAnswerSmokeResult,
  GroundedAnswerSmokeAssertionError,
  safeSmokeFailure,
} from './grounded-answer.smoke.cli.js'

type SmokeCase = GroundedAnswerSmokeSummary['cases'][number]

function answerableCase(overrides: Partial<SmokeCase> = {}): SmokeCase {
  return {
    scenario: 'answerable',
    queryChars: 40,
    runOutcome: 'run_completed',
    groundingSessionEstablished: true,
    answerChars: 300,
    grounding: {
      present: true,
      schemaVersion: 1,
      evidenceAvailability: 'available',
      outcome: 'answered',
      citationIntegrity: 'validated',
      faithfulnessStatus: 'not_evaluated',
      citationCount: 2,
      sourceIds: [46, 60],
      chunkIds: ['chunk-a', 'chunk-b'],
      granularities: ['chunk', 'chunk'],
    },
    deltaCount: 6,
    replayMatchesFinalContent: true,
    elapsedMs: 12_000,
    ...overrides,
  }
}

function unanswerableCase(overrides: Partial<SmokeCase> = {}): SmokeCase {
  return {
    scenario: 'unanswerable',
    queryChars: 38,
    runOutcome: 'run_completed',
    groundingSessionEstablished: true,
    answerChars: 200,
    grounding: {
      present: true,
      schemaVersion: 1,
      evidenceAvailability: 'available',
      outcome: 'insufficient_evidence',
      citationIntegrity: 'validated',
      faithfulnessStatus: 'not_evaluated',
      citationCount: 0,
      sourceIds: [],
      chunkIds: [],
      granularities: [],
    },
    deltaCount: 6,
    replayMatchesFinalContent: true,
    elapsedMs: 16_000,
    ...overrides,
  }
}

function summary(...cases: SmokeCase[]): GroundedAnswerSmokeSummary {
  return { tool: 'submit_grounded_answer@1', cases }
}

function assertRejected(value: GroundedAnswerSmokeSummary): string[] {
  try {
    assertGroundedAnswerSmoke(value)
  }
  catch (error) {
    assert.ok(error instanceof GroundedAnswerSmokeAssertionError)
    assert.ok(error.violations.length > 0)
    return error.violations
  }

  throw new Error('期望 smoke 断言失败，但它通过了')
}

describe('assertGroundedAnswerSmoke 通过条件', () => {
  it('两条场景都符合预期时通过', () => {
    assertGroundedAnswerSmoke(summary(answerableCase(), unanswerableCase()))
  })

  it('unanswerable 允许 none / unavailable 可用性', () => {
    for (const evidenceAvailability of ['none', 'unavailable'] as const) {
      assertGroundedAnswerSmoke(summary(
        answerableCase(),
        unanswerableCase({
          grounding: {
            ...unanswerableCase().grounding,
            evidenceAvailability,
          },
        }),
      ))
    }
  })
})

describe('assertGroundedAnswerSmoke 门禁条件', () => {
  it('缺少任一场景时失败', () => {
    assertRejected(summary(answerableCase()))
    assertRejected(summary(unanswerableCase()))
  })

  it('任一 case 不是 run_completed 时失败', () => {
    const violations = assertRejected(summary(
      answerableCase({ runOutcome: 'run_failed' }),
      unanswerableCase(),
    ))

    assert.match(violations.join('\n'), /runOutcome=run_failed/)
  })

  it('未建立 Grounding Session 时失败', () => {
    const violations = assertRejected(summary(
      answerableCase({ groundingSessionEstablished: false }),
      unanswerableCase(),
    ))

    assert.match(violations.join('\n'), /未建立 Grounding Session/)
  })

  it('answerable 不是 answered 时失败', () => {
    assertRejected(summary(
      answerableCase({
        grounding: {
          ...answerableCase().grounding,
          outcome: 'insufficient_evidence',
        },
      }),
      unanswerableCase(),
    ))
  })

  it('answerable 没有有效 Citation 时失败', () => {
    const violations = assertRejected(summary(
      answerableCase({
        grounding: {
          ...answerableCase().grounding,
          citationCount: 0,
          sourceIds: [],
        },
      }),
      unanswerableCase(),
    ))

    assert.match(violations.join('\n'), /没有有效 Citation/)
  })

  it('unanswerable 不是 insufficient_evidence 时失败', () => {
    assertRejected(summary(
      answerableCase(),
      unanswerableCase({
        grounding: {
          ...unanswerableCase().grounding,
          outcome: 'answered',
        },
      }),
    ))
  })

  it('citation integrity / faithfulness 状态错误时失败', () => {
    assertRejected(summary(
      answerableCase({
        grounding: {
          ...answerableCase().grounding,
          citationIntegrity: 'verified' as never,
        },
      }),
      unanswerableCase(),
    ))
    assertRejected(summary(
      answerableCase({
        grounding: {
          ...answerableCase().grounding,
          faithfulnessStatus: 'verified' as never,
        },
      }),
      unanswerableCase(),
    ))
  })

  it('schemaVersion 不是 1 时失败', () => {
    assertRejected(summary(
      answerableCase({
        grounding: { ...answerableCase().grounding, schemaVersion: 2 },
      }),
      unanswerableCase(),
    ))
  })

  it('replay 与最终内容不一致时失败', () => {
    const violations = assertRejected(summary(
      answerableCase({ replayMatchesFinalContent: false }),
      unanswerableCase(),
    ))

    assert.match(violations.join('\n'), /重放结果与最终内容不一致/)
  })

  it('缺少 Grounding 时失败', () => {
    assertRejected(summary(
      answerableCase({ grounding: { present: false } }),
      unanswerableCase(),
    ))
  })

  it('sourceId 非法时失败', () => {
    assertRejected(summary(
      answerableCase({
        grounding: { ...answerableCase().grounding, sourceIds: [0] },
      }),
      unanswerableCase(),
    ))
  })

  it('输出出现不允许的敏感字段时失败', () => {
    for (const leaked of [
      'evk_0123456789abcdef0123456789abcdef',
      'sk-live-secret-key',
      'postgresql://user:pass@localhost:5432/db',
      'SELECT * FROM "ArticleChunk"',
      '[untrusted_data:evidence_registry]',
      'reasoning_content',
      'cosineDistance',
    ]) {
      const violations = assertRejected(summary(
        answerableCase({
          grounding: {
            ...answerableCase().grounding,
            chunkIds: [leaked],
          },
        }),
        unanswerableCase(),
      ))

      assert.match(violations.join('\n'), /不允许的敏感内容/)
    }
  })
})

describe('emitGroundedAnswerSmokeResult 输出顺序', () => {
  function createSink() {
    const stdout: string[] = []
    const stderr: string[] = []

    return {
      stdout,
      stderr,
      sink: {
        stdout: (line: string) => stdout.push(line),
        stderr: (line: string) => stderr.push(line),
      },
    }
  }

  it('安全 summary：stdout 输出 summary，退出码 0', () => {
    const { stdout, stderr, sink } = createSink()
    const value = summary(answerableCase(), unanswerableCase())
    const exitCode = emitGroundedAnswerSmokeResult(value, sink)

    assert.equal(exitCode, 0)
    assert.equal(stderr.length, 0)
    assert.equal(stdout.length, 1)
    assert.deepEqual(JSON.parse(stdout[0]!), value)
  })

  it('不达标 summary：stdout 完全没有输出，stderr 只有脱敏错误，退出码 1', () => {
    const { stdout, stderr, sink } = createSink()
    const exitCode = emitGroundedAnswerSmokeResult(
      summary(answerableCase({ runOutcome: 'run_failed' }), unanswerableCase()),
      sink,
    )

    assert.equal(exitCode, 1)
    // 断言在输出之前：原始 summary 一个字节都没有进入 stdout。
    assert.equal(stdout.length, 0)
    assert.equal(stderr.length, 1)

    const failure = JSON.parse(stderr[0]!) as Record<string, unknown>

    assert.equal(failure.error, 'grounded_answer_smoke_assertion_failed')
    assert.ok(Array.isArray(failure.violations))
  })

  it('敏感内容绝不会先写入 stdout 或日志', () => {
    const leaks: Array<[string, string]> = [
      ['citationKey', 'evk_0123456789abcdef0123456789abcdef'],
      ['apiKey', 'sk-live-secret-key'],
      ['connectionString', 'postgresql://user:pass@localhost:5432/db'],
      ['sql', 'SELECT * FROM "ArticleChunk"'],
      ['prompt', '[untrusted_data:evidence_registry]'],
      ['reasoning', 'reasoning_content'],
    ]

    for (const [name, leaked] of leaks) {
      const { stdout, stderr, sink } = createSink()
      const exitCode = emitGroundedAnswerSmokeResult(
        summary(
          answerableCase({
            grounding: { ...answerableCase().grounding, chunkIds: [leaked] },
          }),
          unanswerableCase(),
        ),
        sink,
      )

      assert.equal(exitCode, 1, name)
      assert.equal(stdout.length, 0, `${name} 不得先输出 summary`)
      assert.equal(stderr.length, 1, name)
      assert.equal(
        stderr[0]!.includes(leaked),
        false,
        `${name} 不得出现在 stderr`,
      )
    }
  })
})

describe('safeSmokeFailure', () => {
  it('断言失败时返回脱敏的 violations', () => {
    const error = new GroundedAnswerSmokeAssertionError(['[answerable] outcome=answered'])
    const failure = safeSmokeFailure(error)

    assert.equal(failure.error, 'grounded_answer_smoke_assertion_failed')
    assert.deepEqual(failure.violations, ['[answerable] outcome=answered'])
  })

  it('其它错误不泄漏原始信息', () => {
    const failure = safeSmokeFailure(
      new Error('postgresql://user:secret@localhost:5432/db'),
    )

    assert.equal(failure.error, 'grounded_answer_smoke_failed')
    assert.doesNotMatch(JSON.stringify(failure), /postgresql|secret/)
  })

  it('中断被单独标记', () => {
    const aborted = new Error('aborted')

    aborted.name = 'AbortError'
    assert.equal(safeSmokeFailure(aborted).error, 'grounded_answer_smoke_aborted')
  })
})
