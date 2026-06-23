<script setup lang="ts">
import type { SeoConversationTurn } from '../../types/seo'

import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/common/AppIcon.vue'
import { ScrollArea } from '@/components/ui/scroll-area'
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
const conversationRootRef = ref<HTMLElement | null>(null)

const activeTurnId = computed(() => {
  if (!props.anchorLatestTurn || props.turns.length <= 1)
    return undefined

  return props.turns[props.turns.length - 1]?.id
})

const activeTurnSignature = computed(() => {
  if (!props.anchorLatestTurn)
    return ''

  const activeTurn = props.turns[props.turns.length - 1]

  if (!activeTurn || props.turns.length <= 1)
    return ''

  return [
    activeTurn.id,
    activeTurn.status,
    activeTurn.generatedAt ?? '',
    activeTurn.reply?.length ?? 0,
    activeTurn.errorMessage?.length ?? 0,
  ].join(':')
})

const {
  activeTopSpacerHeight,
  activeTopSpacerStyle,
  activeBottomSpacerHeight,
  activeBottomSpacerStyle,
} = useAgentConversationScroll({
  containerRef: conversationRootRef,
  activeTurnId,
  activeTurnSignature,
  enabled: computed(() => props.anchorLatestTurn),
})

const {
  isRestoringScroll,
} = useConversationScrollMemory({
  containerRef: conversationRootRef,
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
    ref="conversationRootRef"
    class="mx-auto flex min-h-0 w-full max-w-[920px] flex-1 flex-col px-4 pt-5 sm:pt-6"
  >
    <div
      v-if="turns.length === 0 && showEmptyState"
      class="flex min-h-0 flex-1 items-center justify-center px-1 pb-7 pt-5 sm:px-4 sm:pb-9 lg:pb-10"
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

    <ScrollArea
      v-else
      class="min-h-0 flex-1 pr-1"
      :class="isRestoringScroll ? 'invisible' : undefined"
    >
      <div class="py-5 sm:py-6">
        <div
          v-if="lastGeneratedAt !== '--:--'"
          class="pb-3 text-right text-xs font-semibold text-agent-ink-muted"
        >
          {{ t('conversation.lastReply', { time: lastGeneratedAt }) }}
        </div>
        <div class="pb-14 sm:pb-16">
          <div
            v-if="activeTopSpacerHeight > 0"
            :style="activeTopSpacerStyle"
            aria-hidden="true"
          />

          <div class="space-y-6 sm:space-y-7">
            <template
              v-for="turn in turns"
              :key="turn.id"
            >
              <AgentMessage
                role="user"
              >
                <div class="max-w-[720px] whitespace-pre-wrap rounded-2xl bg-agent-user-bubble px-5 py-3.5 text-[17px] font-semibold leading-7 text-agent-user-bubble-text ring-1 ring-agent-user-bubble-border">
                  {{ turn.userMessage }}
                </div>
              </AgentMessage>

              <AgentMessage
                role="agent"
                data-agent-active-turn-anchor="true"
                :data-agent-turn-id="turn.id"
              >
                <div
                  v-if="turn.status === 'loading'"
                  class="inline-flex h-10 items-center justify-center text-agent-ink-muted"
                >
                  <AppIcon name="tabler:loader-2" :size="18" class="animate-spin" />
                </div>

                <div
                  v-else-if="turn.status === 'error'"
                  class="inline-flex max-w-[620px] items-start gap-2.5 rounded-2xl border border-agent-copper/30 bg-agent-copper-soft px-4 py-3 text-sm font-semibold leading-6 text-agent-ink-soft"
                >
                  <AppIcon name="tabler:alert-triangle" :size="18" class="mt-0.5 shrink-0 text-agent-copper" />
                  <span>{{ turn.errorMessage || t('conversation.fallbackError') }}</span>
                </div>

                <AgentAssistantReply
                  v-else
                  :text="turn.reply || ''"
                />
              </AgentMessage>
            </template>
          </div>

          <div
            v-if="activeBottomSpacerHeight > 0"
            :style="activeBottomSpacerStyle"
            aria-hidden="true"
          />
        </div>
      </div>
    </ScrollArea>
  </section>
</template>
