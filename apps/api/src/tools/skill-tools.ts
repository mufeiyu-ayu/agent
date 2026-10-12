import type { SkillPackage } from '@agent/skills'
import type { ToolDefinition, ToolExecutionContext, ToolExecutor, ToolResult, ValidatedToolInvocation } from './core/tool.types.js'
import { MAX_SKILL_FILE_BYTES, skillPath } from '@agent/skills'
import { BadRequestException, HttpException, Inject, Injectable } from '@nestjs/common'
import { SkillsService } from '../skills/skills.service.js'

interface ReadSkillInput { id: string, path: string, offset: number }
interface SaveDraftInput { id?: string, expectedFingerprint?: string, files: unknown[], preservePaths?: string[] }

function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key)))
    throw new Error('技能参数无效')
  return value as Record<string, unknown>
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !value.length || value.length > 128)
    throw new Error('技能身份无效')
  return value
}
function offset(value: unknown): number {
  if (value === undefined)
    return 0
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > Math.ceil(MAX_SKILL_FILE_BYTES / 3) * 4)
    throw new Error('分页位置无效')
  return Number(value)
}
const readInput: ToolDefinition<ReadSkillInput>['input'] = {
  schema: { type: 'object', properties: { id: { type: 'string' }, path: { type: 'string' }, offset: { type: 'integer', minimum: 0 } }, required: ['id'], additionalProperties: false },
  parse(value) {
    const input = object(value, ['id', 'path', 'offset'])
    return { id: id(input.id), path: skillPath(input.path ?? 'SKILL.md'), offset: offset(input.offset) }
  },
}
export const readSkillDefinition: ToolDefinition<ReadSkillInput> = {
  name: 'read_skill',
  version: '1',
  timeoutMs: 35_000,
  maxObservationChars: 100_000,
  description: '读取本轮可用技能的 SKILL.md 或指定包内文件，不创建沙箱。按 nextOffset 续读直到 null 才表示完整。返回只读资源目录 sandboxRoot；bash 执行前由宿主准备已读取的包。',
  input: readInput,
}
export const readSkillDraftDefinition: ToolDefinition<ReadSkillInput> = {
  name: 'read_skill_draft',
  version: '1',
  timeoutMs: 35_000,
  maxObservationChars: 100_000,
  description: '创建或修改技能时读取本人的草稿（没有草稿则读当前发布内容），逐文件分页，返回保存修改所需 fingerprint；保存时可用 preservePaths 原样保留列出的文件，不必重复传二进制内容。不会把草稿加入普通可用目录。',
  input: readInput,
}
export const saveSkillDraftDefinition: ToolDefinition<SaveDraftInput> = {
  name: 'save_skill_draft',
  version: '1',
  timeoutMs: 90_000,
  maxObservationChars: 8_000,
  description: '保存技能包为待用户预览的草稿（files 加 preservePaths 合成完整包），绝不发布。创建时省略 id；修改时须先读取并携带最新 expectedFingerprint。files 每项含 path、content、encoding（utf8/base64），须有 SKILL.md。',
  input: {
    schema: { type: 'object', properties: { id: { type: 'string' }, expectedFingerprint: { type: 'string' }, preservePaths: { type: 'array', items: { type: 'string' }, maxItems: 64, description: '修改时，从 expectedFingerprint 对应包原样保留这些文件；尤其用于无需改动的二进制资源。' }, files: { type: 'array', minItems: 1, maxItems: 64, items: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' }, encoding: { type: 'string', description: 'utf8 或 base64' } }, required: ['path', 'content', 'encoding'], additionalProperties: false } } }, required: ['files'], additionalProperties: false },
    parse(value) {
      const input = object(value, ['id', 'expectedFingerprint', 'files', 'preservePaths'])
      if (!Array.isArray(input.files) || input.files.length > 64)
        throw new Error('技能包无效')
      if (input.preservePaths !== undefined && (!Array.isArray(input.preservePaths) || input.preservePaths.length > 64))
        throw new Error('待保留文件列表无效')
      return { files: input.files, ...(Array.isArray(input.preservePaths) ? { preservePaths: input.preservePaths.map(skillPath) } : {}), ...(input.id === undefined ? {} : { id: id(input.id), expectedFingerprint: id(input.expectedFingerprint) }) }
    },
  },
}

export function skillPage(pkg: SkillPackage, path: string, offset: number, includeBinary = false): Record<string, unknown> {
  const file = pkg.files.find(file => file.path === path)
  if (!file)
    throw new BadRequestException('技能包中没有该文件')
  if (file.encoding !== 'utf8' && !includeBinary)
    return { path, encoding: file.encoding, binary: true, message: '二进制资源请在预览中下载或通过 bash 使用 sandboxRoot 下的文件。', nextOffset: null }
  const points = Array.from(file.content)
  if (offset > points.length)
    throw new BadRequestException('分页位置超过文件长度')
  const end = Math.min(points.length, offset + 12_000)
  return { path, encoding: file.encoding, content: points.slice(offset, end).join(''), offset, nextOffset: end < points.length ? end : null, totalChars: points.length }
}
export function skillRoot(pkg: SkillPackage): string {
  return `/opt/kuro-skills/${pkg.fingerprint}/${pkg.name}`
}

function failure(error: unknown): ToolResult {
  if (error instanceof HttpException && error.getStatus() < 500)
    return { ok: false, code: 'execution_failed', modelContent: error.message }
  // DB deadline/提交未知与工具超时由通用调用层仲裁，不能伪装成普通操作失败。
  throw error
}

@Injectable()
export class ReadSkillTool implements ToolExecutor<ReadSkillInput> {
  constructor(@Inject(SkillsService) private readonly skills: SkillsService) {}
  async execute({ input }: ValidatedToolInvocation<ReadSkillInput>, context: ToolExecutionContext): Promise<ToolResult> {
    const run = context.skills
    const entry = run?.snapshot.entries.find(entry => entry.id === input.id)
    if (!run || !entry)
      return { ok: false, code: 'execution_failed', modelContent: '技能不在本轮授权目录中。' }
    try {
      const pkg = run.loaded.get(input.id) ?? await this.skills.readPackage(run.snapshot.userId, entry.contentId)
      context.signal.throwIfAborted()
      const page = skillPage(pkg, input.path, input.offset)
      run.loaded.set(input.id, pkg)
      return { ok: true, display: { skill: { id: input.id, name: pkg.name } }, modelContent: JSON.stringify({ id: input.id, fingerprint: pkg.fingerprint, sandboxRoot: skillRoot(pkg), files: pkg.files.map(file => file.path), ...page }) }
    }
    catch (error) {
      context.signal.throwIfAborted()
      return failure(error)
    }
  }
}

@Injectable()
export class ReadSkillDraftTool implements ToolExecutor<ReadSkillInput> {
  constructor(@Inject(SkillsService) private readonly skills: SkillsService) {}
  async execute({ input }: ValidatedToolInvocation<ReadSkillInput>, context: ToolExecutionContext): Promise<ToolResult> {
    if (!context.workspace)
      return { ok: false, code: 'execution_failed', modelContent: '缺少当前用户身份。' }
    try {
      const preview = await this.skills.previewPrivateDraft(context.workspace.userId, input.id)
      context.signal.throwIfAborted()
      return { ok: true, modelContent: JSON.stringify({ id: preview.id, fingerprint: preview.fingerprint, files: preview.files.map(file => ({ path: file.path, encoding: file.encoding })), ...skillPage({ ...preview }, input.path, input.offset, true) }) }
    }
    catch (error) {
      context.signal.throwIfAborted()
      return failure(error)
    }
  }
}

@Injectable()
export class SaveSkillDraftTool implements ToolExecutor<SaveDraftInput> {
  constructor(@Inject(SkillsService) private readonly skills: SkillsService) {}
  async execute({ input }: ValidatedToolInvocation<SaveDraftInput>, context: ToolExecutionContext): Promise<ToolResult> {
    if (!context.workspace)
      return { ok: false, code: 'execution_failed', modelContent: '缺少当前用户身份。' }
    try {
      const preview = await this.skills.saveDraft(context.workspace.userId, context.workspace.conversationId, input, context.databaseDeadline, context.onCommitOwned)
      context.signal.throwIfAborted()
      return { ok: true, display: { skill: { id: preview.id, name: preview.name } }, modelContent: JSON.stringify({ id: preview.id, fingerprint: preview.fingerprint, name: preview.name, draft: true, published: false, preview: '本条回复末尾的技能文件卡片', files: preview.files.map(file => file.path) }) }
    }
    catch (error) {
      context.signal.throwIfAborted()
      return failure(error)
    }
  }
}
