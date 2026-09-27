<script setup lang="ts">
import type { AuthUser, GoogleLoginResult } from '@agent/contracts'
import { DialogClose, DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

import AppIcon from '@/components/common/AppIcon.vue'

import LoginForm from './LoginForm.vue'

/** 首页的登录弹窗：复用登录表单，登录成功直接进工作台，需要改密码则进改密码页。 */
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
      <DialogOverlay class="fixed inset-0 z-[70] bg-black/40" />
      <DialogContent
        :aria-describedby="undefined"
        class="fixed left-1/2 top-1/2 z-[70] w-[min(384px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-agent-border-soft bg-agent-surface-raised p-6 text-agent-ink shadow-lg outline-none"
      >
        <DialogClose
          :aria-label="t('common.actions.close')"
          class="absolute right-3 top-3 grid size-8 place-items-center rounded-lg text-agent-ink-muted transition hover:text-agent-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-agent-focus/45"
        >
          <AppIcon name="tabler:x" :size="18" />
        </DialogClose>
        <DialogTitle class="sr-only">
          {{ t('auth.login.title') }}
        </DialogTitle>
        <LoginForm v-model:notice="notice" redirect="/workspace" @success="enter" />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
