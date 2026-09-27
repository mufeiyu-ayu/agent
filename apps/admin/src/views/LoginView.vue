<script setup lang="ts">
import { GOOGLE_LOGIN_RESULTS } from '@agent/contracts'
import { Alert, Button, Card, Divider, Form, FormItem, Input, InputPassword, Result } from 'ant-design-vue'
import { onMounted, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import { fetchAuthConfig, startGoogleLogin } from '@/features/auth/auth-api'
import { safeRedirect, useAuth } from '@/features/auth/auth.state'
import { formatAdminRunError } from '@/features/shared/admin-api'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { signIn } = useAuth()

const form = reactive({ email: '', password: '' })
const error = ref('')
const submitting = ref(false)
// Google 回调没能直接进站时带回 ?google=<GOOGLE_LOGIN_RESULTS 之一>。
const googleResult = ref(GOOGLE_LOGIN_RESULTS.find(result => result === route.query.google) ?? null)
const googleEnabled = ref(false)

onMounted(async () => {
  googleEnabled.value = Boolean((await fetchAuthConfig().catch(() => null))?.googleClientId)
})

function loginWithGoogle() {
  startGoogleLogin(safeRedirect(route.query.redirect))
}

async function submit() {
  error.value = ''
  googleResult.value = null
  submitting.value = true

  try {
    const user = await signIn(form)
    const redirect = safeRedirect(route.query.redirect)

    await router.replace(user.mustChangePassword ? { name: 'change-password', query: { redirect } } : redirect)
  }
  catch (caught) {
    error.value = formatAdminRunError(caught)
  }
  finally {
    submitting.value = false
  }
}
</script>

<template>
  <main class="auth-page">
    <Card v-if="googleResult === 'pending'" class="auth-page__card">
      <Result status="info" :title="t('auth.google.pendingTitle')" :sub-title="t('auth.google.pendingBody')">
        <template #extra>
          <Button @click="googleResult = null">
            {{ t('auth.google.back') }}
          </Button>
        </template>
      </Result>
    </Card>
    <Card v-else class="auth-page__card" :title="t('auth.login.title')">
      <Form layout="vertical" :model="form" @finish="submit">
        <FormItem :label="t('auth.fields.email')" name="email" :rules="[{ required: true, message: t('auth.fields.required') }]">
          <Input v-model:value="form.email" type="email" autocomplete="username" />
        </FormItem>
        <FormItem :label="t('auth.fields.password')" name="password" :rules="[{ required: true, message: t('auth.fields.required') }]">
          <InputPassword v-model:value="form.password" autocomplete="current-password" />
        </FormItem>
        <Alert v-if="error || googleResult" type="error" :message="error || t(`auth.google.${googleResult}`)" show-icon class="auth-page__error" />
        <Button type="primary" html-type="submit" block :loading="submitting">
          {{ t('auth.login.submit') }}
        </Button>
      </Form>
      <template v-if="googleEnabled">
        <Divider plain>
          {{ t('auth.google.or') }}
        </Divider>
        <Button block @click="loginWithGoogle">
          {{ t('auth.google.button') }}
        </Button>
      </template>
    </Card>
  </main>
</template>

<style scoped>
.auth-page {
  display: grid;
  min-height: 100vh;
  place-items: center;
  padding: 16px;
  background: var(--admin-bg-deep);
}

.auth-page__card {
  width: min(380px, 100%);
}

.auth-page__error {
  margin-bottom: 16px;
}
</style>
