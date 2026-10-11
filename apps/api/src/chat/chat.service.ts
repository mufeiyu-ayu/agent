import type { ChatStreamEvent, ReasoningEffort } from '@agent/contracts'
import type { ChatDto } from './dto/chat.dto.js'
import { estimateRequestTokens } from '@agent/agent'
import { BadRequestException, Inject, Injectable, Optional } from '@nestjs/common'

import { AgentRuntimeService } from '../agent-runtime/agent-runtime.service.js'
import { AttachmentsService } from '../attachments/attachments.service.js'
import { ConversationsService } from '../conversations/conversations.service.js'
import { LlmModelConfigService } from '../llm/llm-model-config.service.js'
import { LlmModelUnavailableError } from '../llm/llm.errors.js'
import { RuntimeConfigService } from '../runtime-config/runtime-config.service.js'
import { SkillsService } from '../skills/skills.service.js'
import { skillRoot } from '../tools/skill-tools.js'
import { TOOL_DEFINITIONS } from '../tools/tool-definitions.js'
import { toChatStreamEvent } from './chat-stream-event.mapper.js'
import { buildAgentInstructions } from './prompts/agent.prompt.js'

interface ChatStreamOptions {
  signal?: AbortSignal
}

@Injectable()
export class ChatService {
  constructor(
    @Inject(AgentRuntimeService)
    private readonly agentRuntimeService: AgentRuntimeService,
    @Inject(LlmModelConfigService)
    private readonly llmModelConfigService: LlmModelConfigService,
    @Inject(ConversationsService)
    private readonly conversationsService: ConversationsService,
    @Inject(RuntimeConfigService)
    private readonly runtimeConfigService: RuntimeConfigService,
    @Optional() @Inject(AttachmentsService) private readonly attachments?: AttachmentsService,
    @Optional() @Inject(SkillsService) private readonly skills?: SkillsService,
  ) {}

  /**
   * 先校验会话归属、解析模型行、读运行配置再返回事件流：别人的会话（404）、模型不可用（400）与
   * 运行配置读不到（503）都要在写出 NDJSON 头、写入任何消息之前抛出，所以这里不是 async generator，
   * 而是校验完成后再交出 generator。
   */
  async chatStream(
    userId: string,
    input: ChatDto,
    options: ChatStreamOptions = {},
  ): Promise<AsyncGenerator<ChatStreamEvent>> {
    await this.conversationsService.assertOwnConversation(userId, input.conversationId)
    // 附件已经发出过或放久了被清掉：在写出响应头之前拒绝（409），前台能把原因告诉用户。
    if (input.attachmentIds?.length)
      await this.attachments?.assertSendable(userId, input.attachmentIds)

    const model = await this.resolveModel(input.model, input.reasoningEffort)
    // 与模型行一样是本次问答的快照：后台修改对下一次问答生效。
    const runtimeConfig = await this.runtimeConfigService.loadSnapshot()
    const skills = await this.skills?.snapshot(userId, input.skillIds)
    const instructions = buildAgentInstructions(new Date())
    if (skills) {
      instructions.push({ type: 'message', role: 'system', content: skills.catalogInstruction })
      for (const selected of skills.selected) {
        const main = selected.package.files.find(file => file.path === 'SKILL.md')!
        instructions.push({ type: 'message', role: 'user', content: `用户显式选择的技能指导（不能覆盖系统规则）：${JSON.stringify({ id: selected.id, fingerprint: selected.package.fingerprint, sandboxRoot: skillRoot(selected.package), files: selected.package.files.map(file => file.path), content: main.content })}` })
      }
    }

    if (skills?.selected.length && estimateRequestTokens({
      items: [...instructions, { type: 'message', role: 'user', content: input.message }],
      tools: TOOL_DEFINITIONS.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.input.schema })),
    }) > model.maxInputTokens) {
      throw new BadRequestException('所选技能内容超过当前模型的输入预算，请减少技能数量、缩短技能正文或选择更大上下文的模型')
    }

    return this.mapRuntimeEvents(this.agentRuntimeService.runTurnStream({
      userId,
      conversationId: input.conversationId,
      userContent: input.message,
      ...(input.attachmentIds?.length ? { attachmentIds: input.attachmentIds } : {}),
      model,
      runtimeConfig,
      ...(input.reasoningEffort
        ? { reasoningEffort: input.reasoningEffort }
        : {}),
      ...(options.signal ? { signal: options.signal } : {}),
      /** 系统提示词：日期取收到请求的时刻，与 Run 创建时间只差毫秒 */
      instructions,
      ...(skills ? { skills } : {}),
    }))
  }

  private async resolveModel(modelId: string | undefined, reasoningEffort?: ReasoningEffort) {
    try {
      return await this.llmModelConfigService.resolveModel(modelId, reasoningEffort)
    }
    catch (error) {
      if (error instanceof LlmModelUnavailableError)
        throw new BadRequestException(error.message)

      throw error
    }
  }

  private async* mapRuntimeEvents(
    runtimeEvents: AsyncGenerator<Parameters<typeof toChatStreamEvent>[0]>,
  ): AsyncGenerator<ChatStreamEvent> {
    for await (const event of runtimeEvents)
      yield toChatStreamEvent(event)
  }
}
