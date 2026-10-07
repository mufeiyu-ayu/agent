import type { AdminUser } from '@agent/contracts'
import assert from 'node:assert/strict'
import { it, onTestFinished, vi } from 'vitest'
import { createUsersState } from './users.state'

it('用户写操作按行防重、互不阻塞，失败后恢复；成功就地更新而不重拉用户列表', async () => {
  const requests: { url: string, method: string, resolve: (response: Response) => void }[] = []
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation((url, init) => new Promise<Response>((resolve) => {
    requests.push({ url: String(url), method: init!.method!, resolve })
  }))
  onTestFinished(() => fetch.mockRestore())
  const state = createUsersState()
  const user = (id: string): AdminUser => ({
    id,
    email: `${id}@example.com`,
    name: null,
    avatarUrl: null,
    role: 'MEMBER',
    status: 'ACTIVE',
    mustChangePassword: false,
    lastLoginAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
  })
  const respond = (index: number, data: unknown, status = 200) => requests[index]!.resolve(new Response(JSON.stringify({
    success: status === 200,
    data,
    message: '操作失败',
  }), { status }))
  const loading = state.load()
  await state.load()
  assert.equal(requests.length, 1)
  assert.equal(state.loading.value, true)
  respond(0, [user('a'), user('b')])
  await loading
  assert.equal(state.loading.value, false)

  const first = state.update('a', { status: 'DISABLED' })
  await assert.rejects(state.update('a', { status: 'DISABLED' }), /操作正在进行/)
  await assert.rejects(state.resetPassword('a', 'fixture-password'), /操作正在进行/)
  const second = state.update('b', { role: 'ADMIN' })
  assert.equal(requests.length, 3)
  assert.deepEqual([...state.pendingUserIds.value], ['a', 'b'])
  respond(1, null, 502)
  await assert.rejects(first, /操作失败/)
  assert.deepEqual([...state.pendingUserIds.value], ['b'])
  const retry = state.update('a', { status: 'DISABLED' })
  respond(2, { ...user('b'), role: 'ADMIN' })
  await second
  assert.deepEqual([...state.pendingUserIds.value], ['a'])
  respond(3, { ...user('a'), status: 'DISABLED' })
  await retry
  assert.equal(state.pendingUserIds.value.size, 0)
  assert.equal(state.users.value[0]!.status, 'DISABLED')
  assert.equal(state.users.value[1]!.role, 'ADMIN')
  assert.equal(requests.filter(request => request.method === 'GET').length, 1)

  const create = state.create({ email: 'c@example.com', password: 'fixture-password', role: 'MEMBER' })
  assert.equal(state.creating.value, true)
  await assert.rejects(state.create({ email: 'c@example.com', password: 'fixture-password', role: 'MEMBER' }), /操作正在进行/)
  respond(4, null, 502)
  await assert.rejects(create, /操作失败/)
  assert.equal(state.creating.value, false)
})

it('B10：初始 GET 迟到不抹掉期间 create/update/reset 成功的用户，同时补齐其它历史行', async () => {
  const requests: Array<{ method: string, resolve: (value: Response) => void }> = []
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise((resolve) => {
    requests.push({ method: init!.method!, resolve })
  }))
  onTestFinished(() => fetch.mockRestore())
  const user = (id: string): AdminUser => ({ id, email: `${id}@example.com`, name: null, avatarUrl: null, role: 'MEMBER', status: 'ACTIVE', mustChangePassword: false, lastLoginAt: null, createdAt: '2026-01-01T00:00:00Z' })
  const respond = (index: number, data: unknown) => requests[index]!.resolve(new Response(JSON.stringify({ success: true, data }), { status: 200 }))
  const state = createUsersState()
  const load = state.load()
  const create = state.create({ email: 'new@example.com', password: 'fixture-password', role: 'MEMBER' })
  const update = state.update('updated', { status: 'DISABLED' })
  const reset = state.resetPassword('reset', 'fixture-password')
  respond(1, user('new'))
  respond(2, { ...user('updated'), status: 'DISABLED' })
  respond(3, { ...user('reset'), mustChangePassword: true })
  await Promise.all([create, update, reset])
  respond(0, [user('updated'), user('reset'), user('other')])
  await load
  assert.ok(state.users.value.some(item => item.id === 'new'))
  assert.ok(state.users.value.some(item => item.id === 'other'))
  assert.equal(state.users.value.find(item => item.id === 'updated')!.status, 'DISABLED')
  assert.equal(state.users.value.find(item => item.id === 'reset')!.mustChangePassword, true)
  assert.equal(requests.filter(item => item.method === 'GET').length, 1)
  assert.equal(state.loading.value, false)
})
