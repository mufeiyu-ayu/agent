<script setup lang="ts">
import type { InkLevel, WorkspaceThemeId } from '@/types/workspace-theme'

import {
  DialogClose,
  DialogContent,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import AppIcon from '@/components/common/AppIcon.vue'
import { useLocale } from '@/hooks/useLocale'
import { useWorkspaceTheme } from '@/hooks/useWorkspaceTheme'

import SettingsSegmented from './SettingsSegmented.vue'

const open = defineModel<boolean>('open', { required: true })

const { t } = useI18n()
const { workspaceTheme, workspaceThemeOptions, updateWorkspaceTheme, inkLevel, inkLevelOptions, updateInkLevel } = useWorkspaceTheme()
const { localeOptions, currentLocale, updateLocale } = useLocale()

const themeOptions = computed(() => workspaceThemeOptions.map(option => ({
  value: option.value,
  label: t(option.shortLabelKey),
  icon: option.icon,
})))
const inkOptions = computed(() => inkLevelOptions.map(value => ({
  value,
  label: t(`layout.settings.inkLevel.options.${value}`),
})))
const languageOptions = computed(() => localeOptions.map(option => ({
  value: option.value,
  label: t(option.labelKey),
})))
</script>

<template>
  <DialogRoot v-model:open="open">
    <DialogPortal>
      <DialogOverlay class="settings-overlay fixed inset-0 z-50 bg-black/40" />
      <!-- 尺寸、间距与层次按 claude.ai 设置弹窗实测值还原 -->
      <DialogContent
        :aria-describedby="undefined"
        class="settings-panel fixed inset-0 z-50 m-auto flex h-[min(800px,calc(100dvh-48px))] w-[min(1024px,calc(100vw-48px))] overflow-hidden rounded-xl text-agent-ink outline-none"
      >
        <nav class="settings-nav hidden w-48 shrink-0 flex-col px-3 pt-4 sm:flex">
          <DialogTitle class="px-2 py-1.5 text-xs text-agent-ink-faint">
            {{ t('layout.settings.title') }}
          </DialogTitle>
          <span aria-current="page" class="settings-nav-item flex h-8 items-center gap-3 rounded-lg pl-2 text-sm font-medium">
            <AppIcon name="tabler:settings" :size="18" />
            {{ t('layout.settings.nav.general') }}
          </span>
        </nav>

        <div class="relative min-w-0 flex-1 overflow-y-auto px-6 pb-10 pt-[60px]">
          <DialogClose
            :aria-label="t('layout.settings.close')"
            class="settings-close absolute right-3 top-3 grid size-8 place-items-center rounded-lg text-agent-ink transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-agent-focus/45"
          >
            <AppIcon name="tabler:x" :size="18" />
          </DialogClose>
          <p class="mb-4 text-base font-semibold sm:hidden" aria-hidden="true">
            {{ t('layout.settings.title') }}
          </p>

          <section>
            <h3 class="mb-4 text-[15px] font-semibold leading-5">
              {{ t('layout.settings.sections.appearance') }}
            </h3>
            <div class="settings-row">
              <span>{{ t('layout.settings.theme.label') }}</span>
              <SettingsSegmented
                :model-value="workspaceTheme"
                :options="themeOptions"
                :group-label="t('layout.settings.theme.label')"
                icon-only
                @update:model-value="updateWorkspaceTheme($event as WorkspaceThemeId)"
              />
            </div>
            <div class="settings-row">
              <span>{{ t('layout.settings.inkLevel.label') }}</span>
              <SettingsSegmented
                :model-value="inkLevel"
                :options="inkOptions"
                :group-label="t('layout.settings.inkLevel.label')"
                @update:model-value="updateInkLevel($event as InkLevel)"
              />
            </div>
          </section>

          <section class="mt-10">
            <h3 class="mb-4 text-[15px] font-semibold leading-5">
              {{ t('layout.settings.sections.language') }}
            </h3>
            <div class="settings-row">
              <span>{{ t('layout.settings.language.label') }}</span>
              <SettingsSegmented
                :model-value="currentLocale"
                :options="languageOptions"
                :group-label="t('layout.settings.language.label')"
                @update:model-value="updateLocale"
              />
            </div>
          </section>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
/*
 * 层次用叠色变量表达，浅色 / 暗色各一组（claude.ai 实测：暗色左栏比内容区深一档、
 * 选中项白 15%、行分割线白 5%、分段槽白 5%、滑块白 10%；浅色左栏偏灰、滑块纯白）。
 * SettingsSegmented 渲染在面板内，直接继承这些变量。
 */
.settings-panel {
  --settings-panel-bg: var(--agent-surface-raised);
  --settings-nav-bg: var(--agent-canvas);
  --settings-selected: color-mix(in oklch, var(--agent-ink) 8%, transparent);
  --settings-divider: color-mix(in oklch, var(--agent-ink) 9%, transparent);
  --settings-track: color-mix(in oklch, var(--agent-ink) 5%, transparent);
  --settings-thumb: var(--agent-surface-raised);
  --settings-edge: color-mix(in oklch, var(--agent-ink) 10%, transparent);

  background: var(--settings-panel-bg);
  box-shadow:
    inset 0 0 0 1px var(--settings-edge),
    0 1px 2px rgb(0 0 0 / 6%),
    0 2px 8px rgb(0 0 0 / 24%);
}

:global([data-agent-workspace-theme='olive-ember']) .settings-panel {
  /* 主题的 surface 在暗处偏棕，右侧改由左栏底色提亮一档，保证两侧同色相 */
  --settings-panel-bg: color-mix(in oklch, var(--agent-surface-sunken), white 4%);
  --settings-nav-bg: var(--agent-surface-sunken);
  --settings-selected: color-mix(in oklch, var(--agent-ink) 15%, transparent);
  --settings-divider: color-mix(in oklch, var(--agent-ink) 6%, transparent);
  --settings-thumb: color-mix(in oklch, var(--agent-ink) 10%, transparent);
}

.settings-nav {
  background: var(--settings-nav-bg);
  border-right: 1px solid var(--settings-edge);
}

.settings-nav-item {
  background: var(--settings-selected);
}

.settings-close:hover {
  background: var(--settings-selected);
}

/* 行与行之间一条分割线；行高固定、不换行，切换语言时文案长短变化不会让布局跳动 */
.settings-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  min-height: 56px;
  padding: 12px 0;
  font-size: 14px;
}

.settings-row + .settings-row {
  border-top: 1px solid var(--settings-divider);
}

.settings-row > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.settings-panel[data-state='open'] {
  animation: settings-panel-in 180ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.settings-panel[data-state='closed'] {
  animation: settings-panel-out 140ms ease-in both;
}

.settings-overlay[data-state='open'] {
  animation: settings-fade-in 180ms ease-out both;
}

.settings-overlay[data-state='closed'] {
  animation: settings-fade-in 140ms ease-in reverse both;
}

@keyframes settings-panel-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
}

@keyframes settings-panel-out {
  to {
    opacity: 0;
    transform: scale(0.96);
  }
}

@keyframes settings-fade-in {
  from { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .settings-panel[data-state='open'],
  .settings-panel[data-state='closed'] {
    animation-name: settings-fade-in;
  }
}
</style>
