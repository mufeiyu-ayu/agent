import type { AdminSkillDetail, UpdateAdminSkillRequest } from '@agent/contracts'
import assert from 'node:assert/strict'
import { beforeEach, it, vi } from 'vitest'
import { AdminRunApiError } from '../shared/admin-api'
import * as api from './skills-api'
import { createSkillsState } from './skills.state'
import { buildSkillMarkdown, BUILTIN_SKILL_CREATOR_ID, parseSkillMarkdown } from './skills.utils'

vi.mock('./skills-api', () => ({ fetchAdminSkills: vi.fn(), fetchAdminSkillDetail: vi.fn(), createAdminSkill: vi.fn(), updateAdminSkill: vi.fn(), toggleAdminSkill: vi.fn(), deleteAdminSkill: vi.fn() }))
const skill: AdminSkillDetail = {
  id: 'system-test',
  name: 'system-test',
  description: '系统技能',
  builtin: true,
  enabled: true,
  published: true,
  hasDraft: false,
  draft: false,
  conversationId: null,
  fingerprint: 'original',
  updatedAt: '2026-10-12T00:00:00Z',
  createdAt: '2026-10-10T00:00:00Z',
  usageCount: 0,
  examples: [],
  files: [{ path: 'SKILL.md', encoding: 'utf8', content: '---\nname: system-test\ndescription: |\n  用途: 查标题\nlicense: MIT\nmetadata:\n  author: Ayu\n---\n\n原正文' }, { path: 'assets/a.woff', encoding: 'base64', content: 'AQID' }],
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(api.fetchAdminSkills).mockResolvedValue([skill])
  vi.mocked(api.fetchAdminSkillDetail).mockResolvedValue(skill)
})

it('公共技能可搜索、筛选和删除，只有固定 creator 身份禁止删除', async () => {
  const state = createSkillsState()
  await state.load()
  state.keyword.value = '系统'
  assert.equal(state.filteredSkills.value.length, 1)
  state.statusFilter.value = 'DISABLED'
  assert.equal(state.filteredSkills.value.length, 0)
  await assert.rejects(state.deleteSkill({ ...skill, id: BUILTIN_SKILL_CREATOR_ID }), /禁止删除/)
  assert.equal(await state.deleteSkill(skill), true)
  assert.equal(state.skills.value.length, 0)
  assert.equal(vi.mocked(api.deleteAdminSkill).mock.calls.length, 1)
})

it('详情读取切换或关闭后即使忽略 abort 的旧接口返回，也不污染当前状态', async () => {
  let release!: (value: AdminSkillDetail) => void
  vi.mocked(api.fetchAdminSkillDetail).mockImplementationOnce(() => new Promise((resolve) => {
    release = resolve
  }))
  const state = createSkillsState()
  const first = state.openDetail('old')
  await state.openDetail(skill.id)
  release({ ...skill, id: 'old' })
  await first
  assert.equal(state.detailData.value?.id, skill.id)
  vi.mocked(api.fetchAdminSkillDetail).mockImplementationOnce(() => new Promise((resolve) => {
    release = resolve
  }))
  const pending = state.openDetail(skill.id)
  state.closeDetail()
  release(skill)
  await pending
  assert.equal(state.detailData.value, null)
  assert.equal(state.detailOpen.value, false)
})

it('编辑读取期间离开页面，迟到结果不重新打开表单', async () => {
  let release!: (value: AdminSkillDetail) => void
  vi.mocked(api.fetchAdminSkillDetail).mockImplementationOnce(() => new Promise((resolve) => {
    release = resolve
  }))
  const state = createSkillsState()
  const pending = state.openEdit(skill)
  state.dispose()
  release(skill)
  await pending
  assert.equal(state.formModalOpen.value, false)
  assert.equal(state.editingSkill.value, null)
})

