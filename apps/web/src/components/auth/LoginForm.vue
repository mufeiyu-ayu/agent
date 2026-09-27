<script setup lang="ts">
import type { ApiErrorResponse, AuthUser, GoogleLoginResult } from '@agent/contracts'
import { isAxiosError } from 'axios'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

import palmUrl from '@/assets/hero-palm.jpg'
import logoUrl from '@/assets/logo.webp'
import AppIcon from '@/components/common/AppIcon.vue'
import { useAuth } from '@/hooks/useAuth'
import { useGoogleClientId, useGoogleRedirect } from '@/hooks/useGoogleLogin'

/**
 * 登录卡片：`/login` 页与首页弹窗共用。左栏是首页首屏的世界（叶影 + 暖光 + 主标语），右栏是表单；
 * 邮箱密码 + Google / Apple（Apple 暂未接入）。成功后由调用方决定去哪。
 */
/** page：独立登录页，卡片铺满整屏（左半屏光影、右半屏表单）；不传则是首页弹窗里的卡片 */
const props = defineProps<{ redirect: string, page?: boolean }>()
const emit = defineEmits<{ success: [user: AuthUser] }>()
/** Google 登录没能直接进站的结果：pending 显示待审核，其余显示失败文案。 */
const notice = defineModel<GoogleLoginResult | null>('notice', { default: null })

const { t } = useI18n()
const { signIn } = useAuth()
const googleClientId = useGoogleClientId()

const email = ref('')
const password = ref('')
const passwordVisible = ref(false)
const error = ref('')
const submitting = ref(false)
const { redirecting, start: startGoogleRedirect } = useGoogleRedirect()

function loginWithGoogle() {
  error.value = ''
  startGoogleRedirect(props.redirect)
}

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

// Apple 登录还没接入：按钮先占位，点了只提示。
function startAppleLogin() {
  notice.value = null
  error.value = t('auth.apple.unavailable')
}
</script>

<template>
  <div class="login-card" :class="{ 'is-page': page }" :style="{ '--palm': `url(${palmUrl})` }">
    <aside class="login-card__window">
      <div class="login-card__glow" aria-hidden="true" />
      <component :is="page ? 'RouterLink' : 'div'" :to="page ? '/' : undefined" class="login-card__brand">
        <img :src="logoUrl" alt="" width="30" height="30">
        Kuro
      </component>
      <div class="login-card__pitch" :aria-hidden="!page">
        <p class="login-card__tagline">
          {{ t('auth.login.tagline') }}
        </p>
        <p class="login-card__note">
          {{ t('auth.login.taglineNote') }}
        </p>
      </div>
      <nav v-if="page" class="login-card__foot">
        <RouterLink to="/">
          {{ t('auth.login.backHome') }}
        </RouterLink>
        <RouterLink to="/privacy">
          {{ t('auth.login.privacy') }}
        </RouterLink>
      </nav>
    </aside>

    <section class="login-card__form">
      <div class="login-card__form-inner">
        <div v-if="notice === 'pending'" role="status">
          <h1 class="login__title">
            {{ t('auth.google.pendingTitle') }}
          </h1>
          <p class="login__subtitle">
            {{ t('auth.google.pendingBody') }}
          </p>
          <button type="button" class="login__button is-ghost is-wide" @click="notice = null">
            {{ t('auth.google.back') }}
          </button>
        </div>

        <form v-else @submit.prevent="submit">
          <h1 class="login__title">
            {{ t('auth.login.title') }}
          </h1>
          <p class="login__subtitle">
            {{ t('auth.login.subtitle') }}
          </p>

          <label class="login__field">
            <span>{{ t('auth.fields.email') }}</span>
            <input v-model="email" type="email" autocomplete="username" required class="login__input" placeholder="name@company.com">
          </label>

          <label class="login__field">
            <span>{{ t('auth.fields.password') }}</span>
            <span class="login__password">
              <input
                v-model="password"
                :type="passwordVisible ? 'text' : 'password'"
                autocomplete="current-password"
                required
                class="login__input"
              >
              <button type="button" class="login__reveal" @click="passwordVisible = !passwordVisible">
                {{ passwordVisible ? t('auth.login.hidePassword') : t('auth.login.showPassword') }}
              </button>
            </span>
          </label>

          <p v-if="error || notice" role="alert" class="login__error">
            <AppIcon name="tabler:alert-circle" :size="16" />
            {{ error || t(`auth.google.${notice}`) }}
          </p>

          <button type="submit" class="login__button is-primary is-wide" :disabled="submitting || redirecting" :aria-busy="submitting">
            <AppIcon v-if="submitting" name="tabler:loader-2" :size="18" class="login__spin" />
            {{ submitting ? t('auth.login.submitting') : t('auth.login.submit') }}
            <AppIcon v-if="!submitting" name="tabler:arrow-right" :size="18" class="login__go" />
          </button>

          <p class="login__divider">
            {{ t('auth.login.otherMethods') }}
          </p>

          <div class="login__socials">
            <button
              v-if="googleClientId"
              type="button"
              class="login__button is-ghost"
              :aria-label="t('auth.google.button')"
              :aria-busy="redirecting"
              :disabled="submitting || redirecting"
              @click="loginWithGoogle"
            >
              <AppIcon v-if="redirecting" name="tabler:loader-2" :size="18" class="login__spin" />
              <AppIcon v-else name="logos:google-icon" :size="18" />
              {{ redirecting ? t('auth.google.redirecting') : 'Google' }}
            </button>
            <button type="button" class="login__button is-ghost" :disabled="submitting || redirecting" @click="startAppleLogin">
              <AppIcon name="logos:apple" :size="18" />
              Apple
            </button>
          </div>
        </form>
      </div>
    </section>
  </div>
