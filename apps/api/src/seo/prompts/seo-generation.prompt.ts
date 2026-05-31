import type { ChatMessage } from '../../llm/llm.types.js'
import type { GenerateSeoDto } from '../dto/generate-seo.dto.js'

export function buildSeoGenerationMessages(input: GenerateSeoDto): ChatMessage[] {
  const pageTopic = input.pageTopic.trim()
  const language = input.language.trim()
  const keywords = input.keywords.map(keyword => keyword.trim()).filter(Boolean)

  return [
    {
      role: 'system',
      content: [
        '角色：你是一个 SEO 文案助手。',
        '任务：根据用户输入生成 SEO title 和 meta description。',
        '输出格式：只返回 JSON，不要返回 Markdown，不要返回解释。',
        'JSON 字段：',
        '- title: string',
        '- description: string',
        '约束：',
        '- title 必须自然包含主要关键词。',
        '- description 必须说明页面价值，并尽量覆盖关键词。',
        '- 不要输出 JSON 以外的任何内容。',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        `页面主题：${pageTopic}`,
        `语言：${language}`,
        `关键词：${keywords.join(', ')}`,
        '',
        '请返回如下 JSON：',
        '{',
        '  "title": "...",',
        '  "description": "..."',
        '}',
      ].join('\n'),
    },
  ]
}
