import type { SkillPreview, SkillResource, SkillSummary } from '@agent/contracts'
import type { InjectionKey } from 'vue'
import { isAxiosError } from 'axios'
import { inject, onScopeDispose, provide, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { createSkill, deleteSkill, enableSkill, getSkill, getSkills, publishSkill, saveSkillDraft } from '@/api/skills'

const skillsKey: InjectionKey<ReturnType<typeof provideSkills>> = Symbol('skills')

export function provideSkills(startChat: (skillId: string, prompt?: string) => Promise<void>, notifySuccess: (text: string) => void) {
  const { t, locale } = useI18n()
  const items = ref<SkillSummary[]>([])
  const selectedIds = ref<string[]>([])
  const chatRequested = ref(0)
  const preview = ref<SkillPreview | null>(null)
  const previewSurface = ref<'dialog' | 'panel'>('dialog')
  const previewDialogOpen = ref(false)
  const previewLoading = ref(false)
  const previewItem = ref<Pick<SkillSummary, 'id'> & Partial<Pick<SkillSummary, 'name' | 'builtin'>> | null>(null)
  let previewRequest: AbortController | undefined
  const editorOpen = ref(false)
  const editorLoading = ref(false)
  const editingSkill = ref<SkillPreview | null>(null)
  const editorError = ref('')
  const editorOutcomeUnknown = ref(false)
  let editorRequest: AbortController | undefined
  const loading = ref(false)
  const busy = ref(false)
  const error = ref('')
  let epoch = 0
  let controller: AbortController | undefined
  onScopeDispose(() => {
    epoch++
    controller?.abort()
    previewRequest?.abort()
    editorRequest?.abort()
    previewDialogOpen.value = false
    previewLoading.value = false
    editorOpen.value = false
    editorLoading.value = false
  })
  function commitUnknown(cause: unknown) {
    return isAxiosError(cause) && cause.response?.data?.error?.error === 'DatabaseCommitOutcomeUnknown'
  }
  function message(cause: unknown) {
    if (commitUnknown(cause))
      return t('skills.resultUnknown')
    if (locale.value !== 'zh-CN' && isAxiosError(cause)) {
      const status = cause.response?.status
      return t(status === 409 ? 'skills.conflict' : status === 400 ? 'skills.invalidRequest' : status === 404 ? 'skills.notFound' : 'skills.operationFailed')
    }
    const detail = isAxiosError(cause) ? cause.response?.data?.message : undefined
    return typeof detail === 'string' ? detail : cause instanceof Error ? cause.message : t('skills.operationFailed')
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
  function dismissPreview() {
    if (previewRequest) {
      previewRequest.abort()
      previewRequest = undefined
      busy.value = false
    }
    previewDialogOpen.value = false
    previewLoading.value = false
    previewItem.value = null
    preview.value = null
  }
  async function showPreview(item: Pick<SkillSummary, 'id'> & Partial<Pick<SkillSummary, 'name' | 'builtin'>>, draft = false, surface: 'dialog' | 'panel' = 'dialog') {
    if (previewRequest) {
      previewRequest.abort()
      previewRequest = undefined
    }
    const request = new AbortController()
    previewRequest = request
    previewSurface.value = surface
    previewItem.value = item
    preview.value = null
    if (surface === 'dialog') {
      previewDialogOpen.value = true
      previewLoading.value = true
    }
    busy.value = true
    error.value = ''
    try {
      const result = await getSkill(item.id, draft, request.signal)
      if (!request.signal.aborted)
        preview.value = result
    }
    catch (cause) {
      if (!request.signal.aborted)
        error.value = message(cause)
    }
    finally {
      if (previewRequest === request) {
        previewRequest = undefined
        busy.value = false
        previewLoading.value = false
      }
    }
  }
  async function publish() {
    if (!preview.value || busy.value)
      return
    busy.value = true
    error.value = ''
    const current = preview.value
    try {
      const published = await publishSkill(current.id, current.fingerprint)
      if (preview.value === current)
        preview.value = published
      notifySuccess(t(current.published ? 'skills.feedback.updated' : 'skills.feedback.published'))
      await reload()
    }
    catch (cause) { error.value = message(cause) }
    finally { busy.value = false }
  }

  function closeEditor() {
    if (editorRequest) {
      editorRequest.abort()
      editorRequest = undefined
      busy.value = false
    }
    editorOpen.value = false
    editorLoading.value = false
    editingSkill.value = null
    editorError.value = ''
    editorOutcomeUnknown.value = false
  }

  async function manage(item: SkillSummary, action: 'toggle' | 'delete') {
    if (busy.value)
      return false
    busy.value = true
    error.value = ''
    try {
      if (action === 'toggle') {
        await enableSkill(item.id, !item.enabled)
      }
      else {
        await deleteSkill(item.id)
        items.value = items.value.filter(skill => skill.id !== item.id)
        selectedIds.value = selectedIds.value.filter(id => id !== item.id)
        if (preview.value?.id === item.id || previewItem.value?.id === item.id)
          dismissPreview()
        if (editingSkill.value?.id === item.id)
          closeEditor()
      }
      notifySuccess(t(action === 'delete' ? 'skills.feedback.deleted' : item.enabled ? 'skills.feedback.disabled' : 'skills.feedback.enabled'))
      await reload()
      return true
    }
    catch (cause) {
      error.value = message(cause)
      return false
    }
    finally { busy.value = false }
  }
  function createManual() {
    closeEditor()
    editorError.value = ''
    editorLoading.value = false
    editingSkill.value = {
      id: '',
      name: '',
      description: '',
      fingerprint: '',
      builtin: false,
      enabled: true,
      published: false,
      hasDraft: true,
      draft: true,
      conversationId: null,
      files: [{ path: 'SKILL.md', encoding: 'utf8', content: '---\nname: \ndescription: \n---\n\n' }],
    }
    editorOpen.value = true
  }

  async function openEditor(item: Pick<SkillSummary, 'id'> | SkillPreview, draft?: boolean) {
    closeEditor()
    editorError.value = ''
    if ('files' in item && Array.isArray((item as SkillPreview).files) && !(!item.draft && item.hasDraft)) {
      editingSkill.value = item as SkillPreview
      editorLoading.value = false
      editorOpen.value = true
      return
    }
    const shouldDraft = draft !== undefined ? draft : Boolean('hasDraft' in item && (item as SkillSummary).hasDraft)
    editingSkill.value = null
    editorOpen.value = true
    editorLoading.value = true
    busy.value = true
    const request = new AbortController()
    editorRequest = request
    try {
      const data = await getSkill(item.id, shouldDraft, request.signal)
      if (!request.signal.aborted)
        editingSkill.value = data
    }
    catch (cause) {
      if (!request.signal.aborted) {
        error.value = message(cause)
        editorError.value = message(cause)
      }
    }
    finally {
      if (editorRequest === request) {
        editorRequest = undefined
        busy.value = false
        editorLoading.value = false
      }
    }
  }

  async function saveDraft(id: string, files: SkillResource[], expectedFingerprint: string): Promise<SkillPreview> {
    busy.value = true
    editorError.value = ''
    try {
      const updated = await saveSkillDraft(id, files, expectedFingerprint)
      if (editingSkill.value?.id === id)
        editingSkill.value = updated
      if (preview.value?.id === id)
        preview.value = updated
      notifySuccess(t('skills.feedback.saved'))
      await reload()
      return updated
    }
    catch (cause) {
      const msg = message(cause)
      editorError.value = msg
      if (commitUnknown(cause)) {
        editorOutcomeUnknown.value = true
        await reload()
      }
      throw cause
    }
    finally {
      busy.value = false
    }
  }

  async function publishEditor(id: string, files: SkillResource[], expectedFingerprint: string): Promise<SkillPreview> {
    busy.value = true
    editorError.value = ''
    try {
      if (!id) {
        const created = await createSkill(files)
        notifySuccess(t('skills.feedback.published'))
        await reload()
        closeEditor()
        return created
      }
      const draftResult = await saveSkillDraft(id, files, expectedFingerprint)
      if (editingSkill.value?.id === id)
        editingSkill.value = draftResult
      if (preview.value?.id === id)
        preview.value = draftResult
      const published = await publishSkill(draftResult.id, draftResult.fingerprint)
      if (editingSkill.value?.id === draftResult.id)
        editingSkill.value = published
      if (preview.value?.id === id)
        preview.value = published
      notifySuccess(t(draftResult.published ? 'skills.feedback.updated' : 'skills.feedback.published'))
      await reload()
      closeEditor()
      return published
    }
    catch (cause) {
      const msg = message(cause)
      editorError.value = msg
      if (commitUnknown(cause)) {
        editorOutcomeUnknown.value = true
        await reload()
      }
      throw cause
    }
    finally {
      busy.value = false
    }
  }

  async function start(skillId = 'builtin:skill-creator', prompt = t('skills.createPrompt')) {
    if (busy.value)
      return
    chatRequested.value++
    dismissPreview()
    busy.value = true
    error.value = ''
    try {
      await startChat(skillId, prompt)
    }
    catch (cause) { error.value = message(cause) }
    finally { busy.value = false }
  }
  const state = {
    items,
    selectedIds,
    chatRequested,
    preview,
    previewSurface,
    previewDialogOpen,
    previewLoading,
    previewItem,
    dismissPreview,
    loading,
    busy,
    error,
    reload,
    showPreview,
    publish,
    manage,
    start,
    editorOpen,
    editorLoading,
    editingSkill,
    editorError,
    editorOutcomeUnknown,
    openEditor,
    createManual,
    closeEditor,
    saveDraft,
    publishEditor,
  }
  provide(skillsKey, state)
  return state
}

export function useSkills() {
  const skills = inject(skillsKey)
  if (!skills)
    throw new Error('技能组件需要工作台上下文')
  return skills
}
