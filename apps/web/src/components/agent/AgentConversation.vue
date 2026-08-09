<script setup lang="ts">
import type { SeoConversationTurn } from '../../types/seo'

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/common/AppIcon.vue'
import { useAgentConversationScroll } from '@/hooks/useAgentConversationScroll'
import { useConversationScrollMemory } from '@/hooks/useConversationScrollMemory'

import AgentAssistantReply from './AgentAssistantReply.vue'
import AgentMessage from './AgentMessage.vue'

const props = defineProps<{
  turns: SeoConversationTurn[]
  lastGeneratedAt: string
  isLoadingMessages: boolean
  showEmptyState: boolean
  conversationId: string | null
  anchorLatestTurn: boolean
}>()

const emit = defineEmits<{
  promptSelected: [value: string]
}>()

const { t } = useI18n()
const conversationViewportRef = ref<HTMLElement | null>(null)

const activeTurnId = computed(() => {
  if (!props.anchorLatestTurn)
    return undefined

  return props.turns[props.turns.length - 1]?.id
})

const activeTurnSignature = computed(() => {
  if (!props.anchorLatestTurn)
    return ''

  const activeTurn = props.turns[props.turns.length - 1]

  if (!activeTurn)
    return ''

  return [
    activeTurn.id,
    activeTurn.status,
    activeTurn.generatedAt ?? '',
    activeTurn.reply?.length ?? 0,
    activeTurn.errorMessage?.length ?? 0,
  ].join(':')
})

useAgentConversationScroll({
  viewportRef: conversationViewportRef,
  activeTurnId,
  activeTurnSignature,
  enabled: computed(() => props.anchorLatestTurn),
})

const {
  isRestoringScroll,
} = useConversationScrollMemory({
  viewportRef: conversationViewportRef,
  conversationId: computed(() => props.conversationId),
  canRestore: computed(() => props.turns.length > 0 && !props.anchorLatestTurn),
})

const starterPrompts = computed(() => [
  {
    icon: 'tabler:file-analytics',
    iconClass: 'text-agent-accent',
    label: t('conversation.starterPrompts.audit.label'),
    description: t('conversation.starterPrompts.audit.description'),
    prompt: t('conversation.starterPrompts.audit.prompt'),
  },
  {
    icon: 'tabler:bulb',
    iconClass: 'text-agent-moss',
    label: t('conversation.starterPrompts.keywords.label'),
    description: t('conversation.starterPrompts.keywords.description'),
    prompt: t('conversation.starterPrompts.keywords.prompt'),
  },
  {
    icon: 'tabler:article',
    iconClass: 'text-agent-copper',
    label: t('conversation.starterPrompts.content.label'),
    description: t('conversation.starterPrompts.content.description'),
    prompt: t('conversation.starterPrompts.content.prompt'),
  },
])
</script>

