<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import aiAvatarHomeCoreSoftUrl from '@/assets/avatar-olive.webp'
import aiAvatarUrl from '@/assets/avatar-warm.webp'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { useWorkspaceTheme } from '@/hooks/useWorkspaceTheme'

defineProps<{
  role: 'user' | 'agent'
}>()

const { t } = useI18n()
const { workspaceTheme } = useWorkspaceTheme()

const agentAvatarUrl = computed(() => {
  return workspaceTheme.value === 'olive-ember' ? aiAvatarHomeCoreSoftUrl : aiAvatarUrl
})
</script>

<template>
  <article
    class="flex gap-3"
    :class="role === 'user' ? 'justify-end' : 'justify-start'"
  >
    <Avatar
      v-if="role === 'agent'"
      size="lg"
      class="size-10 bg-agent-surface-raised text-white after:border-agent-surface"
    >
      <AvatarImage
        :src="agentAvatarUrl"
        :alt="t('conversation.avatarAlt')"
      />
      <AvatarFallback class="bg-agent-primary text-sm font-black text-white">
        AI
      </AvatarFallback>
    </Avatar>

    <div
      class="min-w-0"
      :class="role === 'user' ? 'max-w-[78%]' : 'max-w-[920px] flex-1'"
    >
      <slot />
    </div>

    <Avatar
      v-if="role === 'user'"
      size="lg"
      class="size-10 bg-agent-primary text-white"
    >
      <AvatarFallback class="bg-agent-primary text-sm font-black text-white">
        D
      </AvatarFallback>
    </Avatar>
  </article>
</template>
