import type { ToolEvidenceRef } from './tool-evidence.js'
import assert from 'node:assert/strict'
// 项目使用 Node 原生测试运行器，不为证据投影引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import {
  normalizeToolEvidenceProjection,
  TOOL_EVIDENCE_MAX_REFS_PER_CALL,
  TOOL_EVIDENCE_REF_MAX_CHARS,
} from './tool-evidence.js'

function chunkRef(overrides: Partial<ToolEvidenceRef> = {}): ToolEvidenceRef {
  return {
    sourceId: 301,
    chunkId: 'article-301-chunk-0',
    granularity: 'chunk',
    title: 'SEO 基础',
    slug: 'seo-basics',
    languageCode: 'zh-cn',
    sectionPath: 'Section 0',
    excerpt: 'SEO 的核心是让搜索引擎理解页面结构。',
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

describe('normalizeToolEvidenceProjection', () => {
  it('放行合法的 chunk 与 article 粒度证据', () => {
    const refs = normalizeToolEvidenceProjection({
      refs: [chunkRef(), articleRef({ sourceId: 302, slug: 'sitemap' })],
    })

    assert.equal(refs.length, 2)
    assert.equal(refs[0]?.granularity, 'chunk')
    assert.equal(refs[0]?.chunkId, 'article-301-chunk-0')
    assert.equal(refs[1]?.granularity, 'article')
    assert.equal(refs[1]?.chunkId, null)
  })

  it('undefined / 非对象 / 多余顶层字段一律返回空数组', () => {
    assert.deepEqual(normalizeToolEvidenceProjection(undefined), [])
    assert.deepEqual(normalizeToolEvidenceProjection(null), [])
    assert.deepEqual(normalizeToolEvidenceProjection('refs'), [])
    assert.deepEqual(normalizeToolEvidenceProjection([chunkRef()]), [])
    assert.deepEqual(normalizeToolEvidenceProjection({ refs: chunkRef() }), [])
    assert.deepEqual(
      normalizeToolEvidenceProjection({ refs: [chunkRef()], extra: 1 }),
      [],
    )
  })

  it('字段 allowlist 之外的内部信号整条 fail closed', () => {
    const refs = normalizeToolEvidenceProjection({
      refs: [
        { ...chunkRef(), cosineDistance: 0.12 },
        { ...chunkRef(), embedding: [0.1, 0.2] },
        chunkRef({ sourceId: 303 }),
      ],
    })

    assert.equal(refs.length, 1)
    assert.equal(refs[0]?.sourceId, 303)
    assert.doesNotMatch(JSON.stringify(refs), /cosineDistance|embedding/)
  })

  it('缺字段的 ref 同样 fail closed', () => {
    const { excerpt: _excerpt, ...missingExcerpt } = chunkRef()

    assert.deepEqual(
      normalizeToolEvidenceProjection({ refs: [missingExcerpt] }),
      [],
    )
  })

  it('article 粒度不得携带 chunkId，chunk 粒度必须有 chunkId', () => {
    assert.deepEqual(
      normalizeToolEvidenceProjection({
        refs: [articleRef({ chunkId: 'forged-chunk' })],
      }),
      [],
    )
    assert.deepEqual(
      normalizeToolEvidenceProjection({
        refs: [chunkRef({ chunkId: null })],
      }),
      [],
    )
  })

  it('拒绝非法 sourceId、rank 与 strategy', () => {
    assert.deepEqual(
      normalizeToolEvidenceProjection({ refs: [chunkRef({ sourceId: 0 })] }),
      [],
    )
    assert.deepEqual(
      normalizeToolEvidenceProjection({ refs: [chunkRef({ sourceId: 1.5 })] }),
      [],
    )
    assert.deepEqual(
      normalizeToolEvidenceProjection({ refs: [chunkRef({ rank: -1 })] }),
      [],
    )
    assert.deepEqual(
      normalizeToolEvidenceProjection({
        refs: [{
          ...chunkRef(),
          strategy: { name: 'hybrid_rrf', version: '1', extra: 'x' },
        }],
      }),
      [],
    )
  })

  it('超长 excerpt 与超体积 ref 被丢弃', () => {
    assert.deepEqual(
      normalizeToolEvidenceProjection({
        refs: [chunkRef({ excerpt: '正'.repeat(501) })],
      }),
      [],
    )
    assert.deepEqual(
      normalizeToolEvidenceProjection({
        refs: [chunkRef({ title: '标'.repeat(TOOL_EVIDENCE_REF_MAX_CHARS) })],
      }),
      [],
    )
  })

  it('单次调用最多接受固定数量 ref', () => {
    const refs = normalizeToolEvidenceProjection({
      refs: Array.from(
        { length: TOOL_EVIDENCE_MAX_REFS_PER_CALL + 3 },
        (_, index) => chunkRef({
          sourceId: 400 + index,
          chunkId: `article-${400 + index}-chunk-0`,
        }),
      ),
    })

    assert.equal(refs.length, TOOL_EVIDENCE_MAX_REFS_PER_CALL)
  })
})
