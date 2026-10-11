import type { SkillsService } from '../skills/skills.service.js'
import type { WorkspaceService } from '../workspaces/workspace.service.js'
import type { ToolExecutionContext } from './core/tool.types.js'
import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { ModelContext, normalizeToolObservation } from '@agent/agent'
import { validateSkillPackage } from '@agent/skills'
import { it } from 'vitest'
import { DatabaseCommitOutcomeUnknownError } from '../prisma/prisma.service.js'
import { SKILL_RULES } from '../skills/skill-prompt.js'
import { WorkspaceOperationError } from '../workspaces/workspace-files.js'
import { ToolInvocationService } from './core/tool-invocation.service.js'
import { ToolRegistryService } from './core/tool-registry.service.js'
import { readSkillDefinition, readSkillDraftDefinition, ReadSkillTool, saveSkillDraftDefinition, SaveSkillDraftTool, skillPage } from './skill-tools.js'
import { BashTool } from './workspace/workspace-tools.js'

const pkg = validateSkillPackage([{ path: 'SKILL.md', encoding: 'utf8', content: `---\nname: long-skill\ndescription: 长技能\n---\n${'😀\\"\n'.repeat(10000)}` }])
it('完整分页保留 Unicode，JSON 转义后也不被 observation 静默截断', () => {
  let offset = 0
  let combined = ''
  while (true) {
    const page = skillPage(pkg, 'SKILL.md', offset)
    const normalized = normalizeToolObservation(JSON.stringify(page), readSkillDefinition.maxObservationChars)
    assert.equal(normalized.truncated, false)
    combined += page.content
    if (page.nextOffset === null)
      break
    offset = Number(page.nextOffset)
  }
  assert.equal(combined, pkg.files[0]!.content)
})
it('只允许本轮快照中的技能，取消后不登记为读取完成，不启动工作区', async () => {
  let calls = 0
  const service = { async readPackage() {
    calls++
    return pkg
  } } as unknown as SkillsService
  const controller = new AbortController()
  const context = { signal: controller.signal, skills: { snapshot: { userId: 'user', entries: [{ id: 'own', contentId: 'fixed' }], selected: [], catalogInstruction: '' }, loaded: new Map() } } as unknown as ToolExecutionContext
  const tool = new ReadSkillTool(service)
  assert.equal((await tool.execute({ toolName: 'read_skill', input: { id: 'other', path: 'SKILL.md', offset: 0 } }, context)).ok, false)
  assert.equal(calls, 0)
  const result = await tool.execute({ toolName: 'read_skill', input: { id: 'own', path: 'SKILL.md', offset: 0 } }, context)
  assert.equal(result.ok, true)
  assert.equal(context.skills!.loaded.size, 1)
  assert.match(result.modelContent, /sandboxRoot/)
  assert.deepEqual(result.display?.skill, { id: 'own', name: pkg.name })
  context.skills!.loaded.clear()
  controller.abort()
  await assert.rejects(tool.execute({ toolName: 'read_skill', input: { id: 'own', path: 'SKILL.md', offset: 0 } }, context))
  assert.equal(context.skills!.loaded.size, 0)
})