</template>

<style scoped>
/* 与首页同一套暖色账本色板（HomeView .home 的 token 镜像） */
.login-card {
  --ground: oklch(0.955 0.007 72);
  --surface: oklch(0.992 0.002 72);
  --surface-2: oklch(0.978 0.004 72);
  --ink: oklch(0.190 0.018 65);
  --ink-2: oklch(0.360 0.016 65);
  --ink-3: oklch(0.530 0.012 65);
  --border-soft: oklch(0.855 0.009 72);
  --primary: oklch(0.205 0.020 65);
  --primary-hover: oklch(0.270 0.024 65);
  --clay: oklch(0.620 0.120 42);
  --rose: oklch(0.620 0.085 22);
  --sage: oklch(0.580 0.060 150);
  --wheat: oklch(0.870 0.085 82);
  --focus: oklch(0.620 0.060 42);

  display: grid;
  grid-template-columns: 5fr 6fr;
  min-height: 560px;
  overflow: hidden;
  border-radius: 16px;
  color: var(--ink);
  background: var(--surface);
  font-family: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  -webkit-font-smoothing: antialiased;
}

.login-card ::selection {
  background: color-mix(in oklch, var(--wheat) 70%, transparent);
}

/* ---------- 左栏：首页首屏的一扇窗 ---------- */
.login-card__window {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 32px;
  background: var(--ground);
}

/* 午后的叶影，缓慢摇曳 */
.login-card__window::before {
  position: absolute;
  inset: -10%;
  background: var(--palm) 30% 20% / cover no-repeat;
  content: '';
  filter: sepia(0.35) brightness(1.08) contrast(1.1);
  mix-blend-mode: multiply;
  opacity: 0.5;
  animation: login-sway 22s ease-in-out infinite alternate;
}

/* 首页首屏同款暖光：wheat / rose / clay / sage 四团柔光 */
.login-card__glow {
  position: absolute;
  inset: 30% -30% -30% -30%;
  pointer-events: none;
  background:
    radial-gradient(38% 52% at 20% 58%, color-mix(in oklch, var(--wheat) 75%, transparent), transparent 72%),
    radial-gradient(34% 48% at 48% 36%, color-mix(in oklch, var(--rose) 42%, transparent), transparent 72%),
    radial-gradient(36% 52% at 80% 60%, color-mix(in oklch, var(--clay) 48%, transparent), transparent 72%),
    radial-gradient(30% 40% at 55% 92%, color-mix(in oklch, var(--sage) 38%, transparent), transparent 72%);
  filter: blur(48px);
  opacity: 0.75;
  animation: login-drift 18s ease-in-out infinite alternate;
}

.login-card__brand {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.025em;
}

.login-card__brand img {
  border-radius: 8px;
}

