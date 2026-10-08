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
