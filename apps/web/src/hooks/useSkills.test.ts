import type { SkillSummary } from '@agent/contracts'
import assert from 'node:assert/strict'
import { beforeEach, it, vi } from 'vitest'
import { effectScope } from 'vue'
import { getSkills } from '@/api/skills'
import { provideSkills } from './useSkills'

vi.mock('vue', async importOriginal => ({ ...await importOriginal<typeof import('vue')>(), provide: vi.fn() }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (key: string) => key, locale: { value: 'zh-CN' } }) }))
vi.mock('@/api/skills', () => ({ getSkills: vi.fn() }))
const creator: SkillSummary = { id: 'builtin:skill-creator', name: 'skill-creator', description: '创建', builtin: true, enabled: true, published: true, hasDraft: false, conversationId: null, createdAt: '2026-10-10T00:00:00Z', updatedAt: '2026-10-12T00:00:00Z', usageCount: 0, examples: [] }
beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(getSkills).mockResolvedValue([creator])
})

for (const action of ['dispose', 'reload'] as const) {
  it(`创建前可用性读取被 ${action} 取消后，不按缓存技能继续导航`, async () => {
    const scope = effectScope()
    const startChat = vi.fn(async () => {})
    const skills = scope.run(() => provideSkills(startChat, () => {}))!
    await skills.reload()
    let release!: (items: SkillSummary[]) => void
    let signal: AbortSignal | undefined
    vi.mocked(getSkills).mockImplementationOnce((input) => {
      signal = input
      return new Promise((resolve) => {
        release = resolve
      })
    })
    const pending = skills.start()
    if (action === 'dispose')
      scope.stop()
    else
      await skills.reload()
    assert.equal(signal?.aborted, true)
    release([creator])
    await pending
    assert.equal(startChat.mock.calls.length, 0)
    scope.stop()
  })
}

it('最新目录有效才进入聊天，停用后明确反馈且不使用旧缓存', async () => {
  const scope = effectScope()
  const startChat = vi.fn(async () => {})
  const skills = scope.run(() => provideSkills(startChat, () => {}))!
  await skills.start()
  assert.equal(startChat.mock.calls.length, 1)
  vi.mocked(getSkills).mockResolvedValueOnce([])
  await skills.start()
  assert.equal(startChat.mock.calls.length, 1)
  assert.equal(skills.error.value, 'skills.unavailable')
  scope.stop()
})
