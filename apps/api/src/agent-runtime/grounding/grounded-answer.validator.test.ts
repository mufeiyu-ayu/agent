import type { ToolEvidenceRef } from '../../tools/core/tool-evidence.js'
import type { SubmitGroundedAnswerInputV1 } from './grounded-answer.contract.js'
import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，不为校验器引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { GroundedAnswerRejectedError } from './grounded-answer.contract.js'
import { validateGroundedAnswer } from './grounded-answer.validator.js'
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

function createRegistry(refs: ToolEvidenceRef[]): RunEvidenceRegistry {
  const registry = new RunEvidenceRegistry()

  registry.recordEligibleToolOutcome({
    toolName: 'retrieve_article_context',
    ok: true,
    evidence: { refs },
  })

  return registry
}

function createFailedRegistry(): RunEvidenceRegistry {
  const registry = new RunEvidenceRegistry()

  registry.recordEligibleToolOutcome({
    toolName: 'retrieve_article_context',
    ok: false,
  })

  return registry
}

function submit(
  overrides: Partial<SubmitGroundedAnswerInputV1> = {},
): SubmitGroundedAnswerInputV1 {
  return {
    answer: '基于站内资料的回答。',
    outcome: 'answered',
    citationKeys: [],
    ...overrides,
  }
}

function assertRejected(
  input: SubmitGroundedAnswerInputV1,
  registry: RunEvidenceRegistry,
  code: string,
): void {
  assert.throws(
    () => validateGroundedAnswer(input, registry),
    (error: unknown) => {
      assert.ok(error instanceof GroundedAnswerRejectedError)
      assert.equal(error.code, code)
      return true
    },
  )
}

describe('validateGroundedAnswer 成功路径', () => {
  it('answered 引用真实证据时生成 validated Grounding', () => {
    const registry = createRegistry([chunkRef()])
    const key = registry.list()[0]!.citationKey
    const result = validateGroundedAnswer(
      submit({ citationKeys: [key] }),
      registry,
    )

    assert.equal(result.answer, '基于站内资料的回答。')
    assert.equal(result.grounding.schemaVersion, 1)
    assert.equal(result.grounding.evidenceAvailability, 'available')
    assert.equal(result.grounding.outcome, 'answered')
    assert.equal(result.grounding.citationIntegrity, 'validated')
    // v1 不做逐断言事实核验，禁止升级成 verified。
    assert.equal(result.grounding.faithfulnessStatus, 'not_evaluated')
    assert.equal(result.grounding.citations.length, 1)

    const [citation] = result.grounding.citations

    assert.match(citation!.citationId, /^cit_[a-f\d]{32}$/)
    assert.notEqual(citation!.citationId, key)
    assert.equal(citation!.sourceId, 301)
    assert.equal(citation!.granularity, 'chunk')
    // 当前没有 allowlisted 的公开文章路由，href 必须为 null。
    assert.equal(citation!.href, null)
    assert.deepEqual(citation!.strategy, { name: 'hybrid_rrf', version: '1' })
  })

  it('公共 Citation 不泄漏内部 citationKey', () => {
    const registry = createRegistry([chunkRef()])
    const key = registry.list()[0]!.citationKey
    const result = validateGroundedAnswer(
      submit({ citationKeys: [key] }),
      registry,
    )

    assert.doesNotMatch(JSON.stringify(result.grounding), /evk_/)
  })

  it('conflicting_evidence 引用两个不同 source 时通过', () => {
    const registry = createRegistry([
      chunkRef(),
      chunkRef({ sourceId: 302, chunkId: 'article-302-chunk-0', rank: 2 }),
    ])
    const keys = registry.list().map(entry => entry.citationKey)
    const result = validateGroundedAnswer(
      submit({ outcome: 'conflicting_evidence', citationKeys: keys }),
      registry,
    )

    assert.equal(result.grounding.outcome, 'conflicting_evidence')
    assert.equal(result.grounding.citations.length, 2)
  })

  it('zero-hit 时 insufficient_evidence + 0 citation 通过', () => {
    const registry = new RunEvidenceRegistry()

    registry.recordEligibleToolOutcome({
      toolName: 'retrieve_article_context',
      ok: true,
      evidence: { refs: [] },
    })

    const result = validateGroundedAnswer(
      submit({ outcome: 'insufficient_evidence', answer: '当前资料无法确认。' }),
      registry,
    )

    assert.equal(result.grounding.evidenceAvailability, 'none')
    assert.deepEqual(result.grounding.citations, [])
  })

  it('有候选但不足以回答时允许 insufficient_evidence 带引用', () => {
    const registry = createRegistry([chunkRef()])
    const key = registry.list()[0]!.citationKey
    const result = validateGroundedAnswer(
      submit({
        outcome: 'insufficient_evidence',
        answer: '检查过相关候选，但不足以确认。',
        citationKeys: [key],
      }),
      registry,
    )

    assert.equal(result.grounding.evidenceAvailability, 'available')
    assert.equal(result.grounding.outcome, 'insufficient_evidence')
    assert.equal(result.grounding.citations.length, 1)
  })

  it('重复提交同一 key 时稳定去重', () => {
    const registry = createRegistry([chunkRef()])
    const key = registry.list()[0]!.citationKey
    const result = validateGroundedAnswer(
      submit({ citationKeys: [key, key, key] }),
      registry,
    )

    assert.equal(result.grounding.citations.length, 1)
  })
})

