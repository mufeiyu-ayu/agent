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

/** 系统技能管理沿用技能包协议，仅管理员可以写入。 */
export interface AdminSkillSummary extends SkillSummary { updatedAt: string }
export interface AdminSkillDetail extends SkillPreview { updatedAt: string }
export interface CreateAdminSkillRequest { files: SkillResource[] }
export interface UpdateAdminSkillRequest extends CreateAdminSkillRequest { expectedFingerprint: string }
