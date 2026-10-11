export interface SkillResource { path: string, content: string, encoding: 'utf8' | 'base64' }
export interface SkillSummary {
  id: string
  name: string
  description: string
  builtin: boolean
  enabled: boolean
  published: boolean
  hasDraft: boolean
  conversationId: string | null
}
export interface SkillPreview extends SkillSummary {
  fingerprint: string
  files: SkillResource[]
  draft: boolean
}
