import type { WorkspaceService } from '../../workspaces/workspace.service.js'
import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { topuplistTraffic, trafficDefinition } from './topuplist-traffic.tool.js'
import { bashDefinition, editDefinition, readDefinition, writeDefinition, WriteTool } from './workspace-tools.js'

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
