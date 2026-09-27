<script setup lang="ts">
import type { ApiErrorResponse, AuthUser, GoogleLoginResult } from '@agent/contracts'
import { isAxiosError } from 'axios'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/useAuth'
import { startGoogleLogin, useGoogleClientId } from '@/hooks/useGoogleLogin'

/** 登录表单：`/login` 页与首页弹窗共用。邮箱密码 + 「使用 Google 登录」；成功后由调用方决定去哪。 */
const props = defineProps<{ redirect: string }>()
const emit = defineEmits<{ success: [user: AuthUser] }>()
/** Google 登录没能直接进站的结果：pending 显示待审核，其余显示失败文案。 */
const notice = defineModel<GoogleLoginResult | null>('notice', { default: null })

const { t } = useI18n()
const { signIn } = useAuth()
const googleClientId = useGoogleClientId()

const email = ref('')
const password = ref('')
const error = ref('')
const submitting = ref(false)

async function submit() {
  error.value = ''
  notice.value = null
  submitting.value = true

  try {
    emit('success', await signIn({ email: email.value, password: password.value }))
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
  <div v-if="notice === 'pending'" role="status">
    <h1 class="mb-3 text-xl font-semibold">
      {{ t('auth.google.pendingTitle') }}
    </h1>
    <p class="mb-6 text-sm text-agent-ink-soft">
      {{ t('auth.google.pendingBody') }}
    </p>
    <Button type="button" size="lg" variant="outline" class="w-full" @click="notice = null">
      {{ t('auth.google.back') }}
    </Button>
  </div>

  <form v-else @submit.prevent="submit">
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

    <p v-if="error || notice" role="alert" class="mb-4 text-sm text-red-600">
      {{ error || t(`auth.google.${notice}`) }}
    </p>

    <Button type="submit" size="lg" class="w-full" :disabled="submitting">
      {{ t('auth.login.submit') }}
    </Button>

    <template v-if="googleClientId">
      <p class="my-4 text-center text-xs text-agent-ink-faint">
        {{ t('auth.google.or') }}
      </p>
      <Button type="button" size="lg" variant="outline" class="w-full" @click="startGoogleLogin(props.redirect)">
        {{ t('auth.google.button') }}
      </Button>
    </template>
  </form>
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
