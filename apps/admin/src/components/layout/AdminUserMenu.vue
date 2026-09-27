<script setup lang="ts">
import { userDisplayName } from '@agent/contracts'
import { DownOutlined, LoadingOutlined, LogoutOutlined } from '@ant-design/icons-vue'
import { App as AntApp, Dropdown } from 'ant-design-vue'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import UserAvatar from '@/components/common/UserAvatar.vue'
import { useAuth } from '@/features/auth/auth.state'
import { formatAdminRunError } from '@/features/shared/admin-api'

const router = useRouter()
const { message } = AntApp.useApp()
const { currentUser, signOut } = useAuth()
const { t } = useI18n()
const open = ref(false)

const loggingOut = ref(false)

async function logout() {
  if (loggingOut.value)
    return
  loggingOut.value = true
  try {
    await signOut()
  }
  catch (error) {
    void message.error(formatAdminRunError(error))
    loggingOut.value = false
    return
  }

  await router.replace({ name: 'login' })
}
</script>

<template>
  <Dropdown v-if="currentUser" v-model:open="open" placement="bottomRight" :trigger="['click']">
    <button type="button" class="user-menu__trigger" :aria-label="userDisplayName(currentUser)">
      <UserAvatar :user="currentUser" :size="26" />
      <span class="user-menu__name">{{ userDisplayName(currentUser) }}</span>
      <DownOutlined class="user-menu__caret" />
    </button>

    <template #overlay>
      <div class="user-menu__panel">
        <div class="user-menu__identity">
          <UserAvatar :user="currentUser" :size="36" />
          <span>
            <strong>{{ userDisplayName(currentUser) }}</strong>
            <small>{{ currentUser.email }}</small>
            <small>{{ t('users.roles.ADMIN') }}</small>
          </span>
        </div>
        <button type="button" class="user-menu__item" :disabled="loggingOut" :aria-busy="loggingOut" @click="logout">
          <LoadingOutlined v-if="loggingOut" />
          <LogoutOutlined v-else />
          {{ t('auth.logout') }}
        </button>
      </div>
    </template>
  </Dropdown>
</template>

<style scoped>
.user-menu__trigger {
  display: flex;
  height: 32px;
  align-items: center;
  gap: 8px;
  padding: 0 8px 0 3px;
  border: 0;
  border-radius: 999px;
  color: var(--admin-text);
  background: transparent;
  cursor: pointer;
  font: inherit;
}

.user-menu__trigger:hover,
.user-menu__trigger[aria-expanded='true'] {
  background: var(--admin-hover);
}

.user-menu__name {
  max-width: 140px;
  overflow: hidden;
  font-size: var(--admin-font-sm);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-menu__caret {
  color: var(--admin-text-subtle);
  font-size: 10px;
}

.user-menu__panel {
  width: 240px;
  padding: 6px;
  border-radius: 12px;
  background: var(--admin-surface-raised);
  box-shadow: var(--admin-shadow-md);
}

.user-menu__identity {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 8px 12px;
  border-bottom: 0.5px solid var(--admin-border-strong);
  margin-bottom: 6px;
}

.user-menu__identity > span {
  display: grid;
  min-width: 0;
  line-height: 1.35;
}

.user-menu__identity strong {
  overflow: hidden;
  font-size: var(--admin-font-sm);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-menu__identity small {
  overflow: hidden;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.user-menu__item {
  display: flex;
  width: 100%;
  height: 34px;
  align-items: center;
  gap: 9px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  color: var(--admin-text);
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: var(--admin-font-sm);
  text-align: left;
}

.user-menu__item:hover {
  background: var(--admin-hover);
}

.user-menu__item:disabled {
  cursor: default;
  color: var(--admin-text-muted);
}
</style>
