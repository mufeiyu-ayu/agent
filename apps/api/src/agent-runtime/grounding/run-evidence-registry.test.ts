import type { ToolEvidenceRef } from '../../tools/core/tool-evidence.js'
import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，不为 Registry 引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import {
  RUN_EVIDENCE_REGISTRY_MAX_REFS,
  RunEvidenceRegistry,
} from './run-evidence-registry.js'

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

function articleRef(overrides: Partial<ToolEvidenceRef> = {}): ToolEvidenceRef {
  return chunkRef({
    chunkId: null,
    granularity: 'article',
    sectionPath: null,
    excerpt: null,
    rank: null,
    strategy: { name: 'article_detail', version: '1' },
    ...overrides,
  })
}

function retrieval(
  registry: RunEvidenceRegistry,
  refs: ToolEvidenceRef[],
): void {
  registry.recordEligibleToolOutcome({
    toolName: 'retrieve_article_context',
    ok: true,
    evidence: { refs },
  })
}

describe('RunEvidenceRegistry availability', () => {
  it('成功且有 ref 时为 available', () => {
    const registry = new RunEvidenceRegistry()

    retrieval(registry, [chunkRef()])

    assert.equal(registry.evidenceAvailability(), 'available')
    assert.equal(registry.summary().refCount, 1)
  })

  it('zero-hit 成功但没有 ref 时为 none，而不是 unavailable', () => {
    const registry = new RunEvidenceRegistry()

    retrieval(registry, [])

    assert.equal(registry.evidenceAvailability(), 'none')
    assert.equal(registry.summary().eligibleToolFailureCount, 0)
  })

  it('eligible Tool 全部失败且无 ref 时为 unavailable', () => {
    const registry = new RunEvidenceRegistry()

    registry.recordEligibleToolOutcome({
      toolName: 'retrieve_article_context',
      ok: false,
    })

    assert.equal(registry.evidenceAvailability(), 'unavailable')
    assert.equal(registry.summary().eligibleToolFailureCount, 1)
  })

  it('有 ref 同时存在失败通道时为 partial', () => {
    const registry = new RunEvidenceRegistry()

    retrieval(registry, [chunkRef()])
    registry.recordEligibleToolOutcome({
      toolName: 'get_article_detail',
      ok: false,
    })

    assert.equal(registry.evidenceAvailability(), 'partial')
  })

  it('失败调用携带的 evidence 一律不采纳', () => {
    const registry = new RunEvidenceRegistry()

    registry.recordEligibleToolOutcome({
      toolName: 'retrieve_article_context',
      ok: false,
      evidence: { refs: [chunkRef()] },
    })

    assert.equal(registry.summary().refCount, 0)
    assert.equal(registry.evidenceAvailability(), 'unavailable')
  })
})

describe('RunEvidenceRegistry citationKey', () => {
  it('key 是服务端生成的 opaque 值，不泄漏来源标识', () => {
    const registry = new RunEvidenceRegistry()

    retrieval(registry, [chunkRef()])

    const [entry] = registry.list()

    assert.ok(entry)
    assert.match(entry.citationKey, /^evk_[a-f\d]{32}$/)
    assert.doesNotMatch(entry.citationKey, /301|seo-basics|chunk-0/)
  })

  it('只有本 Registry 生成的 key 能被解析', () => {
    const current = new RunEvidenceRegistry()
    const other = new RunEvidenceRegistry()

    retrieval(current, [chunkRef()])
    retrieval(other, [chunkRef()])

    const currentKey = current.list()[0]!.citationKey
    const otherKey = other.list()[0]!.citationKey

    assert.notEqual(currentKey, otherKey)
    assert.ok(current.resolve(currentKey))
    // 另一次 Run 的 key 在这里不存在，历史证据无法越界。
    assert.equal(current.resolve(otherKey), undefined)
    assert.equal(current.resolve('301'), undefined)
    assert.equal(current.resolve('article-301-chunk-0'), undefined)
  })
})

