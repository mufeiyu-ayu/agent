<script setup lang="ts">
import { CheckCircle2, Circle, LoaderCircle } from '@lucide/vue'

const props = defineProps<{
  message?: string
}>()

const steps = [
  'Building prompt',
  'Calling model',
  'Validating structured result',
  'Preparing final answer',
]

function getStepState(step: string, index: number): 'done' | 'active' | 'pending' {
  const activeIndex = Math.max(0, steps.findIndex(item => item === props.message))

  if (index < activeIndex)
    return 'done'

  if (index === activeIndex)
    return 'active'

  return 'pending'
}
</script>

<template>
  <div class="w-full max-w-[520px] rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_18px_44px_rgb(15_23_42/8%)]">
    <h3 class="mb-3 text-sm font-black text-slate-900">
      Working on your request...
    </h3>

    <div class="space-y-2">
      <div
        v-for="(step, index) in steps"
        :key="step"
        class="flex h-10 items-center justify-between gap-4 rounded-xl px-3 text-sm font-semibold"
        :class="{
          'bg-blue-50 text-blue-700': getStepState(step, index) === 'active',
          'text-slate-700': getStepState(step, index) === 'done',
          'text-slate-400': getStepState(step, index) === 'pending',
        }"
      >
        <span class="flex min-w-0 items-center gap-3">
          <CheckCircle2
            v-if="getStepState(step, index) === 'done'"
            class="shrink-0 text-emerald-500"
            :size="18"
          />
          <LoaderCircle
            v-else-if="getStepState(step, index) === 'active'"
            class="shrink-0 animate-spin text-blue-600"
            :size="18"
          />
          <Circle
            v-else
            class="shrink-0 text-slate-300"
            :size="18"
          />
          <span class="truncate">{{ step }}</span>
        </span>
        <span class="shrink-0 text-xs font-bold">
          {{ getStepState(step, index) === 'active' ? 'In progress' : getStepState(step, index) }}
        </span>
      </div>
    </div>
  </div>
</template>
