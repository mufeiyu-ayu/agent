<script setup lang="ts">
import type { AuthUser, GoogleLoginResult } from '@agent/contracts'
import type { OneTapOutcome } from '@/hooks/useGoogleLogin'
import { GOOGLE_LOGIN_RESULTS } from '@agent/contracts'
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import LoginForm from '@/components/auth/LoginForm.vue'
import { useGoogleOneTap } from '@/hooks/useGoogleLogin'
import { safeRedirect } from '@/utils/safe-redirect'

const route = useRoute()
const router = useRouter()
const redirect = computed(() => safeRedirect(route.query.redirect))
// Google 回调没能直接进站时带回 ?google=<GOOGLE_LOGIN_RESULTS 之一>。
const notice = ref<GoogleLoginResult | null>(
  GOOGLE_LOGIN_RESULTS.find(result => result === route.query.google) ?? null,
)

async function enter(user: AuthUser) {
  await router.replace(user.mustChangePassword
    ? { name: 'change-password', query: { redirect: redirect.value } }
    : redirect.value)
}

useGoogleOneTap((outcome: OneTapOutcome) => {
  if ('user' in outcome)
    void enter(outcome.user)
  else
    notice.value = outcome.notice
})
</script>

<template>
  <main class="grid min-h-screen place-items-center bg-agent-canvas px-4 text-agent-ink">
    <div class="w-full max-w-sm rounded-xl border border-agent-border-soft bg-agent-surface-raised p-6 shadow-sm">
      <LoginForm v-model:notice="notice" :redirect="redirect" @success="enter" />
    </div>
  </main>
</template>
