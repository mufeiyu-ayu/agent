import { Buffer } from 'node:buffer'
import { createHash } from 'node:crypto'
import { posix } from 'node:path'
import { parseDocument } from 'yaml'

export interface SkillFile { path: string, content: string, encoding: 'utf8' | 'base64' }
export interface SkillMetadata { name: string, description: string }
export interface SkillPackage extends SkillMetadata { files: SkillFile[], fingerprint: string }
export const MAX_SKILL_BYTES = 2 * 1024 * 1024
export const MAX_SKILL_FILE_BYTES = 512 * 1024
export const MAX_SKILL_FILES = 64

export function skillPath(value: unknown): string {
  if (typeof value !== 'string' || value.length > 240 || !/^[\w.-]+(?:\/[\w.-]+)*$/u.test(value)
    || value.split('/').some(part => part === '.' || part === '..' || part.startsWith('.'))) {
    throw new Error('技能路径必须是包内相对路径，不能包含隐藏目录、反斜杠或路径穿越')
  }
  return value
}

export function parseSkill(source: string): SkillMetadata {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/u.exec(source)
  if (!match || !match[2]?.trim())
    throw new Error('SKILL.md 必须包含 YAML 元数据和非空正文')
  const doc = parseDocument(match[1]!, { uniqueKeys: true })
  if (doc.errors.length)
    throw new Error('技能 YAML 元数据无效')
  const value: unknown = doc.toJS({ maxAliasCount: 0 })
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('技能元数据必须是对象')
  const meta = value as Record<string, unknown>
  if (typeof meta.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(meta.name) || meta.name.length > 64)
    throw new Error('技能名称须为 1–64 位小写字母、数字和单个连字符')
  if (typeof meta.description !== 'string' || !meta.description.trim() || meta.description.length > 1024)
    throw new Error('技能描述须为 1–1024 字符')
  if (meta.compatibility !== undefined && (typeof meta.compatibility !== 'string' || !meta.compatibility.trim() || meta.compatibility.length > 500))
    throw new Error('compatibility 须为 1–500 字符')
  for (const key of ['license', 'allowed-tools']) {
    if (meta[key] !== undefined && typeof meta[key] !== 'string')
      throw new Error(`${key} 必须是文本`)
  }
  if (meta.metadata !== undefined && (!meta.metadata || typeof meta.metadata !== 'object' || Array.isArray(meta.metadata) || Object.values(meta.metadata).some(item => typeof item !== 'string')))
    throw new Error('metadata 必须是字符串映射')
  return { name: meta.name, description: meta.description.trim() }
}

export function fileBytes(file: SkillFile): Buffer {
  return Buffer.from(file.content, file.encoding === 'base64' ? 'base64' : 'utf8')
}

export function validateSkillPackage(value: unknown): SkillPackage {
  if (!Array.isArray(value) || !value.length || value.length > MAX_SKILL_FILES)
    throw new Error(`技能包须包含 1–${MAX_SKILL_FILES} 个文件`)
  let total = 0
  const seen = new Set<string>()
  const files: SkillFile[] = value.map((raw: unknown) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('技能文件无效')
    const f = raw as Record<string, unknown>
    if (Object.keys(f).some(key => !['path', 'content', 'encoding'].includes(key)))
      throw new Error('技能文件只能包含 path、content、encoding')
    const path = skillPath(f.path)
    if (!/\.(?:md|txt|json|yaml|yml|csv|tsv|py|sh|js|mjs|cjs|ts|tsx|jsx|html|css|svg|png|jpe?g|webp|gif|ico|pdf|xlsx|docx|pptx|woff2?|ttf|otf)$/iu.test(path))
      throw new Error('不支持的技能文件类型')
    if (seen.has(path.toLowerCase()))
      throw new Error('技能文件路径重复')
    seen.add(path.toLowerCase())
    if (typeof f.content !== 'string' || (typeof f.encoding !== 'string' || !['utf8', 'base64'].includes(f.encoding)))
      throw new Error('技能文件编码无效')
    const file = { path, content: f.content, encoding: f.encoding as SkillFile['encoding'] }
    if (file.encoding === 'utf8' && (file.content.includes('\0') || /[\uD800-\uDFFF]/u.test(file.content.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/gu, ''))))
      throw new Error('技能文件含无效 Unicode')
    if (file.encoding === 'base64' && (file.content.length > MAX_SKILL_FILE_BYTES * 2 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(file.content)))
      throw new Error('无效 base64')
    const bytes = fileBytes(file)
    if (bytes.length > MAX_SKILL_FILE_BYTES)
      throw new Error('单个技能文件不能超过 512 KiB')
    total += bytes.length
    if (total > MAX_SKILL_BYTES)
      throw new Error('技能包不能超过 2 MiB')
    return file
  }).sort((a, b) => a.path.localeCompare(b.path))
  for (const file of files) {
    if (files.some(other => other.path.startsWith(`${file.path}/`)))
      throw new Error('技能文件不能同时作为目录')
  }
  const main = files.find(file => file.path === 'SKILL.md')
  if (!main || main.encoding !== 'utf8')
    throw new Error('必须提供 UTF-8 SKILL.md')
  const metadata = parseSkill(main.content)
  const paths = new Set(files.map(file => file.path))
  for (const file of files.filter(file => file.encoding === 'utf8' && file.path.endsWith('.md'))) {
    for (const reference of file.content.matchAll(/`((?:references|scripts|assets)\/[\w./-]+\.[a-z0-9]+)`/giu)) {
      const path = skillPath(reference[1])
      if (!paths.has(path))
        throw new Error(`技能引用不存在：${path}`)
    }
    for (const match of file.content.matchAll(/\[[^\]]*\]\(([^\s)]+)(?:\s[^)]*)?\)/gu)) {
      const target = match[1]!
      if (/^(?:https?:|mailto:|#)/u.test(target))
        continue
      let path: string
      try {
        path = decodeURIComponent(target.split('#')[0]!)
      }
      catch { throw new Error('技能引用编码无效') }
      // 明确拒绝向上路径；文档从包根组织引用即可。
      skillPath(path)
      const resolved = posix.join(posix.dirname(file.path), path)
      if (!paths.has(resolved))
        throw new Error(`技能引用不存在：${resolved}`)
    }
  }
  return { ...metadata, files, fingerprint: createHash('sha256').update(JSON.stringify(files)).digest('hex') }
}

export function formatSkillCatalog(skills: Array<SkillMetadata & { id: string }>): string {
  return JSON.stringify(skills.map(({ id, name, description }) => ({ id, name, description, path: 'SKILL.md' })))
}
