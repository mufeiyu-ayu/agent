<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import aiAvatarUrl from '@/assets/ai-avatar.png'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

defineProps<{
  role: 'user' | 'agent'
}>()

const { t } = useI18n()
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
        :src="aiAvatarUrl"
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
