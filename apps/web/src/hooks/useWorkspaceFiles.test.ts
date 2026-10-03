import type { WorkspaceSnapshot } from '@agent/contracts'
import assert from 'node:assert/strict'
import { afterEach, it, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { getWorkspace, getWorkspaceFile } from '../api/workspace'
import { useWorkspaceFiles } from './useWorkspaceFiles'

vi.mock('../api/workspace', () => ({ getWorkspace: vi.fn(), getWorkspaceFile: vi.fn() }))
afterEach(() => vi.resetAllMocks())
const snapshot = (revision: number, conversationId = 'a'): WorkspaceSnapshot => ({ configured: true, conversationId, revision, state: 'idle', files: [], lastOperation: null, lastError: null, updatedAt: null })

it('显式刷新等到在途请求之后的新快照，不能提前用旧版本打开文件', async () => {
  const responses: Array<(value: WorkspaceSnapshot) => void> = []
  vi.mocked(getWorkspace).mockImplementation(() => new Promise(resolve => responses.push(resolve)))
  const scope = effectScope()
  const files = scope.run(() => useWorkspaceFiles(ref('a'), ref('idle')))!
  let finished = false
  const refresh = files.refresh().then(() => {
    finished = true
  })
  try {
    await Promise.resolve()
    await Promise.resolve()
    assert.equal(finished, false)
    responses[0]!(snapshot(1))
    await vi.waitFor(() => assert.equal(responses.length, 2))
    assert.equal(finished, false)
    responses[1]!(snapshot(2))
    await refresh
    assert.equal(files.snapshot.value?.revision, 2)
    assert.equal(files.loading.value, false)
  }
  finally {
    scope.stop()
    for (const respond of responses)
      respond(snapshot(2))
    await refresh
  }
})

it('切换会话后丢弃旧快照与下载结果，不把旧文件当作新会话文件', async () => {
  const responses = new Map<string, (value: WorkspaceSnapshot) => void>()
  vi.mocked(getWorkspace).mockImplementation(id => new Promise(resolve => responses.set(id, resolve)))
  const conversation = ref<string | null>('a')
  const scope = effectScope()
  const files = scope.run(() => useWorkspaceFiles(conversation, ref('idle')))!
  try {
    responses.get('a')!(snapshot(1))
    await vi.waitFor(() => assert.equal(files.snapshot.value?.revision, 1))
    let finishRead!: (value: Uint8Array) => void
    vi.mocked(getWorkspaceFile).mockImplementation(() => new Promise((resolve) => {
      finishRead = resolve
    }))
    const read = files.readFile('index.html')
    const signal = vi.mocked(getWorkspaceFile).mock.calls.at(-1)![3]!
    conversation.value = 'b'
    assert.equal(signal.aborted, true)
    responses.get('b')!(snapshot(2, 'b'))
    finishRead(new Uint8Array([65]))
    await assert.rejects(read, /会话或文件版本已改变/)
    await vi.waitFor(() => assert.equal(files.snapshot.value?.conversationId, 'b'))
    assert.equal(files.error.value, '')
  }
  finally { scope.stop() }
})

it('离开工作区取消文件读取，即使响应忽略取消也不能交付迟到文件', async () => {
  vi.mocked(getWorkspace).mockResolvedValue(snapshot(1))
  const scope = effectScope()
  const files = scope.run(() => useWorkspaceFiles(ref('a'), ref('idle')))!
  await vi.waitFor(() => assert.equal(files.snapshot.value?.revision, 1))
  let finishRead!: (value: Uint8Array) => void
  vi.mocked(getWorkspaceFile).mockImplementation(() => new Promise((resolve) => {
    finishRead = resolve
  }))
  const read = files.readFile('index.html')
  const signal = vi.mocked(getWorkspaceFile).mock.calls.at(-1)![3]!
  scope.stop()
  assert.equal(signal.aborted, true)
  finishRead(new Uint8Array([65]))
  await assert.rejects(read, /会话或文件版本已改变/)
})
