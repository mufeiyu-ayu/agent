<script setup lang="ts">
import { GOOGLE_LOGIN_RESULTS } from '@agent/contracts'
import { Alert, Button, Divider, Form, FormItem, Input, InputPassword } from 'ant-design-vue'
import { onBeforeUnmount, onMounted, reactive, ref } from 'vue'
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
/** 已经整页跳去 Google：loading 一直保持到页面离开 */
const redirecting = ref(false)

// 从 Google 页面按浏览器返回时页面可能来自 bfcache，loading 要复位
function resetOnPageShow(event: PageTransitionEvent) {
  if (event.persisted)
    redirecting.value = false
}

onMounted(async () => {
  window.addEventListener('pageshow', resetOnPageShow)
  googleEnabled.value = Boolean((await fetchAuthConfig().catch(() => null))?.googleClientId)
})
onBeforeUnmount(() => window.removeEventListener('pageshow', resetOnPageShow))

function loginWithGoogle() {
  redirecting.value = true
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
  <main class="login-page">
    <!--
      左侧流动背景：两片十瓣波浪形缓慢旋转（形状取自 cool-admin-vue 登录页，MIT，见 THIRD_PARTY_NOTICES.md），
      换成森林绿；十瓣对称所以转 36° 就能无缝循环。
    -->
    <div class="login-page__art" aria-hidden="true">
      <svg viewBox="0 0 500 350">
        <g transform="translate(628,-17) scale(100)" class="login-page__blob is-back">
          <path d="M4.10125 0 C4.10125 0.5525 4.3542 0.8338 4.1835 1.3593 S3.6427 1.9637 3.318 2.4107 S3.0325 3.2339 2.5855 3.5587 S1.7928 3.7298 1.2674 3.9005 S0.5525 4.3988 0 4.3988 S-0.7419 4.0713 -1.2674 3.9005 S-2.1385 3.8834 -2.5855 3.5587 S-2.9932 2.8576 -3.318 2.4107 S-4.0127 1.8847 -4.1835 1.3593 S-4.1013 0.5525 -4.1013 0 S-4.3542 -0.8338 -4.1835 -1.3593 S-3.6427 -1.9637 -3.318 -2.4107 S-3.0325 -3.2339 -2.5855 -3.5587 S-1.7928 -3.7298 -1.2674 -3.9005 S-0.5525 -4.3988 0 -4.3988 S0.7419 -4.0713 1.2674 -3.9005 S2.1385 -3.8834 2.5855 -3.5587 S2.9932 -2.8576 3.318 -2.4107 S4.0127 -1.8847 4.1835 -1.3593 S4.1013 -0.5525 4.1013 0" />
        </g>
        <g transform="translate(704,-56) scale(100)" class="login-page__blob is-front">
          <path d="M4.9215 0 C4.9215 0.663 5.225 1.0006 5.0202 1.6311 S4.3713 2.3564 3.9816 2.8928 S3.639 3.8807 3.1026 4.2704 S2.1514 4.4757 1.5208 4.6806 S0.663 5.2785 0 5.2785 S-0.8903 4.8855 -1.5208 4.6806 S-2.5662 4.6601 -3.1026 4.2704 S-3.5919 3.4292 -3.9816 2.8928 S-4.8153 2.2617 -5.0202 1.6311 S-4.9215 0.663 -4.9215 0 S-5.225 -1.0006 -5.0202 -1.6311 S-4.3713 -2.3564 -3.9816 -2.8928 S-3.639 -3.8807 -3.1026 -4.2704 S-2.1514 -4.4757 -1.5208 -4.6806 S-0.663 -5.2785 0 -5.2785 S0.8903 -4.8855 1.5208 -4.6806 S2.5662 -4.6601 3.1026 -4.2704 S3.5919 -3.4292 3.9816 -2.8928 S4.8153 -2.2617 5.0202 -1.6311 S4.9215 -0.663 4.9215 0" />
        </g>
      </svg>
    </div>

    <section class="login-page__panel">
      <div class="login-page__box">
        <header class="login-page__brand">
          <span class="login-page__mark" aria-hidden="true">
            <svg viewBox="0 0 18 18" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round">
              <circle cx="9" cy="9" r="5.2" />
              <circle cx="13.2" cy="4.8" r="1.8" fill="#fff" stroke="none" />
            </svg>
          </span>
          <h1>{{ t('common.appName') }}</h1>
        </header>

        <div v-if="googleResult === 'pending'" class="login-page__pending" role="status">
          <h2>{{ t('auth.google.pendingTitle') }}</h2>
          <p>{{ t('auth.google.pendingBody') }}</p>
          <Button block size="large" @click="googleResult = null">
            {{ t('auth.google.back') }}
          </Button>
        </div>

        <template v-else>
          <p class="login-page__subtitle">
            {{ t('auth.login.subtitle') }}
          </p>

          <Form class="login-page__form" layout="vertical" :model="form" :required-mark="false" @finish="submit">
            <FormItem :label="t('auth.fields.email')" name="email" :rules="[{ required: true, message: t('auth.fields.required') }]">
              <Input v-model:value="form.email" size="large" type="email" autocomplete="username" />
            </FormItem>
            <FormItem :label="t('auth.fields.password')" name="password" :rules="[{ required: true, message: t('auth.fields.required') }]">
              <InputPassword v-model:value="form.password" size="large" autocomplete="current-password" />
            </FormItem>
            <Alert v-if="error || googleResult" type="error" :message="error || t(`auth.google.${googleResult}`)" show-icon class="login-page__error" />
            <Button type="primary" html-type="submit" block size="large" :loading="submitting" :disabled="redirecting">
              {{ t('auth.login.submit') }}
            </Button>
          </Form>

          <template v-if="googleEnabled">
            <Divider plain class="login-page__divider">
              {{ t('auth.google.or') }}
            </Divider>
            <Button block size="large" class="login-page__google" :loading="redirecting" :disabled="submitting" @click="loginWithGoogle">
              <template v-if="!redirecting" #icon>
                <!-- Google 彩色 G（gilbarbara/logos，CC0）；跳转中由按钮自己的 loading 图标替换 -->
                <svg class="login-page__google-icon" viewBox="0 0 256 262" aria-hidden="true">
                  <path fill="#4285f4" d="M255.878 133.451c0-10.734-.871-18.567-2.756-26.69H130.55v48.448h71.947c-1.45 12.04-9.283 30.172-26.69 42.356l-.244 1.622l38.755 30.023l2.685.268c24.659-22.774 38.875-56.282 38.875-96.027" />
                  <path fill="#34a853" d="M130.55 261.1c35.248 0 64.839-11.605 86.453-31.622l-41.196-31.913c-11.024 7.688-25.82 13.055-45.257 13.055c-34.523 0-63.824-22.773-74.269-54.25l-1.531.13l-40.298 31.187l-.527 1.465C35.393 231.798 79.49 261.1 130.55 261.1" />
                  <path fill="#fbbc05" d="M56.281 156.37c-2.756-8.123-4.351-16.827-4.351-25.82c0-8.994 1.595-17.697 4.206-25.82l-.073-1.73L15.26 71.312l-1.335.635C5.077 89.644 0 109.517 0 130.55s5.077 40.905 13.925 58.602z" />
                  <path fill="#eb4335" d="M130.55 50.479c24.514 0 41.05 10.589 50.479 19.438l36.844-35.974C195.245 12.91 165.798 0 130.55 0C79.49 0 35.393 29.301 13.925 71.947l42.211 32.783c10.59-31.477 39.891-54.251 74.414-54.251" />
                </svg>
              </template>
              {{ redirecting ? t('auth.google.redirecting') : t('auth.google.button') }}
            </Button>
          </template>
        </template>
      </div>
    </section>

    <footer class="login-page__copyright">
      Copyright © Kuro
    </footer>
  </main>
</template>

<style scoped>
.login-page {
  position: relative;
  min-height: 100vh;
  overflow: hidden;
  color: var(--admin-text);
  background: var(--admin-bg-deep);
}

/* 背景占左侧九成宽，整体水平翻转，让原本在右边的波浪贴到左边 */
.login-page__art {
  position: absolute;
  top: 0;
  left: 0;
  width: 90%;
  height: 100%;
  pointer-events: none;
  transform: scaleX(-1);
}

.login-page__art svg {
  width: 100%;
  height: 100%;
}

.login-page__blob path {
  animation: login-blob 10s linear infinite;
}

.login-page__blob.is-back {
  opacity: 0.28;
}

.login-page__blob.is-back path {
  fill: var(--admin-success);
}

.login-page__blob.is-front {
  opacity: 0.94;
}

.login-page__blob.is-front path {
  fill: var(--admin-primary);
  animation-duration: 6s;
}

@keyframes login-blob {
  to {
    transform: rotate(36deg);
  }
}

.login-page__panel {
  position: absolute;
  z-index: 1;
  top: 0;
  right: 0;
  display: grid;
  width: 50%;
  height: 100%;
  place-items: center;
  padding: 24px;
}

.login-page__box {
  width: min(360px, 100%);
}

.login-page__brand {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
}

.login-page__mark {
  display: grid;
  width: 40px;
  height: 40px;
  place-items: center;
  border-radius: 11px;
  background: linear-gradient(180deg, #296944, #0f4a2a);
  box-shadow: inset 0 0.5px 0 rgb(255 255 255 / 35%), 0 1px 2px rgb(0 0 0 / 18%);
}

.login-page__mark svg {
  width: 24px;
  height: 24px;
}

.login-page__brand h1 {
  margin: 0;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.login-page__subtitle {
  margin: 12px 0 36px;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-md);
  text-align: center;
}

/* 灰底无边框的输入框，聚焦时才出现绿色描边 */
.login-page__form :deep(.ant-form-item-label > label) {
  color: var(--admin-text-muted);
  font-size: var(--admin-font-sm);
}

.login-page__form :deep(.ant-input-affix-wrapper),
.login-page__form :deep(.ant-input:not(.ant-input-affix-wrapper .ant-input)) {
  border-color: transparent;
  background: var(--admin-surface-muted);
}

.login-page__form :deep(.ant-input-affix-wrapper .ant-input) {
  background: transparent;
}

.login-page__form :deep(.ant-input-affix-wrapper-focused),
.login-page__form :deep(.ant-input:focus) {
  border-color: var(--admin-primary);
  background: var(--admin-surface);
}

/* 浏览器自动填充默认刷一层淡蓝，改回我们的灰底 */
.login-page__form :deep(input:-webkit-autofill) {
  -webkit-text-fill-color: var(--admin-text);
  box-shadow: 0 0 0 1000px var(--admin-surface-muted) inset;
  transition: background-color 9999s ease-out;
}

.login-page__error {
  margin-bottom: 16px;
}

.login-page__form :deep(.ant-btn-primary) {
  margin-top: 8px;
}

.login-page__google {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  font-weight: 500;
}

.login-page__google-icon {
  width: 18px;
  height: 18px;
}

.login-page__divider {
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-xs);
}

.login-page__pending {
  margin-top: 32px;
  text-align: center;
}

.login-page__pending h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}

.login-page__pending p {
  margin: 10px 0 24px;
  color: var(--admin-text-muted);
}

.login-page__copyright {
  position: absolute;
  z-index: 1;
  bottom: 16px;
  left: 0;
  width: 100%;
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-sm);
  text-align: center;
  user-select: none;
}

/* 窄屏：波浪退到背景，表单居中占满 */
@media (max-width: 900px) {
  .login-page__art {
    width: 100%;
    opacity: 0.18;
  }

  .login-page__panel {
    width: 100%;
  }
}

@media (prefers-reduced-motion: reduce) {
  .login-page__blob path {
    animation: none;
  }
}
</style>
