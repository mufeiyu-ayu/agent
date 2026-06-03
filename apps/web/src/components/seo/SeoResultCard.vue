<script setup lang="ts">
import type { CopyableSeoField, GenerateSeoRequest, GenerateSeoResponse } from '../../types/seo'

import { Copy, FileText, Lightbulb, SearchCheck } from '@lucide/vue'

import AgentTraceBar from '../agent/AgentTraceBar.vue'

const props = defineProps<{
  turnId: string
  request: GenerateSeoRequest
  result: GenerateSeoResponse
  copiedItemKey: string | null
}>()

const emit = defineEmits<{
  copy: [turnId: string, field: CopyableSeoField, content: string]
}>()

function buildCopyItemKey(field: CopyableSeoField): string {
  return `${props.turnId}:${field}`
}
</script>

<template>
  <div class="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_54px_rgb(15_23_42/10%)]">
    <div class="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_260px]">
      <div class="min-w-0 divide-y divide-slate-100 px-5 py-2">
        <section class="py-4">
          <div class="mb-3 flex items-center gap-3">
            <span class="grid size-8 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
              <SearchCheck :size="17" />
            </span>
            <h3 class="text-sm font-black text-slate-900">
              SEO Title
            </h3>
            <span class="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-600">
              Recommended
            </span>
          </div>
          <div class="grid grid-cols-[minmax(0,1fr)_80px_40px] items-center gap-3">
            <p class="min-w-0 text-base font-black leading-7 text-slate-950">
              {{ result.title }}
            </p>
            <span class="text-right text-sm font-bold text-slate-400">
              {{ result.title.length }} / 60
            </span>
            <button
              type="button"
              title="Copy SEO title"
              aria-label="Copy SEO title"
              class="grid size-9 place-items-center rounded-lg text-slate-500 transition hover:bg-blue-50 hover:text-blue-600"
              @click="emit('copy', turnId, 'title', result.title)"
            >
              <Copy :size="18" />
            </button>
          </div>
          <p v-if="copiedItemKey === buildCopyItemKey('title')" class="mt-2 text-sm font-semibold text-blue-600">
            Title copied
          </p>
        </section>

        <section class="py-4">
          <div class="mb-3 flex items-center gap-3">
            <span class="grid size-8 place-items-center rounded-lg bg-blue-50 text-blue-600">
              <FileText :size="17" />
            </span>
            <h3 class="text-sm font-black text-slate-900">
              Meta Description
            </h3>
            <span class="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-black text-emerald-600">
              Recommended
            </span>
          </div>
          <div class="grid grid-cols-[minmax(0,1fr)_80px_40px] items-start gap-3">
            <p class="min-w-0 text-sm font-semibold leading-6 text-slate-700">
              {{ result.description }}
            </p>
            <span class="text-right text-sm font-bold text-slate-400">
              {{ result.description.length }} / 160
            </span>
            <button
              type="button"
              title="Copy meta description"
              aria-label="Copy meta description"
              class="grid size-9 place-items-center rounded-lg text-slate-500 transition hover:bg-blue-50 hover:text-blue-600"
              @click="emit('copy', turnId, 'description', result.description)"
            >
              <Copy :size="18" />
            </button>
          </div>
          <p v-if="copiedItemKey === buildCopyItemKey('description')" class="mt-2 text-sm font-semibold text-blue-600">
            Description copied
          </p>
        </section>

        <section class="py-4">
          <div class="mb-3 flex items-center gap-3">
            <span class="grid size-8 place-items-center rounded-lg bg-amber-50 text-amber-600">
              <Lightbulb :size="17" />
            </span>
            <h3 class="text-sm font-black text-slate-900">
              Optimization Suggestions
            </h3>
          </div>
          <ul class="space-y-2">
            <li
              v-for="(suggestion, index) in result.suggestions"
              :key="`${turnId}-${index}-${suggestion}`"
              class="flex min-w-0 items-start gap-3 text-sm font-semibold leading-6 text-slate-700"
            >
              <span class="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-emerald-50 text-xs font-black text-emerald-600">
                {{ index + 1 }}
              </span>
              <span class="min-w-0">{{ suggestion }}</span>
            </li>
          </ul>
        </section>
      </div>

      <aside class="border-t border-slate-200 bg-slate-50/80 px-5 py-5 lg:border-l lg:border-t-0">
        <h3 class="text-sm font-black text-slate-900">
          SEO Snapshot
        </h3>
        <div class="mt-4 space-y-4">
          <div>
            <div class="mb-2 flex items-center justify-between text-xs font-bold text-slate-500">
              <span>Title Length</span>
              <span>{{ result.title.length }} / 60</span>
            </div>
            <div class="h-2 overflow-hidden rounded-full bg-white">
              <div class="h-full rounded-full bg-emerald-500" :style="{ width: `${Math.min(100, result.title.length / 60 * 100)}%` }" />
            </div>
          </div>

          <div>
            <div class="mb-2 flex items-center justify-between text-xs font-bold text-slate-500">
              <span>Description</span>
              <span>{{ result.description.length }} / 160</span>
            </div>
            <div class="h-2 overflow-hidden rounded-full bg-white">
              <div class="h-full rounded-full bg-blue-500" :style="{ width: `${Math.min(100, result.description.length / 160 * 100)}%` }" />
            </div>
          </div>

          <div>
            <div class="mb-2 text-xs font-bold text-slate-500">
              Keyword Context
            </div>
            <div class="flex flex-wrap gap-2">
              <span
                v-for="keyword in request.keywords"
                :key="keyword"
                class="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700"
              >
                {{ keyword }}
              </span>
            </div>
          </div>

          <div class="rounded-xl bg-white px-3 py-3">
            <div class="text-xs font-bold text-slate-400">
              Language
            </div>
            <div class="mt-1 text-sm font-black text-slate-900">
              {{ request.language }}
            </div>
          </div>

          <div v-if="request.model" class="rounded-xl bg-white px-3 py-3">
            <div class="text-xs font-bold text-slate-400">
              Model
            </div>
            <div class="mt-1 break-words text-sm font-black text-slate-900">
              {{ request.model }}
            </div>
          </div>
        </div>
      </aside>
    </div>

    <AgentTraceBar />
  </div>
</template>
