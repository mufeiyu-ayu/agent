<script setup lang="ts">
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@agent/contracts'
import { Alert, Button, Card, Form, FormItem, InputPassword } from 'ant-design-vue'
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import { safeRedirect, useAuth } from '@/features/auth/auth.state'
import { formatAdminRunError } from '@/features/shared/admin-api'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const { currentUser, updatePassword } = useAuth()

const form = reactive({ currentPassword: '', newPassword: '', confirmPassword: '' })
const error = ref('')
const submitting = ref(false)

const newPasswordRules = computed(() => [{ required: true, min: PASSWORD_MIN_LENGTH, max: PASSWORD_MAX_LENGTH, message: t('auth.fields.passwordLength', { min: PASSWORD_MIN_LENGTH }) }])
const confirmRules = [{
  validator: async (_rule: unknown, value: string) => {
    if (value !== form.newPassword)
      throw new Error(t('auth.changePassword.mismatch'))
  },
}]

async function submit() {
  error.value = ''
  submitting.value = true

  try {
    await updatePassword({ currentPassword: form.currentPassword, newPassword: form.newPassword })
    await router.replace(safeRedirect(route.query.redirect))
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
    <Card class="auth-page__card" :title="t('auth.changePassword.title')">
      <p class="auth-page__hint">
        {{ currentUser?.mustChangePassword ? t('auth.changePassword.required') : currentUser?.email }}
      </p>
      <Form layout="vertical" :model="form" @finish="submit">
        <FormItem :label="t('auth.fields.currentPassword')" name="currentPassword" :rules="[{ required: true, message: t('auth.fields.required') }]">
          <InputPassword v-model:value="form.currentPassword" autocomplete="current-password" />
        </FormItem>
        <FormItem :label="t('auth.fields.newPassword')" name="newPassword" :rules="newPasswordRules">
          <InputPassword v-model:value="form.newPassword" autocomplete="new-password" />
        </FormItem>
        <FormItem :label="t('auth.fields.confirmPassword')" name="confirmPassword" :rules="confirmRules">
          <InputPassword v-model:value="form.confirmPassword" autocomplete="new-password" />
        </FormItem>
        <Alert v-if="error" type="error" :message="error" show-icon class="auth-page__error" />
        <Button type="primary" html-type="submit" block :loading="submitting">
          {{ t('auth.changePassword.submit') }}
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

.auth-page__hint {
  margin-bottom: 16px;
  color: var(--admin-text-muted);
}

.auth-page__error {
  margin-bottom: 16px;
}
</style>
