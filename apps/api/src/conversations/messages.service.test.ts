import type { Message } from '../generated/prisma/client.js'
import type { PrismaService } from '../prisma/prisma.service.js'
import type { MessageActivityStepRow } from './message-activity.js'
import assert from 'node:assert/strict'
import { NotFoundException } from '@nestjs/common'
import { describe, it } from 'vitest'

import { ConversationsService } from './conversations.service.js'
import { MessagesService } from './messages.service.js'

describe('MessagesService.listMessages（#212 activity）', () => {
  it('AC-06 整个会话一次查询 Step，只按 jsonb 路径取还原要用的字段，不读 observation；查询次数与消息数无关', async () => {
    for (const messageCount of [2, 40]) {
      const prisma = new FakePrisma(createMessages(messageCount), [])

      await createService(prisma).listMessages('user-1', 'conversation-1')

      assert.equal(prisma.rawQueries.length, 1)
      assert.equal(prisma.messageQueries, 1)
    }

    const prisma = new FakePrisma(createMessages(2), [])

    await createService(prisma).listMessages('user-1', 'conversation-1')

    const [query] = prisma.rawQueries

    assert.ok(query)
    // 只按 Step 类型取这些 jsonb 路径（每个 `->` 都会解压整列，不给用不上的类型取）；不出现 observation，也不整列取 input / output。
    assert.deepEqual(
      [...query.sql.matchAll(/CASE WHEN s\."type" = \$(\d+) THEN s\."(input|output)" -> '(\w+)'/g)]
        .map(([, index, column, path]) => `${String(query.values[Number(index) - 1])}: ${column}.${path}`),
      [
        'model_sampling: output.reasoningContent',
        'model_sampling: output.answerStartedMs',
        'tool_execution: input.callId',
        'tool_execution: input.toolName',
        'tool_execution: input.arguments',
        'tool_execution: output.ok',
        'tool_execution: output.code',
        'tool_execution: output.display',
      ],
    )
    assert.equal([...query.sql.matchAll(/s\."(input|output)"/g)].length, 8)
    assert.doesNotMatch(query.sql, /observation/)
    assert.ok(query.values.includes('conversation-1'))
  })

  it('AC-04 activity 只挂在 assistant 消息上：user 消息没有，没有运行记录的回答也没有', async () => {
    const [user, assistant, oldAssistant] = [
      createMessage('message-1', 'USER'),
      createMessage('message-2', 'ASSISTANT'),
      createMessage('message-3', 'ASSISTANT'),
    ]
    const prisma = new FakePrisma([user!, assistant!, oldAssistant!], [
      // 同一 id 的 user 消息不可能有运行，这里故意造一条，确认按角色过滤。
      { ...toolRow('message-1', 2) },
      toolRow('message-2', 2),
    ])

    const messages = await createService(prisma).listMessages('user-1', 'conversation-1')

    assert.equal(Object.hasOwn(messages[0]!, 'activity'), false)
    assert.equal(messages[1]?.activity?.items.length, 1)
    assert.equal(Object.hasOwn(messages[2]!, 'activity'), false)
  })

  it('AC-05 activity 查询失败时只是不带 activity：消息照常返回，不 500', async () => {
    const prisma = new FakePrisma([createMessage('message-1', 'USER'), createMessage('message-2', 'ASSISTANT')], [])

    prisma.rawQueryError = new Error('statement timeout')

    const messages = await createService(prisma).listMessages('user-1', 'conversation-1')

    assert.deepEqual(messages.map(message => [message.id, Object.hasOwn(message, 'activity')]), [['message-1', false], ['message-2', false]])
  })

  it('AC-07 他人会话仍是 404，且不查消息与 Step', async () => {
    const prisma = new FakePrisma(createMessages(2), [])

    prisma.ownConversation = false

    await assert.rejects(
      createService(prisma).listMessages('user-2', 'conversation-1'),
      NotFoundException,
    )
    assert.equal(prisma.messageQueries, 0)
    assert.equal(prisma.rawQueries.length, 0)
  })
})

function createService(prisma: FakePrisma): MessagesService {
  const prismaService = prisma as unknown as PrismaService

  return new MessagesService(prismaService, new ConversationsService(prismaService))
}

class FakePrisma {
  ownConversation = true
  rawQueryError: Error | undefined
  messageQueries = 0
  readonly rawQueries: Array<{ sql: string, values: unknown[] }> = []

  constructor(
    private readonly messages: Message[],
    private readonly stepRows: MessageActivityStepRow[],
  ) {}

  readonly conversation = {
    findFirst: async () => this.ownConversation ? { id: 'conversation-1' } : null,
  }

  readonly message = {
    findMany: async () => {
      this.messageQueries += 1
      return this.messages
    },
  }

  // Prisma.sql 的 text 是发给 PostgreSQL 的原文（占位符为 $1、$2…）。
  async $queryRaw(query: { text: string, values: unknown[] }): Promise<MessageActivityStepRow[]> {
    this.rawQueries.push({ sql: query.text, values: query.values })
    if (this.rawQueryError)
      throw this.rawQueryError
    return this.stepRows
  }
}

function createMessages(count: number): Message[] {
  return Array.from({ length: count }, (_, index) =>
    createMessage(`message-${index + 1}`, index % 2 === 0 ? 'USER' : 'ASSISTANT'))
}

function createMessage(id: string, role: Message['role']): Message {
  const createdAt = new Date('2026-09-28T08:00:00.000Z')

  return {
    id,
    conversationId: 'conversation-1',
    role,
    content: '内容',
    status: 'COMPLETED',
    createdAt,
    updatedAt: createdAt,
  }
}

function toolRow(messageId: string, sequence: number): MessageActivityStepRow {
  return {
    messageId,
    sequence,
    type: 'tool_execution',
    startedAt: null,
    endedAt: null,
    reasoningContent: null,
    answerStartedMs: null,
    callId: 'call-1',
    toolName: 'web_search',
    arguments: '{"query":"seo"}',
    ok: true,
    code: null,
    display: null,
  }
}