/* 标语压到左栏底部 */
.login-card__pitch {
  position: relative;
  margin-top: auto;
}

.login-card__tagline {
  margin: 0;
  font-size: 30px;
  font-weight: 600;
  line-height: 1.12;
  letter-spacing: -0.03em;
  text-wrap: balance;
}

.login-card__note {
  max-width: 30ch;
  margin: 14px 0 0;
  color: var(--ink-2);
  font-size: 14.5px;
  line-height: 1.55;
}

@keyframes login-sway {
  from { transform: translate3d(-1.5%, 0, 0) rotate(-0.8deg) scale(1.02); }
  to { transform: translate3d(1.5%, 1%, 0) rotate(0.8deg) scale(1.06); }
}

@keyframes login-drift {
  from { transform: translate3d(-3%, 2%, 0) rotate(-2deg); }
  to { transform: translate3d(3%, -2%, 0) rotate(2deg) scale(1.06); }
}

/* ---------- 右栏：表单 ---------- */
.login-card__form {
  display: flex;
  flex-direction: column;
  justify-content: center;
  padding: 48px 44px 40px;
}

.login__title {
  margin: 0;
  font-size: 26px;
  font-weight: 650;
  letter-spacing: -0.025em;
}

.login__subtitle {
  margin: 8px 0 28px;
  color: var(--ink-3);
  font-size: 15px;
  line-height: 1.5;
}

.login__field {
  display: grid;
  gap: 7px;
  margin-bottom: 16px;
}

.login__field > span:first-child {
  color: var(--ink-2);
  font-size: 13.5px;
  font-weight: 500;
}

.login__password {
  position: relative;
  display: block;
}

.login__input {
  width: 100%;
  height: 48px;
  padding: 0 16px;
  border: 0;
  border-radius: 12px;
  color: var(--ink);
  background: var(--surface-2);
  box-shadow: inset 0 0 0 1px var(--border-soft);
  caret-color: var(--clay);
  font: inherit;
  font-size: 15px;
  outline: none;
  transition: box-shadow 180ms ease, background-color 180ms ease;
}

.login__password .login__input {
  padding-right: 68px;
}

.login__input::placeholder {
  color: oklch(0.6 0.01 65);
}

.login__input:hover {
  box-shadow: inset 0 0 0 1px oklch(0.78 0.012 72);
}

.login__input:focus-visible {
  background: var(--surface);
  box-shadow: inset 0 0 0 1.5px var(--focus), 0 0 0 4px color-mix(in oklch, var(--clay) 16%, transparent);
}

.login__reveal {
  position: absolute;
  top: 50%;
  right: 8px;
  height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  color: var(--ink-3);
  background: transparent;
  cursor: pointer;
  font: inherit;
  font-size: 13px;
  transform: translateY(-50%);
}

.login__reveal:hover {
  color: var(--ink);
  background: oklch(0.19 0.018 65 / 0.05);
}

.login__error {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0 0 14px;
  color: oklch(0.5 0.15 30);
  font-size: 14px;
  line-height: 1.45;
}

.login__error :deep(svg) {
  margin-top: 2px;
}

.login__button {
  display: inline-flex;
  height: 48px;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 0 18px;
  border: 0;
  border-radius: 12px;
  cursor: pointer;
  font: inherit;
  font-size: 15px;
  font-weight: 600;
  transition: transform 250ms cubic-bezier(0.2, 0.8, 0.2, 1), background-color 250ms, box-shadow 250ms;
}

.login__button.is-wide {
  width: 100%;
}

.login__button.is-primary {
  margin-top: 8px;
  color: #fff;
  background: var(--primary);
  box-shadow: 0 14px 30px -12px color-mix(in srgb, var(--primary) 85%, transparent), inset 0 1px 0 rgb(255 255 255 / 25%);
}

.login__button.is-primary:hover {
  background: var(--primary-hover);
  transform: translateY(-1px);
}

.login__button.is-primary:disabled {
  cursor: default;
  opacity: 0.6;
  transform: none;
}

.login__go {
  transition: transform 250ms;
}

.login__button.is-primary:hover .login__go {
  transform: translateX(3px);
}

.login__button.is-ghost {
  color: var(--ink);
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--border-soft), 0 1px 2px rgb(61 49 36 / 4%);
}

.login__button.is-ghost:hover {
  background: var(--surface-2);
}

