<script setup lang="ts">
import { ArrowRight, CheckCircle2, FileJson, Sparkles, Wand2 } from '@lucide/vue'

const traceSteps = [
  {
    label: 'Generate',
    detail: 'LLM call',
    icon: Sparkles,
  },
  {
    label: 'Validate',
    detail: 'JSON output',
    icon: FileJson,
  },
  {
    label: 'Finalize',
    detail: 'Render result',
    icon: Wand2,
  },
]
</script>

<template>
  <div class="border-t border-slate-200 bg-slate-50 px-5 py-4">
    <div class="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
      <CheckCircle2 class="text-emerald-500" :size="16" />
      Agent Trace
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <template
        v-for="(step, index) in traceSteps"
        :key="step.label"
      >
        <div class="flex items-center gap-3 rounded-xl bg-white px-3 py-2 shadow-sm">
          <span class="grid size-8 place-items-center rounded-lg bg-blue-50 text-blue-600">
            <component :is="step.icon" :size="16" />
          </span>
          <span>
            <span class="block text-xs font-black text-slate-900">{{ step.label }}</span>
            <span class="block text-xs font-semibold text-slate-400">{{ step.detail }}</span>
          </span>
        </div>
        <ArrowRight
          v-if="index < traceSteps.length - 1"
          class="text-slate-300"
          :size="16"
        />
      </template>
    </div>
  </div>
</template>
