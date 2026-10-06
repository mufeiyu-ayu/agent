import type { Prisma } from '../generated/prisma/client.js'
import type { PrismaService } from '../prisma/prisma.service.js'
import { DatabaseCommitOutcomeUnknownError } from '../prisma/prisma.service.js'
import { WorkspaceOperationError } from './workspace-files.js'

/** 上传登记、取得所有权、文件确认、预览授权、删除与 GC 共用；跨进程，不依赖内存。 */
export async function lockWorkspaceStorage(db: Prisma.TransactionClient, conversationId: string): Promise<void> {
  await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`workspace-storage:${conversationId}`}, 0))`
}

/** 文件指针、生命周期和核查均使用独立且由 PostgreSQL 执行的有限预算。 */
export async function workspaceDb<T>(prisma: PrismaService, operation: (db: Prisma.TransactionClient) => Promise<T>, signal?: AbortSignal): Promise<T> {
  try {
    return await prisma.withDeadlineTransaction({
      deadlineAt: Date.now() + 5_000,
      ...(signal ? { signal } : {}),
      createTimeoutError: () => new WorkspaceOperationError('工作区状态操作超时，停止等待。', true),
    }, transaction => transaction.execute(operation), () => {})
  }
  catch (error) {
    if (error instanceof DatabaseCommitOutcomeUnknownError)
      throw new WorkspaceOperationError('工作区状态事务结果未知，已停止执行，请核查平台记录。', true)
    throw error
  }
}
