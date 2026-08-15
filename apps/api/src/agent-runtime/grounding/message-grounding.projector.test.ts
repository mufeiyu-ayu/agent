import type { MessageCitationV1 } from '@agent/contracts'
import type { PersistedMessageGrounding } from './message-grounding.projector.js'
import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，不为投影层引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { toMessageGroundingV1 } from './message-grounding.projector.js'

function citation(overrides: Partial<MessageCitationV1> = {}): MessageCitationV1 {
  return {
    citationId: 'cit_0123456789abcdef0123456789abcdef',
    sourceId: 301,
    chunkId: 'article-301-chunk-0',
    granularity: 'chunk',
    title: 'SEO 基础',
    slug: 'seo-basics',
    languageCode: 'zh-cn',
    sectionPath: 'Section 0',
    excerpt: '候选片段',
    rank: 1,
    href: null,
    strategy: { name: 'hybrid_rrf', version: '1' },
    ...overrides,
  }
}

function persisted(
  overrides: Partial<PersistedMessageGrounding> = {},
): PersistedMessageGrounding {
  return {
    schemaVersion: 1,
    evidenceAvailability: 'available',
    outcome: 'answered',
    citationIntegrity: 'validated',
    faithfulnessStatus: 'not_evaluated',
    citations: [citation()],
    ...overrides,
  }
}

describe('toMessageGroundingV1 成功路径', () => {
  it('投影合法持久化数据', () => {
    const grounding = toMessageGroundingV1(persisted())

    assert.ok(grounding)
    assert.equal(grounding.schemaVersion, 1)
    assert.equal(grounding.evidenceAvailability, 'available')
    assert.equal(grounding.outcome, 'answered')
    assert.equal(grounding.citationIntegrity, 'validated')
    assert.equal(grounding.faithfulnessStatus, 'not_evaluated')
    assert.deepEqual(grounding.citations, [citation()])
  })

  it('article 粒度允许空 chunkId / sectionPath / excerpt / rank', () => {
    const grounding = toMessageGroundingV1(persisted({
      citations: [citation({
        chunkId: null,
        granularity: 'article',
        sectionPath: null,
        excerpt: null,
        rank: null,
        strategy: { name: 'article_detail', version: '1' },
      })],
    }))

    assert.ok(grounding)
    assert.equal(grounding.citations[0]?.granularity, 'article')
    assert.equal(grounding.citations[0]?.chunkId, null)
  })

  it('零引用的 insufficient_evidence 是合法事实', () => {
    const grounding = toMessageGroundingV1(persisted({
      evidenceAvailability: 'unavailable',
      outcome: 'insufficient_evidence',
      citations: [],
    }))

    assert.ok(grounding)
    assert.deepEqual(grounding.citations, [])
  })

  it('缺失 Grounding 返回 null', () => {
    assert.equal(toMessageGroundingV1(null), null)
    assert.equal(toMessageGroundingV1(undefined), null)
  })
})

describe('toMessageGroundingV1 fail closed', () => {
  const invalidCases: Array<[string, PersistedMessageGrounding]> = [
    ['未知 schemaVersion', persisted({ schemaVersion: 2 })],
    ['未知 availability', persisted({ evidenceAvailability: 'maybe' })],
    ['未知 outcome', persisted({ outcome: 'answered_maybe' })],
    ['被提升的 citationIntegrity', persisted({ citationIntegrity: 'verified' })],
    ['被提升的 faithfulnessStatus', persisted({ faithfulnessStatus: 'verified' })],
    ['citations 不是数组', persisted({ citations: { 0: citation() } })],
    ['citations 超过上限', persisted({
      citations: Array.from({ length: 6 }, () => citation()),
    })],
    ['citation 缺字段', persisted({
      citations: [{ ...citation(), citationId: undefined }],
    })],
    ['citation 多出内部字段', persisted({
      citations: [{ ...citation(), citationKey: 'evk_1' }],
    })],
    ['citation sourceId 非法', persisted({ citations: [citation({ sourceId: 0 })] })],
    ['article 粒度伪造 chunkId', persisted({
      citations: [citation({ granularity: 'article' })],
    })],
    ['chunk 粒度缺 chunkId', persisted({
      citations: [citation({ chunkId: null })],
    })],
    ['strategy 结构非法', persisted({
      citations: [{ ...citation(), strategy: { name: 'x' } }],
    })],
  ]

  for (const [name, value] of invalidCases) {
    it(`${name} 时返回 null`, () => {
      assert.equal(toMessageGroundingV1(value), null)
    })
  }

  it('损坏数据不会以任何形式回传原始 JSON', () => {
    const projected = toMessageGroundingV1(persisted({
      citations: [{ ...citation(), leakedSql: 'SELECT * FROM "ArticleChunk"' }],
    }))

    assert.equal(projected, null)
    assert.doesNotMatch(JSON.stringify(projected), /SELECT|leakedSql/)
  })
})
