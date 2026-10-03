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
    class="my-2.5 min-w-0 max-w-2xl rounded-xl border border-agent-border-soft/70 bg-agent-surface-raised/40 p-1.5 shadow-2xs transition-colors hover:border-agent-border-soft hover:bg-agent-surface-raised/70 dark:border-white/[0.07] dark:bg-white/[0.02]"
  >
    <!-- 单文件场景：紧凑单行条，图标精致无厚重方框，排版通透 -->
    <div v-if="artifacts.length === 1" class="flex min-w-0 items-center justify-between gap-2">
      <button
        type="button"
        :disabled="opening"
        :title="artifacts[0]!.path"
        :aria-label="t('workspace.openFile', { path: artifacts[0]!.path })"
        class="group flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-1 text-left transition-colors hover:bg-agent-surface/80 focus-visible:outline-2 focus-visible:outline-agent-focus disabled:cursor-wait disabled:opacity-50"
        @click="emit('openFile', artifacts[0]!)"
      >
        <AppIcon :name="workspaceFileType(artifacts[0]!.path).icon" :size="15" class="shrink-0 transition-transform group-hover:scale-105" />
        <span class="min-w-0 truncate font-mono text-[12.5px] font-medium text-agent-ink group-hover:text-agent-ink-soft">
          {{ artifacts[0]!.path }}
        </span>
        <span class="shrink-0 text-[11px] tabular-nums text-agent-ink-muted/80">
          {{ formatBytes(artifacts[0]!.bytes) }}
        </span>
      </button>

      <button
        type="button"
        :disabled="opening"
        :aria-label="t('workspace.openPanel')"
        class="artifact-panel-btn"
        @click="emit('openFile', artifacts[0]!)"
      >
        <AppIcon name="tabler:layout-columns" :size="13" class="panel-btn-icon" />
        <span>{{ t('workspace.openPanel') }}</span>
      </button>
    </div>

    <!-- 多文件场景：轻量标头统计，下方横向优雅流式文件胶囊列表 -->
    <div v-else class="flex min-w-0 flex-col gap-1.5 p-0.5">
      <header class="flex items-center justify-between gap-2 px-1 pt-0.5">
        <div class="flex items-center gap-1.5 text-agent-ink-muted">
          <AppIcon name="tabler:folder-check" :size="13" class="text-agent-accent shrink-0" />
          <span class="text-[11.5px] font-medium text-agent-ink-muted">
            {{ t('workspace.files') }}
            <span class="ml-0.5 tabular-nums text-agent-ink-faint">({{ artifacts.length }})</span>
          </span>
        </div>

        <button
          type="button"
          :disabled="opening"
          :aria-label="t('workspace.openPanel')"
          class="artifact-panel-btn"
          @click="emit('openFile', artifacts[0]!)"
        >
          <AppIcon name="tabler:layout-columns" :size="13" class="panel-btn-icon" />
          <span>{{ t('workspace.openPanel') }}</span>
        </button>
      </header>

      <div class="flex min-w-0 flex-wrap items-center gap-1.5 px-0.5 pb-0.5">
        <button
          v-for="file in artifacts"
          :key="file.path"
          type="button"
          :disabled="opening"
          :title="file.path"
          :aria-label="t('workspace.openFile', { path: file.path })"
          class="group inline-flex h-7 max-w-full items-center gap-1.5 rounded-lg border border-agent-border-soft/60 bg-agent-surface/80 px-2 text-left shadow-2xs transition-all hover:border-agent-border hover:bg-agent-surface hover:shadow-xs focus-visible:outline-2 focus-visible:outline-agent-focus disabled:cursor-wait disabled:opacity-50"
          @click="emit('openFile', file)"
        >
          <AppIcon :name="workspaceFileType(file.path).icon" :size="14" class="shrink-0 transition-transform group-hover:scale-105" />
          <span class="min-w-0 truncate font-mono text-[12px] font-medium text-agent-ink group-hover:text-agent-ink-soft">
            {{ file.path }}
          </span>
          <span class="shrink-0 text-[10.5px] tabular-nums text-agent-ink-muted/80">
            {{ formatBytes(file.bytes) }}
          </span>
        </button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.artifact-panel-btn {
  display: inline-flex;
  height: 25px;
  flex-shrink: 0;
  align-items: center;
  gap: 6px;
  border-radius: 6px;
  border: 1px solid var(--agent-border-soft);
  background: var(--agent-surface-sunken);
  padding: 0 10px;
  font-size: 11.5px;
  font-weight: 500;
  line-height: 1;
  color: var(--agent-ink);
  box-shadow: 0 1px 2px 0 rgb(0 0 0 / 0.04);
  transition: all 160ms cubic-bezier(0.16, 1, 0.3, 1);
  cursor: pointer;
  outline: none;
}

.artifact-panel-btn:focus-visible {
  outline: 2px solid var(--agent-focus);
}

.artifact-panel-btn:hover:not(:disabled) {
  border-color: var(--agent-border);
  background: var(--agent-surface);
  color: var(--agent-ink);
}

.artifact-panel-btn:active:not(:disabled) {
  transform: scale(0.98);
}

.artifact-panel-btn:disabled {
  opacity: 0.5;
  cursor: wait;
}

.panel-btn-icon {
  flex-shrink: 0;
  color: var(--agent-ink-muted);
  transition: color 160ms ease;
}

.artifact-panel-btn:hover:not(:disabled) .panel-btn-icon {
  color: var(--agent-ink);
}

/* 暗色主题衬托：深橄榄余烬微光，边框与图标呼应主题琥珀金色 */
:global([data-agent-workspace-theme='olive-ember']) .artifact-panel-btn {
  border-color: color-mix(in oklch, var(--agent-accent) 30%, var(--agent-border-soft));
  background: color-mix(in oklch, var(--agent-accent) 12%, var(--agent-surface-sunken));
  color: var(--agent-ink-soft);
  box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.25);
}

:global([data-agent-workspace-theme='olive-ember']) .artifact-panel-btn .panel-btn-icon {
  color: var(--agent-accent);
}

:global([data-agent-workspace-theme='olive-ember']) .artifact-panel-btn:hover:not(:disabled) {
  border-color: color-mix(in oklch, var(--agent-accent) 55%, var(--agent-border-soft));
  background: color-mix(in oklch, var(--agent-accent) 20%, var(--agent-surface-sunken));
  color: var(--agent-ink);
}

:global([data-agent-workspace-theme='olive-ember']) .artifact-panel-btn:hover:not(:disabled) .panel-btn-icon {
  color: var(--agent-accent);
}
</style>