it('本轮及历史压缩后保留重新读取规则；正文可以从同一快照再次进入工具上下文', async () => {
  const context = ModelContext.create({
    instructions: [{ type: 'message', role: 'system', content: SKILL_RULES }],
    history: { readAt: new Date(), compaction: undefined, groups: [] },
    currentUser: { content: '继续技能任务', createdAt: new Date() },
  })
  const append = (attempt: number, content: string) => context.appendToolExchange({ samplingAttemptId: `sampling-${attempt}`, calls: [{ callId: `call-${attempt}`, toolName: 'read_skill' }], intermediateText: '', reasoningContent: '', results: [{ content, ok: true, feedbackArgumentsJson: '{"id":"own"}' }] })
  append(1, '先前读取的正文')
  context.applyTurnCompaction({ stepId: 'compaction', summary: '已读取技能', keptFrom: 1 })
  context.applyHistoryCompaction({ id: 'history', summary: '历史工作', coveredGroupIds: [], answerOnlyGroupId: null })
  const after = context.plan([]).items
  assert.ok(after.some(item => item.type === 'message' && item.role === 'system' && item.content.includes('重新调用 read_skill')))
  assert.ok(!after.some(item => item.type === 'tool_result'))
  const service = { async readPackage() {
    return pkg
  } } as unknown as SkillsService
  const run = { signal: new AbortController().signal, skills: { snapshot: { userId: 'u', entries: [{ id: 'own', contentId: 'fixed' }] }, loaded: new Map([['own', pkg]]) } } as unknown as ToolExecutionContext
  const result = await new ReadSkillTool(service).execute({ toolName: 'read_skill', input: { id: 'own', path: 'SKILL.md', offset: 0 } }, run)
  assert.equal(result.ok, true)
  append(2, result.modelContent)
  assert.ok(context.plan([]).items.some(item => item.type === 'tool_result' && item.content === result.modelContent))
})

it('技能读取超时后迟到存储结果不回填 loaded；工具入口拒绝穿越参数', async () => {
  let resolve!: (value: typeof pkg) => void
  const pending = new Promise<typeof pkg>((done) => {
    resolve = done
  })
  const service = { readPackage: () => pending } as unknown as SkillsService
  const registry = new ToolRegistryService()
  registry.register({ definition: { ...readSkillDefinition, timeoutMs: 5 }, executor: new ReadSkillTool(service) })
  const invocation = new ToolInvocationService(registry)
  const context = {
    signal: new AbortController().signal,
    databaseDeadline: { deadlineAt: Date.now() + 10000, createTimeoutError: () => new Error('deadline') },
    argumentsTruncated: false,
    serperApiKey: { status: 'missing' as const },
    skills: { snapshot: { userId: 'u', entries: [{ id: 'own', contentId: 'fixed', name: 'test', description: 'test', fingerprint: pkg.fingerprint }], selected: [], catalogInstruction: '' }, loaded: new Map<string, typeof pkg>() },
  }
  const envelope = { callId: 'call', toolName: 'read_skill', rawArgumentsJson: '{"id":"own"}' }
  const timedOut = await invocation.invoke(envelope, context)
  assert.equal(timedOut.result.ok, false)
  assert.equal(!timedOut.result.ok && timedOut.result.code, 'timeout')
  resolve(pkg)
  await new Promise(done => setTimeout(done, 0))
  assert.equal(context.skills.loaded.size, 0)
  const invalid = await invocation.invoke({ ...envelope, rawArgumentsJson: '{"id":"own","path":"../secret"}' }, context)
  assert.equal(!invalid.result.ok && invalid.result.code, 'invalid_arguments')
})

it('技能资源恢复失败时不执行 bash，返回真实失败且保留工作区错误', async () => {
  let executed = false
  let reported = ''
  const workspaces = {
    async prepareSkills() { throw new WorkspaceOperationError('技能资源恢复失败') },
    async reportError(_execution: unknown, message: string) { reported = message },
    async releaseRun() {},
    async bash() { executed = true },
  } as unknown as WorkspaceService
  const result = await new BashTool(workspaces).execute({ toolName: 'bash', input: { command: 'python3 check.py', title: '运行脚本', timeout: 30 } }, {
    signal: new AbortController().signal,
    databaseDeadline: { deadlineAt: Date.now() + 10000, createTimeoutError: () => new Error('deadline') },
    serperApiKey: { status: 'missing' },
    workspace: { userId: 'u', conversationId: 'c', runId: 'r', deadlineAt: Date.now() + 10000 },
    skills: { snapshot: { userId: 'u', entries: [], selected: [], catalogInstruction: '' }, loaded: new Map([['own', pkg]]) },
  })
  assert.equal(result.ok, false)
  assert.equal(executed, false)
  assert.equal(reported, '技能资源恢复失败')
})

