<script setup lang="ts">
import type { ApiErrorResponse } from '@agent/contracts'
import { PASSWORD_MIN_LENGTH } from '@agent/contracts'
import { isAxiosError } from 'axios'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { safeRedirect } from '@/utils/safe-redirect'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { currentUser, updatePassword } = useAuth()

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const error = ref('')
const submitting = ref(false)

async function submit() {
  error.value = ''

  if (newPassword.value !== confirmPassword.value) {
    error.value = t('auth.changePassword.mismatch')
    return
  }

  submitting.value = true

  try {
    await updatePassword({ currentPassword: currentPassword.value, newPassword: newPassword.value })
    await router.replace(safeRedirect(route.query.redirect))
  }
  catch (caught) {
    const data = isAxiosError<ApiErrorResponse>(caught) ? caught.response?.data : undefined
    const details = data?.error?.details
    error.value = Array.isArray(details) && details.length > 0
      ? String(details[0])
      : data?.message ?? t('auth.fallbackError')
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="grid min-h-screen place-items-center bg-agent-canvas px-4 text-agent-ink">
    <form class="w-full max-w-sm rounded-xl border border-agent-border-soft bg-agent-surface-raised p-6 shadow-sm" @submit.prevent="submit">
      <h1 class="mb-2 text-xl font-semibold">
        {{ t('auth.changePassword.title') }}
      </h1>
      <p class="mb-6 text-sm text-agent-ink-muted">
        {{ currentUser?.mustChangePassword ? t('auth.changePassword.required') : currentUser?.email }}
      </p>

      <label class="mb-4 block text-sm">
        <span class="mb-1.5 block text-agent-ink-soft">{{ t('auth.fields.currentPassword') }}</span>
        <input v-model="currentPassword" type="password" autocomplete="current-password" required class="auth-input">
      </label>

      <label class="mb-4 block text-sm">
        <span class="mb-1.5 block text-agent-ink-soft">{{ t('auth.fields.newPassword', { min: PASSWORD_MIN_LENGTH }) }}</span>
        <input v-model="newPassword" type="password" autocomplete="new-password" :minlength="PASSWORD_MIN_LENGTH" required class="auth-input">
      </label>

      <label class="mb-4 block text-sm">
        <span class="mb-1.5 block text-agent-ink-soft">{{ t('auth.fields.confirmPassword') }}</span>
        <input v-model="confirmPassword" type="password" autocomplete="new-password" required class="auth-input">
      </label>

      <p v-if="error" role="alert" class="mb-4 text-sm text-red-600">
        {{ error }}
      </p>

      <Button type="submit" size="lg" class="w-full" :disabled="submitting">
        {{ t('auth.changePassword.submit') }}
      </Button>
    </form>
  </main>
</template>

<style scoped>
.auth-input {
  width: 100%;
  height: 2.5rem;
  border: 1px solid var(--agent-border);
  border-radius: 0.5rem;
  background: var(--agent-surface);
  padding: 0 0.75rem;
  outline: none;
}

.auth-input:focus-visible {
  border-color: var(--agent-focus);
}
</style>
