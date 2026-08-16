<script setup lang="ts">
import type { MessageGroundingV1 } from '@agent/contracts'
import type { GroundingTone } from '@/utils/grounding-presenter'

import { computed, ref, useId } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/common/AppIcon.vue'
import { toGroundingView } from '@/utils/grounding-presenter'

import AgentSourceCard from './AgentSourceCard.vue'

const props = defineProps<{
  grounding: MessageGroundingV1
}>()

const TONE_CLASSES: Record<GroundingTone, string> = {
  neutral: 'text-agent-ink-muted',
  caution: 'text-agent-copper',
  warning: 'text-agent-copper',
}

const TONE_ICONS: Record<GroundingTone, string> = {
  neutral: 'tabler:books',
  caution: 'tabler:alert-circle',
  warning: 'tabler:alert-triangle',
}

const { t } = useI18n()
const isExpanded = ref(false)
const sourcesId = useId()

const view = computed(() => toGroundingView(props.grounding))
</script>

<template>
  <section
    v-if="view"
    data-agent-grounding
    class="mt-3 max-w-full rounded-2xl border border-agent-border-soft bg-agent-surface-raised px-3 py-2.5"
  >
    <p
      class="flex items-start gap-2 text-[12px] font-semibold leading-5"
      :class="TONE_CLASSES[view.tone]"
      data-agent-grounding-status
    >
      <AppIcon :name="TONE_ICONS[view.tone]" :size="15" class="mt-0.5" />
      <span class="min-w-0 break-words">{{ t(`conversation.grounding.status.${view.statusKey}`) }}</span>
    </p>

    <p
      v-if="view.noteKey"
      class="mt-1.5 pl-[23px] text-[11px] font-semibold leading-4 text-agent-ink-muted"
      data-agent-grounding-note
    >
      {{ t(`conversation.grounding.note.${view.noteKey}`) }}
    </p>

    <template v-if="view.sources.length > 0">
      <button
        type="button"
        class="mt-2 flex w-full items-center justify-between gap-2 rounded-lg px-1 py-1 text-left text-[12px] font-bold text-agent-ink transition hover:bg-agent-surface-sunken focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-agent-focus/45"
        :aria-expanded="isExpanded"
        :aria-controls="sourcesId"
        data-agent-grounding-toggle
        @click="isExpanded = !isExpanded"
      >
        <span class="min-w-0 break-words">
          {{ t(`conversation.grounding.sources.${view.sourcesKey}`, { count: view.sources.length }) }}
        </span>
        <AppIcon
          name="tabler:chevron-down"
          :size="15"
          class="shrink-0 text-agent-ink-muted transition-transform"
          :class="isExpanded ? 'rotate-180' : undefined"
        />
      </button>

      <!--
        收起时用 v-show 而不是 v-if：aria-controls 必须始终指向真实存在的元素，
        否则辅助技术会拿到一个悬空引用。
      -->
      <ol
        v-show="isExpanded"
        :id="sourcesId"
        class="mt-1.5 flex flex-col gap-1.5"
        data-agent-grounding-sources
      >
        <AgentSourceCard
          v-for="source in view.sources"
          :key="source.citationId"
          :source="source"
        />
      </ol>
    </template>
  </section>
</template>
