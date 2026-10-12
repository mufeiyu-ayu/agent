import type { AdminSkillDetail, AdminSkillSummary, SkillResource } from '@agent/contracts'
import { computed, ref, shallowRef } from 'vue'
import { i18n } from '@/i18n'
import { AdminRunApiError, formatAdminRunError } from '../shared/admin-api'
import { createAdminSkill, deleteAdminSkill, fetchAdminSkillDetail, fetchAdminSkills, toggleAdminSkill, updateAdminSkill } from './skills-api'
import { buildSkillMarkdown, createDefaultSkillMarkdown, isBuiltinSkill } from './skills.utils'

export function createSkillsState() {
  const skills = shallowRef<AdminSkillSummary[]>([])
  const loading = ref(false)
  const error = ref('')
  const keyword = ref('')
  const statusFilter = ref<'ALL' | 'ENABLED' | 'DISABLED'>('ALL')
  const pendingIds = shallowRef(new Set<string>())
  const saving = ref(false)
  const detailOpen = ref(false)
  const activeDetailId = ref<string | null>(null)
  const detailLoading = ref(false)
  const detailError = ref('')
  const detailData = shallowRef<AdminSkillDetail | null>(null)
  const formModalOpen = ref(false)
  const editingSkill = shallowRef<AdminSkillDetail | null>(null)
  const editingId = ref<string | null>(null)
  const fetchingEditTarget = ref(false)
  const formError = ref('')
  const formOutcomeUnknown = ref(false)
  let listController: AbortController | undefined
  let detailController: AbortController | undefined
  let editController: AbortController | undefined
  let disposed = false

  const busy = computed(() => loading.value || saving.value || fetchingEditTarget.value || detailLoading.value || pendingIds.value.size > 0)
  const filteredSkills = computed(() => {
    const query = keyword.value.trim().toLowerCase()
    return skills.value.filter(item => (statusFilter.value === 'ALL' || item.enabled === (statusFilter.value === 'ENABLED'))
      && (!query || `${item.name} ${item.description}`.toLowerCase().includes(query)))
  })

  async function load(): Promise<void> {
    if (disposed || busy.value)
      return
    const controller = new AbortController()
    listController = controller
    loading.value = true
    error.value = ''
    try {
      const fetched = await fetchAdminSkills({ signal: controller.signal })
      if (!controller.signal.aborted)
        skills.value = fetched
    }
    catch (cause) {
      if (!controller.signal.aborted)
        error.value = formatAdminRunError(cause)
    }
    finally { loading.value = false }
  }

  async function openDetail(id: string): Promise<void> {
    if (disposed || loading.value || saving.value || fetchingEditTarget.value || pendingIds.value.size)
      return
    detailController?.abort()
    const controller = new AbortController()
    detailController = controller
    detailOpen.value = true
    activeDetailId.value = id
    detailError.value = ''
    detailLoading.value = true
    detailData.value = null
    try {
      const detail = await fetchAdminSkillDetail(id, { signal: controller.signal })
      if (!controller.signal.aborted)
        detailData.value = detail
    }
    catch (cause) {
      if (!controller.signal.aborted)
        detailError.value = formatAdminRunError(cause)
    }
    finally {
      if (detailController === controller)
        detailLoading.value = false
    }
  }

  function closeDetail(): void {
    detailController?.abort()
    detailController = undefined
    detailOpen.value = false
    activeDetailId.value = null
    detailData.value = null
    detailLoading.value = false
    detailError.value = ''
  }

  function openCreate(): void {
    if (disposed || busy.value)
      return
    editingSkill.value = null
    editingId.value = null
    formError.value = ''
    formOutcomeUnknown.value = false
    formModalOpen.value = true
  }

  async function openEdit(skill: AdminSkillSummary): Promise<void> {
    if (disposed || busy.value)
      return
    fetchingEditTarget.value = true
    editingId.value = skill.id
    const controller = new AbortController()
    editController = controller
    try {
      // 每次进入编辑都读取当前内容与指纹，不拿旧详情直接覆盖。
      const detail = await fetchAdminSkillDetail(skill.id, { signal: controller.signal })
      if (!controller.signal.aborted) {
        editingSkill.value = detail
        formError.value = ''
        formOutcomeUnknown.value = false
        formModalOpen.value = true
      }
    }
    catch (cause) {
      if (!controller.signal.aborted)
        throw new Error(formatAdminRunError(cause))
    }
    finally { fetchingEditTarget.value = false }
  }

  function closeFormModal(): void {
    if (saving.value)
      return
    editController?.abort()
    formModalOpen.value = false
    editingSkill.value = null
    editingId.value = null
    formError.value = ''
    formOutcomeUnknown.value = false
  }

  async function saveSkill(input: { name: string, description: string, body: string }): Promise<void> {
    if (disposed || busy.value || formOutcomeUnknown.value)
      throw new Error(i18n.global.t('errors.requestPending'))
    const current = editingSkill.value
    saving.value = true
    formError.value = ''
    try {
      const files: SkillResource[] = [{
        path: 'SKILL.md',
        encoding: 'utf8',
        content: buildSkillMarkdown(current?.files.find(file => file.path === 'SKILL.md')?.content ?? createDefaultSkillMarkdown(), input.name, input.description, input.body),
      }, ...(current?.files.filter(file => file.path !== 'SKILL.md') ?? [])]
      const saved = current
        ? await updateAdminSkill(current.id, { files, expectedFingerprint: current.fingerprint })
        : await createAdminSkill({ files })
      if (disposed)
        return
      const { files: _files, fingerprint: _fingerprint, draft: _draft, ...summary } = saved
      skills.value = current ? skills.value.map(item => item.id === saved.id ? summary : item) : [summary, ...skills.value]
      if (activeDetailId.value === saved.id)
        detailData.value = saved
      formModalOpen.value = false
      editingSkill.value = null
      editingId.value = null
    }
    catch (cause) {
      if (!disposed) {
        formError.value = formatAdminRunError(cause)
        formOutcomeUnknown.value = cause instanceof AdminRunApiError && cause.code === 'DatabaseCommitOutcomeUnknown'
      }
      throw cause
    }
    finally { saving.value = false }
  }

  async function toggleSkill(skill: AdminSkillSummary): Promise<boolean> {
    if (disposed || busy.value)
      return false
    pendingIds.value = new Set([skill.id])
    try {
      const updated = await toggleAdminSkill(skill.id, !skill.enabled)
      if (!disposed) {
        skills.value = skills.value.map(item => item.id === updated.id ? { ...item, enabled: updated.enabled } : item)
        if (detailData.value?.id === updated.id)
          detailData.value = { ...detailData.value, enabled: updated.enabled }
      }
      return !disposed
    }
    finally { pendingIds.value = new Set() }
  }

  async function deleteSkill(skill: AdminSkillSummary): Promise<boolean> {
    if (isBuiltinSkill(skill.id))
      throw new Error(i18n.global.t('skills.deleteForbiddenForBuiltin'))
    if (disposed || busy.value)
      return false
    pendingIds.value = new Set([skill.id])
    try {
      await deleteAdminSkill(skill.id)
      if (!disposed) {
        skills.value = skills.value.filter(item => item.id !== skill.id)
        if (activeDetailId.value === skill.id)
          closeDetail()
      }
      return !disposed
    }
    finally { pendingIds.value = new Set() }
  }

  function dispose(): void {
    disposed = true
    listController?.abort()
    editController?.abort()
    closeDetail()
  }

  return {
    skills,
    loading,
    error,
    keyword,
    statusFilter,
    filteredSkills,
    pendingIds,
    saving,
    busy,
    fetchingEditTarget,
    editingId,
    detailOpen,
    activeDetailId,
    detailLoading,
    detailError,
    detailData,
    openDetail,
    closeDetail,
    formModalOpen,
    editingSkill,
    formError,
    formOutcomeUnknown,
    openCreate,
    openEdit,
    closeFormModal,
    saveSkill,
    load,
    toggleSkill,
    deleteSkill,
    dispose,
  }
}
