import type { SkillResource } from '@agent/contracts'

export { writeSkillMarkdown as buildSkillMarkdown, readSkillMarkdown as parseSkillMarkdown } from '@agent/skills/markdown'

export const BUILTIN_SKILL_CREATOR_ID = 'builtin:skill-creator'
export function isBuiltinSkill(id: string): boolean {
  return id === BUILTIN_SKILL_CREATOR_ID
}

export function createDefaultSkillMarkdown(): string {
  return '---\nname: ""\ndescription: ""\n---\n\n'
}

/**
 * 格式化字节大小为易读文本（B, KB, MB）。
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024)
    return `${bytes} B`
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

/**
 * 计算单个技能资源文件的大致字节数。
 */
export function estimateFileBytes(file: SkillResource): number {
  if (file.encoding === 'base64') {
    const padding = (file.content.endsWith('==') ? 2 : file.content.endsWith('=') ? 1 : 0)
    return Math.max(0, Math.floor((file.content.length * 3) / 4) - padding)
  }
  return new TextEncoder().encode(file.content).length
}

/**
 * 安全触发浏览器下载包内文件。
 */
export function downloadSkillResource(file: SkillResource, filename?: string): void {
  const name = filename || file.path.split('/').pop() || 'download'
  let blob: Blob

  if (file.encoding === 'base64') {
    const byteCharacters = atob(file.content)
    const byteArray = new Uint8Array(byteCharacters.length)
    for (let i = 0; i < byteCharacters.length; i++) {
      byteArray[i] = byteCharacters.charCodeAt(i)
    }
    blob = new Blob([byteArray], { type: 'application/octet-stream' })
  }
  else {
    blob = new Blob([file.content], { type: 'text/plain;charset=utf-8' })
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
