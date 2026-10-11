import type { SkillPreview, SkillResource, SkillSummary } from '@agent/contracts'
import { http } from './http'

export async function getSkills(signal?: AbortSignal): Promise<SkillSummary[]> {
  return (await http.get<SkillSummary[]>('/api/skills', { signal })).data
}
export async function getSkill(id: string, draft = false, signal?: AbortSignal): Promise<SkillPreview> {
  return (await http.get<SkillPreview>(`/api/skills/${encodeURIComponent(id)}`, { params: { draft }, signal })).data
}
export async function publishSkill(id: string, fingerprint: string): Promise<SkillPreview> {
  return (await http.post<SkillPreview>(`/api/skills/${encodeURIComponent(id)}/publish`, { fingerprint })).data
}
export async function saveSkillDraft(id: string, files: SkillResource[], expectedFingerprint: string): Promise<SkillPreview> {
  return (await http.put<SkillPreview>(`/api/skills/${encodeURIComponent(id)}/draft`, { files, expectedFingerprint })).data
}
export async function createSkill(files: SkillResource[]): Promise<SkillPreview> {
  return (await http.post<SkillPreview>('/api/skills', { files })).data
}
export async function enableSkill(id: string, enabled: boolean): Promise<void> {
  await http.patch(`/api/skills/${encodeURIComponent(id)}`, { enabled })
}
export async function deleteSkill(id: string): Promise<void> {
  await http.delete(`/api/skills/${encodeURIComponent(id)}`)
}
