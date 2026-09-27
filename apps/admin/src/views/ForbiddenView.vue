<script setup lang="ts">
import { App as AntApp, Button, Result } from 'ant-design-vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import { useAuth } from '@/features/auth/auth.state'
import { formatAdminRunError } from '@/features/shared/admin-api'

const { t } = useI18n()
const router = useRouter()
const { message } = AntApp.useApp()
const { currentUser, signOut } = useAuth()

async function logout() {
  try {
    await signOut()
  }
  catch (error) {
    void message.error(formatAdminRunError(error))
    return
  }

  await router.replace({ name: 'login' })
}
</script>

<template>
  <main class="forbidden">
    <Result status="403" :title="t('auth.forbidden.title')" :sub-title="t('auth.forbidden.description', { email: currentUser?.email ?? '' })">
      <template #extra>
        <Button type="primary" @click="logout">
          {{ t('auth.logout') }}
        </Button>
      </template>
    </Result>
  </main>
</template>

<style scoped>
.forbidden {
  display: grid;
  min-height: 100vh;
  place-items: center;
  background: var(--admin-bg-deep);
}
</style>
