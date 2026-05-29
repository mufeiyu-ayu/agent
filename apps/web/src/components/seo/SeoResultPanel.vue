<script setup lang="ts">
import type { CopyableSeoField, GenerationStatus, SeoCheck } from '../../types/seo'

import { AlertCircle, CheckCircle2, ChevronDown, Clock3, Copy, Info, Sparkles } from '@lucide/vue'

defineProps<{
  status: GenerationStatus
  lastGeneratedAt: string
  seoTitle: string
  metaDescription: string
  titleCharacterCount: number
  descriptionCharacterCount: number
  seoChecks: SeoCheck[]
  copiedField: CopyableSeoField | null
}>()

const emit = defineEmits<{
  copy: [field: CopyableSeoField, content: string]
}>()
</script>

<template>
  <section class="flex min-h-0 flex-col overflow-hidden rounded-[28px] border border-slate-200 bg-white/82 p-5 shadow-[0_22px_55px_rgb(31_42_68/8%)]">
    <div class="mb-5 flex shrink-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div class="flex items-start gap-3">
        <span class="mt-2 size-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_5px_rgb(16_185_129/12%)]" />
        <div>
          <h2 class="text-base font-black uppercase tracking-normal text-slate-950">
            Results
          </h2>
          <p class="mt-1 text-sm font-medium text-slate-500">
            AI-generated SEO content and checks
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
          SEO Checks
          <Info class="text-slate-400" :size="16" />
        </h3>
        <div class="overflow-hidden rounded-[16px] border border-slate-200 bg-white shadow-sm">
          <div
            v-for="check in seoChecks"
            :key="check.label"
            class="grid grid-cols-[minmax(0,1fr)_82px_24px] items-center gap-4 border-b border-slate-100 px-5 py-3 last:border-b-0"
          >
            <div class="flex min-w-0 items-center gap-3">
              <CheckCircle2
                v-if="check.pass"
                class="shrink-0 text-emerald-500"
                :size="20"
              />
              <AlertCircle
                v-else
                class="shrink-0 text-rose-500"
                :size="20"
              />
              <div class="min-w-0">
                <p class="truncate text-sm font-semibold text-slate-900">
                  {{ check.label }}
                </p>
                <p class="mt-1 truncate text-xs font-medium text-slate-400">
                  {{ check.detail }}
                </p>
              </div>
            </div>
            <span
              class="inline-flex h-9 items-center justify-center rounded-full px-4 text-sm font-black"
              :class="check.pass ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'"
            >
              {{ check.pass ? 'Pass' : 'Fix' }}
            </span>
            <ChevronDown class="text-slate-500" :size="18" />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
