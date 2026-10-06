import type { WorkspaceSnapshot } from '@agent/contracts'
import assert from 'node:assert/strict'
import { afterEach, it, vi } from 'vitest'
import { effectScope, nextTick, ref, watch } from 'vue'
import { getWorkspace, getWorkspaceFile } from '../api/workspace'
import { useWorkspaceFiles } from './useWorkspaceFiles'

vi.mock('../api/workspace', () => ({ getWorkspace: vi.fn(), getWorkspaceFile: vi.fn() }))
afterEach(() => {
  vi.resetAllMocks()
  vi.useRealTimers()
})
const snapshot = (revision: number, conversationId = 'a'): WorkspaceSnapshot => ({ configured: true, conversationId, revision, state: 'idle', files: [{ path: 'index.html', sha256: 'a', bytes: 1 }], lastOperation: null, lastError: null, updatedAt: null })

it('30 秒生成/快照 running 或 saving 无轮询，非终态变化不查询；各终态仅一次刷新', async () => {
  vi.useFakeTimers()
  const status = ref<'idle' | 'thinking' | 'generating' | 'done' | 'error' | 'aborted'>('idle')
  vi.mocked(getWorkspace).mockResolvedValue({ ...snapshot(1), state: 'running' })
  const scope = effectScope()
  const files = scope.run(() => useWorkspaceFiles(ref('a'), status))!
  try {
    await files.refresh(false)
    assert.equal(vi.mocked(getWorkspace).mock.calls.length, 1)
    for (const terminal of ['done', 'error', 'aborted'] as const) {
      const before = vi.mocked(getWorkspace).mock.calls.length
      status.value = 'thinking'
      await nextTick()
      await vi.advanceTimersByTimeAsync(30_000)
      status.value = 'generating'
      await nextTick()
      await vi.advanceTimersByTimeAsync(30_000)
      assert.equal(vi.mocked(getWorkspace).mock.calls.length, before)
      vi.mocked(getWorkspace).mockResolvedValue({ ...snapshot(before + 1), state: 'saving' })
      status.value = terminal
      await nextTick()
      await files.refresh(false)
      assert.equal(vi.mocked(getWorkspace).mock.calls.length, before + 1)
      status.value = terminal
      await nextTick()
      await vi.advanceTimersByTimeAsync(30_000)
      assert.equal(vi.mocked(getWorkspace).mock.calls.length, before + 1)
      assert.equal(files.snapshot.value?.state, 'saving', '本地终态不冒充后端完成')
    }
    scope.stop()
    assert.equal(vi.getTimerCount(), 0)
  }
  finally { scope.stop() }
})

it('终态前旧请求不代替终态后新读取，重复收尾合并；切会话拒绝迟到结果', async () => {
  const responses: Array<(data: WorkspaceSnapshot) => void> = []
  vi.mocked(getWorkspace).mockImplementation(() => new Promise(resolve => responses.push(resolve)))
  const status = ref<'thinking' | 'generating' | 'done' | 'idle'>('thinking')
  const conversation = ref<string | null>('a')
  const scope = effectScope()
  const files = scope.run(() => useWorkspaceFiles(conversation, status))!
  try {
    status.value = 'generating'
    await nextTick()
    assert.equal(responses.length, 1)
    status.value = 'done'
    await nextTick()
    status.value = 'idle'
    await nextTick()
    const pending = files.refresh(false)
    responses[0]!(snapshot(1))
    await vi.waitFor(() => assert.equal(responses.length, 2))
    responses[1]!(snapshot(2))
    await pending
    assert.equal(files.snapshot.value?.revision, 2)
    const old = files.refresh(false)
    conversation.value = 'b'
    const current = files.refresh(false)
    responses[3]!(snapshot(4, 'b'))
    await current
    responses[2]!(snapshot(3))
    await old
    assert.equal(files.snapshot.value?.conversationId, 'b')
    assert.equal(files.snapshot.value?.revision, 4)
  }
  finally { scope.stop() }
})

it('读取循环已退出但 finally 未执行时排入的刷新仍有效', async () => {
  vi.mocked(getWorkspace).mockResolvedValueOnce(snapshot(1)).mockResolvedValue(snapshot(2))
  const scope = effectScope()
  const files = scope.run(() => useWorkspaceFiles(ref('a'), ref('generating')))!
  const stop = watch(files.snapshot, () => {
    void files.refresh()
  }, { once: true })
  try {
    await files.refresh(false)
    assert.equal(vi.mocked(getWorkspace).mock.calls.length, 2)
    assert.equal(files.snapshot.value?.revision, 2)
  }
  finally {
    stop()
    scope.stop()
  }
})

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

