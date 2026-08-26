import type { DatabaseOperationDeadline } from '../../prisma/prisma.service.js'

import {
  DatabaseOperationDeadlineExceededError,
} from '../../prisma/prisma.service.js'
import { AgentRunDeadlineExceededError } from '../agent-runtime.errors.js'

const TERMINALIZATION_DEADLINE_MS = 5_000

type RunTerminationSource
  = | 'completed'
    | 'completing'
    | 'deadline'
    | 'failure'
    | 'user'

export interface RunCancellation {
  databaseDeadline: DatabaseOperationDeadline
  reason?: unknown
  signal: AbortSignal
  source?: RunTerminationSource
  claimCompletion: () => void
  claimCompleted: () => void
  claimCompletionFailure: (
    source: 'deadline' | 'failure',
    reason: unknown,
  ) => void
  claimDeadline: (reason?: AgentRunDeadlineExceededError) => void
  claimFailure: (reason: unknown) => void
  throwIfUnavailable: () => void
  dispose: () => void
}

/**
 * 管理一次 AgentRun「为什么停止」以及「通知谁停止」。
 *
 * 三个停止入口：
 * - 用户点击停止 / 断开连接 -> user；
 * - 超过本轮最长时间 -> deadline；
 * - 模型、Tool 或数据库抛错 -> failure。
 *
 * 普通执行阶段遵循先到先得：第一个原因写入 source / reason，并通过内部
 * signal 通知 LLM、Tool 和数据库停止；后来的原因不能覆盖它。
 *
 * 正常完成多一个中间态：
 * undefined -> completing（数据库正在 COMMIT）-> completed（COMMIT 成功）。
 * completing 期间收到 user / deadline 时不能马上判为中断，因为 COMMIT
 * 可能已经成功；这里只暂存原因，等 COMMIT 成功或失败后再决定最终状态。
 */
