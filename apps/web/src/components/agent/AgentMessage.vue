<script setup lang="ts">
import aiAvatarUrl from '@/assets/ai-avatar.png'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'

defineProps<{
  role: 'user' | 'agent'
}>()
</script>

<template>
  <article
    class="flex gap-3"
    :class="role === 'user' ? 'justify-end' : 'justify-start'"
  >
    <Avatar
      v-if="role === 'agent'"
      size="lg"
      class="size-10 bg-white text-white shadow-[0_14px_26px_rgb(37_99_235/16%)] after:border-white/80"
    >
      <AvatarImage
        :src="aiAvatarUrl"
        alt="AI assistant avatar"
      />
      <AvatarFallback class="bg-slate-950 text-sm font-black text-white">
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
      class="size-10 bg-slate-800 text-white"
    >
      <AvatarFallback class="bg-slate-800 text-sm font-black text-white">
        D
      </AvatarFallback>
    </Avatar>
  </article>
</template>
