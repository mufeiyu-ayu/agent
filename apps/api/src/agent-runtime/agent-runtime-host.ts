import type { RunRecorder, RuntimeConfig, RuntimeHost, RuntimeModel, StoredMessage } from '@agent/agent'
import type { AttachmentModelRow } from '../attachments/attachments.service.js'
import type { Prisma } from '../generated/prisma/client.js'
import type { ResolvedLlmModel } from '../llm/llm-model-config.service.js'
import type { LLMService } from '../llm/llm.service.js'
import type { PrismaService } from '../prisma/prisma.service.js'
import type { ToolInvocationService } from '../tools/core/tool-invocation.service.js'
import type { WorkspaceService } from '../workspaces/workspace.service.js'
import type { RunTurnStreamInput } from './agent-runtime.types.js'
import type { ContextCompactionService } from './context/context-compaction.service.js'
import type { AgentRunRecorderService } from './lifecycle/agent-run-recorder.service.js'
import { NotFoundException } from '@nestjs/common'
import { AttachmentStorageService } from '../attachments/attachment-storage.service.js'
import { AttachmentsService } from '../attachments/attachments.service.js'
import { WORKSPACE_DEVELOPMENT_INSTRUCTION, WORKSPACE_DEVELOPMENT_VERSION, WORKSPACE_TOOL_NAMES } from '../chat/prompts/workspace-development.prompt.js'
import { getAiExceptionMessage } from '../common/utils/llm-error-message.util.js'
import { MessageRole, MessageStatus } from '../generated/prisma/client.js'
import { DatabaseCommitOutcomeUnknownError, DatabaseOperationDeadlineExceededError } from '../prisma/prisma.service.js'
import { toToolProgressArguments } from '../tools/web/tool-progress-arguments.js'
import { loadConversationHistory } from './context/conversation-history.js'

function messageSnapshot(message: StoredMessage): StoredMessage {
  return { id: message.id, content: message.content, createdAt: message.createdAt, updatedAt: message.updatedAt }
}

export function runtimeModel(model: ResolvedLlmModel): RuntimeModel {
  return { modelId: model.modelId, providerId: model.provider.providerId, family: model.family, profile: model.profile, maxInputTokens: model.maxInputTokens }
}

/** 只留内核需要的运行配置，Serper Key 留在宿主。 */
export function runtimeConfig(config: RuntimeConfig): RuntimeConfig {
  return { limits: config.limits, compactionKeepRecentTokens: config.compactionKeepRecentTokens, debugCaptureModelIo: config.debugCaptureModelIo }
}

/** 保留原始异常对象及其类，工具层与全局异常过滤器仍识别同一实例。 */
export const classifyHostError: RuntimeHost['classifyError'] = (error) => {
  if (error instanceof DatabaseOperationDeadlineExceededError)
    return 'deadline'
  if (error instanceof DatabaseCommitOutcomeUnknownError)
    return 'commit_outcome_unknown'
  if (error instanceof NotFoundException)
    return 'conversation_not_found'
  return undefined
}

export function runRecorder(recorder: AgentRunRecorderService): RunRecorder {
  return {
    createRun: async input => ({ id: (await recorder.createRun(input)).id }),
    createAssistantMessage: async (...args) => messageSnapshot(await recorder.createAssistantMessage(...args)),
    startStep: async (...args) => ({ id: (await recorder.startStep(...args)).id }),
    completeStep: (...args) => recorder.completeStep(...args),
    failStep: (...args) => recorder.failStep(...args),
    completeRun: async (...args) => messageSnapshot(await recorder.completeRun(...args)),
    abortRun: (...args) => recorder.abortRun(...args),
    failRun: (...args) => recorder.failRun(...args),
  }
}

