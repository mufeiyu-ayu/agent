import type { Prisma } from '../generated/prisma/client.js'
import type { PrismaService } from '../prisma/prisma.service.js'
import { DatabaseCommitOutcomeUnknownError } from '../prisma/prisma.service.js'
import { WorkspaceOperationError } from './workspace-files.js'

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
