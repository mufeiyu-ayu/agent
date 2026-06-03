<script setup lang="ts">
import type { CopyableSeoField, GenerationStatus } from '../../types/seo'

import { Clock3, Copy, Info, Lightbulb, Sparkles } from '@lucide/vue'

defineProps<{
  status: GenerationStatus
  lastGeneratedAt: string
  seoTitle: string
  metaDescription: string
  seoSuggestions: string[]
  titleCharacterCount: number
  descriptionCharacterCount: number
  copiedField: CopyableSeoField | null
}>()

const emit = defineEmits<{
  copy: [field: CopyableSeoField, content: string]
}>()
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
            AI-generated SEO content and suggestions
          </p>
        </div>
      </div>

      <div class="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-500 shadow-sm">
        <Clock3 :size="18" />
        Last generated: {{ lastGeneratedAt }}
      </div>
    </div>

    <div v-if="status === 'empty'" class="grid min-h-0 flex-1 place-items-center rounded-[22px] border border-dashed border-slate-200 bg-slate-50/70 p-8 text-center">
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

    <div v-else class="min-h-0 flex-1 space-y-5 overflow-y-auto pr-1">
      <div>
        <div class="mb-3 flex items-center justify-between gap-4">
          <h3 class="flex items-center gap-2 text-sm font-black text-slate-900">
            SEO Title
            <Info class="text-slate-400" :size="16" />
          </h3>
          <p class="text-sm font-semibold text-slate-500">
            <span class="font-black text-emerald-600">{{ titleCharacterCount }}</span>
            / 60 characters
          </p>
        </div>
        <div class="grid min-h-20 grid-cols-[minmax(0,1fr)_52px] items-center gap-4 rounded-[16px] border border-slate-200 bg-white px-5 py-3 shadow-sm">
          <p class="text-[15px] font-semibold leading-7 text-slate-900">
            {{ seoTitle || 'Waiting for generated title' }}
          </p>
          <button
            type="button"
            title="Copy SEO title"
            aria-label="Copy SEO title"
            class="grid size-11 place-items-center rounded-[14px] border border-slate-200 text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600"
            @click="emit('copy', 'title', seoTitle)"
          >
            <Copy :size="22" />
          </button>
        </div>
        <p v-if="copiedField === 'title'" class="mt-2 text-sm font-semibold text-blue-600">
          Title copied
        </p>
      </div>

      <div>
        <div class="mb-3 flex items-center justify-between gap-4">
          <h3 class="flex items-center gap-2 text-sm font-black text-slate-900">
            Meta Description
            <Info class="text-slate-400" :size="16" />
          </h3>
          <p class="text-sm font-semibold text-slate-500">
            <span class="font-black text-emerald-600">{{ descriptionCharacterCount }}</span>
            / 160 characters
          </p>
        </div>
        <div class="grid min-h-28 grid-cols-[minmax(0,1fr)_52px] items-center gap-4 rounded-[16px] border border-slate-200 bg-white px-5 py-3 shadow-sm">
          <p class="text-[15px] font-semibold leading-7 text-slate-900">
            {{ metaDescription || 'Waiting for generated description' }}
          </p>
          <button
            type="button"
            title="Copy meta description"
            aria-label="Copy meta description"
            class="grid size-11 place-items-center rounded-[14px] border border-slate-200 text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600"
            @click="emit('copy', 'description', metaDescription)"
          >
            <Copy :size="22" />
          </button>
        </div>
        <p v-if="copiedField === 'description'" class="mt-2 text-sm font-semibold text-blue-600">
          Description copied
        </p>
      </div>

      <div>
        <h3 class="mb-4 flex items-center gap-2 text-sm font-black text-slate-900">
          Optimization Suggestions
          <Info class="text-slate-400" :size="16" />
        </h3>
        <div class="space-y-3">
          <div
            v-for="(suggestion, index) in seoSuggestions"
            :key="`${index}-${suggestion}`"
            class="flex min-w-0 items-start gap-3 rounded-lg border border-slate-200 bg-white px-5 py-3 shadow-sm"
          >
            <span class="grid size-8 shrink-0 place-items-center rounded-full bg-amber-50 text-sm font-black text-amber-600">
              {{ index + 1 }}
            </span>
            <p class="min-w-0 text-sm font-semibold leading-6 text-slate-800">
              {{ suggestion }}
            </p>
          </div>

          <div
            v-if="seoSuggestions.length === 0"
            class="flex min-h-16 items-center gap-3 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-5 py-3 text-sm font-semibold text-slate-500"
          >
            <Lightbulb class="shrink-0 text-amber-500" :size="20" />
            Waiting for generated suggestions
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
