import type { SkillPreview, SkillSummary } from '@agent/contracts'
import { http } from './http'

export async function getSkills(signal?: AbortSignal): Promise<SkillSummary[]> {
  return (await http.get<SkillSummary[]>('/api/skills', { signal })).data
}
export async function getSkill(id: string, draft = false): Promise<SkillPreview> {
  return (await http.get<SkillPreview>(`/api/skills/${encodeURIComponent(id)}`, { params: { draft } })).data
}
export async function publishSkill(id: string, fingerprint: string): Promise<SkillPreview> {
  return (await http.post<SkillPreview>(`/api/skills/${encodeURIComponent(id)}/publish`, { fingerprint })).data
}
export async function enableSkill(id: string, enabled: boolean): Promise<void> {
  await http.patch(`/api/skills/${encodeURIComponent(id)}`, { enabled })
}
export async function deleteSkill(id: string): Promise<void> {
  await http.delete(`/api/skills/${encodeURIComponent(id)}`)
}
