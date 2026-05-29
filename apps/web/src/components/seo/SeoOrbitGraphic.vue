<script setup lang="ts">
import { BrainCircuit } from '@lucide/vue'
</script>

<template>
  <div class="relative hidden min-h-0 items-center justify-center xl:flex">
    <div class="absolute left-1/2 top-1/2 h-[68%] w-px -translate-x-1/2 -translate-y-1/2 bg-gradient-to-b from-transparent via-blue-300/55 to-transparent" />
    <div class="absolute left-1/2 top-1/2 h-px w-[150px] -translate-x-1/2 -translate-y-1/2 bg-gradient-to-r from-transparent via-blue-300/55 to-transparent" />
    <div class="absolute left-3 top-[28%] size-2 rounded-full bg-blue-500 shadow-[0_0_18px_rgb(59_130_246/70%)]" />
    <div class="absolute right-6 top-[18%] size-2 rounded-full bg-indigo-400" />
    <div class="absolute bottom-[18%] left-7 size-2 rounded-full bg-blue-500" />
    <div class="absolute bottom-[25%] right-3 size-2 rounded-full bg-cyan-400" />
    <div class="relative grid size-36 place-items-center">
      <div class="absolute inset-0 rounded-full border border-blue-100" />
      <div class="absolute inset-4 rounded-full border border-blue-200/80" />
      <div class="absolute inset-8 rounded-full border border-cyan-200/80" />
      <div class="absolute inset-1 rounded-full border border-dashed border-blue-200 animate-spin-slow" />
      <div class="absolute h-16 w-44 rounded-full border border-blue-200/80 animate-spin-slow" />
      <div class="absolute h-44 w-16 rounded-full border border-cyan-200/80 animate-spin-slow" />
      <div class="relative grid size-24 place-items-center rounded-full border border-white bg-gradient-to-br from-blue-600 via-indigo-500 to-cyan-300 shadow-[0_0_55px_rgb(37_99_235/42%)]">
        <BrainCircuit class="text-white" :size="36" />
      </div>
    </div>
  </div>
</template>
