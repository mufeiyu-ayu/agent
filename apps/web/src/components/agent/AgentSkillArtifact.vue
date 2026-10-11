<script setup lang="ts">
import type { TurnRun } from '@/types/chat'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/common/AppIcon.vue'

const props = defineProps<{ run: TurnRun, opening: boolean }>()
const emit = defineEmits<{ preview: [id: string] }>()
const { t } = useI18n()
const files = computed(() => [...new Map(props.run.steps.flatMap(step =>
  step.status === 'ok' && step.toolName === 'save_skill_draft' && step.skill ? [[step.skill.id, step.skill] as const] : [])).values()])
</script>

<template>
  <div v-if="files.length" class="my-3 grid max-w-2xl gap-2" data-skill-artifacts>
    <button
      v-for="file in files"
      :key="file.id"
      type="button"
      :disabled="opening"
      :aria-label="t('workspace.previewSkillFile', { name: file.name })"
      class="group flex min-w-0 w-full items-center gap-3 rounded-xl border border-agent-border-soft bg-agent-surface-raised/50 px-4 py-3 text-left transition-colors hover:bg-agent-surface-raised focus-visible:outline-2 focus-visible:outline-agent-focus disabled:cursor-wait disabled:opacity-50"
      @click="emit('preview', file.id)"
    >
      <AppIcon name="tabler:file-description" :size="24" class="shrink-0 text-agent-ink-muted" />
      <span class="min-w-0 flex-1">
        <span class="block text-sm font-medium text-agent-ink">SKILL.md</span>
        <span class="mt-0.5 block truncate text-xs text-agent-ink-muted" :title="file.name">{{ file.name }} · {{ t('workspace.skillFile') }}</span>
      </span>
      <span class="shrink-0 text-xs text-agent-ink-muted">{{ t(opening ? 'workspace.openingSkill' : 'workspace.previewSkill') }}</span>
      <AppIcon name="tabler:chevron-right" :size="16" class="shrink-0 text-agent-ink-muted" />
    </button>
  </div>
</template>
