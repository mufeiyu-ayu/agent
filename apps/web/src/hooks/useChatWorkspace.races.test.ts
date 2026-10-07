import type { ChatStreamEvent, ConversationMessage } from '@agent/contracts'
import assert from 'node:assert/strict'
import { afterEach, beforeEach, it, vi } from 'vitest'
import { streamChat } from '../api/chat'
import { createConversation, deleteConversation, listConversationMessages, listConversations } from '../api/conversations'
import { useChatWorkspace } from './useChatWorkspace'

const lifecycle = vi.hoisted(() => ({ mounted: () => {}, unmounted: () => {} }))
vi.mock('vue', async original => ({
  ...await original<typeof import('vue')>(),
  onMounted: (callback: () => void) => { lifecycle.mounted = callback },
  onUnmounted: (callback: () => void) => { lifecycle.unmounted = callback },
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('../api/conversations', () => ({ createConversation: vi.fn(), deleteConversation: vi.fn(), listConversationMessages: vi.fn(), listConversations: vi.fn(), updateConversation: vi.fn() }))
vi.mock('../api/chat', () => ({ streamChat: vi.fn(), ChatStreamHttpError: class extends Error {} }))
const time = '2026-10-07T00:00:00Z'
const conversation = (id: string) => ({ id, title: id, createdAt: time, updatedAt: time })
function history(id: string): ConversationMessage[] {
  return [
    { id: `question-${id}`, conversationId: id, role: 'USER', content: `question ${id}`, status: 'COMPLETED', createdAt: time, updatedAt: time },
    { id: `past-${id}`, conversationId: id, role: 'ASSISTANT', content: `history ${id}`, status: 'COMPLETED', createdAt: time, updatedAt: time },
  ]
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
beforeEach(() => {
  vi.stubGlobal('window', { setTimeout, clearTimeout })
  vi.stubGlobal('requestAnimationFrame', (callback: () => void) => setTimeout(callback, 0))
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
  vi.mocked(listConversations).mockResolvedValue({ items: [conversation('a'), conversation('b')], nextCursor: null })
  vi.mocked(listConversationMessages).mockImplementation(async id => history(id))
  vi.mocked(createConversation).mockResolvedValue(conversation('created'))
  vi.mocked(streamChat).mockImplementation(async function* (request) {
    yield { type: 'start', conversationId: request.conversationId, userMessageId: 'fresh-user', assistantMessageId: 'fresh-reply' }
    yield { type: 'done', conversationId: request.conversationId, assistantMessageId: 'fresh-reply', content: 'latest reply', generatedAt: time }
  })
})
afterEach(() => {
  lifecycle.unmounted()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.resetAllMocks()
})

it('B8：旧初始化不抢回新视图/草稿，也不抹掉期间创建的会话', async () => {
  const initial = deferred<Awaited<ReturnType<typeof listConversations>>>()
  vi.mocked(listConversations).mockReturnValueOnce(initial.promise)
  const workspace = useChatWorkspace()
  lifecycle.mounted()
  workspace.resetWorkspace()
  workspace.message.value = 'new draft'
  initial.resolve({ items: [conversation('a')], nextCursor: null })
  await vi.waitFor(() => assert.equal(workspace.conversations.value.length, 1))
  assert.equal(workspace.activeConversationId.value, null)
  assert.equal(workspace.message.value, 'new draft')

  lifecycle.unmounted()
  const second = deferred<Awaited<ReturnType<typeof listConversations>>>()
  vi.mocked(listConversations).mockReturnValueOnce(second.promise)
  const creating = useChatWorkspace()
  lifecycle.mounted()
  creating.resetWorkspace()
  creating.message.value = 'create and send'
  await creating.sendMessage()
  assert.equal(creating.activeConversationId.value, 'created')
  second.resolve({ items: [conversation('a')], nextCursor: null })
  await vi.waitFor(() => assert.equal(creating.conversations.value.length, 2))
  assert.equal(creating.activeConversationId.value, 'created')
  assert.ok(creating.conversations.value.some(item => item.id === 'created'))
})

it.each(['done', 'error', 'aborted'] as const)('B5：回切 GET 在 %s 后失败，消息与缓存仍在；下一轮保留历史', async (terminal) => {
  const workspace = useChatWorkspace()
  lifecycle.mounted()
  await vi.waitFor(() => assert.ok(workspace.activeConversationId.value === 'a' && !workspace.isLoadingMessages.value))
  const ending = deferred<void>()
  vi.mocked(streamChat).mockImplementationOnce(async function* () {
    yield { type: 'start', conversationId: 'a', userMessageId: 'fresh-user', assistantMessageId: 'fresh-reply' }
    yield { type: 'delta', conversationId: 'a', assistantMessageId: 'fresh-reply', contentDelta: 'latest reply' }
    await ending.promise
    const event: ChatStreamEvent = terminal === 'error'
      ? { type: 'error', conversationId: 'a', assistantMessageId: 'fresh-reply', message: 'injected model failure' }
      : terminal === 'aborted'
        ? { type: 'aborted', conversationId: 'a', assistantMessageId: 'fresh-reply', content: 'latest reply' }
        : { type: 'done', conversationId: 'a', assistantMessageId: 'fresh-reply', content: 'latest reply', generatedAt: time }
    yield event
  })
  workspace.message.value = 'question'
  const sending = workspace.sendMessage()
  await vi.waitFor(() => assert.ok(workspace.messages.value.some(item => item.id === 'fresh-reply')))
  await workspace.selectConversation('b')
  const late = deferred<ConversationMessage[]>()
  vi.mocked(listConversationMessages).mockReturnValueOnce(late.promise)
  const selecting = workspace.selectConversation('a')
  ending.resolve()
  await sending
  const ids = workspace.messages.value.map(item => item.id)
  late.reject(new Error('late GET offline'))
  await selecting
  assert.deepEqual(workspace.messages.value.map(item => item.id), ids)
  assert.ok(ids.includes('past-a') && ids.includes('fresh-reply'))
  assert.equal(workspace.appMessage.value.text, 'late GET offline')
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000)
  workspace.message.value = 'next question'
  await workspace.sendMessage()
  assert.ok(workspace.messages.value.some(item => item.id === 'past-a'))
})

it.each(['error', 'aborted'] as const)('删除当前会话自动回落到 %s 缓存，历史恢复/重试后仍可发送', async (terminal) => {
  const workspace = useChatWorkspace()
  lifecycle.mounted()
  await vi.waitFor(() => assert.ok(workspace.activeConversationId.value === 'a' && !workspace.isLoadingMessages.value))
  await workspace.selectConversation('b')
  vi.mocked(streamChat).mockImplementationOnce(async function* () {
    yield { type: 'start', conversationId: 'b', userMessageId: 'terminal-user', assistantMessageId: 'terminal-reply' }
    if (terminal === 'error')
      yield { type: 'error', conversationId: 'b', assistantMessageId: 'terminal-reply', message: 'injected failure' }
    else
      yield { type: 'aborted', conversationId: 'b', assistantMessageId: 'terminal-reply', content: 'stopped reply' }
  })
  workspace.message.value = 'B question'
  await workspace.sendMessage()
  await workspace.selectConversation('a')
  vi.mocked(deleteConversation).mockResolvedValueOnce({ id: 'a', deleted: true })
  await workspace.deleteConversationById('a')
  assert.equal(workspace.activeConversationId.value, 'b')
  assert.equal(workspace.isHistoryReady.value, true)
  assert.ok(workspace.messages.value.some(item => item.id === 'past-b'))
  assert.ok(workspace.messages.value.some(item => item.id === 'terminal-reply'))
  await workspace.reloadMessages()
  assert.equal(workspace.isHistoryReady.value, true)
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000)
  workspace.message.value = 'B retry question'
  await workspace.sendMessage()
  assert.equal(vi.mocked(streamChat).mock.calls.length, 2)
  assert.ok(workspace.messages.value.some(item => item.id === 'past-b'))
})

it('B9：未缓存历史期间不能发，读取失败可重试，成功后保留旧历史再发送', async () => {
  const workspace = useChatWorkspace()
  lifecycle.mounted()
  await vi.waitFor(() => assert.ok(workspace.activeConversationId.value === 'a' && !workspace.isLoadingMessages.value))
  const pending = deferred<ConversationMessage[]>()
  vi.mocked(listConversationMessages).mockReturnValueOnce(pending.promise)
  const selecting = workspace.selectConversation('b')
  workspace.message.value = 'draft B'
  assert.equal(workspace.isHistoryReady.value, false)
  await workspace.sendMessage()
  assert.equal(vi.mocked(streamChat).mock.calls.length, 0)
  pending.reject(new Error('history offline'))
  await selecting
  assert.equal(workspace.isHistoryReady.value, false)
  assert.equal(workspace.message.value, 'draft B')
  await workspace.sendMessage()
  assert.equal(vi.mocked(streamChat).mock.calls.length, 0)
  await workspace.reloadMessages()
  assert.equal(workspace.isHistoryReady.value, true)
  await workspace.sendMessage()
  assert.equal(vi.mocked(streamChat).mock.calls.length, 1)
  assert.ok(workspace.messages.value.some(item => item.id === 'past-b'))
})
