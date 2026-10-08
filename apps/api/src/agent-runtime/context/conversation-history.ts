import type { ConversationHistory, HistoryStepRow } from '@agent/agent'
import type { MessageImage } from '@agent/ai'
import type { Message } from '../../generated/prisma/client.js'
import type { DatabaseOperationDeadline, PrismaService } from '../../prisma/prisma.service.js'
import { AGENT_STEP_TYPES, pairHistory, restoreGroups } from '@agent/agent'
import { AttachmentStorageService } from '../../attachments/attachment-storage.service.js'
import { ATTACHMENT_MODEL_SELECT, AttachmentsService } from '../../attachments/attachments.service.js'
import { MessageRole, MessageStatus, Prisma } from '../../generated/prisma/client.js'

/**
 * 在同一个 REPEATABLE READ 快照里读历史（#220）：最新压缩记录、消息、各组 Run 的状态与需要还原的 Step。
 * 消息是严格早于 `before` 的已完成消息（检查点 B 读下一次问答的历史，不给 `before`），最旧在前、不按条数截断；
 * 被压缩记录覆盖的组不再查 Step。`messageCount` 是读到的 Message 条数，记在 load_conversation_history Step 上。
 * 用户消息带附件时，附件记录也在同一个快照里读出；正文换成模型看到的样子（附件文字拼在前面），
 * 图片在事务结束后从存储读出，不让网络往返占着快照。`images: false`（写摘要用）只拼文字、不读图片。
 */
export async function loadConversationHistory(
  prismaService: PrismaService,
  conversationId: string,
  before: Pick<Message, 'id' | 'createdAt'> | undefined,
  deadline: DatabaseOperationDeadline,
  attachments: AttachmentsService = new AttachmentsService(prismaService, new AttachmentStorageService()),
  options: { images: boolean } = { images: true },
): Promise<{ history: ConversationHistory, messageCount: number }> {
  const snapshot = await prismaService.withDeadlineTransaction(deadline, async (transaction) => {
    const [{ readAt }] = await transaction.execute(prisma => prisma.$queryRaw<[{ readAt: Date }]>`SELECT now() AS "readAt"`)
    const compaction = await transaction.execute(prisma => prisma.conversationCompaction.findFirst({
      where: { conversationId },
      orderBy: [{ readAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, summary: true, coveredGroupIds: true, answerOnlyGroupId: true },
    }))
    // 先配对轻量元数据：覆盖组仍参与顺序/计数，但不再搬运已压缩正文。
    const metadata = await transaction.execute(prisma => prisma.message.findMany({
      where: {
        conversationId,
        status: MessageStatus.COMPLETED,
        // 严格早于当前用户消息：createdAt 更早，或同一时刻 id 更小。
        ...(before
          ? {
              OR: [
                { createdAt: { lt: before.createdAt } },
                { createdAt: before.createdAt, id: { lt: before.id } },
              ],
            }
          : {}),
      },
      orderBy: [
        { createdAt: 'asc' },
        { id: 'asc' },
      ],
      select: { id: true, conversationId: true, role: true, status: true, createdAt: true, updatedAt: true },
    }))
    const messages = metadata.map((message): typeof message & { content: string, images?: MessageImage[] } => ({ ...message, content: '' }))
    const userMessageIds = messages.filter(message => message.role === MessageRole.USER).map(message => message.id)
    const runs = userMessageIds.length === 0
      ? []
      : await transaction.execute(prisma => prisma.agentRun.findMany({
          where: { conversationId, userMessageId: { in: userMessageIds } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true, userMessageId: true, assistantMessageId: true, status: true },
        }))
    const covered = new Set(compaction?.coveredGroupIds)
    const groups = pairHistory(messages, runs).filter(group => !covered.has(group.key))
    const retainedMessages = groups.flatMap(group => [...(group.question ? [group.question] : []), ...group.answers.map(answer => answer.message)])
    if (retainedMessages.length) {
      const contents = await transaction.execute(prisma => prisma.message.findMany({
        where: { conversationId, id: { in: retainedMessages.map(message => message.id) } },
        select: { id: true, content: true },
      }))
      const byId = new Map(contents.map(message => [message.id, message.content]))
      for (const message of retainedMessages) {
        const content = byId.get(message.id)
        if (content === undefined)
          throw new Error('历史消息正文缺失，停止使用不完整快照')
        message.content = content
      }
    }
    // 边界组也查 Step：它按退回形式发出，但本 Run 内新写的记录可能既不覆盖它、也不再以它为边界，
    // 那之后要按完整形态发出，才与按新记录重建的一致。
    const runIds = groups.flatMap(group => group.answers.flatMap(answer => answer.runId ? [answer.runId] : []))
    const steps = runIds.length === 0
      ? []
      : await transaction.execute(prisma => prisma.$queryRaw<HistoryStepRow[]>(historyStepsQuery(runIds)))

    const questions = groups.flatMap(group => group.question ? [group.question] : [])
    const attachmentRows = questions.length === 0
      ? []
      : await transaction.execute(prisma => prisma.attachment.findMany({
          where: { messageId: { in: questions.map(question => question.id) }, deletedAt: null },
          orderBy: [{ messageId: 'asc' }, { position: 'asc' }],
          select: { ...ATTACHMENT_MODEL_SELECT, messageId: true },
        }))

    return { readAt, compaction, groups, steps, questions, attachmentRows, messageCount: messages.length }
  }, undefined, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead })

  await Promise.all(snapshot.questions.map(async (question) => {
    const rows = snapshot.attachmentRows.filter(row => row.messageId === question.id)
    if (rows.length === 0)
      return

    const input = await attachments.modelInput(question.content, rows, options)
    question.content = input.modelContent
    if (input.images)
      question.images = input.images
  }))

  return {
    history: { readAt: snapshot.readAt, compaction: snapshot.compaction ?? undefined, groups: restoreGroups(snapshot.groups, snapshot.steps) },
    messageCount: snapshot.messageCount,
  }
}

