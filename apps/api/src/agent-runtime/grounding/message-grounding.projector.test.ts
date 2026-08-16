import type { MessageCitationV1 } from '@agent/contracts'
import type { PersistedMessageGrounding } from './message-grounding.projector.js'
import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，不为投影层引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import {
  toMessageGroundingV1,
  toOwnedMessageGroundingV1,
} from './message-grounding.projector.js'

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

  it('空 sectionPath / excerpt 归一化为 null，不视为损坏', () => {
    const grounding = toMessageGroundingV1(persisted({
      citations: [citation({ sectionPath: '', excerpt: '' })],
    }))

    assert.ok(grounding)
    assert.equal(grounding.citations[0]?.sectionPath, null)
    assert.equal(grounding.citations[0]?.excerpt, null)
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

describe('toMessageGroundingV1 语义 fail closed', () => {
  const semanticCases: Array<[string, PersistedMessageGrounding]> = [
    ['none + answered', persisted({
      evidenceAvailability: 'none',
      outcome: 'answered',
      citations: [],
    })],
    ['unavailable + answered', persisted({
      evidenceAvailability: 'unavailable',
      outcome: 'answered',
      citations: [],
    })],
    ['none + conflicting_evidence', persisted({
      evidenceAvailability: 'none',
      outcome: 'conflicting_evidence',
      citations: [],
    })],
    ['unavailable 但 citations 非空', persisted({
      evidenceAvailability: 'unavailable',
      outcome: 'insufficient_evidence',
      citations: [citation()],
    })],
    ['none 但 citations 非空', persisted({
      evidenceAvailability: 'none',
      outcome: 'insufficient_evidence',
      citations: [citation()],
    })],
    ['answered 但 0 citation', persisted({ citations: [] })],
    ['conflicting_evidence 但只有一个 source', persisted({
      outcome: 'conflicting_evidence',
      citations: [
        citation(),
        citation({
          citationId: 'cit_ffffffffffffffffffffffffffffffff',
          chunkId: 'article-301-chunk-1',
          rank: 2,
        }),
      ],
    })],
    ['citationId 重复', persisted({
      outcome: 'conflicting_evidence',
      citations: [
        citation(),
        citation({ sourceId: 302, chunkId: 'article-302-chunk-0' }),
      ],
    })],
    ['非空 href', persisted({
      citations: [citation({ href: '/articles/seo-basics' })],
    })],
    ['sourceId 不是安全整数', persisted({
      citations: [citation({ sourceId: Number.MAX_SAFE_INTEGER + 2 })],
    })],
    ['rank 为负数', persisted({ citations: [citation({ rank: -1 })] })],
    ['title 超长', persisted({
      citations: [citation({ title: '标'.repeat(301) })],
    })],
    ['excerpt 超长', persisted({
      citations: [citation({ excerpt: '正'.repeat(501) })],
    })],
    ['title 为空字符串', persisted({ citations: [citation({ title: '' })] })],
    // 公开 citationId 必须是 server-issued 的 `cit_<32hex>`。
    ['citationId 使用内部 citationKey 前缀', persisted({
      citations: [citation({
        citationId: 'evk_0123456789abcdef0123456789abcdef',
      })],
    })],
    ['citationId 被截断', persisted({ citations: [citation({ citationId: 'cit_1' })] })],
    ['citationId 为空字符串', persisted({ citations: [citation({ citationId: '' })] })],
    ['citationId 为纯空白', persisted({ citations: [citation({ citationId: '   ' })] })],
    ['citationId 前缀错误', persisted({
      citations: [citation({
        citationId: 'sid_0123456789abcdef0123456789abcdef',
      })],
    })],
    ['citationId 含大写十六进制', persisted({
      citations: [citation({
        citationId: 'cit_0123456789ABCDEF0123456789abcdef',
      })],
    })],
    // chunkId 是身份字段，空字符串不能被当成「没有这项内容」。
    ['chunk 粒度 chunkId 为空字符串', persisted({
      citations: [citation({ chunkId: '' })],
    })],
    ['chunk 粒度 chunkId 超长', persisted({
      citations: [citation({ chunkId: 'c'.repeat(201) })],
    })],
  ]

  for (const [name, value] of semanticCases) {
    it(`${name} 时返回 null`, () => {
      assert.equal(toMessageGroundingV1(value), null)
    })
  }

  it('conflicting_evidence 引用两个不同 source 时通过', () => {
    const grounding = toMessageGroundingV1(persisted({
      outcome: 'conflicting_evidence',
      citations: [
        citation(),
        citation({
          citationId: 'cit_ffffffffffffffffffffffffffffffff',
          sourceId: 302,
          chunkId: 'article-302-chunk-0',
          rank: 2,
        }),
      ],
    }))

    assert.ok(grounding)
    assert.equal(grounding.citations.length, 2)
  })

  it('合法的 cit_<32hex> citationId 通过', () => {
    const grounding = toMessageGroundingV1(persisted({
      citations: [citation({
        citationId: 'cit_abcdef0123456789abcdef0123456789',
      })],
    }))

    assert.ok(grounding)
    assert.equal(
      grounding.citations[0]?.citationId,
      'cit_abcdef0123456789abcdef0123456789',
    )
  })

  it('partial + answered 且有引用时通过', () => {
    const grounding = toMessageGroundingV1(persisted({
      evidenceAvailability: 'partial',
    }))

    assert.ok(grounding)
    assert.equal(grounding.evidenceAvailability, 'partial')
  })
})

describe('toOwnedMessageGroundingV1 归属校验', () => {
  it('只为 COMPLETED assistant Message 投影 Grounding', () => {
    assert.ok(toOwnedMessageGroundingV1(
      { role: 'ASSISTANT', status: 'COMPLETED' },
      persisted(),
    ))
  })

  it('非终态或失败的助手消息不返回 Grounding', () => {
    for (const status of ['PENDING', 'STREAMING', 'FAILED', 'ABORTED']) {
      assert.equal(
        toOwnedMessageGroundingV1({ role: 'ASSISTANT', status }, persisted()),
        null,
        `${status} 不应返回 Grounding`,
      )
    }
  })

  it('用户消息上被人为插入的 Grounding 不会外泄', () => {
    assert.equal(
      toOwnedMessageGroundingV1(
        { role: 'USER', status: 'COMPLETED' },
        persisted(),
      ),
      null,
    )
  })
})
