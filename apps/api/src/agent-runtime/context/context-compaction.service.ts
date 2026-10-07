import type { CompactionRun as CoreCompactionRun, RuntimeConfig } from '@agent/agent'
import type { ResolvedLlmModel } from '../../llm/llm-model-config.service.js'
import { ContextCompactionService as CoreCompaction } from '@agent/agent'
import { Inject, Injectable, Logger } from '@nestjs/common'
import { LLMService } from '../../llm/llm.service.js'
import { DatabaseOperationDeadlineExceededError, PrismaService } from '../../prisma/prisma.service.js'
import { runRecorder, runtimeModel } from '../agent-runtime-host.js'
import { AgentRunRecorderService } from '../lifecycle/agent-run-recorder.service.js'
import { loadConversationHistory } from './conversation-history.js'

type CompactionRun = Omit<CoreCompactionRun, 'model'> & { model: ResolvedLlmModel }
type AfterRun = Omit<Parameters<CoreCompaction['compactAfterRun']>[0], 'model' | 'runtimeConfig'> & { model: ResolvedLlmModel, runtimeConfig: RuntimeConfig }

/** 仅绑定凭据与存储；三个检查点及摘要策略全部在核心包。 */
@Injectable()
export class ContextCompactionService {
  private readonly logger = new Logger(ContextCompactionService.name)

  constructor(
    @Inject(LLMService) private readonly llmService: LLMService,
    @Inject(PrismaService) private readonly prismaService: PrismaService,
    @Inject(AgentRunRecorderService) private readonly agentRunRecorderService: AgentRunRecorderService,
  ) {}

  compactBeforeSampling(run: CompactionRun): Promise<void> {
    return this.bind(run.model).compactBeforeSampling({ ...run, model: runtimeModel(run.model) })
  }

  canCompact(run: CompactionRun): boolean {
    return this.bind(run.model).canCompact({ ...run, model: runtimeModel(run.model) })
  }

  compactAfterOverflow(run: CompactionRun): Promise<boolean> {
    return this.bind(run.model).compactAfterOverflow({ ...run, model: runtimeModel(run.model) })
  }

  compactAfterRun(input: AfterRun): Promise<void> {
    return this.bind(input.model).compactAfterRun({ ...input, model: runtimeModel(input.model), runtimeConfig: {
      limits: input.runtimeConfig.limits,
      compactionKeepRecentTokens: input.runtimeConfig.compactionKeepRecentTokens,
      debugCaptureModelIo: input.runtimeConfig.debugCaptureModelIo,
    } })
  }

  private bind(model: ResolvedLlmModel): CoreCompaction {
    return new CoreCompaction({
      stream: (items, options) => this.llmService.chatStream(model.provider, items, options),
      recorder: runRecorder(this.agentRunRecorderService),
      logger: this.logger,
      createTimeoutError: () => new DatabaseOperationDeadlineExceededError(),
      loadHistory: (conversationId, before, deadline) => loadConversationHistory(this.prismaService, conversationId, before, deadline),
      insertCompaction: (input, deadline) => this.prismaService.withDeadlineTransaction(deadline, transaction => transaction.execute(prisma => prisma.conversationCompaction.create({
        data: input,
        select: { id: true, summary: true, coveredGroupIds: true, answerOnlyGroupId: true },
      }))),
    })
  }
}