/** 每次调用新建，指南状态及密钥只在该 Run 的宿主闭包里。 */
export function createRuntimeHost(input: RunTurnStreamInput, deps: {
  llm: LLMService
  prisma: PrismaService
  recorder: AgentRunRecorderService
  tools: ToolInvocationService
  compaction: ContextCompactionService
  logger: RuntimeHost['logger']
  attachments?: AttachmentsService
  workspaces?: WorkspaceService
}): RuntimeHost {
  const { prisma, recorder, compaction } = deps
  const attachments = deps.attachments ?? new AttachmentsService(prisma, new AttachmentStorageService())
  let userAttachmentRows: AttachmentModelRow[] = []
  let guideStepId: string | undefined
  let guideRequired = false
  return {
    logger: deps.logger,
    stream: (items, options) => deps.llm.chatStream(input.model.provider, items, options),
    recorder: {
      ...runRecorder(recorder),
      startStep: async (step, deadline) => ({ id: (await recorder.startStep({
        ...step,
        ...(step.type === 'model_sampling' && guideStepId
          ? { input: { ...step.input, workspaceDevelopment: { version: WORKSPACE_DEVELOPMENT_VERSION, stepId: guideStepId } } }
          : {}),
      }, deadline)).id }),
    },
    compaction: {
      compactBeforeSampling: run => compaction.compactBeforeSampling({ ...run, model: input.model }),
      canCompact: run => compaction.canCompact({ ...run, model: input.model }),
      compactAfterOverflow: run => compaction.compactAfterOverflow({ ...run, model: input.model }),
      compactAfterRun: run => compaction.compactAfterRun({ ...run, model: input.model }),
    },
    classifyError: classifyHostError,
    aiErrorMessage: getAiExceptionMessage,
    createTimeoutError: () => new DatabaseOperationDeadlineExceededError(),
    loadHistory: (conversationId, before, deadline) => loadConversationHistory(prisma, conversationId, before, deadline, attachments),
    assertConversationExists: async (conversationId) => {
      const conversation = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { id: true } })
      if (!conversation)
        throw new NotFoundException('会话不存在或已被删除')
    },
    createUserMessage: async (conversationId, content, attachmentIds) => {
      const { message, rows } = await prisma.$transaction(async (db) => {
        const message = await db.message.create({ data: { conversationId, role: MessageRole.USER, content, status: MessageStatus.COMPLETED } })
        const rows = await attachments.bind(db, { userId: input.userId, conversationId, messageId: message.id, attachmentIds })
        await db.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } })
        return { message, rows }
      })
      userAttachmentRows = rows
      // 提交确认只返回持久身份，不让后续存储错误把成功提交误报成未提交。
      return messageSnapshot(message)
    },
    loadUserMessage: async message => ({ ...messageSnapshot(message), ...await attachments.modelInput(message.content, userAttachmentRows) }),
    prepareToolBatch: async (batch, deadline) => {
      guideRequired = !guideStepId && !batch.argumentsTruncated && batch.calls.some(call => WORKSPACE_TOOL_NAMES.includes(call.toolName))
      if (!guideRequired)
        return undefined
      const guide = await recorder.startStep({
        runId: batch.runId,
        type: 'workspace_development',
        input: { version: WORKSPACE_DEVELOPMENT_VERSION, activatedAfterSamplingAttemptId: batch.samplingAttemptId },
      }, deadline)
      await recorder.completeStep(guide.id, deadline, { output: { instruction: WORKSPACE_DEVELOPMENT_INSTRUCTION as unknown as Prisma.InputJsonObject } })
      guideStepId = guide.id
      return WORKSPACE_DEVELOPMENT_INSTRUCTION
    },
    toolProgress: toToolProgressArguments,
    invokeTool: async (call, context) => {
      const invocation = await deps.tools.invoke(call, {
        signal: context.signal,
        databaseDeadline: context.databaseDeadline,
        argumentsTruncated: context.argumentsTruncated,
        workspaceGuideRequired: guideRequired,
        serperApiKey: input.runtimeConfig.serperApiKey,
        ...(input.userId ? { workspace: { userId: input.userId, conversationId: context.conversationId, runId: context.runId, deadlineAt: context.databaseDeadline.deadlineAt } } : {}),
      })
      const result = invocation.result
      // 显式投影，不能用展开运算把 WorkspaceCommit 随结构兼容类型偷偷传进核心。
      return {
        result: result.ok ? { ok: true, modelContent: result.modelContent, ...(result.display ? { display: result.display } : {}) } : { ok: false, code: result.code, modelContent: result.modelContent },
        argumentsValidated: invocation.argumentsValidated,
        observation: invocation.observation,
        finishStep: (id, deadline, close) => close.errorMessage === undefined
          ? recorder.completeStep(id, deadline, { ...close, ...(result.ok && result.workspaceCommit ? { workspaceCommit: result.workspaceCommit } : {}) })
          : recorder.failStep(id, deadline, { ...close, errorMessage: close.errorMessage }),
      }
    },
    releaseRun: async (runId) => { await deps.workspaces?.releaseRun(runId) },
  }
}
