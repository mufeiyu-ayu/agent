<script setup lang="ts">
import type { WorkspaceFile } from '@agent/contracts'
import type { TurnRun } from '../../types/chat'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { workspaceArtifacts, workspaceFileType } from '../../utils/workspace-files'
import AppIcon from '../common/AppIcon.vue'

const props = defineProps<{ run: TurnRun, files: WorkspaceFile[], opening: boolean }>()
const emit = defineEmits<{ openFile: [file: WorkspaceFile] }>()
const { t } = useI18n()
const artifacts = computed(() => workspaceArtifacts(props.run, props.files))

function formatBytes(bytes: number) {
  if (bytes < 1024)
    return `${bytes} B`
  return `${(bytes / 1024).toFixed(1)} KB`
}
</script>

<template>
  <section
    v-if="artifacts.length"
    data-workspace-artifact
    class="mt-3.5 min-w-0 max-w-2xl rounded-xl border border-agent-border-soft/80 bg-agent-surface-raised p-1.5 shadow-2xs transition-colors sm:p-2"
  >
    <!-- 单文件场景：紧凑单行交付条，移除多余标题，按钮轻量克制 -->
    <div v-if="artifacts.length === 1" class="flex min-w-0 items-center justify-between gap-2">
      <button
        type="button"
        :disabled="opening"
        :title="artifacts[0]!.path"
        :aria-label="t('workspace.openFile', { path: artifacts[0]!.path })"
        class="group flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1 text-left transition-colors hover:bg-agent-surface focus-visible:outline-2 focus-visible:outline-agent-focus disabled:cursor-wait disabled:opacity-50"
        @click="emit('openFile', artifacts[0]!)"
      >
        <span class="flex size-7 shrink-0 items-center justify-center rounded-md bg-agent-surface-sunken/40 text-agent-ink transition-transform group-hover:scale-105">
          <AppIcon :name="workspaceFileType(artifacts[0]!.path).icon" :size="17" />
        </span>
        <span class="min-w-0 truncate font-mono text-[13px] font-medium text-agent-ink group-hover:text-agent-ink-soft">
          {{ artifacts[0]!.path }}
        </span>
        <span class="shrink-0 text-[11px] tabular-nums text-agent-ink-muted">
          {{ formatBytes(artifacts[0]!.bytes) }}
        </span>
      </button>

      <button
        type="button"
        :disabled="opening"
        :aria-label="t('workspace.openPanel')"
        class="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-agent-border-soft bg-agent-surface px-2.5 text-xs font-medium text-agent-ink-soft shadow-2xs transition-colors hover:border-agent-border hover:bg-agent-surface-raised hover:text-agent-ink focus-visible:outline-2 focus-visible:outline-agent-focus disabled:cursor-wait disabled:opacity-50"
        @click="emit('openFile', artifacts[0]!)"
      >
        <AppIcon name="tabler:layout-columns" :size="14" class="text-agent-ink-muted" />
        <span>{{ t('workspace.openPanel') }}</span>
      </button>
    </div>

    <!-- 多文件场景：紧凑轻量操作栏，清晰条目列表 -->
    <template v-else>
      <header class="mb-1.5 flex items-center justify-between gap-2 px-1 pt-0.5">
        <span class="text-xs font-medium text-agent-ink-muted">
          {{ artifacts.length }} {{ t('workspace.files') }}
        </span>
        <button
          type="button"
          :disabled="opening"
          :aria-label="t('workspace.openPanel')"
          class="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-agent-border-soft bg-agent-surface px-2.5 text-xs font-medium text-agent-ink-soft shadow-2xs transition-colors hover:border-agent-border hover:bg-agent-surface-raised hover:text-agent-ink focus-visible:outline-2 focus-visible:outline-agent-focus disabled:cursor-wait disabled:opacity-50"
          @click="emit('openFile', artifacts[0]!)"
        >
          <AppIcon name="tabler:layout-columns" :size="14" class="text-agent-ink-muted" />
          <span>{{ t('workspace.openPanel') }}</span>
        </button>
      </header>

      <div class="flex flex-col gap-1">
        <button
          v-for="file in artifacts"
          :key="file.path"
          type="button"
          :disabled="opening"
          :title="file.path"
          :aria-label="t('workspace.openFile', { path: file.path })"
          class="group flex min-w-0 items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-agent-surface focus-visible:outline-2 focus-visible:outline-agent-focus disabled:cursor-wait disabled:opacity-50"
          @click="emit('openFile', file)"
        >
          <span class="flex size-7 shrink-0 items-center justify-center rounded-md bg-agent-surface-sunken/40 text-agent-ink transition-transform group-hover:scale-105">
            <AppIcon :name="workspaceFileType(file.path).icon" :size="17" />
          </span>
          <span class="min-w-0 flex-1 truncate font-mono text-[13px] font-medium text-agent-ink group-hover:text-agent-ink-soft">
            {{ file.path }}
          </span>
          <span class="shrink-0 text-[11px] tabular-nums text-agent-ink-muted">
            {{ formatBytes(file.bytes) }}
          </span>
          <AppIcon name="tabler:chevron-right" :size="14" class="shrink-0 text-agent-ink-faint transition-transform group-hover:translate-x-0.5 group-hover:text-agent-ink-muted" />
        </button>
      </div>
    </template>
  </section>
</template>
