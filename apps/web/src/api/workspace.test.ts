import assert from 'node:assert/strict'
import { it, onTestFinished, vi } from 'vitest'
import { http } from './http'
import { getWorkspaceArchive } from './workspace'

it('完整 Source ZIP 使用匹配后端30秒预算的请求时限，仍传递取消和固定 revision', async () => {
  const signal = new AbortController().signal
  const get = vi.spyOn(http, 'get').mockResolvedValue({ data: { revision: 7, encoding: 'base64', content: 'QQ==' } })
  onTestFinished(() => get.mockRestore())
  assert.deepEqual(await getWorkspaceArchive('c', 7, signal), new Uint8Array([65]))
  const [url, config] = get.mock.calls[0]!
  assert.equal(url, '/api/conversations/c/workspace/archive')
  assert.equal(config?.timeout, 35_000)
  assert.equal(config?.signal, signal)
  assert.deepEqual(config?.params, { revision: 7 })
})
