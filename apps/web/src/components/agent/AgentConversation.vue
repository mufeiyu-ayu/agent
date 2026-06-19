<script setup lang="ts">
import type { SeoConversationTurn } from '../../types/seo'

import { LoaderCircle, Sparkles } from '@lucide/vue'

import { ScrollArea } from '@/components/ui/scroll-area'

import AgentMessage from './AgentMessage.vue'

defineProps<{
  turns: SeoConversationTurn[]
  lastGeneratedAt: string
}>()
</script>

<template>
  <section class="mx-auto flex min-h-0 w-full max-w-[920px] flex-1 flex-col px-4 pt-10">
    <div
      v-if="turns.length === 0"
      class="grid min-h-0 flex-1 place-items-center px-4 py-8"
    >
      <div class="max-w-xl text-center">
        <div class="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-blue-600 text-white shadow-[0_18px_34px_rgb(37_99_235/22%)]">
          <Sparkles :size="26" />
        </div>
        <h3 class="text-2xl font-black text-slate-950">
          Start a SEO conversation
        </h3>
        <p class="mx-auto mt-3 max-w-md text-sm font-medium leading-6 text-slate-500">
          Ask for SEO strategy, page optimization, keyword ideas, content structure, or technical SEO advice.
        </p>
        <div class="mt-6 flex flex-wrap justify-center gap-2">
          <span class="rounded-full bg-white px-4 py-2 text-sm font-bold text-slate-600 shadow-sm">
            帮我诊断一个落地页 SEO
          </span>
          <span class="rounded-full bg-white px-4 py-2 text-sm font-bold text-slate-600 shadow-sm">
            给我一个内容优化计划
          </span>
        </div>
      </div>
    </div>

    <ScrollArea
      v-else
      class="min-h-0 flex-1 pr-1"
    >
      <div class="space-y-7 pb-14 sm:pb-16">
        <template
          v-for="turn in turns"
          :key="turn.id"
        >
          <AgentMessage
            role="user"
          >
            <div class="max-w-[720px] whitespace-pre-wrap rounded-2xl bg-blue-50 px-5 py-3 text-sm font-bold leading-6 text-slate-800 shadow-sm">
              {{ turn.userMessage }}
            </div>
          </AgentMessage>

          <AgentMessage
            role="agent"
          >
            <div
              v-if="turn.status === 'loading'"
              class="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-5 py-4 text-sm font-bold text-slate-600 shadow-sm"
            >
              <LoaderCircle class="animate-spin text-blue-600" :size="18" />
              SEO Agent is thinking...
            </div>

            <div
              v-else-if="turn.status === 'error'"
              class="max-w-[620px] rounded-2xl border border-rose-100 bg-rose-50 px-5 py-4 text-sm font-bold leading-6 text-rose-700"
            >
              {{ turn.errorMessage || 'SEO Agent 暂时无法回复，请稍后重试。' }}
            </div>

            <div
              v-else
              class="max-w-[760px] whitespace-pre-wrap rounded-2xl bg-white px-5 py-4 text-sm font-semibold leading-7 text-slate-800 shadow-sm"
            >
              {{ turn.reply }}
            </div>
          </AgentMessage>
        </template>
      </div>
    </ScrollArea>
  </section>
</template>
