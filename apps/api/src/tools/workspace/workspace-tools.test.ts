import type { WorkspaceService } from '../../workspaces/workspace.service.js'
import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { ToolInvocationService } from '../core/tool-invocation.service.js'
import { ToolRegistryService } from '../core/tool-registry.service.js'
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
  it.each([
    { stdout: '', stderr: '', collected: false, longPaths: true },
    { stdout: 'stdout\n', stderr: 'stderr\n', collected: false, longPaths: true },
    { stdout: `HEAD\n${'a'.repeat(11992)}\nTAIL`, stderr: 'e'.repeat(11992), collected: false, longPaths: true },
    { stdout: `HEAD\n${'\\"\n😀'.repeat(8000)}\nTAIL`, stderr: '\\\\'.repeat(20000), collected: false, longPaths: true },
    { stdout: 'stdout', stderr: 'stderr', collected: true, longPaths: true },
    { stdout: 'short stdout', stderr: '', collected: false, longPaths: false },
    { stdout: `HEAD\n${'a'.repeat(11992)}\nTAIL`, stderr: 'e'.repeat(11992), collected: false, longPaths: false },
  ])('实际 invoke 保留交付身份与日志首尾，预算含转义及 Unicode（case %#）', async ({ stdout, stderr, collected, longPaths }) => {
    const files = Array.from({ length: 40 }, (_, index) => ({ path: longPaths ? `${index}-${'很长的路径'.repeat(80)}.txt` : `${index}.txt`, sha256: 'a'.repeat(64), bytes: 1, key: 'unused' }))
    const commit = { conversationId: 'c', runId: 'r', expectedRevision: 2, files, artifact: { id: 'artifact-confirmed', userId: 'u', sourceRevision: 3, command: 'pnpm build', createdAt: new Date().toISOString(), files } }
    const service = {
      bash: async () => ({ stdout, stderr, exitCode: 7, truncated: collected, timedOut: false }),
      prepareCommit: async () => commit,
    } as unknown as WorkspaceService
    const registry = new ToolRegistryService()
    registry.register({ definition: bashDefinition, executor: new BashTool(service) })
    const invocation = await new ToolInvocationService(registry).invoke({ callId: 'call', toolName: 'bash', rawArgumentsJson: '{"command":"echo fixture"}' }, {
      argumentsTruncated: false,
      signal: new AbortController().signal,
      databaseDeadline: { deadlineAt: Date.now() + 5000, createTimeoutError: () => new Error('timeout') },
      serperApiKey: { configured: false } as never,
      workspace: { userId: 'u', conversationId: 'c', runId: 'r', deadlineAt: Date.now() + 5000 },
    })
    const { result, observation } = invocation
    assert.equal(result.ok, true)
    assert.equal(observation.truncated, false, '最终 JSON 不应再被全局开头截断')
    assert.ok(observation.observationChars <= 24000)
    const payload = JSON.parse(observation.content)
    assert.equal(payload.saved, true)
    assert.equal(payload.revision, 3)
    assert.equal(payload.exitCode, 7)
    assert.equal(payload.artifact.id, commit.artifact.id)
    assert.equal(payload.artifact.fileCount, 40)
    assert.equal(payload.filesOmitted, files.length - payload.files.length)
    assert.equal(payload.artifactFilesOmitted, files.length - payload.artifact.files.length)
    if (stdout.length < 100) {
      assert.equal(payload.stdout, stdout)
      assert.equal(payload.stderr, stderr)
      assert.equal(payload.truncated, collected)
      assert.equal(payload.files.length, 20, '预算足够时不再裁剪已选择的清单')
      assert.equal(payload.artifact.files.length, 20)
    }
    else {
      assert.equal(payload.truncated, true)
      assert.ok(payload.stdout.startsWith('HEAD\n') && payload.stdout.endsWith('\nTAIL'))
      assert.match(payload.stdout, /中间输出已截断/)
      assert.equal(payload.stdout.isWellFormed(), true)
      assert.equal(payload.stderr.isWellFormed(), true)
    }
    if (result.ok)
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
