import assert from 'node:assert/strict'
// 项目本轮使用 Node 原生测试运行器，不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import {
  normalizeToolStepSummary,
  TOOL_STEP_SUMMARY_MAX_CHARS,
  TOOL_STEP_SUMMARY_MAX_DEPTH,
} from './tool-step-summary.js'

const VALID_SUMMARY = {
  status: 'candidates_returned',
  answerStatus: 'unverified',
  strategy: {
    name: 'hybrid_rrf',
    version: '1',
  },
  sourceCount: 3,
  chunkEvidenceCount: 3,
  sources: [
    { sourceId: 1, chunkId: 'chunk-1' },
    { sourceId: 2 },
  ],
}

describe('normalizeToolStepSummary', () => {
  it('原样通过合法的 JSON-compatible summary', () => {
    const normalized = normalizeToolStepSummary(VALID_SUMMARY)

    assert.deepEqual(normalized, VALID_SUMMARY)
  })

  it('允许 null、布尔、空对象与空数组', () => {
    const summary = {
      status: 'no_candidates',
      truncated: false,
      note: null,
      sources: [],
      extra: {},
    }

    assert.deepEqual(normalizeToolStepSummary(summary), summary)
  })

  it('summary 缺省时返回 undefined', () => {
    assert.equal(normalizeToolStepSummary(undefined), undefined)
  })

  it('拒绝非普通对象的顶层值', () => {
    for (const invalid of [
      null,
      'summary',
      42,
      true,
      [{ sourceId: 1 }],
      new Date(),
      new Map([['a', 1]]),
    ]) {
      assert.equal(normalizeToolStepSummary(invalid), undefined)
    }
  })

  it('拒绝 BigInt、undefined、function 与 symbol', () => {
    const invalidValues: unknown[] = [
      BigInt(1),
      undefined,
      () => {},
      Symbol('secret'),
    ]

    for (const value of invalidValues) {
      assert.equal(
        normalizeToolStepSummary({ status: 'ok', value }),
        undefined,
        `应拒绝：${String(typeof value)}`,
      )
      // 嵌套位置同样必须被拒绝。
      assert.equal(
        normalizeToolStepSummary({ sources: [{ sourceId: 1, value }] }),
        undefined,
      )
    }
  })

  it('拒绝非有限数字', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])
      assert.equal(normalizeToolStepSummary({ status: 'ok', value }), undefined)
  })

  it('拒绝循环引用，且不抛异常', () => {
    const summary: Record<string, unknown> = { status: 'ok' }
    summary.self = summary

    assert.equal(normalizeToolStepSummary(summary), undefined)

    const nested: Record<string, unknown> = { status: 'ok' }
    nested.sources = [{ parent: nested }]

    assert.equal(normalizeToolStepSummary(nested), undefined)
  })

  it('允许同一对象出现在兄弟位置，只拒绝祖先链上的重复引用', () => {
    const shared = { name: 'hybrid_rrf', version: '1' }
    const summary = { first: shared, second: shared }

    assert.deepEqual(normalizeToolStepSummary(summary), summary)
  })

  it('拒绝超过最大嵌套深度的 summary', () => {
    assert.deepEqual(
      normalizeToolStepSummary(nest(TOOL_STEP_SUMMARY_MAX_DEPTH)),
      nest(TOOL_STEP_SUMMARY_MAX_DEPTH),
    )
    assert.equal(normalizeToolStepSummary(nest(TOOL_STEP_SUMMARY_MAX_DEPTH + 1)), undefined)
  })

  it('拒绝超过字符预算的 summary，而不是静默截断', () => {
    const withinBudget = { note: 'a'.repeat(TOOL_STEP_SUMMARY_MAX_CHARS - 20) }
    const overBudget = { note: 'a'.repeat(TOOL_STEP_SUMMARY_MAX_CHARS) }
    const overBudgetArray = {
      sources: Array.from({ length: 2_000 }, (_, index) => ({ sourceId: index })),
    }

    assert.deepEqual(normalizeToolStepSummary(withinBudget), withinBudget)
    assert.equal(normalizeToolStepSummary(overBudget), undefined)
    assert.equal(normalizeToolStepSummary(overBudgetArray), undefined)
  })

  it('预算常量保持在审计元数据量级，不足以承载 Observation 正文', () => {
    assert.equal(TOOL_STEP_SUMMARY_MAX_CHARS, 2_000)
    assert.equal(TOOL_STEP_SUMMARY_MAX_DEPTH, 5)
    // 合法 Retrieval summary 应远小于预算。
    assert.ok(JSON.stringify(VALID_SUMMARY).length < TOOL_STEP_SUMMARY_MAX_CHARS / 4)
  })
})

/** 构造指定层数的嵌套对象；顶层记为第 1 层。 */
function nest(depth: number): Record<string, unknown> {
  let current: Record<string, unknown> = { leaf: 'value' }

  for (let level = 1; level < depth; level += 1)
    current = { child: current }

  return current
}
