import type { Conversation } from '@agent/contracts'
import assert from 'node:assert/strict'
import { afterEach, beforeEach, it, vi } from 'vitest'
import { deleteConversation, listConversationMessages, listConversations, updateConversation } from '../api/conversations'
import { useChatWorkspace } from './useChatWorkspace'

const lifecycle = vi.hoisted(() => ({ mounted: () => {}, unmounted: () => {} }))
vi.mock('vue', async (importOriginal) => {
  const vue = await importOriginal<typeof import('vue')>()
  return {
    ...vue,
    onMounted: (callback: () => void) => {
      lifecycle.mounted = callback
    },
    onUnmounted: (callback: () => void) => {
      lifecycle.unmounted = callback
    },
  }
})
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('../api/conversations', () => ({ createConversation: vi.fn(), deleteConversation: vi.fn(), listConversationMessages: vi.fn(), listConversations: vi.fn(), updateConversation: vi.fn() }))

const conversation: Conversation = { id: 'a', title: 'A', createdAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z' }
beforeEach(() => {
  vi.stubGlobal('window', { setTimeout, clearTimeout })
  vi.mocked(listConversations).mockResolvedValue({ items: [conversation], nextCursor: null })
  vi.mocked(listConversationMessages).mockResolvedValue([])
})
afterEach(() => {
  lifecycle.unmounted()
  vi.unstubAllGlobals()
  vi.resetAllMocks()
})

it('改名在途状态按会话展示，重复改名与删除不再发送；失败解除状态后可重试', async () => {
  const workspace = useChatWorkspace()
  lifecycle.mounted()
  await vi.waitFor(() => assert.equal(workspace.activeConversationId.value, 'a'))
  let reject!: (error: Error) => void
  vi.mocked(updateConversation).mockImplementation(() => new Promise((_resolve, fail) => {
    reject = fail
  }))
  const rename = workspace.renameConversationById('a', 'B')
  await workspace.renameConversationById('a', 'C')
  await workspace.deleteConversationById('a')
  assert.equal(workspace.recentChats.value[0]?.pending, true)
  assert.equal(vi.mocked(updateConversation).mock.calls.length, 1)
  assert.equal(vi.mocked(deleteConversation).mock.calls.length, 0)
  reject(new Error('offline'))
  await rename
  assert.equal(workspace.recentChats.value[0]?.pending, false)
  assert.equal(workspace.recentChats.value[0]?.title, 'A')
  assert.equal(workspace.appMessage.value.text, 'offline')
  vi.mocked(updateConversation).mockResolvedValueOnce({ ...conversation, title: 'B' })
  await workspace.renameConversationById('a', 'B')
  assert.equal(workspace.recentChats.value[0]?.title, 'B')
  assert.equal(workspace.recentChats.value[0]?.pending, false)
})

it('删除不同会话互不吞操作，先结束的请求不清除另一行的 pending 或列表 busy', async () => {
  vi.mocked(listConversations).mockResolvedValue({ items: ['a', 'b', 'c'].map(id => ({ ...conversation, id, title: id })), nextCursor: null })
  const workspace = useChatWorkspace()
  lifecycle.mounted()
  await vi.waitFor(() => assert.equal(workspace.activeConversationId.value, 'a'))
  await workspace.selectConversation('c')
  const pending = new Map<string, { resolve: () => void, reject: (error: Error) => void }>()
  vi.mocked(deleteConversation).mockImplementation(id => new Promise((resolve, reject) => {
    pending.set(id, { resolve: () => resolve({ id, deleted: true }), reject })
  }))
  const first = workspace.deleteConversationById('a')
  const second = workspace.deleteConversationById('b')
  try {
    assert.equal(vi.mocked(deleteConversation).mock.calls.length, 2, '不能让 A 的列表 busy 吞掉 B 的独立删除')
    pending.get('a')!.resolve()
    await first
    assert.equal(workspace.isLoadingConversations.value, true)
    assert.equal(workspace.recentChats.value.find(chat => chat.id === 'b')?.pending, true)
    pending.get('b')!.reject(new Error('offline b'))
    await second
    assert.equal(workspace.isLoadingConversations.value, false)
    assert.equal(workspace.recentChats.value.find(chat => chat.id === 'b')?.pending, false)
    assert.equal(workspace.activeConversationId.value, 'c')
  }
  finally {
    pending.forEach(request => request.resolve())
    await Promise.allSettled([first, second])
  }
})

it('重复删除共享禁止状态，失败保留会话且可重试，成功后才移除', async () => {
  const deleted = vi.fn()
  const workspace = useChatWorkspace({ onConversationDeleted: deleted })
  lifecycle.mounted()
  await vi.waitFor(() => assert.equal(workspace.activeConversationId.value, 'a'))
  let reject!: (error: Error) => void
  vi.mocked(deleteConversation).mockImplementation(() => new Promise((_resolve, fail) => {
    reject = fail
  }))
  const deletion = workspace.deleteConversationById('a')
  await workspace.deleteConversationById('a')
  assert.equal(workspace.isLoadingConversations.value, true)
  assert.equal(workspace.recentChats.value[0]?.pending, true)
  assert.equal(vi.mocked(deleteConversation).mock.calls.length, 1)
  reject(new Error('offline'))
  await deletion
  assert.equal(workspace.isLoadingConversations.value, false)
  assert.equal(workspace.recentChats.value[0]?.pending, false)
  assert.equal(workspace.activeConversationId.value, 'a')
  assert.equal(deleted.mock.calls.length, 0, '删除失败不能清理已读文件缓存')
  vi.mocked(deleteConversation).mockResolvedValueOnce({ id: 'a', deleted: true })
  await workspace.deleteConversationById('a')
  assert.equal(workspace.isLoadingConversations.value, false)
  assert.equal(workspace.recentChats.value.length, 0)
  assert.equal(workspace.activeConversationId.value, null)
  assert.deepEqual(deleted.mock.calls, [['a']], '后端确认删除后才通知工作文件清理')
})
