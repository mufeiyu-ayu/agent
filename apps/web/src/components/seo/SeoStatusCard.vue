<script setup lang="ts">
defineProps<{
  title: string
  description: string
  completionPercent: number
}>()
</script>

<template>
  <div class="flex items-center gap-4 rounded-[18px] border border-slate-200 bg-white p-3 shadow-[0_14px_34px_rgb(30_41_72/8%)]">
    <div class="relative grid size-14 shrink-0 place-items-center rounded-[18px] bg-blue-50">
      <div class="absolute inset-2 rounded-full border border-blue-200" />
      <div class="absolute inset-4 rounded-full bg-gradient-to-br from-blue-500 to-cyan-300 shadow-[0_0_22px_rgb(59_130_246/42%)]" />
      <div class="relative size-2 rounded-full bg-white" />
    </div>
    <div class="min-w-0 flex-1">
      <div class="flex items-center justify-between gap-3">
        <h3 class="truncate text-sm font-black text-slate-900">
          {{ title }}
        </h3>
        <span class="text-sm font-black text-blue-600">
          {{ completionPercent }}%
        </span>
      </div>
      <p class="mt-1 truncate text-sm font-medium text-slate-500">
        {{ description }}
      </p>
      <div class="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100">
        <div
          class="h-full rounded-full bg-blue-600 transition-all duration-500"
          :style="{ width: `${completionPercent}%` }"
        />
      </div>
    </div>
  </div>
</template>
