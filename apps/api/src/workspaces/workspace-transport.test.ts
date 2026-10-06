import type { Sandbox } from 'e2b'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { rm, stat, writeFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { promisify } from 'node:util'
import { it } from 'vitest'
import { WorkspaceCloudService } from './workspace-cloud.service.js'

const exec = promisify(execFile)

it('真实可信监督：大结果走 root-only GZIP 文件/有界流，原文完整，解压超限拒绝且清理两个临时文件', async () => {
  for (const bytes of [1024, 9 * 1024 * 1024, 13 * 1024 * 1024]) {
    const paths = new Set<string>()
    let commandStdout = ''
    const sandbox = {
      files: {
        write: async (path: string, content: string, options: { user: string }) => {
          assert.equal(options.user, 'root')
          paths.add(path)
          await writeFile(path, content)
        },
        read: async (path: string, options: { user: string, format: string }) => {
          assert.equal(options.user, 'root')
          assert.equal(options.format, 'stream')
          assert.equal((await stat(path)).mode & 0o777, 0o600)
          return Readable.toWeb(createReadStream(path))
        },
        remove: async (path: string) => {
          await rm(path, { force: true })
        },
      },
      commands: { run: async (command: string, options: { user: string, cwd: string }) => {
        assert.equal(options.user, 'root')
        assert.equal(options.cwd, '/')
        const output = await exec('/bin/bash', ['-c', command.replace('/usr/local/bin/python3', 'python3')], { maxBuffer: 1024 })
        commandStdout = output.stdout
      } },
    } as unknown as Sandbox
    const cloud = new WorkspaceCloudService()
    const request = cloud.request(sandbox, `import json;print(json.dumps({'content':'x'*${bytes}}))`, {}, AbortSignal.timeout(10_000))
    if (bytes > 12 * 1024 * 1024)
      await assert.rejects(request)
    else
      assert.equal((await request as { content: string }).content.length, bytes)
    assert.equal(commandStdout, '', '完整 Source/dist 不占用 envd stdout')
    for (const path of paths) {
      await assert.rejects(stat(path), { code: 'ENOENT' })
      await assert.rejects(stat(`${path}.result`), { code: 'ENOENT' })
    }
  }
})