it('技能存储事务的提交未知保留原异常，不能当作普通失败允许模型重试', async () => {
  const error = new DatabaseCommitOutcomeUnknownError()
  const registry = new ToolRegistryService()
  registry.register({ definition: saveSkillDraftDefinition, executor: new SaveSkillDraftTool({ async saveDraft() {
    throw error
  } } as unknown as SkillsService) })
  const invocation = new ToolInvocationService(registry)
  await assert.rejects(invocation.invoke({ callId: 'call', toolName: 'save_skill_draft', rawArgumentsJson: JSON.stringify({ files: pkg.files }) }, {
    workspace: { userId: 'u', conversationId: 'c', runId: 'r', deadlineAt: Date.now() + 10000 },
    signal: new AbortController().signal,
    argumentsTruncated: false,
    serperApiKey: { status: 'missing' },
    databaseDeadline: { deadlineAt: Date.now() + 10000, createTimeoutError: () => new Error('deadline') },
  }), cause => cause === error)
})

it('512 KiB 二进制资源的 base64 可以经真实参数校验分页读到 EOF', () => {
  const content = Buffer.alloc(512 * 1024, 7).toString('base64')
  const binary = validateSkillPackage([pkg.files[0]!, { path: 'assets/image.png', encoding: 'base64', content }])
  let position = 0
  let result = ''
  while (true) {
    const input = readSkillDraftDefinition.input.parse({ id: 'draft', path: 'assets/image.png', offset: position })
    const page = skillPage(binary, input.path, input.offset, true)
    result += page.content
    if (page.nextOffset === null)
      break
    position = Number(page.nextOffset)
  }
  assert.ok(position > 524288)
  assert.equal(result, content)
})

it('草稿 COMMIT 后的工具超时或用户停止等待结局，提交未知不会被覆盖', async () => {
  for (const stop of [false, true]) {
    const unknown = new DatabaseCommitOutcomeUnknownError()
    let entered!: () => void
    const commitEntered = new Promise<void>((resolve) => {
      entered = resolve
    })
    let rejectCommit!: (error: Error) => void
    const commit = new Promise<never>((_resolve, reject) => {
      rejectCommit = reject
    })
    const service = { async saveDraft(_user: string, _conversation: string, _input: unknown, _deadline: unknown, onCommitOwned: () => void) {
      onCommitOwned()
      entered()
      return commit
    } } as unknown as SkillsService
    const registry = new ToolRegistryService()
    registry.register({ definition: { ...saveSkillDraftDefinition, timeoutMs: 10 }, executor: new SaveSkillDraftTool(service) })
    const controller = new AbortController()
    const context = {
      signal: controller.signal,
      argumentsTruncated: false,
      serperApiKey: { status: 'missing' as const },
      workspace: { userId: 'u', conversationId: 'c', runId: 'r', deadlineAt: Date.now() + 10000 },
      databaseDeadline: { deadlineAt: Date.now() + 10000, createTimeoutError: () => new Error('deadline') },
    }
    let settled = false
    const outcome = new ToolInvocationService(registry).invoke({ callId: 'call', toolName: 'save_skill_draft', rawArgumentsJson: JSON.stringify({ files: pkg.files }) }, context).then(value => ({ value }), error => ({ error })).finally(() => {
      settled = true
    })
    await commitEntered
    if (stop)
      controller.abort()
    await new Promise(resolve => setTimeout(resolve, 25))
    assert.equal(settled, false)
    rejectCommit(unknown)
    const result = await outcome
    assert.ok('error' in result && result.error === unknown)
  }
})

it('模型保存工具不能携带直接发布标志', () => {
  assert.throws(() => saveSkillDraftDefinition.input.parse({ files: pkg.files, publish: true }), /技能参数无效/)
})
