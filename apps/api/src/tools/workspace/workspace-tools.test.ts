import type { WorkspaceService } from '../../workspaces/workspace.service.js'
import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { topuplistTraffic, trafficDefinition } from './topuplist-traffic.tool.js'
import { bashDefinition, BashTool, editDefinition, readDefinition, writeDefinition, WriteTool } from './workspace-tools.js'

describe('代码工具输入契约', () => {
  it('校验路径、内容、替换与命令时限，不接受模型覆盖工作区身份', () => {
    assert.deepEqual(readDefinition.input.parse({ path: 'src/a.js' }), { path: 'src/a.js', offset: 1, limit: 200 })
    assert.deepEqual(editDefinition.input.parse({ path: 'a.js', edits: [{ oldText: 'a', newText: 'b' }] }).edits, [{ oldText: 'a', newText: 'b' }])
    assert.equal(writeDefinition.input.parse({ path: 'a.js', content: '' }).content, '')
    assert.deepEqual(editDefinition.input.parse({ path: 'a.js', edits: [{ oldText: '\n\n', newText: '\n' }] }).edits, [{ oldText: '\n\n', newText: '\n' }])
    assert.equal(bashDefinition.input.parse({ command: 'node --version' }).timeout, 60)
    for (const value of [{ path: '../secret' }, { path: 'a', offset: 0 }, { path: 'a', userId: 'other' }, { path: 'a', limit: 1001 }])
      assert.throws(() => readDefinition.input.parse(value))
    assert.throws(() => writeDefinition.input.parse({ path: 'a', content: '中'.repeat(800000) }))
    assert.throws(() => editDefinition.input.parse({ path: 'a', edits: [{ oldText: '', newText: 'b' }] }))
    assert.throws(() => bashDefinition.input.parse({ command: 'echo hi', timeout: 1000 }))
    assert.throws(() => bashDefinition.input.parse({ command: 'echo hi', sandboxId: 'other' }))
  })

  it('缺少后端身份时完全不执行写入', async () => {
    let invoked = false
    const service = { fileOperation: async () => {
      invoked = true
    } } as unknown as WorkspaceService
    const result = await new WriteTool(service).execute({ toolName: 'write', input: { path: 'x', content: 'y' } }, {
      signal: new AbortController().signal,
      databaseDeadline: { deadlineAt: Date.now() + 1000, createTimeoutError: () => new Error('timeout') },
      serperApiKey: { configured: false } as never,
    })
    assert.equal(result.ok, false)
    assert.equal(invoked, false)
  })
})

describe('bash 输出截断事实', () => {
  const output = `${'a'.repeat(6000)}${'b'.repeat(1000)}${'z'.repeat(6000)}`
  const shortened = `${'a'.repeat(6000)}\n[中间输出已截断]\n${'z'.repeat(6000)}`
  const boundary = 'a'.repeat(12_000)
  const overBoundary = `${boundary}z`
  const shortenedBoundary = `${'a'.repeat(6000)}\n[中间输出已截断]\n${'a'.repeat(5999)}z`
  const unicodeBoundary = '😀'.repeat(6000)
  const shortenedUnicode = `${'😀'.repeat(3000)}\n[中间输出已截断]\n${'😀'.repeat(3000)}`

  it.each([
    { name: 'stdout 13000 码元超限', stdout: output, stderr: '', collected: false, truncated: true, expectedStdout: shortened, expectedStderr: '' },
    { name: 'stderr 13000 码元超限', stdout: 'stdout', stderr: output, collected: false, truncated: true, expectedStdout: 'stdout', expectedStderr: shortened },
    { name: '两路空输出', stdout: '', stderr: '', collected: false, truncated: false, expectedStdout: '', expectedStderr: '' },
    { name: '两路短输出逐字不变', stdout: 'stdout\n', stderr: 'stderr\n', collected: false, truncated: false, expectedStdout: 'stdout\n', expectedStderr: 'stderr\n' },
    { name: '两路恰好 12000 码元', stdout: boundary, stderr: boundary, collected: false, truncated: false, expectedStdout: boundary, expectedStderr: boundary },
    { name: 'stdout 12001 码元', stdout: overBoundary, stderr: '', collected: false, truncated: true, expectedStdout: shortenedBoundary, expectedStderr: '' },
    { name: 'stderr 12001 码元', stdout: '', stderr: overBoundary, collected: false, truncated: true, expectedStdout: '', expectedStderr: shortenedBoundary },
    { name: 'Unicode 恰好 12000 码元', stdout: unicodeBoundary, stderr: '', collected: false, truncated: false, expectedStdout: unicodeBoundary, expectedStderr: '' },
    { name: 'Unicode 按 JS string.length 截短', stdout: `${unicodeBoundary}😀`, stderr: '', collected: false, truncated: true, expectedStdout: shortenedUnicode, expectedStderr: '' },
    { name: '保留采集层截断事实', stdout: 'stdout', stderr: 'stderr', collected: true, truncated: true, expectedStdout: 'stdout', expectedStderr: 'stderr' },
  ])('$name', async ({ stdout, stderr, collected, truncated, expectedStdout, expectedStderr }) => {
    const commit = { conversationId: 'c', runId: 'r', expectedRevision: 2, files: [] }
    const service = {
      bash: async () => ({ stdout, stderr, exitCode: 7, truncated: collected, timedOut: false }),
      prepareCommit: async () => commit,
    } as unknown as WorkspaceService
    const result = await new BashTool(service).execute({ toolName: 'bash', input: bashDefinition.input.parse({ command: 'echo fixture' }) }, {
      signal: new AbortController().signal,
      databaseDeadline: { deadlineAt: Date.now() + 1000, createTimeoutError: () => new Error('timeout') },
      serperApiKey: { configured: false } as never,
      workspace: { userId: 'u', conversationId: 'c', runId: 'r', deadlineAt: Date.now() + 1000 },
    })
    assert.equal(result.ok, true)
    assert.deepEqual(JSON.parse(result.modelContent), {
      exitCode: 7,
      stderr: expectedStderr,
      stdout: expectedStdout,
      truncated,
      saved: true,
      revision: 3,
      files: [],
    })
    assert.equal(result.workspaceCommit, commit)
    assert.equal(result.display?.workspace?.stdout, stdout)
    assert.equal(result.display?.workspace?.stderr, stderr)
    assert.equal(result.display?.failure, 'failed')
  })
})

describe('topuplist 流量 Demo', () => {
  it('提供七个完整日期、可核对的合计和明确演示来源', () => {
    const data = topuplistTraffic(new Date('2026-10-02T08:00:00Z'))
    assert.equal(data.source, 'demo')
    assert.equal(data.period.start, '2026-09-25')
    assert.equal(data.period.end, '2026-10-01')
    assert.equal(data.daily.length, 7)
    assert.equal(data.totals.visitors, data.channels.reduce((sum, item) => sum + item.visitors, 0))
    assert.equal(data.totals.pageViews, data.topPages.reduce((sum, item) => sum + item.views, 0))
    assert.throws(() => trafficDefinition.input.parse({ days: 30 }))
  })
})