describe('RunEvidenceRegistry 去重、排序与 hard cap', () => {
  it('相同 source/chunk 稳定去重，先到先得', () => {
    const registry = new RunEvidenceRegistry()

    retrieval(registry, [
      chunkRef({ rank: 1 }),
      chunkRef({ rank: 5, title: '后到的同一 chunk' }),
    ])

    const entries = registry.list()

    assert.equal(entries.length, 1)
    assert.equal(entries[0]?.rank, 1)
    assert.equal(entries[0]?.title, 'SEO 基础')
  })

  it('article detail 与同 source 的 chunk 证据并存且不伪造 chunk identity', () => {
    const registry = new RunEvidenceRegistry()

    retrieval(registry, [chunkRef()])
    registry.recordEligibleToolOutcome({
      toolName: 'get_article_detail',
      ok: true,
      evidence: { refs: [articleRef()] },
    })

    const entries = registry.list()

    assert.equal(entries.length, 2)
    assert.deepEqual(
      entries.map(entry => [entry.granularity, entry.chunkId]),
      [['chunk', 'article-301-chunk-0'], ['article', null]],
    )
  })

  it('按 Tool 序 → rank → sourceId → chunkId 确定性排序', () => {
    const registry = new RunEvidenceRegistry()

    retrieval(registry, [
      chunkRef({ sourceId: 305, chunkId: 'c-305', rank: 3 }),
      chunkRef({ sourceId: 302, chunkId: 'c-302', rank: 1 }),
      chunkRef({ sourceId: 303, chunkId: 'c-303', rank: 2 }),
    ])
    registry.recordEligibleToolOutcome({
      toolName: 'get_article_detail',
      ok: true,
      evidence: { refs: [articleRef({ sourceId: 301 })] },
    })

    assert.deepEqual(
      registry.list().map(entry => entry.sourceId),
      [302, 303, 305, 301],
    )
    // 重复调用结果必须完全一致。
    assert.deepEqual(
      registry.list().map(entry => entry.citationKey),
      registry.list().map(entry => entry.citationKey),
    )
  })

  it('超过 hard cap 时截断并记录 registryTruncated', () => {
    const registry = new RunEvidenceRegistry()

    for (let call = 0; call < 3; call += 1) {
      retrieval(registry, Array.from({ length: 5 }, (_, index) => chunkRef({
        sourceId: 500 + call * 5 + index,
        chunkId: `c-${500 + call * 5 + index}`,
        rank: index + 1,
      })))
    }

    const summary = registry.summary()

    assert.equal(summary.refCount, RUN_EVIDENCE_REGISTRY_MAX_REFS)
    assert.equal(summary.registryTruncated, true)
    assert.equal(summary.eligibleToolCallCount, 3)
  })

  it('未超限时 registryTruncated 保持 false', () => {
    const registry = new RunEvidenceRegistry()

    retrieval(registry, [chunkRef()])

    assert.equal(registry.summary().registryTruncated, false)
  })
})

describe('RunEvidenceRegistry 模型投影', () => {
  it('投影不含 slug、rank、strategy 等内部排序与派生信号', () => {
    const registry = new RunEvidenceRegistry()

    retrieval(registry, [chunkRef()])

    const [projected] = registry.toModelProjection()

    assert.deepEqual(Object.keys(projected!).sort(), [
      'chunkId',
      'citationKey',
      'excerpt',
      'granularity',
      'languageCode',
      'sectionPath',
      'sourceId',
      'title',
    ])
    assert.doesNotMatch(
      JSON.stringify(registry.toModelProjection()),
      /seo-basics|hybrid_rrf|rank/,
    )
  })

  it('非法投影整条丢弃，但不影响同批次的合法证据', () => {
    const registry = new RunEvidenceRegistry()

    registry.recordEligibleToolOutcome({
      toolName: 'retrieve_article_context',
      ok: true,
      evidence: {
        refs: [
          { ...chunkRef(), cosineDistance: 0.1 },
          chunkRef({ sourceId: 306, chunkId: 'c-306' }),
        ],
      },
    })

    assert.deepEqual(
      registry.list().map(entry => entry.sourceId),
      [306],
    )
    assert.equal(registry.evidenceAvailability(), 'available')
  })

  it('完全非法的投影使该次调用成为「成功但无证据」', () => {
    const registry = new RunEvidenceRegistry()

    registry.recordEligibleToolOutcome({
      toolName: 'retrieve_article_context',
      ok: true,
      evidence: { refs: [{ sourceId: 'not-a-number' }] },
    })

    assert.equal(registry.summary().refCount, 0)
    assert.equal(registry.evidenceAvailability(), 'none')
  })
})
