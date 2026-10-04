import type { AdminUser, CreateAdminUserRequest, UpdateAdminUserRequest } from '@agent/contracts'
import { computed, ref, shallowRef } from 'vue'
import { i18n } from '@/i18n'

import { formatAdminRunError } from '../shared/admin-api'
import { createAdminUser, fetchAdminUsers, resetAdminUserPassword, updateAdminUser } from './users-api'

/**
 * 「用户列表」页的状态与动作（Issue #195）。
 *
 * 读失败进 `error` 由页面展示；写操作直接抛出，页面用 message 提示。
 */
export function createUsersState() {
  const users = shallowRef<AdminUser[]>([])
  const loading = ref(false)
  const error = ref('')
  const pendingKeys = shallowRef(new Set<string>())
  const creating = computed(() => pendingKeys.value.has('create'))
  const pendingUserIds = computed(() => new Set([...pendingKeys.value].filter(key => key !== 'create')))

  async function load() {
    if (loading.value)
      return
    loading.value = true
    error.value = ''

    try {
      users.value = await fetchAdminUsers()
    }
    catch (caught) {
      error.value = formatAdminRunError(caught)
    }
    finally {
      loading.value = false
    }
  }

  async function write(key: string, action: () => Promise<AdminUser>) {
    if (pendingKeys.value.has(key))
      throw new Error(i18n.global.t('errors.requestPending'))

    pendingKeys.value = new Set([...pendingKeys.value, key])
    try {
      const user = await action()
      const index = users.value.findIndex(item => item.id === user.id)
      users.value = index === -1
        ? [...users.value, user]
        : users.value.map(item => item.id === user.id ? user : item)
    }
    finally {
      const remaining = new Set(pendingKeys.value)
      remaining.delete(key)
      pendingKeys.value = remaining
    }
  }

  return {
    users,
    loading,
    error,
    creating,
    pendingUserIds,
    load,
    create: (input: CreateAdminUserRequest) => write('create', () => createAdminUser(input)),
    update: (userId: string, input: UpdateAdminUserRequest) => write(userId, () => updateAdminUser(userId, input)),
    resetPassword: (userId: string, password: string) => write(userId, () => resetAdminUserPassword(userId, password)),
  }
}
