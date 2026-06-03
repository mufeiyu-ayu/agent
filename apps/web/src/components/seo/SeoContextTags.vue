<script setup lang="ts">
import { Tag } from '@lucide/vue'

defineProps<{
  keywords: string[]
}>()
</script>

<template>
  <div class="flex min-w-0 flex-wrap items-center gap-2">
    <span
      v-for="keyword in keywords.slice(0, 3)"
      :key="keyword"
      class="inline-flex h-8 items-center gap-2 rounded-lg bg-slate-100 px-3 text-xs font-black text-slate-600"
    >
      <Tag :size="13" />
      {{ keyword }}
    </span>
    <span
      v-if="keywords.length > 3"
      class="inline-flex h-8 items-center rounded-lg bg-slate-100 px-3 text-xs font-black text-slate-500"
    >
      +{{ keywords.length - 3 }}
    </span>
  </div>
</template>
