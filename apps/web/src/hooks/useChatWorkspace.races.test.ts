import type { ChatStreamEvent, ConversationMessage } from '@agent/contracts'
import type { ComposerAttachment } from '../types/chat'
import assert from 'node:assert/strict'
import { afterEach, beforeEach, it, onTestFinished, vi } from 'vitest'
import { effectScope } from 'vue'
import { deleteAttachment, uploadAttachment } from '../api/attachments'
import { ChatStreamHttpError, streamChat } from '../api/chat'
import { createConversation, deleteConversation, listConversationMessages, listConversations } from '../api/conversations'
import { useChatWorkspace } from './useChatWorkspace'
import { useComposerAttachments } from './useComposerAttachments'

const lifecycle = vi.hoisted(() => ({ mounted: () => {}, unmounted: () => {} }))
vi.mock('vue', async original => ({
  ...await original<typeof import('vue')>(),
  onMounted: (callback: () => void) => { lifecycle.mounted = callback },
  onUnmounted: (callback: () => void) => { lifecycle.unmounted = callback },
}))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }))
vi.mock('../api/conversations', () => ({ createConversation: vi.fn(), deleteConversation: vi.fn(), listConversationMessages: vi.fn(), listConversations: vi.fn(), updateConversation: vi.fn() }))
vi.mock('../api/chat', async original => ({ ...await original<typeof import('../api/chat')>(), streamChat: vi.fn() }))
vi.mock('../api/attachments', async original => ({ ...await original<typeof import('../api/attachments')>(), uploadAttachment: vi.fn(), deleteAttachment: vi.fn() }))
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

