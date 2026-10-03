import type { WorkspaceService } from '../../workspaces/workspace.service.js'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { it, onTestFinished } from 'vitest'
import { FILE_SCRIPT } from '../../workspaces/sandbox-scripts.js'
import { ToolInvocationService } from '../core/tool-invocation.service.js'
import { ToolRegistryService } from '../core/tool-registry.service.js'
import { readDefinition, ReadTool } from './workspace-tools.js'

const exec = promisify(execFile)

async function reader(content: string, path = '文件"😀.txt') {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'workspace-read-')))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  await writeFile(join(root, path), content)
  // 执行真实 FILE_SCRIPT；仅将固定云端目录和账号映射到本机临时目录/当前账号，不模拟读取或分页。
  const script = `import os,pwd\npwd.getpwnam=lambda _:pwd.getpwuid(os.getuid())\n${FILE_SCRIPT.replace('ROOT=\'/workspace/project\'', `ROOT=${JSON.stringify(root)}`)}`
  const service = {
    fileOperation: async (_execution: unknown, request: unknown) => {
      const input = join(root, '.request.json')
      await writeFile(input, JSON.stringify(request))
      const { stdout } = await exec('python3', ['-I', '-S', '-c', script, input], { maxBuffer: 4 * 1024 * 1024 })
      return JSON.parse(stdout)
    },
    releaseRun: async () => {},
    reportError: async () => {},
  } as unknown as WorkspaceService
  const registry = new ToolRegistryService()
  registry.register({ definition: readDefinition, executor: new ReadTool(service) })
  const invocation = new ToolInvocationService(registry)
  return {
    root,
    read: async (offset = 1, limit = 200) => {
      const result = await invocation.invoke({ toolName: 'read', callId: 'read-fixture', rawArgumentsJson: JSON.stringify({ path, offset, limit }) }, {
        signal: new AbortController().signal,
        databaseDeadline: { deadlineAt: Date.now() + 60_000, createTimeoutError: () => new Error('fixture deadline') },
        serperApiKey: { configured: false } as never,
        workspace: { userId: 'u', conversationId: 'c', runId: 'r', deadlineAt: Date.now() + 60_000 },
        argumentsTruncated: false,
      })
      assert.equal(result.result.ok, true)
      assert.equal(result.observation.truncated, false, '最终 observation 不能截掉 read 续读协议')
      assert.ok(result.observation.observationChars <= readDefinition.maxObservationChars)
      return JSON.parse(result.observation.content) as { content: string, totalLines: number, offset: number, nextOffset: number | null, truncated?: boolean, readCommand?: string, hint?: string }
    },
  }
}

it('R4：真实文件脚本经 ReadTool 和 observation 连续读取长文本，Unicode 与 JSON 开销不导致跳行', async () => {
  const lines = Array.from({ length: 250 }, (_, index) => `${index + 1} ${'x'.repeat(180)}\t"\\😀中文`)
  const fixture = await reader(lines.join('\n'))
  const received: string[] = []
  let offset: number | null = 1
  while (offset !== null) {
    const page = await fixture.read(offset)
    const chunk = page.content.split('\n')
    assert.equal(page.totalLines, 250)
    assert.ok(chunk.length > 0)
    received.push(...chunk)
    assert.equal(page.nextOffset, received.length < lines.length ? received.length + 1 : null)
    offset = page.nextOffset
  }
  assert.deepEqual(received, lines.map((line, index) => `${index + 1}: ${line}`))
})

it('R4：超长单行不假报 EOF，返回的 bash 替代命令可以逐段读完原文', async () => {
  const content = '😀"\\\t\0中'.repeat(5000)
  const fixture = await reader(content)
  const page = await fixture.read()
  assert.equal(page.nextOffset, 1)
  assert.equal(page.truncated, true)
  assert.equal(page.content, '')
  assert.ok(page.readCommand)
  assert.match(page.hint!, /nextCharOffset/)
  let offset: number | null = 0
  let received = ''
  while (offset !== null) {
    // 只运行本次实际返回的命令；不假冒云端 Linux/seccomp 验证。
    const { stdout } = await exec('/bin/bash', ['-c', page.readCommand.replace('start=0;', `start=${offset};`)], { cwd: fixture.root })
    const chunk = JSON.parse(stdout) as { content: string, nextCharOffset: number | null }
    received += chunk.content
    assert.ok(chunk.content.length > 0)
    assert.ok(chunk.nextCharOffset === null || chunk.nextCharOffset > offset)
    offset = chunk.nextCharOffset
  }
  assert.equal(received, content)
}, 15000)

it('R4：短文件仍返回完整行号、正确 offset/limit 与 EOF', async () => {
  const fixture = await reader('第一行\n第二行\n第三行\n')
  const first = await fixture.read(1, 2)
  assert.equal(first.content, '1: 第一行\n2: 第二行')
  assert.equal(first.nextOffset, 3)
  const last = await fixture.read(first.nextOffset)
  assert.equal(last.content, '3: 第三行')
  assert.equal(last.nextOffset, null)
})
