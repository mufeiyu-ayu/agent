import type { ToolExecutionContext, ValidatedToolInvocation } from '../core/tool.types.js'
import type { WebFetchInput } from './web-fetch.tool.js'
import assert from 'node:assert/strict'
import { afterEach, it, vi } from 'vitest'
import { WebFetchTool } from './web-fetch.tool.js'

const state = vi.hoisted(() => ({ workers: [] as Array<{ emit: (event: string, value?: unknown) => boolean }>, fetch: vi.fn(), throwOnCreate: false }))
vi.mock('node:worker_threads', async () => {
  const { EventEmitter } = await import('node:events')
  return { Worker: class extends EventEmitter {
    constructor() {
      super()
      if (state.throwOnCreate) {
        state.throwOnCreate = false
        throw new Error('worker constructor failed')
      }
      state.workers.push(this)
    }

    async terminate() {
      this.emit('exit', 1)
      return 1
    }
  } }
})
vi.mock('undici', async original => ({ ...await original<typeof import('undici')>(), fetch: state.fetch }))
afterEach(() => {
  state.workers.length = 0
  vi.unstubAllEnvs()
})

it('进程最多两路 worker、最多八个等待；排队取消和繁忙拒绝不启动 worker，message 不能提前释放', async () => {
  vi.stubEnv('OUTBOUND_PROXY_URL', '')
  state.fetch.mockImplementation(async () => new Response('<html>fixture</html>', { headers: { 'content-type': 'text/html' } }))
  const tool = new WebFetchTool()
  const controllers = Array.from({ length: 11 }, () => new AbortController())
  const requests = controllers.map(controller => tool.execute({ input: { url: 'http://93.184.216.34/' } } as ValidatedToolInvocation<WebFetchInput>, { signal: controller.signal } as ToolExecutionContext).catch(error => error as Error))
  await vi.waitFor(() => assert.equal(state.workers.length, 2))
  assert.match((await requests[10] as Error).message, /busy/)
  controllers[2]!.abort(new Error('cancel waiting'))
  assert.match((await requests[2] as Error).message, /cancel waiting/)
  const timeout = setTimeout(() => controllers[3]!.abort(new Error('tool deadline')), 5)
  assert.match((await requests[3] as Error).message, /tool deadline/)
  clearTimeout(timeout)
  assert.equal(state.workers.length, 2)
  state.workers[0]!.emit('message', { pageText: { title: 'ok', text: 'body' } })
  await requests[0]
  assert.equal(state.workers.length, 2, '等待真实 exit，不能让尚在运行的线程超过上限')
  state.workers[0]!.emit('exit', 0)
  await vi.waitFor(() => assert.equal(state.workers.length, 3))
  for (const controller of controllers)
    controller.abort(new Error('finish fixture'))
  await Promise.all(requests)
  assert.equal(state.workers.length, 3, '其余等待请求取消后不能创建 worker')
  await tool.dispatcher.close()
})

it('构造失败、error、exit 和执行取消均不泄漏并发槽位', async () => {
  vi.stubEnv('OUTBOUND_PROXY_URL', '')
  state.fetch.mockImplementation(async () => new Response('<html>fixture</html>', { headers: { 'content-type': 'text/html' } }))
  const tool = new WebFetchTool()
  const request = (signal = new AbortController().signal) => tool.execute({ input: { url: 'http://93.184.216.34/' } } as ValidatedToolInvocation<WebFetchInput>, { signal } as ToolExecutionContext)
  state.throwOnCreate = true
  await assert.rejects(request(), /constructor failed/)
  for (const outcome of ['error', 'exit', 'abort', 'success']) {
    const controller = new AbortController()
    const count = state.workers.length
    const pending = request(controller.signal).catch(error => error as Error)
    await vi.waitFor(() => assert.equal(state.workers.length, count + 1))
    const worker = state.workers.at(-1)!
    if (outcome === 'abort') {
      controller.abort(new Error('cancel running'))
    }
    else {
      if (outcome === 'error')
        worker.emit('error', new Error('worker error'))
      if (outcome === 'success')
        worker.emit('message', { pageText: { title: 'ok', text: 'body' } })
      worker.emit('exit', outcome === 'success' ? 0 : 1)
    }
    const result = await pending
    assert.equal(result instanceof Error, outcome !== 'success')
  }
  await tool.dispatcher.close()
})
