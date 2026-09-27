<script setup lang="ts">
import type { AuthUser, GoogleLoginResult } from '@agent/contracts'
import { DialogClose, DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/common/AppIcon.vue'

import LoginForm from './LoginForm.vue'

/** 首页的登录弹窗：复用登录卡片，登录成功直接进工作台，需要改密码则进改密码页。 */
const open = defineModel<boolean>('open', { required: true })
const notice = defineModel<GoogleLoginResult | null>('notice', { default: null })

const { t } = useI18n()
const router = useRouter()

async function enter(user: AuthUser) {
  open.value = false
  await router.push(user.mustChangePassword
    ? { name: 'change-password', query: { redirect: '/workspace' } }
    : '/workspace')
}
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="login-overlay fixed inset-0 z-[70] bg-[oklch(0.3_0.02_65/0.32)] backdrop-blur-[6px]" />
      <DialogContent
        :aria-describedby="undefined"
        class="login-dialog fixed left-1/2 top-1/2 z-[70] max-h-[calc(100dvh-32px)] w-[min(880px,calc(100vw-32px))] overflow-y-auto -translate-x-1/2 -translate-y-1/2 rounded-2xl shadow-[0_40px_80px_-36px_rgb(61_49_36/0.45),0_12px_28px_-14px_rgb(61_49_36/0.2)] outline-none"
      >
        <DialogClose
          :aria-label="t('common.actions.close')"
          class="absolute right-4 top-4 z-10 grid size-8 place-items-center rounded-lg text-[oklch(0.53_0.012_65)] transition hover:text-agent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-agent-focus/45"
        >
          <AppIcon name="tabler:x" :size="18" />
        </DialogClose>
        <!-- 可见标题在表单里；这里只给对话框一个名字，不再多出一个 heading -->
        <DialogTitle as="span" class="sr-only">
          {{ t('auth.login.title') }}
        </DialogTitle>
        <LoginForm v-model:notice="notice" redirect="/workspace" @success="enter" />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
/* 一个入场动作：卡片从轻微下沉、模糊的状态落定 */
.login-dialog[data-state='open'] {
  animation: login-enter 480ms cubic-bezier(0.16, 1, 0.3, 1);
}

.login-overlay[data-state='open'] {
  animation: login-fade 300ms ease-out;
}

/* 居中用的是 Tailwind 的 translate 属性，这里只动 transform，两者叠加不打架 */
@keyframes login-enter {
  from {
    opacity: 0;
    filter: blur(8px);
    transform: translateY(10px) scale(0.97);
  }
}

.login-dialog[data-state='closed'] {
  animation: login-leave 180ms ease-in forwards;
}

.login-overlay[data-state='closed'] {
  animation: login-fade 180ms ease-in reverse forwards;
}

@keyframes login-leave {
  to {
    opacity: 0;
    transform: scale(0.98);
  }
}

@keyframes login-fade {
  from { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .login-dialog[data-state],
  .login-overlay[data-state] {
    animation: none;
  }
}
</style>
