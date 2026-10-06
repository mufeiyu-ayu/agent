import process from 'node:process'
import { parseArgs } from 'node:util'
import { PrismaService } from '../prisma/prisma.service.js'
import { WorkspaceCloudService } from './workspace-cloud.service.js'
import { lockWorkspaceStorage, workspaceDb } from './workspace-db.js'
import { WorkspaceGcService } from './workspace-gc.service.js'
import 'reflect-metadata'

async function main() {
  const { values } = parseArgs({ options: {
    'conversation': { type: 'string' },
    'bucket': { type: 'string' },
    'database': { type: 'string' },
    'apply': { type: 'boolean', default: false },
    'settle-upload': { type: 'string' },
    'settle-delete': { type: 'string' },
    'confirm-no-inflight': { type: 'boolean', default: false },
  } })
  const url = new URL(process.env.DATABASE_URL!)
  const database = `${url.hostname}:${url.port || '5432'}${url.pathname}${url.searchParams.has('schema') ? `?schema=${url.searchParams.get('schema')}` : ''}`
  const prisma = new PrismaService()
  const cloud = new WorkspaceCloudService()
  const gc = new WorkspaceGcService(prisma, cloud)
  try {
    if (values.apply || values['settle-upload'] || values['settle-delete']) {
      if (!values.conversation || values.bucket !== gc.bucket || values.database !== database)
        throw new Error('写操作必须指定已核定 conversation、Bucket 和数据库；禁止全桶/全会话 apply')
    }
    if (values['settle-upload']) {
      if (!values['confirm-no-inflight'])
        throw new Error('需先核查/停止所有相关上传进程并取得云请求结局，不得仅根据超时或租约过期确认')
      await workspaceDb(prisma, async (db) => {
        await lockWorkspaceStorage(db, values.conversation!)
        const upload = await db.workspaceUpload.findFirst({ where: { id: values['settle-upload']!, conversationId: values.conversation!, bucket: gc.bucket } })
        const activeRuns = await db.agentRun.count({ where: { conversationId: values.conversation!, status: 'RUNNING' } })
        if (!upload || activeRuns)
          throw new Error('核查目标不存在或仍有运行，未解除上传保护')
        await db.workspaceUpload.update({ where: { id: upload.id }, data: { state: 'settled', endedAt: new Date() } })
        await db.workspaceGcTarget.update({ where: { conversationId: upload.conversationId }, data: { pending: true } })
      })
    }
    if (values['settle-delete']) {
      if (!values['confirm-no-inflight'])
        throw new Error('需确认云端删除请求已结束，不能仅根据客户端超时解除写入屏障')
      await workspaceDb(prisma, async (db) => {
        await lockWorkspaceStorage(db, values.conversation!)
        const target = await db.workspaceGcTarget.findFirst({ where: { conversationId: values.conversation!, bucket: gc.bucket, deleteId: values['settle-delete']! } })
        const activeRuns = await db.agentRun.count({ where: { conversationId: values.conversation!, status: 'RUNNING' } })
        if (!target?.deletingKey || activeRuns)
          throw new Error('删除核查目标不存在或仍有运行，未解除写入屏障')
        await db.workspaceGcTarget.update({ where: { conversationId: target.conversationId }, data: { deletingKey: null, deleteId: null, deleteState: null, pending: true } })
      })
    }
    // 只读全量已知会话范围，不列举任意 Bucket 前缀；旧孤儿/测试前缀需另行核定。
    const ids = values.conversation
      ? [values.conversation]
      : [...new Set([
          ...(await prisma.conversationWorkspace.findMany({ select: { conversationId: true } })).map(row => row.conversationId),
          ...(await prisma.workspaceGcTarget.findMany({ select: { conversationId: true } })).map(row => row.conversationId),
        ])]
    console.log(JSON.stringify({ bucket: gc.bucket, database, apply: values.apply, scope: ids }))
    for (const id of ids) {
      const report = await gc.collect(id, values.apply)
      const uploads = await prisma.workspaceUpload.findMany({ where: { conversationId: id, state: { not: 'settled' } } })
      const target = await prisma.workspaceGcTarget.findUnique({ where: { conversationId: id } })
      console.log(JSON.stringify({ ...report, uploads, deletion: target?.deletingKey ? { key: target.deletingKey, id: target.deleteId, state: target.deleteState } : null }))
      if (report.failed.length || report.blocked)
        process.exitCode = 1
    }
  }
  catch {
    console.error('工作区对账未完成，保留待核查/重试目标。核对参数、migration、环境与 OSS ListObjects/DeleteObject 权限；不输出 SDK 异常或凭据。')
    process.exitCode = 1
  }
  finally { await prisma.$disconnect() }
}

void main().catch(() => {
  console.error('工作区维护参数或环境无效，未确认清理完成。')
  process.exitCode = 1
})
