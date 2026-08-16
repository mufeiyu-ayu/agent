import type {
  MessageCitationV1,
  MessageEvidenceAvailability,
  MessageGroundingOutcome,
  MessageGroundingV1,
} from '@agent/contracts'

import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，Web 侧同样不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import { toGroundingView } from './grounding-presenter'

function createCitation(overrides: Partial<MessageCitationV1> = {}): MessageCitationV1 {
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

function createGrounding(
  outcome: MessageGroundingOutcome,
  evidenceAvailability: MessageEvidenceAvailability,
  citations: MessageCitationV1[] = [createCitation()],
): MessageGroundingV1 {
  return {
    schemaVersion: 1,
    evidenceAvailability,
    outcome,
    citationIntegrity: 'validated',
    faithfulnessStatus: 'not_evaluated',
    citations,
  }
}

/** contract 允许的全部 outcome × availability 组合。 */
const LEGAL_COMBINATIONS: [MessageGroundingOutcome, MessageEvidenceAvailability][] = [
  ['answered', 'available'],
  ['answered', 'partial'],
  ['conflicting_evidence', 'available'],
  ['conflicting_evidence', 'partial'],
  ['insufficient_evidence', 'available'],
  ['insufficient_evidence', 'partial'],
  ['insufficient_evidence', 'none'],
  ['insufficient_evidence', 'unavailable'],
]

describe('toGroundingView 状态映射', () => {
  it('没有 Grounding 时不产生任何展示模型', () => {
    assert.equal(toGroundingView(null), null)
    assert.equal(toGroundingView(undefined), null)
  })

  it('八个合法组合各自产生互不相同的状态表达', () => {
    const signatures = new Set<string>()

    for (const [outcome, availability] of LEGAL_COMBINATIONS) {
      const view = toGroundingView(createGrounding(outcome, availability))

      assert.ok(view, `${outcome}:${availability} 应当有展示模型`)
      signatures.add(`${view.tone}|${view.statusKey}|${view.noteKey}|${view.sourcesKey}`)
    }

    assert.equal(
      signatures.size,
      LEGAL_COMBINATIONS.length,
      '每个合法组合都必须有可区分的状态表达',
    )
  })

  it('insufficient 的四种 availability 使用四种不同主状态或补充说明', () => {
    const statuses = (['available', 'partial', 'none', 'unavailable'] as const).map((availability) => {
      const view = toGroundingView(createGrounding('insufficient_evidence', availability))

      assert.ok(view)

      return `${view.statusKey}|${view.noteKey}`
    })

    assert.equal(new Set(statuses).size, 4)
  })

  it('partial 始终附带证据链不完整的补充说明，其它 availability 不附带', () => {
    for (const [outcome, availability] of LEGAL_COMBINATIONS) {
      const view = toGroundingView(createGrounding(outcome, availability))

      assert.ok(view)
      assert.equal(view.noteKey, availability === 'partial' ? 'partial' : null)
    }
  })

  it('insufficient 的 Citation 语义是「已检查的资料」而不是「引用来源」', () => {
    const answered = toGroundingView(createGrounding('answered', 'available'))
    const insufficient = toGroundingView(createGrounding('insufficient_evidence', 'available'))

    assert.ok(answered && insufficient)
    assert.notEqual(answered.sourcesKey, insufficient.sourcesKey)
  })

  it('contract 不允许的组合 fail closed，不兜底成成功状态', () => {
    const illegalGrounding = {
      ...createGrounding('answered', 'available'),
      evidenceAvailability: 'none',
    } as MessageGroundingV1

    assert.equal(toGroundingView(illegalGrounding), null)
  })
})

describe('toGroundingView 来源投影', () => {
  it('UI 编号严格按 contract 数组顺序生成，不按 rank 重排', () => {
    const view = toGroundingView(createGrounding('conflicting_evidence', 'available', [
      createCitation({ rank: 9, title: '后排候选' }),
      createCitation({
        citationId: 'cit_ffffffffffffffffffffffffffffffff',
        sourceId: 302,
        chunkId: 'article-302-chunk-0',
        rank: 0,
        title: '前排候选',
      }),
    ]))

    assert.ok(view)
    assert.deepEqual(
      view.sources.map(source => [source.index, source.title]),
      [[1, '后排候选'], [2, '前排候选']],
    )
  })

  it('只投影安全展示字段，不泄漏内部标识与检索细节', () => {
    const view = toGroundingView(createGrounding('answered', 'available'))

    assert.ok(view)
    assert.deepEqual(Object.keys(view.sources[0]).sort(), [
      'citationId',
      'excerpt',
      'granularity',
      'index',
      'languageCode',
      'sectionPath',
      'title',
    ])
  })

  it('source-level Citation 没有 excerpt 与 sectionPath 时仍然可读', () => {
    const view = toGroundingView(createGrounding('answered', 'available', [
      createCitation({
        granularity: 'article',
        chunkId: null,
        excerpt: null,
        sectionPath: null,
      }),
    ]))

    assert.ok(view)
    assert.equal(view.sources[0].granularity, 'article')
    assert.equal(view.sources[0].excerpt, null)
    assert.equal(view.sources[0].sectionPath, null)
    assert.equal(view.sources[0].title, 'SEO 基础')
  })

  it('没有 Citation 的 zero-hit 状态不产生来源列表', () => {
    const view = toGroundingView(createGrounding('insufficient_evidence', 'none', []))

    assert.ok(view)
    assert.deepEqual(view.sources, [])
  })
})
