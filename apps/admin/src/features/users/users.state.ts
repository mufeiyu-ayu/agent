import type { AdminUser, CreateAdminUserRequest, UpdateAdminUserRequest } from '@agent/contracts'
import { ref, shallowRef } from 'vue'

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
  const submitting = ref(false)

  async function load() {
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

  async function write(action: () => Promise<AdminUser>) {
    submitting.value = true

    try {
      const user = await action()
      const index = users.value.findIndex(item => item.id === user.id)
      users.value = index === -1
        ? [...users.value, user]
        : users.value.map(item => item.id === user.id ? user : item)
    }
    finally {
      submitting.value = false
    }
  }

  return {
    users,
    loading,
    error,
    submitting,
    load,
    create: (input: CreateAdminUserRequest) => write(() => createAdminUser(input)),
    update: (userId: string, input: UpdateAdminUserRequest) => write(() => updateAdminUser(userId, input)),
    resetPassword: (userId: string, password: string) => write(() => resetAdminUserPassword(userId, password)),
  }
}