.login__button.is-ghost:disabled {
  cursor: default;
  color: var(--ink-3);
  background: var(--surface);
}

.login__spin {
  animation: login-spin 0.8s linear infinite;
}

@keyframes login-spin {
  to { transform: rotate(360deg); }
}

.login__button:focus-visible,
.login__reveal:focus-visible {
  outline: 2.5px solid var(--focus);
  outline-offset: 3px;
}

.login__divider {
  display: flex;
  align-items: center;
  gap: 14px;
  margin: 22px 0;
  color: var(--ink-3);
  font-size: 13px;
}

.login__divider::before,
.login__divider::after {
  height: 1px;
  flex: 1;
  background: oklch(0.19 0.018 65 / 0.1);
  content: '';
}

.login__socials {
  display: grid;
  grid-auto-columns: 1fr;
  grid-auto-flow: column;
  gap: 10px;
}

.login-card__form-inner {
  width: 100%;
}

.login-card__brand {
  color: inherit;
  text-decoration: none;
}

/* ---------- 独立登录页：整屏一个连续的光影世界，表单是浮在上面的磨砂纸面板 ---------- */
.login-card.is-page {
  position: relative;
  grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr);
  min-height: 100vh;
  min-height: 100dvh;
  border-radius: 0;
  background: var(--ground);
}

/* 叶影与暖光不再关在左栏里，铺满整屏 */
.is-page .login-card__window {
  position: static;
  overflow: visible;
  padding: clamp(28px, 4vw, 56px);
  background: transparent;
}

.is-page .login-card__window::before {
  inset: -6%;
  background-position: 40% 30%;
  opacity: 0.55;
  -webkit-mask-image: linear-gradient(100deg, #000 40%, rgb(0 0 0 / 35%) 62%, rgb(0 0 0 / 18%) 100%);
  mask-image: linear-gradient(100deg, #000 40%, rgb(0 0 0 / 35%) 62%, rgb(0 0 0 / 18%) 100%);
}

.is-page .login-card__glow {
  inset: 30% 10% -30% -30%;
}

.is-page .login-card__brand,
.is-page .login-card__pitch,
.is-page .login-card__foot {
  z-index: 1;
}

.is-page .login-card__tagline {
  max-width: 17ch;
  font-size: clamp(34px, 3.6vw, 52px);
  line-height: 1.06;
  letter-spacing: -0.035em;
}

.is-page .login-card__note {
  max-width: 36ch;
  margin-top: 18px;
  font-size: 16px;
}

.login-card__foot {
  position: relative;
  display: flex;
  gap: 20px;
  margin-top: 40px;
  font-size: 13.5px;
}

.login-card__foot a {
  color: var(--ink-2);
  text-decoration: none;
  text-underline-offset: 3px;
}

.login-card__foot a:hover {
  color: var(--ink);
  text-decoration: underline;
}

/* 表单直接落在暖色画布上：不做面板，右半屏的叶影淡到只剩一层光感 */
.is-page .login-card__form {
  position: relative;
  z-index: 1;
  align-items: center;
  padding: 48px clamp(24px, 5vw, 72px);
}

.is-page .login-card__form-inner {
  max-width: 400px;
}

.is-page .login__title {
  font-size: 30px;
}

/* 表单控件在暖底上用实心白，层次靠它们自己撑起来 */
.is-page .login__input {
  background: var(--surface);
}

.is-page .login__input:hover {
  background: var(--surface);
}

/* 窄屏：左栏收成顶部一条光影带，只留品牌 */
@media (max-width: 719px) {
  .login-card {
    grid-template-columns: 1fr;
    min-height: 0;
  }

  .login-card__window {
    height: 120px;
    padding: 20px 24px;
  }

  .login-card__pitch {
    display: none;
  }

  .login-card__form {
    padding: 28px 24px 28px;
  }

  .login-card.is-page {
    grid-template-rows: auto 1fr;
  }

  .is-page .login-card__window {
    height: 130px;
    padding: 24px;
  }

  .login-card__foot {
    display: none;
  }

  .is-page .login-card__form {
    align-items: flex-start;
    margin: 0 12px 12px;
    padding: 32px 24px 40px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .login-card__window::before,
  .login-card__glow {
    animation: none;
  }
}
</style>
