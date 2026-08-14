import type { ArticleSourceSnapshot } from './article-chunking.js'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// 项目使用 Node 原生测试运行器，不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'

import {
  ARTICLE_CHUNKER_PROFILE,
  canonicalizeArticleSource,
  chunkCanonicalArticle,
  countArticleTokens,
} from './article-chunking.js'
import { ACTIVE_EMBEDDING_PROFILE } from './embedding-provider.js'

const STRUCTURAL_HTML = `
  <script>ignore me</script>
  <h2 class="hero" style="color:red" onclick="evil()">Overview &amp; 设置</h2>
  <div class="wrapper">
    <p>Hello&nbsp;世界 🚀</p>
    <ul><li>First <strong>item</strong><ol start="3"><li value="5">Nested item</li></ol></li></ul>
    <table><tbody><tr><th colspan="2">Label</th><td rowspan="2">Value</td></tr></tbody></table>
    <blockquote>Quoted <em>text</em></blockquote>
    <pre><code>const x = 1;\nnext()</code></pre>
    <figure><img src="https://example.com/a.png" alt="fallback alt"><figcaption>Visible caption</figcaption></figure>
  </div>
`

describe('deterministic Article chunking', () => {
  it('手算 canonical fixture 保留结构语义并移除不可信 markup', () => {
    const source = canonicalizeArticleSource(snapshot(STRUCTURAL_HTML))
    const path = [{ level: 2, text: 'Overview & 设置' }]

    assert.deepEqual(source.blocks, [
      {
        kind: 'heading',
        level: 2,
        headingPath: path,
        text: 'Overview & 设置',
      },
      {
        kind: 'paragraph',
        headingPath: path,
        text: 'Hello 世界 🚀',
      },
      {
        kind: 'list_item',
        headingPath: path,
        text: 'First item',
        listIndex: 0,
        listKind: 'unordered',
        depth: 1,
        itemOrdinal: null,
        continuation: false,
      },
      {
        kind: 'list_item',
        headingPath: path,
        text: 'Nested item',
        listIndex: 1,
        listKind: 'ordered',
        depth: 2,
        itemOrdinal: 5,
        continuation: false,
        listPath: [{
          listIndex: 0,
          listKind: 'unordered',
          itemPosition: 1,
          itemOrdinal: null,
        }],
      },
      {
        kind: 'table_row',
        headingPath: path,
        text: '| [H] "Label" {colspan=2,rowspan=1} | [D] "Value" {colspan=1,rowspan=2} |',
        tableIndex: 0,
        rowIndex: 0,
        cells: [
          { kind: 'header', text: 'Label', colspan: 2, rowspan: 1 },
          { kind: 'data', text: 'Value', colspan: 1, rowspan: 2 },
        ],
      },
      {
        kind: 'blockquote',
        headingPath: path,
        text: 'Quoted text',
      },
      {
        kind: 'code',
        headingPath: path,
        text: 'const x = 1; next()',
      },
      {
        kind: 'figure',
        source: 'caption',
        headingPath: path,
        text: 'Visible caption',
      },
    ])
    assert.equal(
      source.sourceHash,
      '269c63b130b53de1798b92a18ba93a85bfa5b9ca1a3fdff69899e3165c5b8303',
    )
    assert.doesNotMatch(JSON.stringify(source.blocks), /ignore me|onclick|example\.com|fallback alt/)

    const chunks = chunkCanonicalArticle(source, ACTIVE_EMBEDDING_PROFILE.version)
    assert.deepEqual(chunks.map(chunk => ({
      id: chunk.id,
      tokenCount: chunk.tokenCount,
      contentHash: chunk.contentHash,
      embeddingInputHash: chunk.embeddingInputHash,
    })), [{
      id: 'dbcbb1c4dcb46614f0899b36ec858ff7dd91561fc66588d2e204beeee4389cd7',
      tokenCount: 120,
      contentHash: '615e28226026a674b8d4b225a024077be61754e4014c52947fa9fb382063cdbf',
      embeddingInputHash: '4adc0d525d983bb4a580ee5faab7e73567b16f0d79847b9b7a31faef5c88f1f7',
    }])
  })

  it('D-09：style/class/wrapper/event/image URL 变化不改变 sourceHash、chunk 或 ID', () => {
    const first = canonicalizeArticleSource(snapshot(`
      <h2 style="color:red">Setup</h2>
      <div class="one"><p onclick="bad()">Hello&nbsp;世界</p><p>Second paragraph</p><span>Inline</span> text</div>
      <ul><li>Outer<ol><li>Inner</li></ol></li></ul>
      <figure><img src="https://a.example/x.png" alt="Diagram"></figure>
    `))
    const second = canonicalizeArticleSource(snapshot(`
        <h2 hidden="false">Setup</h2>
        <section data-layout="new"><span><p class="two" style="line-height:2">Hello 世界</p><p>Second paragraph</p><span>Inline</span><script>ignored()</script> text</span></section>
        <ul><div class="list-wrapper"><li><span>Outer</span><div class="nested-wrapper"><ol><li>Inner</li></ol></div></li></div></ul>
        <figure class="card"><img src="https://b.example/y.png" alt="Diagram" onload="bad()"></figure>
      `, {
      updatedAt: new Date('2026-08-15T00:00:00.000Z'),
    }))

    assert.deepEqual(second.blocks, first.blocks)
    assert.equal(second.sourceHash, first.sourceHash)
    assert.deepEqual(
      chunkCanonicalArticle(second, ACTIVE_EMBEDDING_PROFILE.version),
      chunkCanonicalArticle(first, ACTIVE_EMBEDDING_PROFILE.version),
    )

    const excludedDescendants = canonicalizeArticleSource(snapshot(`
      <x>A<template><div>ignored wrapper</div></template>B</x>
      <ul><template><li>ignored item</li></template><li>Visible</li></ul>
      <table><template><tr><td>ignored row</td></tr></template><tr><td>Cell</td></tr></table>
      <figure><template><figcaption>ignored caption</figcaption></template><img alt="Diagram"></figure>
    `))
    const withoutExcludedDescendants = canonicalizeArticleSource(snapshot(`
      <x>AB</x>
      <ul><li>Visible</li></ul>
      <table><tr><td>Cell</td></tr></table>
      <figure><img alt="Diagram"></figure>
    `))
    assert.deepEqual(excludedDescendants.blocks, withoutExcludedDescendants.blocks)
    assert.equal(excludedDescendants.sourceHash, withoutExcludedDescendants.sourceHash)
  })

  it('title、language、heading path、block order、list/table semantics 变化都会重建', () => {
    const base = snapshot(`
      <h2>Section</h2><p>Alpha</p><p>Beta</p>
      <ul><li>Item</li></ul>
      <table><tr><th>Cell</th></tr></table>
    `)
    const baseHash = canonicalizeArticleSource(base).sourceHash
    const variants = [
      { ...base, title: 'Changed title' },
      { ...base, languageCode: 'zh-cn' },
      { ...base, content: base.content.replace('<h2>', '<h3>').replace('</h2>', '</h3>') },
      { ...base, content: base.content.replace('<p>Alpha</p><p>Beta</p>', '<p>Beta</p><p>Alpha</p>') },
      { ...base, content: base.content.replace('<ul>', '<ol>').replace('</ul>', '</ol>') },
      { ...base, content: base.content.replace('<th>Cell</th>', '<td>Cell</td>') },
    ]

    for (const variant of variants)
      assert.notEqual(canonicalizeArticleSource(variant).sourceHash, baseHash)
  })

  it('重复 heading occurrence 与可混淆 heading/table 文本仍产生不同 chunk', () => {
    const repeatedHeading = canonicalizeArticleSource(snapshot(
      '<h2>FAQ</h2><p>A</p><h2>FAQ</h2><p>B</p>',
    ))
    const singleHeading = canonicalizeArticleSource(snapshot(
      '<h2>FAQ</h2><p>A</p><p>B</p>',
    ))
    assert.equal(
      chunkCanonicalArticle(repeatedHeading, ACTIVE_EMBEDDING_PROFILE.version).length,
      2,
    )
    assert.equal(
      chunkCanonicalArticle(singleHeading, ACTIVE_EMBEDDING_PROFILE.version).length,
      1,
    )

    const headingText = canonicalizeArticleSource(snapshot(
      '<h2>A &gt; H3: B</h2><p>Body</p>',
    ))
    const headingTree = canonicalizeArticleSource(snapshot(
      '<h2>A</h2><h3>B</h3><p>Body</p>',
    ))
    assert.notEqual(
      chunkCanonicalArticle(headingText, ACTIVE_EMBEDDING_PROFILE.version)[0]!
        .embeddingInputHash,
      chunkCanonicalArticle(headingTree, ACTIVE_EMBEDDING_PROFILE.version)[0]!
        .embeddingInputHash,
    )

    const oneCell = canonicalizeArticleSource(snapshot(
      '<table><tr><td>A | [D] B</td></tr></table>',
    ))
    const twoCells = canonicalizeArticleSource(snapshot(
      '<table><tr><td>A</td><td>B</td></tr></table>',
    ))
    assert.notEqual(
      chunkCanonicalArticle(oneCell, ACTIVE_EMBEDDING_PROFILE.version)[0]!
        .embeddingInputHash,
      chunkCanonicalArticle(twoCells, ACTIVE_EMBEDDING_PROFILE.version)[0]!
        .embeddingInputHash,
    )
  })

  it('保留内联邻接、Unicode、列表序号、caption、空表格列和特殊 token 字面量', () => {
    const wrapped = canonicalizeArticleSource(snapshot(`
      <p>Hel<strong>lo</strong><a>!</a> 👩‍💻 &lt;|endoftext|&gt;</p>
      <ol><li>One</li><li value="5">Five</li><li>Six</li></ol>
      <table><caption>Visible stats</caption><tr><th>A</th><td></td><td>B</td></tr></table>
    `))
    const plain = canonicalizeArticleSource(snapshot(`
      <p>Hello! 👩‍💻 &lt;|endoftext|&gt;</p>
      <ol><li>One</li><li value="5">Five</li><li>Six</li></ol>
      <table><caption>Visible stats</caption><tr><th>A</th><td></td><td>B</td></tr></table>
    `))

    assert.deepEqual(wrapped.blocks, plain.blocks)
    assert.equal(wrapped.sourceHash, plain.sourceHash)
    assert.equal(wrapped.blocks[0]?.text, 'Hello! 👩‍💻 <|endoftext|>')
    assert.deepEqual(
      wrapped.blocks
        .filter(block => block.kind === 'list_item')
        .map(block => block.itemOrdinal),
      [1, 5, 6],
    )
    assert.deepEqual(wrapped.blocks.at(-2), {
      kind: 'table_caption',
      headingPath: [],
      text: 'Visible stats',
      tableIndex: 0,
    })
    const tableRow = wrapped.blocks.at(-1)
    assert.deepEqual(
      tableRow?.kind === 'table_row'
        ? tableRow.cells.map(cell => cell.text)
        : null,
      ['A', '', 'B'],
    )
    const remainingRows = canonicalizeArticleSource(snapshot(
      '<table><tr><td rowspan="0">A</td></tr><tr><td>B</td></tr></table>',
    ))
    const oneRow = canonicalizeArticleSource(snapshot(
      '<table><tr><td rowspan="1">A</td></tr><tr><td>B</td></tr></table>',
    ))
    assert.equal(
      remainingRows.blocks[0]?.kind === 'table_row'
        ? remainingRows.blocks[0].cells[0]?.rowspan
        : null,
      0,
    )
    assert.notEqual(remainingRows.sourceHash, oneRow.sourceHash)
    assert.notEqual(
      canonicalizeArticleSource(snapshot('<p>👩 💻</p>')).sourceHash,
      canonicalizeArticleSource(snapshot('<p>👩‍💻</p>')).sourceHash,
    )
    assert.deepEqual(
      canonicalizeArticleSource(snapshot(`
        <ol reversed start="-1"><li>First</li><li value="-4">Reset</li><li>Next</li></ol>
      `)).blocks.map(block => (
        block.kind === 'list_item' ? block.itemOrdinal : null
      )),
      [-1, -4, -5],
    )
    assert.ok(countArticleTokens('<|endoftext|>') > 1)
    assert.doesNotThrow(() => (
      chunkCanonicalArticle(wrapped, ACTIVE_EMBEDDING_PROFILE.version)
    ))
  })

  it('真实富 HTML 样本可重复生成逐字相同的块、hash、token 和 ID', () => {
    const articles = JSON.parse(
      readFileSync('../../prisma/fixtures/articles.json', 'utf8'),
    ) as Array<{
      sourceId: number
      title: string
      languageCode: string
      content: string
    }>
    const article = articles.find(item => item.sourceId === 44)
    assert.ok(article)
    const input = snapshot(article.content, {
      sourceId: article.sourceId,
      title: article.title,
      languageCode: article.languageCode,
    })
    const firstSource = canonicalizeArticleSource(input)
    const secondSource = canonicalizeArticleSource(input)
    const first = chunkCanonicalArticle(firstSource, ACTIVE_EMBEDDING_PROFILE.version)
    const second = chunkCanonicalArticle(secondSource, ACTIVE_EMBEDDING_PROFILE.version)

    assert.deepEqual(secondSource, firstSource)
    assert.deepEqual(second, first)
    assert.ok(first.length > 10)
    assert.ok(firstSource.blocks.some(block => block.kind === 'table_row'))
    assert.ok(firstSource.blocks.some(block => block.kind === 'figure'))
    assert.ok(firstSource.blocks.some(block => block.kind === 'list_item'))
    assert.ok(firstSource.blocks.some(block => block.kind === 'blockquote'))
    assert.deepEqual(first.map(chunk => chunk.ordinal), first.map((_, index) => index))
    assert.ok(first.every(chunk => (
      chunk.tokenCount === countArticleTokens(chunk.embeddingInput)
      && chunk.tokenCount <= ARTICLE_CHUNKER_PROFILE.hardMaxTokens
      && chunk.overlapTokenCount <= ARTICLE_CHUNKER_PROFILE.overlapTokens
      && /^[a-f\d]{64}$/.test(chunk.id)
      && /^[a-f\d]{64}$/.test(chunk.contentHash)
      && /^[a-f\d]{64}$/.test(chunk.embeddingInputHash)
    )))
  })

  it('常规 prose 按 600-token target 聚合，不把同步探针上限当作 chunk 边界', () => {
    const paragraph = 'ordinary words '.repeat(30).trim()
    const source = canonicalizeArticleSource(snapshot(
      `<h2>Section</h2>${Array.from({ length: 4 }).fill(`<p>${paragraph}</p>`).join('')}`,
    ))
    const chunks = chunkCanonicalArticle(source, ACTIVE_EMBEDDING_PROFILE.version)

    assert.equal(chunks.length, 1)
    assert.ok(chunks[0]!.tokenCount < ARTICLE_CHUNKER_PROFILE.targetTokens)
    assert.ok(chunks[0]!.content.length > 1_024)
  })

  it('块级 wrapper、嵌套列表顺序/层级与 empty list/table 均稳定规范化', () => {
    const divWrapped = canonicalizeArticleSource(snapshot(
      '<blockquote><div>First</div><section>Second</section></blockquote>',
    ))
    const paragraphWrapped = canonicalizeArticleSource(snapshot(
      '<blockquote><p>First</p><p>Second</p></blockquote>',
    ))
    assert.deepEqual(divWrapped.blocks, paragraphWrapped.blocks)
    assert.equal(divWrapped.sourceHash, paragraphWrapped.sourceHash)

    const nested = canonicalizeArticleSource(snapshot(`
      <ul><li>Before<ul><li>Nested</li></ul>After</li><li>Sibling</li></ul>
    `))
    assert.deepEqual(
      nested.blocks.map(block => block.kind === 'list_item'
        ? {
            text: block.text,
            depth: block.depth,
            continuation: block.continuation,
          }
        : null),
      [
        { text: 'Before', depth: 1, continuation: false },
        { text: 'Nested', depth: 2, continuation: false },
        { text: 'After', depth: 1, continuation: true },
        { text: 'Sibling', depth: 1, continuation: false },
      ],
    )
    const nestedContent = chunkCanonicalArticle(
      nested,
      ACTIVE_EMBEDDING_PROFILE.version,
    )[0]!.content
    assert.equal(
      nestedContent,
      '[List 1] - Before\n\n[In L1:unordered:item=1:ordinal=-] [List 2]   - Nested\n\n[List 1]   After\n\n[List 1] - Sibling',
    )

    const sibling = canonicalizeArticleSource(snapshot(
      '<ul><li>Before</li><li>Nested</li><li>After</li><li>Sibling</li></ul>',
    ))
    assert.notEqual(
      chunkCanonicalArticle(nested, ACTIVE_EMBEDDING_PROFILE.version)[0]!.contentHash,
      chunkCanonicalArticle(sibling, ACTIVE_EMBEDDING_PROFILE.version)[0]!.contentHash,
    )

    const emptyUnorderedParent = canonicalizeArticleSource(snapshot(
      '<ul><li><ul><li>Nested</li></ul></li></ul>',
    ))
    const emptyOrderedParent = canonicalizeArticleSource(snapshot(
      '<ol start="4"><li><ul><li>Nested</li></ul></li></ol>',
    ))
    assert.notEqual(emptyUnorderedParent.sourceHash, emptyOrderedParent.sourceHash)
    assert.notEqual(
      chunkCanonicalArticle(
        emptyUnorderedParent,
        ACTIVE_EMBEDDING_PROFILE.version,
      )[0]!.embeddingInputHash,
      chunkCanonicalArticle(
        emptyOrderedParent,
        ACTIVE_EMBEDDING_PROFILE.version,
      )[0]!.embeddingInputHash,
    )

    const meaningful = canonicalizeArticleSource(snapshot(`
      <ul><li>Item</li></ul>
      <table><tr><td>A</td><td></td><td>B</td></tr></table>
    `))
    const ignoredEmptyStructure = canonicalizeArticleSource(snapshot(`
      <ul><li></li></ul>
      <ul><li>Item</li></ul>
      <table><tr><td></td><td></td></tr></table>
      <table><tr><td>A</td><td></td><td>B</td></tr></table>
    `))
    assert.deepEqual(ignoredEmptyStructure.blocks, meaningful.blocks)
    assert.equal(ignoredEmptyStructure.sourceHash, meaningful.sourceHash)

    const empty = canonicalizeArticleSource(snapshot(`
      <ul><li></li></ul><table><tr><td></td><td></td></tr></table>
    `))
    assert.deepEqual(empty.blocks, [])
    assert.deepEqual(
      chunkCanonicalArticle(empty, ACTIVE_EMBEDDING_PROFILE.version),
      [],
    )
  })

  it('blockquote 内仍保留 list/table 结构语义与引用层级', () => {
    const quoted = canonicalizeArticleSource(snapshot(`
      <blockquote>
        <ul><li>Alpha</li><li>Beta</li></ul>
        <table><tr><th>Label</th><td>Value</td></tr></table>
      </blockquote>
    `))
    const unquoted = canonicalizeArticleSource(snapshot(`
      <ul><li>Alpha</li><li>Beta</li></ul>
      <table><tr><th>Label</th><td>Value</td></tr></table>
    `))
    const orderedQuote = canonicalizeArticleSource(snapshot(`
      <blockquote>
        <ol><li>Alpha</li><li>Beta</li></ol>
        <table><tr><th>Label</th><td>Value</td></tr></table>
      </blockquote>
    `))

    assert.deepEqual(
      quoted.blocks.map(block => ({
        kind: block.kind,
        quoteDepth: block.quoteDepth,
      })),
      [
        { kind: 'list_item', quoteDepth: 1 },
        { kind: 'list_item', quoteDepth: 1 },
        { kind: 'table_row', quoteDepth: 1 },
      ],
    )
    assert.notEqual(quoted.sourceHash, unquoted.sourceHash)
    assert.notEqual(quoted.sourceHash, orderedQuote.sourceHash)
    assert.match(
      chunkCanonicalArticle(quoted, ACTIVE_EMBEDDING_PROFILE.version)[0]!.content,
      /^> \[List 1\] - Alpha/m,
    )
  })

  it('list item 内的 table/blockquote/pre/heading 按 DOM 顺序保留 list context', () => {
    const structured = canonicalizeArticleSource(snapshot(`
      <ul><li>
        Before
        <table><tr><td>Cell</td></tr></table>
        <blockquote>Quote</blockquote>
        <pre>Code</pre>
        <h3>Nested heading</h3><p>After</p>
      </li></ul>
    `))
    assert.deepEqual(
      structured.blocks.map(block => ({
        kind: block.kind,
        text: block.text,
        hasListPath: Boolean(block.listPath),
      })),
      [
        { kind: 'list_item', text: 'Before', hasListPath: false },
        { kind: 'table_row', text: '| [D] "Cell" |', hasListPath: true },
        { kind: 'blockquote', text: 'Quote', hasListPath: true },
        { kind: 'code', text: 'Code', hasListPath: true },
        { kind: 'heading', text: 'Nested heading', hasListPath: true },
        { kind: 'list_item', text: 'After', hasListPath: false },
      ],
    )
    assert.notEqual(
      structured.sourceHash,
      canonicalizeArticleSource(snapshot('<ul><li>Before Cell Quote Code Nested heading After</li></ul>'))
        .sourceHash,
    )
    assert.match(
      chunkCanonicalArticle(structured, ACTIVE_EMBEDDING_PROFILE.version)
        .map(chunk => chunk.content)
        .join('\n'),
      /\[In L1:unordered:item=1:ordinal=-\] \[Table 1, row 1\]/,
    )
  })

  it('相邻 list/table 分组边界进入 embedding input，figure flow content 不被 caption 吞掉', () => {
    const oneList = canonicalizeArticleSource(snapshot(
      '<ul><li>A</li><li>B</li></ul>',
    ))
    const twoLists = canonicalizeArticleSource(snapshot(
      '<ul><li>A</li></ul><ul><li>B</li></ul>',
    ))
    const oneTable = canonicalizeArticleSource(snapshot(
      '<table><tr><td>A</td></tr><tr><td>B</td></tr></table>',
    ))
    const twoTables = canonicalizeArticleSource(snapshot(
      '<table><tr><td>A</td></tr></table><table><tr><td>B</td></tr></table>',
    ))

    assert.notDeepEqual(
      chunkCanonicalArticle(oneList, ACTIVE_EMBEDDING_PROFILE.version)
        .map(chunk => chunk.embeddingInput),
      chunkCanonicalArticle(twoLists, ACTIVE_EMBEDDING_PROFILE.version)
        .map(chunk => chunk.embeddingInput),
    )
    assert.notDeepEqual(
      chunkCanonicalArticle(oneTable, ACTIVE_EMBEDDING_PROFILE.version)
        .map(chunk => chunk.embeddingInput),
      chunkCanonicalArticle(twoTables, ACTIVE_EMBEDDING_PROFILE.version)
        .map(chunk => chunk.embeddingInput),
    )

    const figure = canonicalizeArticleSource(snapshot(`
      <figure>
        <p>Visible intro</p>
        <table><tr><td>Visible cell</td></tr></table>
        <img src="ignored.png" alt="fallback alt">
        <figcaption>Visible caption</figcaption>
        <pre>Visible code</pre>
      </figure>
    `))
    assert.deepEqual(
      figure.blocks.map(block => ({ kind: block.kind, text: block.text })),
      [
        { kind: 'paragraph', text: 'Visible intro' },
        { kind: 'table_row', text: '| [D] "Visible cell" |' },
        { kind: 'figure', text: 'Visible caption' },
        { kind: 'code', text: 'Visible code' },
      ],
    )
    assert.doesNotMatch(JSON.stringify(figure.blocks), /ignored\.png|fallback alt/)
  })

  it('oversized Unicode block 使用 tokenizer 硬切且不生成纯 overlap chunk', () => {
    const source = canonicalizeArticleSource(snapshot(
      `<h2>超长章节 🚀</h2><p>${'这是一个包含 emoji 🚀 与 English words 的超长句子。'.repeat(900)}</p>`,
    ))
    const chunks = chunkCanonicalArticle(source, ACTIVE_EMBEDDING_PROFILE.version)

    assert.ok(chunks.length > 2)
    assert.ok(chunks.some(chunk => chunk.overlapTokenCount > 0))
    for (const chunk of chunks) {
      assert.ok(chunk.tokenCount <= ARTICLE_CHUNKER_PROFILE.hardMaxTokens)
      assert.ok(chunk.overlapTokenCount <= ARTICLE_CHUNKER_PROFILE.overlapTokens)
      assert.ok(countArticleTokens(chunk.content) > chunk.overlapTokenCount)
      assert.doesNotMatch(chunk.content, /�/)
    }
  })

  it('大量句界流式处理，保留无空格 Unicode 句界并复用长 metadata token 计数', {
    timeout: 15_000,
  }, () => {
    const source = canonicalizeArticleSource(snapshot(
      `<p>${'甲。乙。'.repeat(5_100)}</p>`,
      { title: '-'.repeat(9_000), languageCode: 'zh-cn' },
    ))
    const chunks = chunkCanonicalArticle(source, ACTIVE_EMBEDDING_PROFILE.version)

    assert.ok(chunks.length > 10)
    assert.ok(chunks.every(chunk => (
      chunk.tokenCount <= ARTICLE_CHUNKER_PROFILE.hardMaxTokens
      && !chunk.content.includes('。 ')
    )))
  })

  it('无句界长块限制同步 tokenizer 探针并保持 hard max', { timeout: 10_000 }, () => {
    const body = 'a'.repeat(10_000)
    const source = canonicalizeArticleSource(snapshot(`<p>${body}</p>`))
    const chunks = chunkCanonicalArticle(source, ACTIVE_EMBEDDING_PROFILE.version)

    assert.ok(chunks.length > 1)
    assert.ok(chunks.every(chunk => /^a+(?:\n\na+)*$/.test(chunk.content)))
    assert.ok(
      chunks.reduce(
        (length, chunk) => length + chunk.content.replaceAll('\n', '').length,
        0,
      ) >= body.length,
    )
    assert.ok(chunks.every(chunk => (
      chunk.tokenCount <= ARTICLE_CHUNKER_PROFILE.hardMaxTokens
      && chunk.tokenCount === countArticleTokens(chunk.embeddingInput)
    )))

    const compressibleTitle = canonicalizeArticleSource(snapshot('<p>body</p>', {
      title: 'a'.repeat(1_100),
    }))
    assert.ok(
      chunkCanonicalArticle(compressibleTitle, ACTIVE_EMBEDDING_PROFILE.version)
        .every(chunk => chunk.tokenCount <= ARTICLE_CHUNKER_PROFILE.hardMaxTokens),
    )

    assert.deepEqual(
      ['-', '=', '_', 'a'].map(character => (
        countArticleTokens(character.repeat(9_000))
      )),
      [141, 142, 142, 1_125],
    )
    const longCompressibleTitle = canonicalizeArticleSource(snapshot('<p>body</p>', {
      title: '-'.repeat(9_000),
    }))
    assert.ok(
      chunkCanonicalArticle(longCompressibleTitle, ACTIVE_EMBEDDING_PROFILE.version)
        .every(chunk => chunk.tokenCount <= ARTICLE_CHUNKER_PROFILE.hardMaxTokens),
    )
  })

  it('oversized 结构块的每个新内容分片都重复稳定类型标记', () => {
    const longText = 'Sentence with content '.repeat(1_500)
    const cases = [
      { html: `<blockquote>${longText}</blockquote>`, marker: '> ' },
      { html: `<pre>${longText}</pre>`, marker: 'Code: ' },
      { html: `<ul><li>${longText}</li></ul>`, marker: '- ' },
    ]

    for (const { html, marker } of cases) {
      const chunks = chunkCanonicalArticle(
        canonicalizeArticleSource(snapshot(html)),
        ACTIVE_EMBEDDING_PROFILE.version,
      )
      assert.ok(chunks.length > 1)
      assert.ok(chunks.every(chunk => chunk.content.includes(marker)))
      assert.ok(chunks.every(chunk => (
        chunk.tokenCount <= ARTICLE_CHUNKER_PROFILE.hardMaxTokens
      )))
    }
  })

  it('empty HTML 返回 0 chunk，无法容纳正文的超长 prefix fail closed', () => {
    const empty = canonicalizeArticleSource(snapshot(`
      <style>.hidden { display:none }</style>
      <script>secret()</script>
      <iframe src="https://example.com"></iframe>
      <figure><img src="https://example.com/no-alt.png"></figure>
    `))
    assert.deepEqual(empty.blocks, [])
    assert.deepEqual(
      chunkCanonicalArticle(empty, ACTIVE_EMBEDDING_PROFILE.version),
      [],
    )

    const impossible = canonicalizeArticleSource(snapshot('<p>body</p>', {
      title: 'metadata '.repeat(2_000),
    }))
    assert.throws(
      () => chunkCanonicalArticle(impossible, ACTIVE_EMBEDDING_PROFILE.version),
      /metadata prefix leaves no room/,
    )
  })
})

function snapshot(
  content: string,
  overrides: Partial<ArticleSourceSnapshot> = {},
): ArticleSourceSnapshot {
  return {
    id: 'article-test',
    sourceId: 1,
    title: 'Test Article',
    languageCode: 'en',
    content,
    updatedAt: new Date('2026-08-14T00:00:00.000Z'),
    ...overrides,
  }
}
