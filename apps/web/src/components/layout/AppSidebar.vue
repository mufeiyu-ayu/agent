<script setup lang="ts">
import type { NavigationItem } from '../../types/seo'

import { BarChart3, FileText, Home, Link2, SearchCheck, Settings, Sun, TrendingUp } from '@lucide/vue'

const navigationItems: NavigationItem[] = [
  { label: 'Workspace', icon: Home, active: true },
  { label: 'Analytics', icon: BarChart3 },
  { label: 'Documents', icon: FileText },
  { label: 'SEO Audit', icon: SearchCheck },
  { label: 'Links', icon: Link2 },
  { label: 'Trends', icon: TrendingUp },
  { label: 'Settings', icon: Settings },
]
</script>

<template>
  <aside class="hidden min-h-0 rounded-[28px] border border-slate-200/80 bg-white/80 p-3 shadow-[0_18px_50px_rgb(25_39_78/10%)] backdrop-blur lg:flex lg:h-full lg:flex-col lg:items-center">
    <div class="mb-6 grid size-14 place-items-center rounded-[20px] bg-white shadow-[0_12px_30px_rgb(63_105_255/15%)]">
      <div class="relative size-8 rounded-full bg-gradient-to-br from-blue-500 via-indigo-500 to-violet-500">
        <div class="absolute left-2 top-1.5 size-4 rounded-full bg-white/80" />
        <div class="absolute bottom-1.5 right-1.5 size-3 rounded-full bg-cyan-300/80" />
      </div>
    </div>

    <nav class="flex flex-1 flex-col items-center gap-3">
      <button
        v-for="item in navigationItems"
        :key="item.label"
        type="button"
        :title="item.label"
        :aria-label="item.label"
        class="grid size-12 place-items-center rounded-[16px] border transition"
        :class="item.active
          ? 'border-blue-100 bg-blue-50 text-blue-600 shadow-[0_12px_24px_rgb(37_99_235/12%)]'
          : 'border-transparent text-slate-500 hover:border-slate-200 hover:bg-white hover:text-blue-600'"
      >
        <component :is="item.icon" :size="22" />
      </button>
    </nav>

    <button
      type="button"
      title="Theme"
      aria-label="Theme"
      class="grid size-12 place-items-center rounded-[16px] bg-slate-100 text-slate-500 transition hover:bg-blue-50 hover:text-blue-600"
    >
      <Sun :size="22" />
    </button>
  </aside>
</template>
