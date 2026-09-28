import type { ConversationMessage, MessageActivity } from '@agent/contracts'
import type { Message } from '../generated/prisma/client.js'
import type { MessageActivityStepRow } from './message-activity.js'
import { Inject, Injectable, Logger } from '@nestjs/common'

import { AGENT_STEP_TYPES } from '../agent-runtime/lifecycle/agent-run-recorder.service.js'
import { MessageRole, Prisma } from '../generated/prisma/client.js'
import { PrismaService } from '../prisma/prisma.service.js'
import { ConversationsService } from './conversations.service.js'
import { toMessageActivity } from './message-activity.js'

const SAMPLING = AGENT_STEP_TYPES.modelSampling
const TOOL = AGENT_STEP_TYPES.toolExecution

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name)

  constructor(
    @Inject(PrismaService)
    private readonly prismaService: PrismaService,
    @Inject(ConversationsService)
    private readonly conversationsService: ConversationsService,
  ) {}

  async listMessages(userId: string, conversationId: string): Promise<ConversationMessage[]> {
    await this.conversationsService.assertOwnConversation(userId, conversationId)

    const messages = await this.prismaService.message.findMany({
      where: {
        conversationId,
      },
      orderBy: {
        createdAt: 'asc',
      },
    })
    // 先读消息再读 Step：Run 收口时先提交最后一个采样 Step、再把消息改成终态，
    // 这样读到已结束的消息时，它的 Step 一定也已提交，activity 不会缺最后一轮。
    const activities = await this.listActivities(conversationId)

    return messages.map(message => toConversationMessageResponse(
      message,
      message.role === MessageRole.ASSISTANT ? activities.get(message.id) : undefined,
    ))
  }

  /**
   * 整个会话一次查询（#212）：每条回答取最新的一次运行，只取它的采样与工具 Step，
   * 按 Step 类型只取还原要用的 jsonb 路径，不把 observation 读出来；查询次数与消息数无关。
   * 这些只是界面展示用的数据：查询失败时记日志、不带 activity，消息照常返回。
   */
  private async listActivities(conversationId: string): Promise<Map<string, MessageActivity>> {
    let rows: MessageActivityStepRow[]

    try {
      rows = await this.queryActivitySteps(conversationId)
    }
    catch (error) {
      this.logger.warn({
        event: 'message_activity_query_failed',
        conversationId,
        message: error instanceof Error ? error.message : String(error),
      })
      return new Map()
    }

    const stepsByMessage = new Map<string, MessageActivityStepRow[]>()

    for (const row of rows) {
      const steps = stepsByMessage.get(row.messageId) ?? []

      steps.push(row)
      stepsByMessage.set(row.messageId, steps)
    }

    const activities = new Map<string, MessageActivity>()

    for (const [messageId, steps] of stepsByMessage) {
      const activity = toMessageActivity(steps)

      if (activity)
        activities.set(messageId, activity)
    }

    return activities
  }

  /** 每个 `->` 都会把整列 jsonb 解压一次：只对需要的类型取对应路径，采样 Step 不碰 input，tool Step 只取三项 output。 */
  private queryActivitySteps(conversationId: string): Promise<MessageActivityStepRow[]> {
    return this.prismaService.$queryRaw<MessageActivityStepRow[]>(Prisma.sql`
      SELECT
        r."assistantMessageId" AS "messageId",
        s."sequence",
        s."type",
        s."startedAt",
        s."endedAt",
        CASE WHEN s."type" = ${SAMPLING} THEN s."output" -> 'reasoningContent' END AS "reasoningContent",
        CASE WHEN s."type" = ${SAMPLING} THEN s."output" -> 'answerStartedMs' END AS "answerStartedMs",
        CASE WHEN s."type" = ${TOOL} THEN s."input" -> 'callId' END AS "callId",
        CASE WHEN s."type" = ${TOOL} THEN s."input" -> 'toolName' END AS "toolName",
        CASE WHEN s."type" = ${TOOL} THEN s."input" -> 'arguments' END AS "arguments",
        CASE WHEN s."type" = ${TOOL} THEN s."output" -> 'ok' END AS "ok",
        CASE WHEN s."type" = ${TOOL} THEN s."output" -> 'code' END AS "code",
        CASE WHEN s."type" = ${TOOL} THEN s."output" -> 'display' END AS "display"
      FROM (
        SELECT DISTINCT ON (run."assistantMessageId") run."id", run."assistantMessageId"
        FROM "AgentRun" run
        WHERE run."conversationId" = ${conversationId}
          AND run."assistantMessageId" IS NOT NULL
        ORDER BY run."assistantMessageId", run."createdAt" DESC, run."id" DESC
      ) r
      JOIN "AgentStep" s ON s."runId" = r."id"
      WHERE s."type" IN (${SAMPLING}, ${TOOL})
    `)
  }
}

function toConversationMessageResponse(
  message: Message,
  activity: MessageActivity | undefined,
): ConversationMessage {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role,
    content: message.content,
    status: message.status,
    createdAt: message.createdAt.toISOString(),
    updatedAt: message.updatedAt.toISOString(),
    ...(activity ? { activity } : {}),
  }
}
