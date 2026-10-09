import type { ComposerAttachment } from '../types/chat'
import assert from 'node:assert/strict'
import { it, onTestFinished, vi } from 'vitest'
import { effectScope, ref } from 'vue'
import { deleteAttachment, uploadAttachment } from '../api/attachments'
import { useComposerAttachments } from './useComposerAttachments'

vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('../api/attachments', () => ({ uploadAttachment: vi.fn(async () => ({ id: 'remote-id' })), deleteAttachment: vi.fn() }))

it('附件同步占名额；切视图丢弃迟到尺寸；提交锁阻止移除与撤销 URL', async () => {
  let finishSizing!: (bitmap: { width: number, height: number, close: () => void }) => void
  const sizing = new Promise((resolve) => {
    finishSizing = resolve
  })
  vi.stubGlobal('createImageBitmap', () => sizing)
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const scope = effectScope()
  onTestFinished(() => {
    scope.stop()
    create.mockRestore()
    revoke.mockRestore()
    vi.unstubAllGlobals()
  })
  const attachments = ref<ComposerAttachment[]>([])
  const notify = vi.fn()
  const hook = scope.run(() => useComposerAttachments(attachments, notify))!
  const adding = hook.add(Array.from({ length: 10 }, (_, index) => new File(['x'], `${index}.png`)))
  assert.equal(attachments.value.length, 10, '尺寸读取前就应该占住数量')
  await hook.add([new File(['x'], 'extra.png')])
  assert.equal(attachments.value.length, 10)
  assert.equal(notify.mock.calls.length, 1)
  attachments.value = []
  finishSizing({ width: 64, height: 32, close: () => {} })
  await adding
  assert.equal(attachments.value.length, 0)
  assert.equal(vi.mocked(uploadAttachment).mock.calls.length, 0, '旧视图的文件不能迟到上传')
  await hook.add([new File(['text'], 'new.txt')])
  await Promise.resolve()
  const item = attachments.value[0]!
  attachments.value = [{ ...item, locked: true }]
  const revokedBefore = revoke.mock.calls.length
  hook.remove(item.id)
  assert.equal(attachments.value.length, 1)
  assert.equal(revoke.mock.calls.length, revokedBefore)
  assert.equal(vi.mocked(deleteAttachment).mock.calls.length, 0)
  attachments.value = [{ ...item, locked: false }]
  hook.remove(item.id)
  assert.equal(attachments.value.length, 0)
  assert.equal(vi.mocked(deleteAttachment).mock.calls.length, 1)
})

it('离开工作区：取消上传，回收输入框仍持有的 URL（含锁定草稿）；迟到上传不回填，不删已发附件', async () => {
  let finishUpload!: (uploaded: { id: string }) => void
  let uploadSignal: AbortSignal | undefined
  vi.mocked(uploadAttachment).mockImplementationOnce((_file, options) => {
    uploadSignal = options.signal
    return new Promise((resolve) => {
      finishUpload = resolve as typeof finishUpload
    })
  })
  vi.mocked(deleteAttachment).mockClear()
  let next = 0
  const create = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:${next++}`)
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const scope = effectScope()
  onTestFinished(() => {
    scope.stop()
    create.mockRestore()
    revoke.mockRestore()
  })
  const attachments = ref<ComposerAttachment[]>([])
  const hook = scope.run(() => useComposerAttachments(attachments, vi.fn()))!
  await hook.add([new File(['a'], 'uploading.txt'), new File(['b'], 'submitted.txt')])
  await vi.waitFor(() => assert.equal(attachments.value[1]?.status, 'ready'))
  attachments.value = attachments.value.map((item, index) => index === 1 ? { ...item, locked: true } : item)

  scope.stop()
  assert.equal(uploadSignal?.aborted, true)
  assert.deepEqual(revoke.mock.calls.map(([url]) => url), ['blob:0', 'blob:1'])
  assert.deepEqual(vi.mocked(deleteAttachment).mock.calls, [])
  const snapshot = attachments.value
  finishUpload({ id: 'late-remote' })
  await vi.waitFor(() => assert.deepEqual(vi.mocked(deleteAttachment).mock.calls, [['late-remote']]))
  assert.equal(attachments.value, snapshot, '迟到的上传结果不能回填已经退出的作用域')
})

it('手动重新上传保留原文件，草稿另建 URL；只回填本地 id，移除不释放消息 URL 或删除旧远程附件', async () => {
  vi.mocked(deleteAttachment).mockClear()
  let next = 0
  const create = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:retry-${next++}`)
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const scope = effectScope()
  onTestFinished(() => {
    scope.stop()
    create.mockRestore()
    revoke.mockRestore()
  })
  const attachments = ref<ComposerAttachment[]>([])
  const hook = scope.run(() => useComposerAttachments(attachments, vi.fn()))!
  const file = new File(['x'], 'retained.md')
  await hook.add([file])
  await vi.waitFor(() => assert.equal(attachments.value[0]?.status, 'ready'))
  const id = attachments.value[0]!.id
  attachments.value = [{ ...attachments.value[0]!, status: 'error', remoteId: undefined, inMessage: true }]
  let finishUpload!: (uploaded: { id: string }) => void
  vi.mocked(uploadAttachment).mockImplementationOnce(() => new Promise((resolve) => {
    finishUpload = resolve as typeof finishUpload
  }))
  const retrying = hook.retry(id)
  await hook.add([new File(['y'], 'new.md')])
  await vi.waitFor(() => assert.equal(attachments.value[1]?.status, 'ready'))
  const newDraft = attachments.value[1]
  finishUpload({ id: 'fresh-id' })
  await retrying
  assert.equal(vi.mocked(uploadAttachment).mock.calls.at(-2)?.[0], file)
  assert.equal(attachments.value[0]?.remoteId, 'fresh-id')
  assert.equal(attachments.value[0]?.status, 'ready')
  assert.equal(attachments.value[0]?.url, 'blob:retry-1')
  assert.equal(attachments.value[1], newDraft)
  hook.remove(id)
  assert.deepEqual(revoke.mock.calls, [['blob:retry-1']])
  assert.deepEqual(vi.mocked(deleteAttachment).mock.calls, [['fresh-id']])
})
