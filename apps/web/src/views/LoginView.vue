<script setup lang="ts">
import type { ApiErrorResponse } from '@agent/contracts'
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
const { signIn } = useAuth()

const email = ref('')
const password = ref('')
const error = ref('')
const submitting = ref(false)

async function submit() {
  error.value = ''
  submitting.value = true

  try {
    const user = await signIn({ email: email.value, password: password.value })
    const redirect = safeRedirect(route.query.redirect)

    await router.replace(user.mustChangePassword
      ? { name: 'change-password', query: { redirect } }
      : redirect)
  }
  catch (caught) {
    error.value = isAxiosError<ApiErrorResponse>(caught) && caught.response?.data?.message
      ? caught.response.data.message
      : t('auth.fallbackError')
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="grid min-h-screen place-items-center bg-agent-canvas px-4 text-agent-ink">
    <form class="w-full max-w-sm rounded-xl border border-agent-border-soft bg-agent-surface-raised p-6 shadow-sm" @submit.prevent="submit">
      <h1 class="mb-6 text-xl font-semibold">
        {{ t('auth.login.title') }}
      </h1>

      <label class="mb-4 block text-sm">
        <span class="mb-1.5 block text-agent-ink-soft">{{ t('auth.fields.email') }}</span>
        <input v-model="email" type="email" autocomplete="username" required class="auth-input">
      </label>

      <label class="mb-4 block text-sm">
        <span class="mb-1.5 block text-agent-ink-soft">{{ t('auth.fields.password') }}</span>
        <input v-model="password" type="password" autocomplete="current-password" required class="auth-input">
      </label>

      <p v-if="error" role="alert" class="mb-4 text-sm text-red-600">
        {{ error }}
      </p>

      <Button type="submit" size="lg" class="w-full" :disabled="submitting">
        {{ t('auth.login.submit') }}
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
