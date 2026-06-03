<script setup lang="ts">
import type { CopyableSeoField, SeoConversationTurn } from '../../types/seo'

import { Clock3, Sparkles } from '@lucide/vue'

import SeoConversationTurnItem from './SeoConversationTurn.vue'

defineProps<{
  lastGeneratedAt: string
  turns: SeoConversationTurn[]
  copiedItemKey: string | null
}>()

const emit = defineEmits<{
  copy: [turnId: string, field: CopyableSeoField, content: string]
}>()

function handleCopy(turnId: string, field: CopyableSeoField, content: string) {
  emit('copy', turnId, field, content)
}
</script>

<template>
  <section class="flex min-h-0 flex-col overflow-hidden p-5">
    <div class="mb-5 flex shrink-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div class="flex items-start gap-3">
        <span class="mt-2 size-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_5px_rgb(16_185_129/12%)]" />
        <div>
          <h2 class="text-base font-black uppercase tracking-normal text-slate-950">
            Results
          </h2>
          <p class="mt-1 text-sm font-medium text-slate-500">
            Session conversation and generated SEO content
          </p>
        </div>
      </div>

      <div class="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-500 shadow-sm">
        <Clock3 :size="18" />
        Last generated: {{ lastGeneratedAt }}
      </div>
    </div>

    <div v-if="turns.length === 0" class="grid min-h-0 flex-1 place-items-center rounded-[22px] border border-dashed border-slate-200 bg-slate-50/70 p-8 text-center">
      <div>
        <div class="mx-auto mb-5 grid size-16 place-items-center rounded-[20px] bg-white text-blue-600 shadow-sm">
          <Sparkles :size="28" />
        </div>
        <h3 class="text-lg font-black text-slate-900">
          Empty
        </h3>
        <p class="mt-2 max-w-sm text-sm font-medium leading-6 text-slate-500">
          Fill in page details and generate SEO content.
        </p>
      </div>
    </div>

    <div v-else class="min-h-0 flex-1 space-y-6 overflow-y-auto pr-1">
      <SeoConversationTurnItem
        v-for="turn in turns"
        :key="turn.id"
        :turn="turn"
        :copied-item-key="copiedItemKey"
        @copy="handleCopy"
      />
    </div>
  </section>
</template>
