<script setup lang="ts">
import type { CopyableSeoField, SeoConversationTurn } from '../../types/seo'

import { AlertCircle, Bot, Copy, LoaderCircle, User } from '@lucide/vue'

import { formatGeneratedTime } from '../../utils/seo-format'

defineProps<{
  turn: SeoConversationTurn
  copiedItemKey: string | null
}>()

const emit = defineEmits<{
  copy: [turnId: string, field: CopyableSeoField, content: string]
}>()

function getTurnTime(value: string): string {
  return formatGeneratedTime(new Date(value))
}

function buildCopyItemKey(turnId: string, field: CopyableSeoField): string {
  return `${turnId}:${field}`
}
</script>

<template>
  <article class="space-y-3">
    <div class="flex justify-end">
      <div class="max-w-[88%] rounded-[18px] bg-slate-950 px-5 py-4 text-white shadow-sm">
        <div class="mb-3 flex items-center justify-between gap-4">
          <div class="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-300">
            <User :size="15" />
            User
          </div>
          <span class="text-xs font-semibold text-slate-400">
            {{ getTurnTime(turn.createdAt) }}
          </span>
        </div>
        <p class="text-sm font-black leading-6">
          {{ turn.request.pageTopic }}
        </p>
        <p class="mt-1 text-xs font-semibold text-slate-300">
          {{ turn.request.language }}
        </p>
        <div class="mt-3 flex flex-wrap gap-2">
          <span
            v-for="keyword in turn.request.keywords"
            :key="keyword"
            class="rounded-full bg-white/10 px-3 py-1 text-xs font-bold text-slate-100"
          >
            {{ keyword }}
          </span>
        </div>
      </div>
    </div>

    <div class="flex justify-start">
      <div class="max-w-[92%] rounded-[18px] border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div class="mb-4 flex items-center justify-between gap-4">
          <div class="flex items-center gap-2 text-xs font-black uppercase tracking-normal text-slate-500">
            <Bot :size="16" />
            Agent
          </div>
          <span
            class="rounded-full px-3 py-1 text-xs font-black"
            :class="{
              'bg-blue-50 text-blue-600': turn.status === 'loading',
              'bg-emerald-50 text-emerald-600': turn.status === 'success',
              'bg-rose-50 text-rose-600': turn.status === 'error',
            }"
          >
            {{ turn.status }}
          </span>
        </div>

        <div v-if="turn.status === 'loading'" class="flex min-h-24 items-center gap-3 text-sm font-semibold text-slate-500">
          <LoaderCircle class="animate-spin text-blue-600" :size="22" />
          <span>{{ turn.progressMessage || 'Generating SEO content...' }}</span>
        </div>

        <div v-else-if="turn.status === 'error'" class="flex min-h-24 items-start gap-3 rounded-lg bg-rose-50 px-4 py-3 text-sm font-semibold leading-6 text-rose-700">
          <AlertCircle class="mt-0.5 shrink-0" :size="20" />
          {{ turn.errorMessage || 'Failed to generate SEO content. Please try again.' }}
        </div>

        <div v-else-if="turn.result" class="space-y-5">
          <div>
            <div class="mb-2 flex items-center justify-between gap-4">
              <h3 class="text-sm font-black text-slate-900">
                SEO Title
              </h3>
              <p class="text-sm font-semibold text-slate-500">
                <span class="font-black text-emerald-600">{{ turn.result.title.length }}</span>
                / 60 characters
              </p>
            </div>
            <div class="grid min-h-16 grid-cols-[minmax(0,1fr)_44px] items-center gap-3 border-t border-slate-100 pt-3">
              <p class="min-w-0 text-[15px] font-semibold leading-7 text-slate-900">
                {{ turn.result.title }}
              </p>
              <button
                type="button"
                title="Copy SEO title"
                aria-label="Copy SEO title"
                class="grid size-10 place-items-center rounded-[12px] border border-slate-200 text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600"
                @click="emit('copy', turn.id, 'title', turn.result.title)"
              >
                <Copy :size="20" />
              </button>
            </div>
            <p v-if="copiedItemKey === buildCopyItemKey(turn.id, 'title')" class="mt-2 text-sm font-semibold text-blue-600">
              Title copied
            </p>
          </div>

          <div>
            <div class="mb-2 flex items-center justify-between gap-4">
              <h3 class="text-sm font-black text-slate-900">
                Meta Description
              </h3>
              <p class="text-sm font-semibold text-slate-500">
                <span class="font-black text-emerald-600">{{ turn.result.description.length }}</span>
                / 160 characters
              </p>
            </div>
            <div class="grid min-h-20 grid-cols-[minmax(0,1fr)_44px] items-center gap-3 border-t border-slate-100 pt-3">
              <p class="min-w-0 text-[15px] font-semibold leading-7 text-slate-900">
                {{ turn.result.description }}
              </p>
              <button
                type="button"
                title="Copy meta description"
                aria-label="Copy meta description"
                class="grid size-10 place-items-center rounded-[12px] border border-slate-200 text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600"
                @click="emit('copy', turn.id, 'description', turn.result.description)"
              >
                <Copy :size="20" />
              </button>
            </div>
            <p v-if="copiedItemKey === buildCopyItemKey(turn.id, 'description')" class="mt-2 text-sm font-semibold text-blue-600">
              Description copied
            </p>
          </div>

          <div>
            <h3 class="mb-3 border-t border-slate-100 pt-4 text-sm font-black text-slate-900">
              Optimization Suggestions
            </h3>
            <div class="space-y-2">
              <div
                v-for="(suggestion, index) in turn.result.suggestions"
                :key="`${turn.id}-${index}-${suggestion}`"
                class="flex min-w-0 items-start gap-3"
              >
                <span class="grid size-7 shrink-0 place-items-center rounded-full bg-amber-50 text-xs font-black text-amber-600">
                  {{ index + 1 }}
                </span>
                <p class="min-w-0 text-sm font-semibold leading-6 text-slate-800">
                  {{ suggestion }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </article>
</template>