it.each(['sending', 'stopped', 'failed', 'switched'] as const)('首次直接发送在 %s 状态时初始化列表返回，不抢走视图', async (phase) => {
  const listing = deferred<Awaited<ReturnType<typeof listConversations>>>()
  const creating = deferred<Awaited<ReturnType<typeof createConversation>>>()
  vi.mocked(listConversations).mockReturnValueOnce(listing.promise)
  vi.mocked(createConversation).mockReturnValueOnce(creating.promise)
  const workspace = useChatWorkspace()
  lifecycle.mounted()
  workspace.message.value = 'first question'
  const sending = workspace.sendMessage()
  assert.equal(vi.mocked(createConversation).mock.calls.length, 1)
  if (phase === 'stopped')
    workspace.stopGeneration()
  if (phase === 'failed') {
    creating.reject(new Error('create failed'))
    await sending
  }
  if (phase === 'switched')
    await workspace.selectConversation('b')
  listing.resolve({ items: [conversation('a')], nextCursor: null })
  await vi.waitFor(() => assert.equal(workspace.conversations.value.length, 1))
  assert.equal(workspace.activeConversationId.value, phase === 'switched' ? 'b' : null)
  if (phase !== 'failed') {
    creating.resolve(conversation('created'))
    await sending
  }
  if (phase === 'sending') {
    assert.equal(workspace.activeConversationId.value, 'created')
    assert.equal(workspace.message.value, '')
    assert.ok(workspace.messages.value.some(item => item.content === 'latest reply'))
  }
  else {
    assert.equal(workspace.activeConversationId.value, phase === 'switched' ? 'b' : null)
    assert.equal(workspace.message.value, phase === 'switched' ? '' : 'first question')
  }
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

function draft(index: number): ComposerAttachment {
  return { id: `local-${index}`, remoteId: `remote-${index}`, kind: 'file', name: `${index}.md`, bytes: 1, url: `blob:${index}`, status: 'ready', progress: 1 }
}
function sentQuestion(conversationId: string, id: string, remoteId: string): ConversationMessage {
  return { id, conversationId, role: 'USER', content: '', status: 'COMPLETED', createdAt: time, updatedAt: time, attachments: [{ id: remoteId, kind: 'file', name: '1.md', bytes: 1 }] }
}

// 后端的事实（提交后、运行开始前，消息接口就带着这批附件）由 attachments.db.test.ts 在真实库上验证；这里的消息接口是模拟边界。
it.each(['committed', 'early-query', 'unknown', 'disconnect'] as const)('没收到 start、确认结果 %s：已绑定移出，其余须手动重新上传；新增附件不受影响', async (phase) => {
  const interrupted = deferred<void>()
  vi.mocked(streamChat).mockImplementationOnce(async function* (_request, options) {
    options?.signal?.addEventListener('abort', () => interrupted.reject(new DOMException('aborted', 'AbortError')))
    await interrupted.promise
  })
  const workspace = useChatWorkspace()
  lifecycle.mounted()
  await vi.waitFor(() => assert.ok(workspace.activeConversationId.value === 'a' && !workspace.isLoadingMessages.value))
  workspace.attachments.value = [draft(1)]
  workspace.message.value = 'with file'
  const sending = workspace.sendMessage()
  await vi.waitFor(() => assert.equal(vi.mocked(streamChat).mock.calls.length, 1))
  assert.deepEqual(vi.mocked(streamChat).mock.calls[0]![0].attachmentIds, ['remote-1'])
  const checking = deferred<ConversationMessage[]>()
  vi.mocked(listConversationMessages).mockReturnValueOnce(checking.promise)
  if (phase === 'disconnect')
    interrupted.reject(new Error('connection lost'))
  else
    workspace.stopGeneration()
  await sending
  assert.equal(workspace.attachments.value[0]?.locked, true, '去向不明时不能直接恢复成可重发')
  workspace.attachments.value = [...workspace.attachments.value, draft(2)]

  if (phase === 'unknown')
    checking.reject(new Error('offline'))
  else
    checking.resolve(phase === 'committed' ? [...history('a'), sentQuestion('a', 'persisted', 'remote-1')] : history('a'))
  const expected = phase === 'committed' ? ['local-2'] : ['local-1', 'local-2']
  await vi.waitFor(() => assert.deepEqual(workspace.attachments.value.map(item => [item.id, Boolean(item.locked)]), expected.map(id => [id, false])))
  assert.equal(workspace.message.value, phase === 'committed' ? '' : 'with file')
  assert.deepEqual(workspace.attachments.value.at(-1), draft(2))
  if (phase !== 'committed') {
    assert.equal(workspace.attachments.value[0]?.status, 'error')
    assert.equal(workspace.attachments.value[0]?.remoteId, undefined)
    assert.equal(workspace.appMessage.value.text, 'composer.attachments.sendUnconfirmed')
    // 这次查询即使先于原事务返回，也不能让旧 ID 再次进入请求。
    vi.mocked(listConversationMessages).mockResolvedValue([...history('a'), sentQuestion('a', 'late-commit', 'remote-1')])
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000)
    await workspace.sendMessage()
    assert.equal(vi.mocked(streamChat).mock.calls.length, 1)
  }
})

it('这次页面里发出的附件：消息换成接口地址、会话删除或离开工作区时放掉本地地址，仍在用的不动', async () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const revoked = () => revoke.mock.calls.map(([url]) => url)
  const lastTurn = (workspace: ReturnType<typeof useChatWorkspace>) => workspace.conversationTurns.value.at(-1)?.attachments?.map(item => item.url)
  vi.mocked(streamChat).mockImplementation(async function* (request) {
    yield { type: 'start', conversationId: request.conversationId, userMessageId: `sent-${request.conversationId}`, assistantMessageId: `reply-${request.conversationId}` }
    yield { type: 'done', conversationId: request.conversationId, assistantMessageId: `reply-${request.conversationId}`, content: 'ok', generatedAt: time }
  })
  const workspace = useChatWorkspace()
  lifecycle.mounted()
  await vi.waitFor(() => assert.ok(workspace.activeConversationId.value === 'a' && !workspace.isLoadingMessages.value))

  workspace.attachments.value = [draft(1)]
  await workspace.sendMessage()
  assert.deepEqual(lastTurn(workspace), ['blob:1'])
  assert.deepEqual(revoked(), [], '消息还在用本地地址显示')

  await workspace.selectConversation('b')
  workspace.attachments.value = [draft(2)]
  await workspace.sendMessage()
  // 切回 a：服务端快照里这条消息已经带着附件，改用接口地址。
  vi.mocked(listConversationMessages).mockResolvedValueOnce([sentQuestion('a', 'sent-a', 'remote-1')])
  await workspace.selectConversation('a')
  assert.deepEqual(revoked(), ['blob:1'])
  assert.deepEqual(lastTurn(workspace), ['/api/attachments/remote-1/content'])

  vi.mocked(deleteConversation).mockResolvedValueOnce({ deleted: true, id: 'b' })
  await workspace.deleteConversationById('b')
  assert.deepEqual(revoked(), ['blob:1', 'blob:2'])
})

it.each(['committed', 'missing', 'offline'] as const)('迟到的 %s 确认不恢复已移除的附件，也不修改另一视图的同文草稿', async (phase) => {
  vi.mocked(streamChat).mockImplementationOnce(async function* (_request, options) {
    await new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
  })
  const workspace = useChatWorkspace()
  lifecycle.mounted()
  await vi.waitFor(() => assert.ok(workspace.activeConversationId.value === 'a' && !workspace.isLoadingMessages.value))
  workspace.attachments.value = [draft(1)]
  workspace.message.value = 'same text'
  const sending = workspace.sendMessage()
  const checking = deferred<ConversationMessage[]>()
  vi.mocked(listConversationMessages).mockReturnValueOnce(checking.promise)
  workspace.stopGeneration()
  await sending
  await workspace.selectConversation('b')
  workspace.attachments.value = [draft(2)]
  workspace.message.value = 'same text'
  // 切回原视图后写了新的同文草稿，也不能被旧确认清空。
  await workspace.selectConversation('a')
  workspace.attachments.value = [draft(3)]
  workspace.message.value = 'same text'
  const notice = workspace.appMessage.value
  if (phase === 'offline')
    checking.reject(new Error('offline'))
  else
    checking.resolve(phase === 'committed' ? [sentQuestion('a', 'persisted', 'remote-1')] : [])
  await checking.promise.catch(() => {})
  await Promise.resolve()
  assert.deepEqual(workspace.attachments.value, [draft(3)])
  assert.equal(workspace.message.value, 'same text')
  assert.equal(workspace.appMessage.value, notice)
})

