import { extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { ServiceUnavailableException } from '@nestjs/common'

// 线上跑编译后的 .js，测试直接跑源码，worker 也用 .ts（Node 24 自带类型剥离）。
const DOCUMENT_TEXT_WORKER = new URL(`./document-text.worker${extname(fileURLToPath(import.meta.url))}`, import.meta.url)
const WORKER_MAX_HEAP_MB = 512
const WORKER_TIMEOUT_MS = 30_000
const MAX_ACTIVE_WORKERS = 2
const MAX_WAITERS = 8

let activeWorkers = 0
const waiters: Array<{ start: () => void }> = []

// 同 web_fetch：取得槽位时立即预占；等待者共享调用 deadline，取消后移出队列。
function acquire(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted()
  if (activeWorkers < MAX_ACTIVE_WORKERS) {
    activeWorkers++
    return Promise.resolve()
  }
  if (waiters.length >= MAX_WAITERS)
    return Promise.reject(new ServiceUnavailableException('文件解析繁忙，请稍后再试'))
  return new Promise((resolve, reject) => {
    const waiter = { start: () => {
      signal.removeEventListener('abort', abort)
      activeWorkers++
      resolve()
    } }
    function abort() {
      const index = waiters.indexOf(waiter)
      if (index !== -1)
        waiters.splice(index, 1)
      reject(signal.reason)
    }
    waiters.push(waiter)
    signal.addEventListener('abort', abort, { once: true })
  })
}

function release() {
  activeWorkers--
  waiters.shift()?.start()
}

/** 两路实际线程、最多八个等待者；排队与执行合计 30s，断连或超时立即停止等待/终止线程。 */
export async function extractDocumentText(extension: string, content: Uint8Array, inputSignal?: AbortSignal): Promise<string> {
  const signal = AbortSignal.any([AbortSignal.timeout(WORKER_TIMEOUT_MS), ...(inputSignal ? [inputSignal] : [])])
  await acquire(signal)

  return new Promise((resolve, reject) => {
    let worker: Worker
    try {
      signal.throwIfAborted()
      worker = new Worker(DOCUMENT_TEXT_WORKER, {
        workerData: { extension, content },
        resourceLimits: { maxOldGenerationSizeMb: WORKER_MAX_HEAP_MB },
      })
    }
    catch (error) {
      release()
      reject(error)
      return
    }
    const abort = (): void => {
      reject(signal.reason)
      void worker.terminate()
    }
    signal.addEventListener('abort', abort, { once: true })
    // node --watch 会从 worker 发依赖追踪消息，只认自己的结果。
    worker.on('message', (message: { documentText?: string }) => {
      if (typeof message.documentText === 'string')
        resolve(message.documentText)
    })
    worker.once('error', reject)
    // message/error 不证明线程已退出；真实 exit 才释放并发槽位。
    worker.once('exit', (code) => {
      signal.removeEventListener('abort', abort)
      release()
      reject(signal.reason ?? new Error(`document text worker exited with code ${code}`))
    })
    if (signal.aborted)
      abort()
  })
}
