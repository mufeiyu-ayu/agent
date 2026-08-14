import type {
  ArticleIndexer,
} from './article-indexer.js'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import process from 'node:process'

// 项目使用 Node 原生测试运行器，不引入额外测试框架。
// eslint-disable-next-line test/no-import-node-test
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  createArticleIndexSummary,
  isArticleIndexSummarySuccessful,
} from './article-indexer.js'
import {
  executeArticleIndexCli,
  parseArticleIndexCliArgs,
  resolveArticleIndexDatabaseUrl,
  serializeArticleIndexSummary,
} from './article-indexing.cli.js'

describe('Article indexing CLI', () => {
  it('只接受显式 mode 和可选正安全 source-id', () => {
    assert.deepEqual(parseArticleIndexCliArgs(['--mode=incremental']), {
      mode: 'incremental',
      databaseScope: 'normal',
    })
    assert.deepEqual(parseArticleIndexCliArgs(['--', '--mode=incremental']), {
      mode: 'incremental',
      databaseScope: 'normal',
    })
    assert.deepEqual(
      parseArticleIndexCliArgs(['--source-id=24', '--mode=full']),
      { mode: 'full', sourceId: 24, databaseScope: 'normal' },
    )
    assert.deepEqual(
      parseArticleIndexCliArgs([
        '--database-scope=integration',
        '--',
        '--mode=full',
      ]),
      { mode: 'full', databaseScope: 'integration' },
    )

    const invalid = [
      [],
      ['--mode=other'],
      ['--mode=full', '--mode=full'],
      ['--source-id=1'],
      ['--mode=full', '--source-id=0'],
      ['--mode=full', '--source-id=-1'],
      ['--mode=full', '--source-id=1.5'],
      ['--mode=full', `--source-id=${Number.MAX_SAFE_INTEGER + 1}`],
      ['--mode', 'full'],
      ['--', '--', '--mode=full'],
      ['--mode=full', '--', '--'],
      ['--mode=full', '--database-scope=normal'],
      [
        '--mode=full',
        '--database-scope=integration',
        '--database-scope=integration',
      ],
      ['--api-key=must-not-leak'],
    ]

    for (const args of invalid)
      assert.throws(() => parseArticleIndexCliArgs(args), /invalid article indexing arguments/)

    let message = ''
    try {
      parseArticleIndexCliArgs(['--api-key=must-not-leak'])
    }
    catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    assert.doesNotMatch(message, /must-not-leak/)
  })

  it('pnpm normal/integration 入口透传的参数分隔符可到达 mode 校验', () => {
    for (const script of ['index:articles', 'index:articles:integration']) {
      const result = spawnSync(
        'corepack',
        ['pnpm', '--filter', '@agent/api', script, '--', '--mode=invalid'],
        {
          cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
          encoding: 'utf8',
        },
      )
      const output = `${result.stdout}${result.stderr}`

      assert.equal(result.status, 1)
      assert.match(output, /--mode 只接受 incremental 或 full/)
      assert.doesNotMatch(output, /存在不支持参数/)
    }
  })

  it('normal 模式只选择 DATABASE_URL', () => {
    assert.equal(resolveArticleIndexDatabaseUrl('normal', {
      DATABASE_URL: ' postgresql://development/database ',
      ARTICLE_INDEX_TEST_DATABASE_URL: 'postgresql://integration/database',
    }), 'postgresql://development/database')

    assert.throws(() => resolveArticleIndexDatabaseUrl('normal', {
      ARTICLE_INDEX_TEST_DATABASE_URL: 'postgresql://integration/database',
    }), /DATABASE_URL 未配置/)
  })

  it('integration 模式只选择 ARTICLE_INDEX_TEST_DATABASE_URL', () => {
    assert.equal(resolveArticleIndexDatabaseUrl('integration', {
      DATABASE_URL: 'postgresql://development/database',
      ARTICLE_INDEX_TEST_DATABASE_URL: ' postgresql://integration/database ',
    }), 'postgresql://integration/database')
  })

  it('integration 变量缺失时 fail closed，不回退 DATABASE_URL', () => {
    assert.throws(() => resolveArticleIndexDatabaseUrl('integration', {
      DATABASE_URL: 'postgresql://development/database',
    }), /ARTICLE_INDEX_TEST_DATABASE_URL 未配置/)
  })

  it('integration 入口先检查隔离 URL，再解析 provider 配置', () => {
    const result = spawnSync(
      'corepack',
      [
        'pnpm',
        '--filter',
        '@agent/api',
        'index:articles:integration',
        '--',
        '--mode=full',
      ],
      {
        cwd: fileURLToPath(new URL('../../../../', import.meta.url)),
        encoding: 'utf8',
        env: {
          ...process.env,
          ARTICLE_INDEX_TEST_DATABASE_URL: '',
          GEMINI_API_KEY: '',
        },
      },
    )
    const output = `${result.stdout}${result.stderr}`

    assert.equal(result.status, 1)
    assert.match(output, /ARTICLE_INDEX_TEST_DATABASE_URL 未配置/)
    assert.doesNotMatch(output, /GEMINI_API_KEY 未配置/)
  })

  it('integration 与 development URL 相同时失败', () => {
    assert.throws(() => resolveArticleIndexDatabaseUrl('integration', {
      DATABASE_URL: 'postgresql://same/database',
      ARTICLE_INDEX_TEST_DATABASE_URL: 'postgresql://same/database',
    }), /不得与 DATABASE_URL 相同/)
  })

  it('非法参数在 runtime/DB/provider factory 前失败', async () => {
    let factoryCalls = 0

    await assert.rejects(
      executeArticleIndexCli(
        ['--mode=invalid'],
        new AbortController().signal,
        async (_databaseScope) => {
          factoryCalls += 1
          assert.fail('runtime factory must not run')
        },
      ),
      /invalid article indexing arguments/,
    )
    assert.equal(factoryCalls, 0)

    const abortController = new AbortController()
    abortController.abort()
    const aborted = await executeArticleIndexCli(
      ['--mode=incremental'],
      abortController.signal,
      async (_databaseScope) => {
        factoryCalls += 1
        assert.fail('aborted CLI must not create runtime')
      },
    )
    assert.equal(aborted.aborted, true)
    assert.equal(factoryCalls, 0)
  })

  it('传递 mode/sourceId/signal、关闭 runtime，并用 summary 决定 exit 语义', async () => {
    const abortController = new AbortController()
    let closed = 0
    const expected = createArticleIndexSummary({ mode: 'full', sourceId: 24 })
    expected.indexed = 1
    expected.chunksWritten = 2
    const indexer = {
      run: async (options: unknown) => {
        assert.deepEqual(options, {
          mode: 'full',
          sourceId: 24,
          signal: abortController.signal,
        })
        return expected
      },
    } as unknown as ArticleIndexer

    const summary = await executeArticleIndexCli(
      ['--mode=full', '--source-id=24'],
      abortController.signal,
      async (databaseScope) => {
        assert.equal(databaseScope, 'normal')
        return {
          indexer,
          close: async () => void (closed += 1),
        }
      },
    )

    assert.equal(summary, expected)
    assert.equal(closed, 1)
    assert.equal(isArticleIndexSummarySuccessful(summary), true)
  })

  it('integration 参数传递给 runtime factory', async () => {
    const indexer = {
      run: async () => createArticleIndexSummary({ mode: 'incremental' }),
    } as unknown as ArticleIndexer

    await executeArticleIndexCli(
      ['--database-scope=integration', '--mode=incremental'],
      new AbortController().signal,
      async (databaseScope) => {
        assert.equal(databaseScope, 'integration')
        return {
          indexer,
          close: async () => undefined,
        }
      },
    )
  })

  it('failed/stale/fatal/aborted 均为非成功，JSON 不包含正文、向量或 secret 字段', () => {
    for (const mutate of [
      (summary: ReturnType<typeof createArticleIndexSummary>) => void (summary.failed = 1),
      (summary: ReturnType<typeof createArticleIndexSummary>) => void (summary.stale = 1),
      (summary: ReturnType<typeof createArticleIndexSummary>) => void (summary.aborted = true),
      (summary: ReturnType<typeof createArticleIndexSummary>) => void (summary.fatal = {
        code: 'database',
        message: 'safe database summary',
      }),
    ]) {
      const summary = createArticleIndexSummary({ mode: 'incremental' })
      mutate(summary)
      assert.equal(isArticleIndexSummarySuccessful(summary), false)
    }

    const summary = createArticleIndexSummary({ mode: 'incremental' })
    summary.errors.push({
      sourceId: 24,
      code: 'chunking',
      message: 'Article chunking failed',
    })
    const json = serializeArticleIndexSummary(summary)
    assert.deepEqual(JSON.parse(json), summary)
    assert.doesNotMatch(json, /content|embeddingInput|vector|apiKey|rawPayload|secret/i)
  })

  it('runtime 初始化和 close 失败转换为安全 fatal summary', async () => {
    const initialization = await executeArticleIndexCli(
      ['--mode=incremental'],
      new AbortController().signal,
      async (_databaseScope) => {
        throw new Error('postgresql://user:secret@host/db')
      },
    )
    assert.equal(initialization.fatal?.code, 'database')
    assert.doesNotMatch(JSON.stringify(initialization), /user:secret/)

    const indexer = {
      run: async () => createArticleIndexSummary({ mode: 'incremental' }),
    } as unknown as ArticleIndexer
    const closeFailure = await executeArticleIndexCli(
      ['--mode=incremental'],
      new AbortController().signal,
      async _databaseScope => ({
        indexer,
        close: async () => {
          throw new Error('secret close payload')
        },
      }),
    )
    assert.equal(closeFailure.fatal?.code, 'database')
    assert.doesNotMatch(JSON.stringify(closeFailure), /secret close payload/)
  })
})