<template>
  <section
    class="relative flex min-h-0 w-full flex-1 flex-col"
  >
    <div
      v-if="turns.length === 0 && showEmptyState"
      class="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-5 pb-8 pt-[72px] sm:px-8"
    >
      <div class="w-full max-w-2xl text-center">
        <div class="mx-auto mb-4 inline-flex items-center justify-center text-agent-accent">
          <AppIcon name="tabler:target-arrow" :size="30" />
        </div>
        <h3 class="text-xl font-extrabold tracking-normal text-agent-ink sm:text-2xl">
          {{ t('conversation.emptyTitle') }}
        </h3>
        <p class="mx-auto mt-2.5 max-w-lg text-[15px] font-medium leading-7 text-agent-ink-muted">
          {{ t('conversation.emptyDescription') }}
        </p>
        <div class="mt-5 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:justify-center">
          <button
            v-for="prompt in starterPrompts"
            :key="prompt.label"
            type="button"
            class="group flex min-h-14 items-center gap-3 rounded-2xl border border-agent-border bg-agent-surface-raised px-4 py-3 text-left transition hover:border-agent-border hover:bg-agent-surface focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-agent-focus/45 sm:min-w-[208px]"
            @click="emit('promptSelected', prompt.prompt)"
          >
            <span
              class="flex size-8 shrink-0 items-center justify-center transition group-hover:text-agent-ink"
              :class="prompt.iconClass"
            >
              <AppIcon :name="prompt.icon" :size="20" />
            </span>
            <span class="min-w-0">
              <span class="block text-sm font-bold text-agent-ink">{{ prompt.label }}</span>
              <span class="mt-0.5 block text-xs font-semibold text-agent-ink-muted">{{ prompt.description }}</span>
            </span>
          </button>
        </div>
      </div>
    </div>

    <div
      v-else-if="turns.length === 0"
      class="min-h-0 flex-1"
      :aria-busy="isLoadingMessages ? 'true' : undefined"
    />

    <div
      v-else
      ref="conversationViewportRef"
      data-agent-conversation-viewport
      class="min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-y-contain"
      :class="isRestoringScroll ? 'invisible' : undefined"
    >
      <div class="mx-auto flex min-h-full w-full max-w-[840px] flex-col px-4 pb-10 pt-[72px] sm:px-5 sm:pb-12">
        <div
          v-if="lastGeneratedAt !== '--:--'"
          class="pb-3 text-right text-xs font-semibold text-agent-ink-muted"
        >
          {{ t('conversation.lastReply', { time: lastGeneratedAt }) }}
        </div>
        <div>
          <div class="space-y-6 sm:space-y-7">
            <template
              v-for="(turn, turnIndex) in turns"
              :key="turn.id"
            >
              <AgentMessage
                role="user"
                :data-agent-user-turn-id="turn.id"
              >
                <div class="max-w-[660px] whitespace-pre-wrap rounded-2xl bg-agent-user-bubble px-4 py-3 text-base font-semibold leading-7 text-agent-user-bubble-text ring-1 ring-agent-user-bubble-border min-[960px]:text-[15px] min-[960px]:leading-6">
                  {{ turn.userMessage }}
                </div>
              </AgentMessage>

              <AgentMessage
                role="agent"
                :class="anchorLatestTurn && turnIndex === turns.length - 1 ? 'min-h-[40dvh]' : undefined"
              >
                <div
                  v-if="(turn.status === 'thinking' || turn.status === 'generating') && !turn.reply"
                  class="inline-flex h-10 items-center justify-center text-agent-ink-muted"
                >
                  <AppIcon name="tabler:loader-2" :size="18" class="animate-spin" />
                </div>

                <template v-else-if="turn.status === 'error'">
                  <AgentAssistantReply
                    v-if="turn.reply && turn.reply !== turn.errorMessage"
                    :text="turn.reply"
                  />
                  <div
                    class="mt-2 inline-flex max-w-[620px] items-start gap-2.5 rounded-2xl border border-agent-copper/30 bg-agent-copper-soft px-4 py-3 text-sm font-semibold leading-6 text-agent-ink-soft"
                  >
                    <AppIcon name="tabler:alert-triangle" :size="18" class="mt-0.5 shrink-0 text-agent-copper" />
                    <span>{{ turn.errorMessage || t('conversation.fallbackError') }}</span>
                  </div>
                </template>

                <template v-else-if="turn.status === 'aborted'">
                  <AgentAssistantReply
                    v-if="turn.reply"
                    :text="turn.reply"
                  />
                  <div
                    class="mt-2 inline-flex max-w-[620px] items-center gap-2 rounded-xl border border-agent-border bg-agent-surface px-3 py-2 text-xs font-bold text-agent-ink-muted"
                  >
                    <AppIcon name="tabler:player-stop" :size="15" class="shrink-0" />
                    <span>{{ t('conversation.aborted') }}</span>
                  </div>
                </template>

                <AgentAssistantReply
                  v-else
                  :text="turn.reply || ''"
                  :is-streaming="turn.status === 'generating'"
                />
              </AgentMessage>
            </template>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