it('启停与列表刷新、编辑、新建互斥，连续点击不重复请求，失败后恢复', async () => {
  let reject!: (error: Error) => void
  vi.mocked(api.toggleAdminSkill).mockImplementationOnce(() => new Promise((_resolve, fail) => {
    reject = fail
  }))
  const state = createSkillsState()
  await state.load()
  const pending = state.toggleSkill(skill)
  assert.equal(state.busy.value, true)
  state.openCreate()
  await state.openEdit(skill)
  await state.load()
  assert.equal(await state.toggleSkill(skill), false)
  assert.equal(state.formModalOpen.value, false)
  assert.equal(vi.mocked(api.fetchAdminSkillDetail).mock.calls.length, 0)
  assert.equal(vi.mocked(api.fetchAdminSkills).mock.calls.length, 1)
  reject(new Error('明确失败'))
  await assert.rejects(pending, /明确失败/)
  assert.equal(state.busy.value, false)
  vi.mocked(api.toggleAdminSkill).mockResolvedValue({ id: skill.id, enabled: false })
  await state.toggleSkill(skill)
  assert.equal(state.skills.value[0]?.enabled, false)
})

it('真实请求参数携带指纹，编辑保留二进制文件与复杂 YAML 元数据', async () => {
  const state = createSkillsState()
  await state.load()
  await state.openEdit(skill)
  vi.mocked(api.updateAdminSkill).mockImplementationOnce(async (id: string, input: UpdateAdminSkillRequest) => ({ ...skill, id, files: input.files, fingerprint: 'saved' }))
  await state.saveSkill({ name: 'system-test', description: '用途: 检查 # 标题', body: '新正文' })
  const [id, input] = vi.mocked(api.updateAdminSkill).mock.calls[0]!
  assert.equal(id, skill.id)
  assert.equal(input.expectedFingerprint, 'original')
  assert.deepEqual(input.files[1], skill.files[1])
  assert.equal(parseSkillMarkdown(input.files[0]!.content).description, '用途: 检查 # 标题')
  assert.match(input.files[0]!.content, /license: MIT/)
  assert.match(input.files[0]!.content, /author: Ayu/)
  assert.equal(state.formModalOpen.value, false)
  const rewritten = buildSkillMarkdown(input.files[0]!.content, 'system-test', '多行\n描述', '正文')
  assert.equal(parseSkillMarkdown(rewritten).description, '多行\n描述')
})

it('慢保存保持互斥，关闭或再次提交都不能丢掉保存身份', async () => {
  let release!: (value: AdminSkillDetail) => void
  vi.mocked(api.updateAdminSkill).mockImplementationOnce(() => new Promise((resolve) => {
    release = resolve
  }))
  const state = createSkillsState()
  await state.openEdit(skill)
  const input = { name: skill.name, description: skill.description, body: '保存 A' }
  const pending = state.saveSkill(input)
  state.closeFormModal()
  assert.equal(state.formModalOpen.value, true)
  await assert.rejects(state.saveSkill(input))
  assert.equal(await state.toggleSkill(skill), false)
  release(skill)
  await pending
  assert.equal(vi.mocked(api.updateAdminSkill).mock.calls.length, 1)
  assert.equal(state.busy.value, false)
})

it('提交未知保留明确反馈并阻止盲目重建；409 保留表单供刷新核对', async () => {
  const state = createSkillsState()
  state.openCreate()
  const input = { name: skill.name, description: skill.description, body: '正文' }
  vi.mocked(api.createAdminSkill).mockRejectedValueOnce(new AdminRunApiError(500, '写入结果未知，请刷新核对', undefined, 'DatabaseCommitOutcomeUnknown'))
  await assert.rejects(state.saveSkill(input), /结果未知/)
  assert.equal(state.formModalOpen.value, true)
  assert.equal(state.formOutcomeUnknown.value, true)
  await assert.rejects(state.saveSkill(input))
  assert.equal(vi.mocked(api.createAdminSkill).mock.calls.length, 1)
  state.closeFormModal()
  await state.openEdit(skill)
  vi.mocked(api.updateAdminSkill).mockRejectedValueOnce(new AdminRunApiError(409, '技能已经修改，请重新读取'))
  await assert.rejects(state.saveSkill(input), /重新读取/)
  assert.equal(state.editingSkill.value?.fingerprint, 'original')
  assert.equal(state.formModalOpen.value, true)
  assert.equal(state.formOutcomeUnknown.value, false)
})