it('R3：交付身份按 SHA 校验，同 SHA 跨 revision 使用新 revision；内容改变时不发文件请求', async () => {
  const file = { path: 'index.html', sha256: 'a', bytes: 1 }
  vi.mocked(getWorkspace).mockResolvedValue({ ...snapshot(1), files: [file] })
  vi.mocked(getWorkspaceFile).mockResolvedValue(new Uint8Array([65]))
  const scope = effectScope()
  const files = scope.run(() => useWorkspaceFiles(ref('a'), ref('idle')))!
  try {
    await files.refresh()
    vi.mocked(getWorkspace).mockResolvedValue({ ...snapshot(2), files: [file] })
    await files.refresh()
    assert.equal((await files.readFile(file.path, file.sha256)).text, 'A')
    assert.equal(vi.mocked(getWorkspaceFile).mock.calls.at(-1)![2], 2)
    const calls = vi.mocked(getWorkspaceFile).mock.calls.length
    vi.mocked(getWorkspace).mockResolvedValue({ ...snapshot(3), files: [{ ...file, sha256: 'b' }] })
    await files.refresh()
    await assert.rejects(files.readFile(file.path, file.sha256), /交付文件已改变/)
    assert.equal(vi.mocked(getWorkspaceFile).mock.calls.length, calls)
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

it('会话 A→B→A 保留已读缓存，只改 A 的一个文件时只重读该文件', async () => {
  const conversation = ref<string | null>('a')
  let hash = 'old'
  vi.mocked(getWorkspace).mockImplementation(async id => ({ ...snapshot(1, id), files: [
    { path: 'first.txt', sha256: hash, bytes: 1 },
    { path: 'second.txt', sha256: 'unchanged', bytes: 1 },
  ] }))
  vi.mocked(getWorkspaceFile).mockResolvedValue(new Uint8Array([65]))
  const scope = effectScope()
  const files = scope.run(() => useWorkspaceFiles(conversation, ref('idle')))!
  try {
    await files.refresh()
    await files.readFile('first.txt')
    await files.readFile('second.txt')
    conversation.value = 'b'
    await files.refresh()
    await files.readFile('first.txt')
    conversation.value = 'a'
    await files.refresh()
    await files.readFile('first.txt')
    await files.readFile('second.txt')
    assert.equal(vi.mocked(getWorkspaceFile).mock.calls.length, 3)
    hash = 'new'
    await files.refresh()
    await files.readFile('first.txt')
    await files.readFile('second.txt')
    assert.equal(vi.mocked(getWorkspaceFile).mock.calls.length, 4)
  }
  finally { scope.stop() }
})

it('同文件读取合并；清单只改其他文件的 revision 不应丢弃当前文件或重读', async () => {
  vi.mocked(getWorkspace).mockResolvedValue(snapshot(1))
  let finish!: (bytes: Uint8Array) => void
  vi.mocked(getWorkspaceFile).mockImplementation(() => new Promise(resolve => finish = resolve))
  const scope = effectScope()
  const files = scope.run(() => useWorkspaceFiles(ref('a'), ref('idle')))!
  try {
    await files.refresh()
    const first = files.readFile('index.html')
    const second = files.readFile('index.html')
    assert.equal(vi.mocked(getWorkspaceFile).mock.calls.length, 1)
    vi.mocked(getWorkspace).mockResolvedValue(snapshot(2))
    await files.refresh()
    finish(new Uint8Array([65]))
    assert.equal((await first).text, 'A')
    assert.equal((await second).text, 'A')
    await files.readFile('index.html')
    assert.equal(vi.mocked(getWorkspaceFile).mock.calls.length, 1)
  }
  finally { scope.stop() }
})

it('已改 SHA 的旧读取不能写回缓存；新读取失败后可重试且不缓存失败', async () => {
  vi.mocked(getWorkspace).mockResolvedValue(snapshot(1))
  let finishOld!: (bytes: Uint8Array) => void
  vi.mocked(getWorkspaceFile).mockImplementationOnce(() => new Promise(resolve => finishOld = resolve))
  const scope = effectScope()
  const files = scope.run(() => useWorkspaceFiles(ref('a'), ref('idle')))!
  try {
    await files.refresh()
    const old = files.readFile('index.html')
    const rejected = assert.rejects(old, /会话或文件版本已改变/)
    vi.mocked(getWorkspace).mockResolvedValue({ ...snapshot(2), files: [{ path: 'index.html', sha256: 'new', bytes: 1 }] })
    await files.refresh()
    vi.mocked(getWorkspaceFile).mockRejectedValueOnce(new Error('unavailable'))
    await assert.rejects(files.readFile('index.html'), /unavailable/)
    finishOld(new Uint8Array([65]))
    await rejected
    vi.mocked(getWorkspaceFile).mockResolvedValue(new Uint8Array([66]))
    assert.equal((await files.readFile('index.html')).text, 'B')
    assert.equal((await files.readFile('index.html')).text, 'B')
    assert.equal(vi.mocked(getWorkspaceFile).mock.calls.length, 3)
  }
  finally { scope.stop() }
})

it('删除文件及会话清缓存；清单刷新失败时不使用旧缓存', async () => {
  vi.mocked(getWorkspace).mockResolvedValue(snapshot(1))
  vi.mocked(getWorkspaceFile).mockResolvedValue(new Uint8Array([65]))
  const scope = effectScope()
  const files = scope.run(() => useWorkspaceFiles(ref('a'), ref('idle')))!
  try {
    await files.refresh()
    await files.readFile('index.html')
    vi.mocked(getWorkspace).mockRejectedValueOnce(new Error('offline'))
    await files.refresh()
    await assert.rejects(files.readFile('index.html'))
    assert.equal(vi.mocked(getWorkspaceFile).mock.calls.length, 1)
    vi.mocked(getWorkspace).mockResolvedValue({ ...snapshot(2), files: [] })
    await files.refresh()
    await assert.rejects(files.readFile('index.html'))
    vi.mocked(getWorkspace).mockResolvedValue(snapshot(3))
    await files.refresh()
    await files.readFile('index.html')
    assert.equal(vi.mocked(getWorkspaceFile).mock.calls.length, 2)
    files.forgetConversation('a')
    await files.refresh()
    await files.readFile('index.html')
    assert.equal(vi.mocked(getWorkspaceFile).mock.calls.length, 3)
  }
  finally { scope.stop() }
})

it('换账号清缓存并拒绝旧账号迟到读取；退出账号不请求文件', async () => {
  const account = ref<string | null>('u1')
  vi.mocked(getWorkspace).mockResolvedValue(snapshot(1))
  let finish!: (bytes: Uint8Array) => void
  vi.mocked(getWorkspaceFile).mockImplementationOnce(() => new Promise(resolve => finish = resolve))
  const scope = effectScope()
  const files = scope.run(() => useWorkspaceFiles(ref('a'), ref('idle'), account))!
  try {
    await files.refresh()
    const old = files.readFile('index.html')
    const rejected = assert.rejects(old)
    account.value = 'u2'
    await files.refresh()
    finish(new Uint8Array([65]))
    await rejected
    vi.mocked(getWorkspaceFile).mockResolvedValue(new Uint8Array([66]))
    assert.equal((await files.readFile('index.html')).text, 'B')
    account.value = null
    await assert.rejects(files.readFile('index.html'))
    account.value = 'u2'
    await files.refresh()
    await files.readFile('index.html')
    assert.equal(vi.mocked(getWorkspaceFile).mock.calls.length, 3)
  }
  finally { scope.stop() }
})

it('容量按原始字节加文本估算且按使用顺序淘汰，不预下载其他文件', async () => {
  const list = Array.from({ length: 7 }, (_, index) => ({ path: `${index}.txt`, sha256: String(index), bytes: 2 * 1024 * 1024 }))
  vi.mocked(getWorkspace).mockResolvedValue({ ...snapshot(1), files: list })
  const bytes = new Uint8Array(2 * 1024 * 1024).fill(65)
  vi.mocked(getWorkspaceFile).mockResolvedValue(bytes)
  const scope = effectScope()
  const files = scope.run(() => useWorkspaceFiles(ref('a'), ref('idle')))!
  try {
    await files.refresh()
    assert.equal(vi.mocked(getWorkspaceFile).mock.calls.length, 0)
    for (let index = 0; index < 5; index++)
      await files.readFile(`${index}.txt`)
    await files.readFile('0.txt')
    await files.readFile('5.txt')
    assert.equal(vi.mocked(getWorkspaceFile).mock.calls.length, 6)
    await files.readFile('0.txt')
    assert.equal(vi.mocked(getWorkspaceFile).mock.calls.length, 6, '刚使用过的文件保留')
    await files.readFile('1.txt')
    assert.equal(vi.mocked(getWorkspaceFile).mock.calls.length, 7, '最久未用的文件重新读取')
  }
  finally { scope.stop() }
})

it('切换会话与其状态的同步变化只请求一次清单，普通刷新合并但写后刷新仍排队', async () => {
  const conversation = ref<string | null>('a')
  const status = ref<'idle' | 'empty' | 'generating'>('idle')
  const responses: Array<(value: WorkspaceSnapshot) => void> = []
  vi.mocked(getWorkspace).mockImplementation(() => new Promise(resolve => responses.push(resolve)))
  const scope = effectScope()
  const files = scope.run(() => useWorkspaceFiles(conversation, status))!
  try {
    const joined = files.refresh(false)
    assert.equal(responses.length, 1)
    responses[0]!(snapshot(1))
    await joined
    conversation.value = 'b'
    status.value = 'empty'
    await nextTick()
    assert.equal(responses.length, 2)
    responses[1]!(snapshot(1, 'b'))
    await files.refresh(false)
    const ordinary = files.refresh(false)
    const shared = files.refresh(false)
    const afterWrite = files.refresh()
    assert.equal(responses.length, 3)
    responses[2]!(snapshot(1, 'b'))
    await vi.waitFor(() => assert.equal(responses.length, 4))
    responses[3]!(snapshot(2, 'b'))
    await Promise.all([ordinary, shared, afterWrite])
    assert.equal(files.snapshot.value?.revision, 2)
  }
  finally { scope.stop() }
})

it('409 只重试一次且使用新清单的 revision；SHA 改变后不重试旧交付内容', async () => {
  const conflict = Object.assign(new Error('revision conflict'), { isAxiosError: true, response: { status: 409 } })
  vi.mocked(getWorkspace).mockResolvedValue(snapshot(1))
  const scope = effectScope()
  const files = scope.run(() => useWorkspaceFiles(ref('a'), ref('idle')))!
  try {
    await files.refresh()
    vi.mocked(getWorkspace).mockResolvedValue(snapshot(2))
    vi.mocked(getWorkspaceFile).mockRejectedValueOnce(conflict).mockResolvedValueOnce(new Uint8Array([65]))
    assert.equal((await files.readFile('index.html', 'a')).text, 'A')
    assert.deepEqual(vi.mocked(getWorkspaceFile).mock.calls.map(call => call[2]), [1, 2])
    files.forgetConversation('a')
    await files.refresh()
    vi.mocked(getWorkspaceFile).mockRejectedValue(conflict)
    await assert.rejects(files.readFile('index.html'), /revision conflict/)
    assert.equal(vi.mocked(getWorkspaceFile).mock.calls.length, 4, '第二次 409 不继续重试')
    vi.mocked(getWorkspace).mockResolvedValue({ ...snapshot(3), files: [{ path: 'index.html', sha256: 'b', bytes: 1 }] })
    await assert.rejects(files.readFile('index.html', 'a'), /会话或文件版本已改变/)
    assert.equal(vi.mocked(getWorkspaceFile).mock.calls.length, 5, 'SHA 改变不继续请求旧交付')
  }
  finally { scope.stop() }
})

it('空文件也受条数上限约束，不能无限占用缓存索引', async () => {
  vi.mocked(getWorkspace).mockImplementation(async id => ({ ...snapshot(1, id), files: [{ path: 'empty', sha256: 'empty', bytes: 0 }] }))
  vi.mocked(getWorkspaceFile).mockResolvedValue(new Uint8Array())
  const conversation = ref<string | null>('0')
  const scope = effectScope()
  const files = scope.run(() => useWorkspaceFiles(conversation, ref('idle')))!
  try {
    for (let index = 0; index < 257; index++) {
      conversation.value = String(index)
      await files.refresh(false)
      await files.readFile('empty')
    }
    conversation.value = '256'
    await files.refresh(false)
    await files.readFile('empty')
    assert.equal(vi.mocked(getWorkspaceFile).mock.calls.length, 257)
    conversation.value = '0'
    await files.refresh(false)
    await files.readFile('empty')
    assert.equal(vi.mocked(getWorkspaceFile).mock.calls.length, 258)
  }
  finally { scope.stop() }
})

it('恢复到前台合并在途清单刷新；离开工作区移除监听器', async () => {
  const browser = new EventTarget()
  const document = Object.assign(new EventTarget(), { hidden: false })
  vi.stubGlobal('window', browser)
  vi.stubGlobal('document', document)
  vi.mocked(getWorkspace).mockResolvedValue(snapshot(1))
  const scope = effectScope()
  const files = scope.run(() => useWorkspaceFiles(ref('a'), ref('idle')))!
  try {
    await files.refresh()
    const before = vi.mocked(getWorkspace).mock.calls.length
    let finish!: (data: WorkspaceSnapshot) => void
    vi.mocked(getWorkspace).mockImplementation(() => new Promise(resolve => finish = resolve))
    browser.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    assert.equal(vi.mocked(getWorkspace).mock.calls.length, before + 1)
    finish(snapshot(2))
    await files.refresh(false)
    scope.stop()
    browser.dispatchEvent(new Event('focus'))
    document.dispatchEvent(new Event('visibilitychange'))
    assert.equal(vi.mocked(getWorkspace).mock.calls.length, before + 1)
  }
  finally {
    scope.stop()
    vi.unstubAllGlobals()
  }
})
