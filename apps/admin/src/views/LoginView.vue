<script setup lang="ts">
import { Alert, Button, Card, Form, FormItem, Input, InputPassword } from 'ant-design-vue'
import { reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import { safeRedirect, useAuth } from '@/features/auth/auth.state'
import { formatAdminRunError } from '@/features/shared/admin-api'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { signIn } = useAuth()

const form = reactive({ email: '', password: '' })
const error = ref('')
const submitting = ref(false)

async function submit() {
  error.value = ''
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
    <Card class="auth-page__card" :title="t('auth.login.title')">
      <Form layout="vertical" :model="form" @finish="submit">
        <FormItem :label="t('auth.fields.email')" name="email" :rules="[{ required: true, message: t('auth.fields.required') }]">
          <Input v-model:value="form.email" type="email" autocomplete="username" />
        </FormItem>
        <FormItem :label="t('auth.fields.password')" name="password" :rules="[{ required: true, message: t('auth.fields.required') }]">
          <InputPassword v-model:value="form.password" autocomplete="current-password" />
        </FormItem>
        <Alert v-if="error" type="error" :message="error" show-icon class="auth-page__error" />
        <Button type="primary" html-type="submit" block :loading="submitting">
          {{ t('auth.login.submit') }}
        </Button>
      </Form>
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
