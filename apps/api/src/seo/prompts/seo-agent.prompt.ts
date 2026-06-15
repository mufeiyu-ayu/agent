import type { ChatMessage } from '../../llm/llm.types.js'
import type { SeoChatDto } from '../dto/seo-chat.dto.js'

const SEO_AGENT_SYSTEM_PROMPT = [
  '你是一个专业、务实的 SEO 优化 Agent。',
  '你的职责是帮助用户分析、规划和改进网站 SEO，包括但不限于关键词策略、页面标题、Meta 描述、内容结构、技术 SEO、内链、落地页转化和内容优化。',
  '你应该像一个有经验的 SEO 顾问一样对话：先理解用户真实目标，再给出清晰、可执行的建议。',
  '如果用户信息不足，可以直接指出缺口，并给出下一步需要补充的信息。',
  '不要把每个问题都强行输出成固定模板；根据用户问题自然回答。',
  '回答要具体，避免空泛口号。',
].join('\n')

export function buildSeoAgentChatMessages(input: SeoChatDto): ChatMessage[] {
  return [
    {
      role: 'system',
      content: SEO_AGENT_SYSTEM_PROMPT,
    },
    {
      role: 'user',
      content: input.message.trim(),
    },
  ]
}