describe('validateGroundedAnswer 负向路径', () => {
  it('未知 citationKey 没有成功路径', () => {
    const registry = createRegistry([chunkRef()])

    assertRejected(
      submit({ citationKeys: ['evk_00000000000000000000000000000000'] }),
      registry,
      'unknown_citation_key',
    )
  })

  it('跨 Run citationKey 被拒绝', () => {
    const currentRegistry = createRegistry([chunkRef()])
    const previousRegistry = createRegistry([chunkRef()])
    const previousKey = previousRegistry.list()[0]!.citationKey

    assertRejected(
      submit({ citationKeys: [previousKey] }),
      currentRegistry,
      'unknown_citation_key',
    )
  })

  it('用 sourceId / chunkId / slug / URL 冒充 key 一律被拒绝', () => {
    const registry = createRegistry([chunkRef()])

    for (const forged of [
      '301',
      'article-301-chunk-0',
      'seo-basics',
      'https://example.com/seo-basics',
      '[1]',
    ]) {
      assertRejected(
        submit({ citationKeys: [forged] }),
        registry,
        'unknown_citation_key',
      )
    }
  })

  it('answered 必须至少引用一条证据', () => {
    const registry = createRegistry([chunkRef()])

    assertRejected(
      submit({ citationKeys: [] }),
      registry,
      'citation_required_for_answered',
    )
  })

  it('zero-hit / unavailable 时不允许 answered', () => {
    const zeroHitRegistry = new RunEvidenceRegistry()

    zeroHitRegistry.recordEligibleToolOutcome({
      toolName: 'retrieve_article_context',
      ok: true,
      evidence: { refs: [] },
    })

    assertRejected(
      submit({ citationKeys: [] }),
      zeroHitRegistry,
      'outcome_not_allowed_for_availability',
    )
    assertRejected(
      submit({ citationKeys: [] }),
      createFailedRegistry(),
      'outcome_not_allowed_for_availability',
    )
  })

  it('conflicting_evidence 需要两个不同 source', () => {
    const registry = createRegistry([
      chunkRef(),
      chunkRef({ chunkId: 'article-301-chunk-1', rank: 2 }),
    ])
    const keys = registry.list().map(entry => entry.citationKey)

    assert.equal(keys.length, 2)
    assertRejected(
      submit({ outcome: 'conflicting_evidence', citationKeys: keys }),
      registry,
      'conflicting_requires_two_sources',
    )
  })

  it('没有有效证据时不允许挂任何引用', () => {
    const registry = createFailedRegistry()

    assertRejected(
      submit({
        outcome: 'insufficient_evidence',
        citationKeys: ['evk_00000000000000000000000000000000'],
      }),
      registry,
      'unknown_citation_key',
    )
  })

  it('去重后仍超过 5 条时拒绝', () => {
    const registry = createRegistry(Array.from({ length: 5 }, (_, index) => chunkRef({
      sourceId: 400 + index,
      chunkId: `article-${400 + index}-chunk-0`,
      rank: index + 1,
    })))

    registry.recordEligibleToolOutcome({
      toolName: 'retrieve_article_context',
      ok: true,
      evidence: {
        refs: [chunkRef({ sourceId: 410, chunkId: 'article-410-chunk-0' })],
      },
    })

    const keys = registry.list().map(entry => entry.citationKey)

    assert.equal(keys.length, 6)
    assertRejected(
      submit({ citationKeys: keys }),
      registry,
      'citation_keys_too_many',
    )
  })
})
