<script setup lang="ts">
import type { CopyableSeoField, SeoConversationTurn } from '../../types/seo'

import { Sparkles } from '@lucide/vue'

import { formatGeneratedTime } from '../../utils/seo-format'
import SeoResultCard from '../seo/SeoResultCard.vue'
import AgentMessage from './AgentMessage.vue'
import AgentProgressCard from './AgentProgressCard.vue'

defineProps<{
  turns: SeoConversationTurn[]
  lastGeneratedAt: string
  copiedItemKey: string | null
}>()

const emit = defineEmits<{
  copy: [turnId: string, field: CopyableSeoField, content: string]
}>()

function getTurnTime(value: string): string {
  return formatGeneratedTime(new Date(value))
}

function shouldShowContext(turn: SeoConversationTurn): boolean {
  return Boolean(turn.instruction && turn.instruction !== turn.request.pageTopic)
}

function handleCopy(turnId: string, field: CopyableSeoField, content: string) {
  emit('copy', turnId, field, content)
}
</script>

<template>
  <section class="mx-auto flex min-h-0 w-full max-w-[1120px] flex-1 flex-col px-4">
    <div class="flex shrink-0 items-center justify-between gap-4 py-4">
      <div>
        <h2 class="text-sm font-black uppercase tracking-normal text-slate-400">
          Conversation
        </h2>
        <p class="mt-1 text-sm font-semibold text-slate-600">
          Generate, refine and review SEO content in one thread.
        </p>
      </div>
      <div class="hidden rounded-full bg-white px-4 py-2 text-sm font-bold text-slate-500 shadow-sm sm:block">
        Last generated: {{ lastGeneratedAt }}
      </div>
    </div>

    <div
      v-if="turns.length === 0"
      class="grid min-h-0 flex-1 place-items-center px-4 py-8"
    >
      <div class="max-w-xl text-center">
        <div class="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-blue-600 text-white shadow-[0_18px_34px_rgb(37_99_235/22%)]">
          <Sparkles :size="26" />
        </div>
        <h3 class="text-2xl font-black text-slate-950">
          Start with an SEO task
        </h3>
        <p class="mx-auto mt-3 max-w-md text-sm font-medium leading-6 text-slate-500">
          Ask the agent to generate a title, meta description and optimization suggestions. Template context is optional.
        </p>
        <div class="mt-6 flex flex-wrap justify-center gap-2">
          <span class="rounded-full bg-white px-4 py-2 text-sm font-bold text-slate-600 shadow-sm">
            Generate a top-up landing page
          </span>
          <span class="rounded-full bg-white px-4 py-2 text-sm font-bold text-slate-600 shadow-sm">
            Make title more conversion-focused
          </span>
        </div>
      </div>
    </div>

    <div
      v-else
      class="min-h-0 flex-1 space-y-7 overflow-y-auto pb-6 pr-1"
    >
      <template
        v-for="turn in turns"
        :key="turn.id"
      >
        <AgentMessage
          role="user"
          name="You"
          :time="getTurnTime(turn.createdAt)"
        >
          <div class="rounded-2xl bg-blue-50 px-5 py-3 text-sm font-bold leading-6 text-slate-800 shadow-sm">
            {{ turn.instruction || turn.request.pageTopic }}
            <div
              v-if="shouldShowContext(turn)"
              class="mt-2 text-xs font-semibold text-slate-500"
            >
              Context: {{ turn.request.pageTopic }}
            </div>
          </div>
        </AgentMessage>

        <AgentMessage
          role="agent"
          name="SEO Agent"
          :time="getTurnTime(turn.createdAt)"
        >
          <AgentProgressCard
            v-if="turn.status === 'loading'"
            :message="turn.progressMessage"
          />

          <div
            v-else-if="turn.status === 'error'"
            class="max-w-[520px] rounded-2xl border border-rose-100 bg-rose-50 px-5 py-4 text-sm font-bold leading-6 text-rose-700"
          >
            {{ turn.errorMessage || 'Failed to generate SEO content. Please try again.' }}
          </div>

          <SeoResultCard
            v-else-if="turn.result"
            :turn-id="turn.id"
            :request="turn.request"
            :result="turn.result"
            :copied-item-key="copiedItemKey"
            @copy="handleCopy"
          />
        </AgentMessage>
      </template>
    </div>
  </section>
</template>
