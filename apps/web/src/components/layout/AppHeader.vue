<script setup lang="ts">
import { BadgeCheck, BrainCircuit } from '@lucide/vue'
</script>

<template>
  <header class="mb-3 flex shrink-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
    <div class="flex min-w-0 items-center gap-4">
      <div class="grid size-12 shrink-0 place-items-center rounded-[18px] bg-white shadow-[0_12px_30px_rgb(63_105_255/14%)] lg:hidden">
        <BrainCircuit class="text-blue-600" :size="25" />
      </div>
      <div class="min-w-0">
        <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
          <h1 class="text-[27px] font-black leading-tight tracking-normal text-slate-950 sm:text-[31px]">
            AI SEO Agent
          </h1>
          <span class="hidden h-7 w-px bg-slate-200 sm:block" />
          <p class="text-sm font-semibold text-slate-700 sm:text-base">
            工作台
          </p>
          <p class="text-sm font-medium text-slate-500 sm:text-base">
            SEO Workspace
          </p>
        </div>
      </div>
    </div>

    <div class="flex flex-wrap items-center gap-3">
      <div class="flex h-11 items-center gap-3 rounded-full border border-slate-200 bg-white/80 px-5 text-sm font-semibold text-slate-800 shadow-sm">
        <span class="size-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_5px_rgb(16_185_129/12%)]" />
        API: Connected
      </div>
      <div class="flex h-11 items-center gap-3 rounded-full border border-slate-200 bg-white/80 px-5 text-sm font-semibold text-slate-800 shadow-sm">
        <BadgeCheck class="text-blue-600" :size="21" />
        Model: GPT-5.5
      </div>
      <div class="grid size-11 place-items-center rounded-full bg-slate-700 text-lg font-bold text-white shadow-[0_10px_24px_rgb(15_23_42/20%)]">
        D
      </div>
    </div>
  </header>
</template>