/**
 * 历史回答所属 Run 的采样、工具与成功的本轮压缩 Step，一次查询取回，查询次数与问答数无关。
 * 每个 `->` 都会把整列 jsonb 解压一次：只对需要的类型取对应路径，不碰 debug 抓取、contextPlan 等字段。
 */
function historyStepsQuery(runIds: string[]): Prisma.Sql {
  const sampling = AGENT_STEP_TYPES.modelSampling
  const tool = AGENT_STEP_TYPES.toolExecution
  const compaction = AGENT_STEP_TYPES.contextCompaction

  return Prisma.sql`
    SELECT
      s."runId",
      s."sequence",
      s."type",
      s."input" -> 'samplingAttemptId' AS "samplingAttemptId",
      CASE WHEN s."type" = ${sampling} THEN s."output" -> 'toolCallCount' END AS "toolCallCount",
      CASE WHEN s."type" = ${sampling} THEN s."output" -> 'intermediateText' END AS "intermediateText",
      CASE WHEN s."type" = ${tool} THEN s."input" -> 'callId' END AS "callId",
      CASE WHEN s."type" = ${tool} THEN s."input" -> 'toolName' END AS "toolName",
      CASE WHEN s."type" = ${tool} THEN s."input" -> 'arguments' END AS "arguments",
      CASE WHEN s."type" = ${tool} THEN s."output" -> 'observation' END AS "observation",
      CASE WHEN s."type" = ${tool} THEN s."output" -> 'ok' END AS "ok",
      CASE WHEN s."type" = ${compaction} THEN s."input" -> 'keptFromSamplingAttemptId' END AS "keptFromSamplingAttemptId",
      CASE WHEN s."type" = ${compaction} THEN s."output" -> 'summary' END AS "summary"
    FROM "AgentStep" s
    WHERE s."runId" = ANY(${runIds})
      AND (
        s."type" IN (${sampling}, ${tool})
        OR (s."type" = ${compaction} AND s."status" = 'COMPLETED' AND s."input" ->> 'kind' = 'turn')
      )
  `
}
