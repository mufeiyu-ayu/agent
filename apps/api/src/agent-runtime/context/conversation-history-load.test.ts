import type { HistoryRunRow } from '@agent/agent'
import type { Message } from '../../generated/prisma/client.js'
import type { PrismaService } from '../../prisma/prisma.service.js'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { pairHistory, restoreGroups } from '@agent/agent'
import { it } from 'vitest'
import { loadConversationHistory } from './conversation-history.js'

it.each([0, 990, 1000])('历史覆盖 %s/1000 组时仅加载剩余正文，完整配对和 messageCount 不变', async (coveredCount) => {
  const now = new Date()
  const messages: Message[] = Array.from({ length: 1000 }, (_, i) => [
    { id: `u${i}`, conversationId: 'c', role: 'USER' as const, status: 'COMPLETED' as const, content: 'question', createdAt: now, updatedAt: now },
    { id: `a${i}`, conversationId: 'c', role: 'ASSISTANT' as const, status: 'COMPLETED' as const, content: 'a'.repeat(32000), createdAt: now, updatedAt: now },
  ]).flat()
  const runs: HistoryRunRow[] = Array.from({ length: 1000 }, (_, i) => ({ id: `r${i}`, userMessageId: `u${i}`, assistantMessageId: `a${i}`, status: 'COMPLETED' }))
  const covered = runs.slice(0, coveredCount).map(run => run.userMessageId)
  let contentBytes = 0
  let contentQueries = 0
  let rawQueries = 0
  const db = {
    $queryRaw: async () => rawQueries++ === 0 ? [{ readAt: now }] : [],
    attachment: { findMany: async () => [] },
    conversationCompaction: { findFirst: async () => coveredCount ? ({ id: 'summary', summary: 'summary', coveredGroupIds: covered, answerOnlyGroupId: null }) : null },
    message: { findMany: async (args: { where: { id?: { in: string[] } }, select: { content?: boolean } }) => {
      if (!args.select.content)
        return messages.map(({ content: _content, ...metadata }) => metadata)
      contentQueries++
      assert.ok(args.where.id, '正文必须按保留的 ID 读取')
      const ids = new Set(args.where.id.in)
      const result = messages.filter(message => ids.has(message.id))
      contentBytes += result.reduce((sum, message) => sum + Buffer.byteLength(message.content), 0)
      return result.map(({ id, content }) => ({ id, content }))
    } },
    agentRun: { findMany: async () => runs },
  }
  const prisma = { withDeadlineTransaction: async (_deadline: unknown, callback: (tx: { execute: (fn: (client: typeof db) => Promise<unknown>) => Promise<unknown> }) => Promise<unknown>) => callback({ execute: fn => fn(db) }) } as unknown as PrismaService
  const result = await loadConversationHistory(prisma, 'c', undefined, { deadlineAt: Date.now() + 5000, createTimeoutError: () => new Error('timeout') })
  assert.deepEqual(result.history.groups, restoreGroups(pairHistory(messages, runs).filter(group => !covered.includes(group.key)), []))
  assert.equal(result.messageCount, 2000)
  assert.equal(contentBytes, (1000 - coveredCount) * 32008)
  assert.equal(contentQueries, coveredCount === 1000 ? 0 : 1)
  console.log('history content bytes', { coveredCount, before: 32008000, after: contentBytes })
})
