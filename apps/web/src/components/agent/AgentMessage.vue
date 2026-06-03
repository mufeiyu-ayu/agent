<script setup lang="ts">
defineProps<{
  role: 'user' | 'agent'
  name: string
  time: string
}>()
</script>

<template>
  <article
    class="flex gap-3"
    :class="role === 'user' ? 'justify-end' : 'justify-start'"
  >
    <div
      v-if="role === 'agent'"
      class="grid size-10 shrink-0 place-items-center rounded-2xl bg-blue-600 text-sm font-black text-white shadow-[0_14px_26px_rgb(37_99_235/20%)]"
    >
      AI
    </div>

    <div
      class="min-w-0"
      :class="role === 'user' ? 'max-w-[78%]' : 'max-w-[920px] flex-1'"
    >
      <div
        class="mb-2 flex items-center gap-2 text-xs font-bold text-slate-400"
        :class="role === 'user' ? 'justify-end' : 'justify-start'"
      >
        <span class="text-slate-700">{{ name }}</span>
        <span>{{ time }}</span>
      </div>

      <slot />
    </div>

    <div
      v-if="role === 'user'"
      class="grid size-10 shrink-0 place-items-center rounded-full bg-slate-800 text-sm font-black text-white"
    >
      D
    </div>
  </article>
</template>
