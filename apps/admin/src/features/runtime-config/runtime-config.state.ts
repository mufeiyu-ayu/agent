import type { AdminRuntimeConfig, AdminRuntimeConfigInput } from '@agent/contracts'
import { ref, shallowRef } from 'vue'

import { formatAdminRunError } from '../shared/admin-api'
import { fetchRuntimeConfig, updateRuntimeConfig } from './runtime-config-api'

/** 表单里的时限按秒编辑，接口按毫秒存。 */
export interface RuntimeConfigForm {
  runDeadlineSeconds: number
  compactionKeepRecentTokens: number
  debugCaptureModelIo: boolean
  /** 留空表示不改。 */
  serperApiKey: string
}

export function toRuntimeConfigForm(config: AdminRuntimeConfig): RuntimeConfigForm {
  return {
    runDeadlineSeconds: Math.round(config.runDeadlineMs / 1000),
    compactionKeepRecentTokens: config.compactionKeepRecentTokens,
    debugCaptureModelIo: config.debugCaptureModelIo,
    serperApiKey: '',
  }
}

export function toRuntimeConfigInput(form: RuntimeConfigForm): AdminRuntimeConfigInput {
  const serperApiKey = form.serperApiKey.trim()

  return {
    runDeadlineMs: form.runDeadlineSeconds * 1000,
    compactionKeepRecentTokens: form.compactionKeepRecentTokens,
    debugCaptureModelIo: form.debugCaptureModelIo,
    ...(serperApiKey ? { serperApiKey } : {}),
  }
}

/** 与保存后的值相比有没有改动；Key 填了就算改动。 */
export function isRuntimeConfigDirty(form: RuntimeConfigForm, config: AdminRuntimeConfig): boolean {
  const saved = toRuntimeConfigForm(config)

  return form.serperApiKey.trim() !== ''
    || (Object.keys(saved) as Array<keyof RuntimeConfigForm>)
      .some(key => key !== 'serperApiKey' && form[key] !== saved[key])
}

/**
 * 「运行配置」页的状态与动作（Issue #216）。
 * 读失败进 `error` 由页面展示；保存失败直接抛出，页面用 message 提示。
 */
export function createRuntimeConfigState() {
  const config = shallowRef<AdminRuntimeConfig | null>(null)
  const loading = ref(false)
  const error = ref('')
  const saving = ref(false)

  async function load() {
    loading.value = true
    error.value = ''

    try {
      config.value = await fetchRuntimeConfig()
    }
    catch (caught) {
      error.value = formatAdminRunError(caught)
    }
    finally {
      loading.value = false
    }
  }

  async function save(form: RuntimeConfigForm) {
    saving.value = true

    try {
      config.value = await updateRuntimeConfig(toRuntimeConfigInput(form))
    }
    finally {
      saving.value = false
    }
  }

  return { config, loading, error, saving, load, save }
}
