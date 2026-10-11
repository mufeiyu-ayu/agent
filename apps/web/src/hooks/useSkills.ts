import type { SkillPreview, SkillSummary } from '@agent/contracts'
import type { InjectionKey } from 'vue'
import { isAxiosError } from 'axios'
import { inject, onScopeDispose, provide, ref } from 'vue'
import { deleteSkill, enableSkill, getSkill, getSkills, publishSkill } from '@/api/skills'

const skillsKey: InjectionKey<ReturnType<typeof provideSkills>> = Symbol('skills')

export function provideSkills(startChat: (skillId: string, prompt?: string) => void) {
  const items = ref<SkillSummary[]>([])
  const selectedIds = ref<string[]>([])
  const chatRequested = ref(0)
  const open = ref(false)
  const mode = ref<'select' | 'drafts'>('select')
  const preview = ref<SkillPreview | null>(null)
  const loading = ref(false)
  const busy = ref(false)
  const error = ref('')
  let epoch = 0
  let controller: AbortController | undefined
  onScopeDispose(() => {
    epoch++
    controller?.abort()
  })
  function message(cause: unknown) {
    const detail = isAxiosError(cause) ? cause.response?.data?.message : undefined
    return typeof detail === 'string' ? detail : cause instanceof Error ? cause.message : '技能操作失败，请重试'
  }
  async function reload() {
    const request = ++epoch
    controller?.abort()
    controller = new AbortController()
    loading.value = true
    try {
      const data = await getSkills(controller.signal)
      if (request !== epoch)
        return
      items.value = data
      selectedIds.value = selectedIds.value.filter(id => data.some(item => item.id === id && item.enabled && item.published))
      error.value = ''
    }
    catch (cause) {
      if (request === epoch)
        error.value = message(cause)
    }
    finally {
      if (request === epoch)
        loading.value = false
    }
  }
  async function showPreview(item: SkillSummary, draft = false) {
    if (busy.value)
      return
    busy.value = true
    error.value = ''
    try {
      preview.value = await getSkill(item.id, draft)
    }
    catch (cause) { error.value = message(cause) }
    finally { busy.value = false }
  }
  async function publish() {
    if (!preview.value || busy.value)
      return
    busy.value = true
    error.value = ''
    const current = preview.value
    try {
      preview.value = await publishSkill(current.id, current.fingerprint)
      await reload()
    }
    catch (cause) { error.value = message(cause) }
    finally { busy.value = false }
  }
  async function manage(item: SkillSummary, action: 'toggle' | 'delete') {
    if (busy.value)
      return
    busy.value = true
    error.value = ''
    try {
      if (action === 'toggle')
        await enableSkill(item.id, !item.enabled)
      else await deleteSkill(item.id)
      await reload()
    }
    catch (cause) { error.value = message(cause) }
    finally { busy.value = false }
  }
  function start(item?: SkillSummary) {
    chatRequested.value++
    open.value = false
    preview.value = null
    startChat('builtin:skill-creator', item ? `请修改我的技能 ${item.name}，技能 ID 为 ${item.id}。先读取现有内容，再和我确认需要怎样修改。` : '请帮我创建一个可复用技能。')
  }
  function select(item: SkillSummary) {
    selectedIds.value = [item.id]
    open.value = false
  }
  function show(nextMode: typeof mode.value) {
    mode.value = nextMode
    open.value = true
    void reload()
  }
  const state = { items, selectedIds, chatRequested, open, mode, preview, loading, busy, error, reload, showPreview, publish, manage, start, select, show }
  provide(skillsKey, state)
  return state
}

export function useSkills() {
  const skills = inject(skillsKey)
  if (!skills)
    throw new Error('技能组件需要工作台上下文')
  return skills
}