it.each([false, true])('start 前明确 error、userMessagePersisted=%s：未提交保留旧 ID 重试，已提交移出并保留消息预览', async (persisted) => {
  vi.mocked(streamChat).mockImplementationOnce(async function* () {
    yield { type: 'error', conversationId: 'a', message: 'explicit rejection', userMessagePersisted: persisted }
  })
  const workspace = useChatWorkspace()
  lifecycle.mounted()
  await vi.waitFor(() => assert.ok(workspace.activeConversationId.value === 'a' && !workspace.isLoadingMessages.value))
  const reads = vi.mocked(listConversationMessages).mock.calls.length
  workspace.attachments.value = [draft(1)]
  await workspace.sendMessage()
  assert.equal(vi.mocked(listConversationMessages).mock.calls.length, reads)
  if (persisted) {
    assert.deepEqual(workspace.attachments.value, [])
    assert.deepEqual(workspace.conversationTurns.value.at(-1)?.attachments?.map(item => item.url), ['blob:1'])
  }
  else {
    assert.equal(workspace.attachments.value[0]?.remoteId, 'remote-1')
    assert.equal(workspace.attachments.value[0]?.status, 'ready')
    assert.equal(workspace.attachments.value[0]?.locked, false)
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000)
    await workspace.sendMessage()
    assert.deepEqual(vi.mocked(streamChat).mock.calls[1]?.[0].attachmentIds, ['remote-1'])
  }
})

it('新会话创建尚未返回时退出：取消请求并回收锁定草稿 URL，不删远程附件，不接管迟到创建结果', async () => {
  const creating = deferred<Awaited<ReturnType<typeof createConversation>>>()
  vi.mocked(createConversation).mockReturnValueOnce(creating.promise)
  vi.mocked(uploadAttachment).mockResolvedValueOnce({ id: 'remote-1', kind: 'file', name: 'draft.md', bytes: 1 })
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:creating')
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  const scope = effectScope()
  onTestFinished(() => scope.stop())
  const workspace = scope.run(() => useChatWorkspace())!
  const composer = scope.run(() => useComposerAttachments(workspace.attachments, vi.fn()))!
  workspace.resetWorkspace()
  await composer.add([new File(['x'], 'draft.md')])
  await vi.waitFor(() => assert.equal(workspace.attachments.value[0]?.status, 'ready'))
  const sending = workspace.sendMessage()
  assert.equal(workspace.attachments.value[0]?.locked, true)
  const signal = vi.mocked(createConversation).mock.calls[0]?.[1]?.signal
  lifecycle.unmounted()
  scope.stop()
  assert.equal(signal?.aborted, true)
  assert.deepEqual(revoke.mock.calls, [['blob:creating']])
  assert.deepEqual(vi.mocked(deleteAttachment).mock.calls, [])
  creating.resolve(conversation('late-created'))
  await sending
  assert.equal(vi.mocked(streamChat).mock.calls.length, 0)
  assert.equal(vi.mocked(listConversationMessages).mock.calls.length, 0)
  assert.equal(workspace.activeConversationId.value, null)
  assert.equal(workspace.conversations.value.length, 0)
})

it.each([409, 400, 503])('进入流之前 HTTP %s：仅附件失效清掉旧 ID，其余明确拒绝保留重试；卸载后不再确认', async (httpStatus) => {
  const workspace = useChatWorkspace()
  lifecycle.mounted()
  await vi.waitFor(() => assert.ok(workspace.activeConversationId.value === 'a' && !workspace.isLoadingMessages.value))
  const reads = () => vi.mocked(listConversationMessages).mock.calls.length
  const before = reads()

  vi.mocked(streamChat).mockImplementationOnce(async function* () {
    throw new ChatStreamHttpError('request rejected', httpStatus, httpStatus === 400)
  })
  workspace.attachments.value = [draft(1)]
  await workspace.sendMessage()
  assert.deepEqual(workspace.attachments.value.map(item => [item.id, Boolean(item.locked)]), [['local-1', false]])
  assert.equal(workspace.attachments.value[0]?.status, httpStatus === 409 ? 'error' : 'ready')
  assert.equal(workspace.attachments.value[0]?.remoteId, httpStatus === 409 ? undefined : 'remote-1')
  assert.equal(workspace.appMessage.value.text, httpStatus === 409 ? 'request rejected；composer.attachments.reuploadHint' : 'request rejected')

  await workspace.selectConversation('b')
  vi.mocked(streamChat).mockImplementationOnce(async function* (_request, options) {
    await new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
  })
  workspace.attachments.value = [draft(2)]
  const sending = workspace.sendMessage()
  await vi.waitFor(() => assert.equal(vi.mocked(streamChat).mock.calls.length, 2))
  const afterSelect = reads()
  lifecycle.unmounted()
  await sending
  assert.equal(afterSelect, before + 1)
  assert.equal(reads(), afterSelect)
})