export function createRunCancellation(
  /** 前端停止 fetch / 连接关闭后由 Controller 触发；同步请求没有该信号。 */
  userSignal: AbortSignal | undefined,
  /** 从 AgentRun 创建成功开始计算的最长执行时间，单位为毫秒。 */
  deadlineMs: number,
): RunCancellation {
  // 外部 userSignal 只能表示用户取消；内部 controller 还能表示 deadline / failure。
  const controller = new AbortController()
  // 例如现在 12:00、允许 10 分钟，则 deadlineAt 表示绝对时间 12:10。
  const deadlineAt = Date.now() + deadlineMs
  // claim 等闭包要读取 cancellation.source，所以先声明，再在下面填入完整对象。
  let cancellation!: RunCancellation
  // 保存 setTimeout 的编号；Run 结束后 clearTimeout，避免迟到的超时回调。
  let deadlineId!: NodeJS.Timeout
  // 数据库正在 COMMIT 时若用户取消或时间到，先把最早原因放这里等待结果。
  let pendingTermination: {
    source: 'deadline' | 'user'
    reason: unknown
  } | undefined
  // 需要登记 deadline 时再创建错误，作为 signal.reason 和最终失败原因。
  const deadlineError = (): AgentRunDeadlineExceededError => (
    new AgentRunDeadlineExceededError()
  )

  /** 登记停止原因：普通执行阶段只接受第一个，后来的全部忽略。 */
  const claim = (
    source: 'deadline' | 'failure' | 'user',
    reason: unknown,
  ): void => {
    // COMMIT 已经开始，结果仍未知：只记住最先到达的 user / deadline，不打断。
    if (cancellation.source === 'completing') {
      if (
        !pendingTermination
        && (source === 'deadline' || source === 'user')
      ) {
        pendingTermination = { source, reason }
      }
      return
    }

    // 例如 user 已先到，随后 deadline 到达：保留 user，忽略 deadline。
    if (cancellation.source)
      return

    // source 供收口判断 ABORTED / FAILED；abort signal 负责让在途任务停下来。
    cancellation.source = source
    cancellation.reason = reason
    controller.abort(reason)
  }
  // 外部 signal 一旦 aborted，就把它翻译成 Runtime 的 user 停止原因。
  const handleUserAbort = (): void => claim('user', userSignal?.reason)

  cancellation = {
    // 数据库需要：何时截止、如何接收取消、超时后抛哪一种数据库错误。
    databaseDeadline: {
      deadlineAt,
      signal: controller.signal,
      createTimeoutError: () => new DatabaseOperationDeadlineExceededError(),
    },
    // LLM / Tool 使用这一份信号；任一停止原因生效后它都会变成 aborted。
    signal: controller.signal,

    // 数据库业务语句都成功，准备 COMMIT 前调用：先确认没被取消，再标记“提交中”。
    claimCompletion: () => {
      cancellation.throwIfUnavailable()
      cancellation.source = 'completing'
    },

    // 只在 COMMIT 确认成功后调用；此时数据库事实已成立，迟到取消全部作废。
    claimCompleted: () => {
      if (cancellation.source !== 'completing')
        throw new Error('Agent Run 尚未取得 completion commit ownership')
      cancellation.source = 'completed'
      pendingTermination = undefined
    },

    // COMMIT 失败时调用：期间若已有 user / deadline 就用它，否则用提交失败原因。
    claimCompletionFailure: (source, reason) => {
      if (cancellation.source !== 'completing') {
        claim(source, reason)
        return
      }

      const firstCause = pendingTermination ?? { source, reason }
      cancellation.source = firstCause.source
      cancellation.reason = firstCause.reason
      controller.abort(firstCause.reason)
      pendingTermination = undefined
    },

    // 两个方便调用方使用的入口，最终仍交给 claim() 执行“第一个原因生效”。
    claimDeadline: (reason = deadlineError()) => {
      claim('deadline', reason)
    },
    claimFailure: (reason) => {
      claim('failure', reason)
    },

    // 关键步骤前调用：若已取消就抛出原始 reason，让外层 catch 开始终态收口。
    // 同时直接比较当前时间，避免事件循环繁忙导致 setTimeout 还没来得及执行。
    throwIfUnavailable: () => {
      if (!cancellation.source && Date.now() >= deadlineAt)
        cancellation.claimDeadline()

      if (
        cancellation.source === 'user'
        || cancellation.source === 'deadline'
        || cancellation.source === 'failure'
      ) {
        controller.signal.throwIfAborted()
      }
    },

    // Run 成功、失败或中断后都调用，避免 timer / 监听继续留在内存中。
    dispose: () => {
      clearTimeout(deadlineId)
      userSignal?.removeEventListener('abort', handleUserAbort)
    },
  }

  // 到达 deadlineMs 后登记 deadline；若 user / failure 已先到，claim 会忽略它。
  deadlineId = setTimeout(
    () => claim('deadline', deadlineError()),
    deadlineMs,
  )

  // 用户可能在监听注册前就已取消：已取消就立即处理，否则等待未来的一次用户取消。
  if (userSignal?.aborted)
    handleUserAbort()
  else
    userSignal?.addEventListener('abort', handleUserAbort, { once: true })

  // 返回后，Runtime 使用 signal 通知任务、用各 claim 方法记录状态、用 dispose 清理。
  return cancellation
}

export function claimRunTermination(
  cancellation: RunCancellation,
  error: unknown,
): void {
  if (error instanceof DatabaseOperationDeadlineExceededError) {
    if (cancellation.source === 'completing') {
      cancellation.claimCompletionFailure(
        'deadline',
        new AgentRunDeadlineExceededError(),
      )
    }
    else {
      cancellation.claimDeadline()
    }
    return
  }

  if (cancellation.source === 'completing')
    cancellation.claimCompletionFailure('failure', error)
  else
    cancellation.claimFailure(error)
}

export function createTerminalizationDeadline(): DatabaseOperationDeadline {
  return {
    deadlineAt: Date.now() + TERMINALIZATION_DEADLINE_MS,
    createTimeoutError: () => new Error('Agent Run 终态收口超过数据库等待上限。'),
  }
}
