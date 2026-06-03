<script setup lang="ts">
import { Plus, Sparkles, X } from '@lucide/vue'
import { computed } from 'vue'

const props = defineProps<{
  pageTopic: string
  keywordInput: string
  keywords: string[]
}>()

const emit = defineEmits<{
  'update:pageTopic': [value: string]
  'update:keywordInput': [value: string]
  'addKeyword': []
  'removeKeyword': [keyword: string]
  'close': []
}>()

const pageTopicModel = computed({
  get: () => props.pageTopic,
  set: value => emit('update:pageTopic', value),
})

const keywordInputModel = computed({
  get: () => props.keywordInput,
  set: value => emit('update:keywordInput', value),
})
</script>

<template>
  <div class="rounded-2xl border border-slate-200 bg-slate-50 p-4 shadow-sm">
    <div class="mb-3 flex items-center justify-between gap-3">
      <div class="inline-flex items-center gap-2 text-sm font-black text-slate-900">
        <Sparkles class="text-blue-600" :size="18" />
        SEO Template
      </div>
      <button
        type="button"
        title="Close template"
        aria-label="Close template"
        class="grid size-9 place-items-center rounded-xl text-slate-500 transition hover:bg-white hover:text-slate-900"
        @click="emit('close')"
      >
        <X :size="18" />
      </button>
    </div>

    <div class="grid gap-3">
      <label class="block">
        <span class="mb-1.5 block text-xs font-black uppercase tracking-normal text-slate-500">
          Page Topic
        </span>
        <input
          v-model="pageTopicModel"
          maxlength="120"
          class="h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-blue-300 focus:ring-4 focus:ring-blue-100"
          placeholder="PUBG UC top-up landing page"
        >
      </label>
    </div>

    <div class="mt-3">
      <span class="mb-1.5 block text-xs font-black uppercase tracking-normal text-slate-500">
        Keywords
      </span>
      <div class="flex flex-wrap gap-2 rounded-xl border border-slate-200 bg-white p-2">
        <span
          v-for="keyword in keywords"
          :key="keyword"
          class="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700"
        >
          {{ keyword }}
          <button
            type="button"
            :aria-label="`Remove ${keyword}`"
            :title="`Remove ${keyword}`"
            class="text-slate-500 transition hover:text-rose-500"
            @click="emit('removeKeyword', keyword)"
          >
            <X :size="15" />
          </button>
        </span>

        <label class="inline-flex h-9 min-w-40 flex-1 items-center gap-2 px-2 text-sm font-semibold text-slate-500">
          <Plus :size="17" />
          <input
            v-model="keywordInputModel"
            class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-slate-400"
            placeholder="Add keyword"
            @keydown.enter.prevent="emit('addKeyword')"
          >
        </label>
      </div>
    </div>
  </div>
</template>
