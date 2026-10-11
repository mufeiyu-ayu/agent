<script setup lang="ts">
import {
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogOverlay,
  DialogPortal,
  DialogRoot,
  DialogTitle,
} from 'reka-ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/common/AppIcon.vue'
import AppTooltip from '@/components/common/AppTooltip.vue'
import { useSkills } from '@/hooks/useSkills'
import SkillsList from './SkillsList.vue'

defineProps<{ conversationId: string | null }>()

const { t } = useI18n()

const skills = useSkills()
const selectedPath = ref('SKILL.md')

watch(skills.preview, () => {
  selectedPath.value = 'SKILL.md'
})

const currentSkillName = computed(() => skills.preview.value?.name ?? skills.previewItem.value?.name ?? t('skills.previewTitle'))
const isBuiltin = computed(() => skills.preview.value ? skills.preview.value.builtin : skills.previewItem.value?.builtin)

const file = computed(() => skills.preview.value?.files.find(f => f.path === selectedPath.value))

function download() {
  if (!file.value)
    return
  const content = file.value.encoding === 'utf8'
    ? new TextEncoder().encode(file.value.content)
    : Uint8Array.from(atob(file.value.content), c => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([content], { type: 'application/octet-stream' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.value.path.split('/').at(-1)!
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function handleManualEdit() {
  if (skills.preview.value) {
    const previewItem = skills.preview.value
    skills.dismissPreview()
    skills.openEditor(previewItem)
  }
}
</script>

<template>
  <!-- 技能选择 / 技能草稿弹窗 -->
  <DialogRoot v-model:open="skills.open.value">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[60] bg-black/45 backdrop-blur-xs transition-opacity" />
      <DialogContent
        class="fixed inset-0 z-[60] m-auto flex h-[min(800px,calc(100dvh-32px))] w-[min(900px,calc(100vw-24px))] flex-col overflow-hidden rounded-2xl border border-agent-border-subtle bg-agent-canvas p-6 text-agent-ink shadow-2xl outline-none sm:p-8"
        :aria-describedby="undefined"
      >
        <div class="mb-5 flex items-center justify-between gap-4 border-b border-agent-border-subtle pb-4">
          <DialogTitle class="text-lg font-semibold tracking-tight text-agent-ink">
            {{ t('skills.selectTitle') }}
          </DialogTitle>
          <DialogClose
            :aria-label="t('skills.closeSelection')"
            class="flex h-7 w-7 items-center justify-center rounded-lg text-agent-ink-muted transition-colors hover:bg-agent-surface-sunken hover:text-agent-ink focus-visible:outline-2 focus-visible:outline-agent-focus"
          >
            <AppIcon name="tabler:x" :size="16" />
          </DialogClose>
        </div>
        <div class="min-h-0 flex-1 overflow-y-auto">
          <SkillsList select />
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>

  <!-- 技能预览弹窗（对齐 Setting 缩放淡入动效、弹窗内 Loading、纯源码展示） -->
  <DialogRoot
    :open="skills.previewDialogOpen.value"
    @update:open="!$event && skills.dismissPreview()"
  >
    <DialogPortal>
      <DialogOverlay class="preview-overlay fixed inset-0 z-[70] bg-black/40 backdrop-blur-xs" />
      <DialogContent
        class="preview-panel fixed inset-0 z-[70] m-auto flex h-[min(720px,calc(100dvh-32px))] w-[min(840px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl text-agent-ink outline-none"
        :aria-describedby="undefined"
      >
        <!-- 弹窗 Header -->
        <header class="flex h-13 shrink-0 items-center justify-between border-b border-agent-border-subtle bg-agent-surface-raised px-5">
          <div class="flex min-w-0 items-center gap-3">
            <div class="flex items-center gap-2">
              <AppIcon name="tabler:script" :size="16" class="text-agent-ink-muted" />
              <DialogTitle class="break-all font-mono text-sm font-semibold tracking-tight text-agent-ink">
                {{ currentSkillName }}
              </DialogTitle>
            </div>
            <DialogDescription class="sr-only">
              {{ t('skills.previewDescription') }}
            </DialogDescription>

            <!-- 属性小标签 -->
            <span v-if="isBuiltin !== undefined" class="rounded-md border border-agent-border-subtle bg-agent-surface px-2 py-0.5 text-xs text-agent-ink-muted">
              {{ isBuiltin ? t('skills.builtin') : t('skills.personal') }}
            </span>

            <!-- 草稿小标签（仅当是草稿时展示，已发布不展示） -->
            <span v-if="skills.preview.value?.draft" class="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-600 dark:text-amber-400">
              {{ t('skills.draft') }}
            </span>

            <!-- 多文件切换 -->
            <div v-if="skills.preview.value?.files && skills.preview.value.files.length > 1" class="ml-1 flex items-center gap-1.5">
              <label for="preview-skill-file" class="sr-only">{{ t('skills.switchFile') }}</label>
              <select
                id="preview-skill-file"
                v-model="selectedPath"
                class="h-7 rounded-md border border-agent-border-subtle bg-agent-surface px-2 text-xs font-mono text-agent-ink focus:border-agent-border focus:outline-none"
              >
                <option v-for="resource in skills.preview.value?.files" :key="resource.path" :value="resource.path">
                  {{ resource.path }}
                </option>
              </select>
            </div>
          </div>

          <!-- 右侧操作栏：草稿发布按钮 + 下载图标 + 编辑图标 + 分隔线 + 关闭按钮 -->
          <div class="flex items-center gap-1.5">
            <!-- 草稿发布按钮 -->
            <button
              v-if="skills.preview.value?.draft && !skills.preview.value.builtin"
              :disabled="skills.busy.value"
              class="mr-1 inline-flex h-7 items-center gap-1.5 rounded-lg bg-agent-ink px-2.5 text-agent-canvas shadow-xs transition-opacity hover:opacity-90 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-agent-focus disabled:opacity-50"
              @click="skills.publish()"
            >
              <AppIcon v-if="skills.busy.value" name="tabler:loader-2" :size="13" class="animate-spin" />
              <AppIcon v-else name="tabler:upload" :size="13" />
              <span class="text-xs font-medium">{{ skills.busy.value ? t('skills.publishing') : skills.preview.value.published ? t('skills.confirmUpdate') : t('skills.publish') }}</span>
            </button>

            <!-- 下载文件图标按钮 -->
            <AppTooltip v-if="file" :content="t('skills.download')" side="bottom">
              <button
                type="button"
                :aria-label="t('skills.download')"
                class="flex h-7 w-7 items-center justify-center rounded-lg text-agent-ink-muted transition-colors hover:bg-agent-surface-sunken hover:text-agent-ink focus-visible:outline-2 focus-visible:outline-agent-focus"
                @click="download"
              >
                <AppIcon name="tabler:download" :size="16" />
              </button>
            </AppTooltip>

            <!-- 手动编辑图标按钮 -->
            <AppTooltip v-if="skills.preview.value && !skills.preview.value.builtin" :content="t('skills.manualEdit')" side="bottom">
              <button
                type="button"
                :aria-label="t('skills.manualEdit')"
                :disabled="skills.busy.value"
                class="flex h-7 w-7 items-center justify-center rounded-lg text-agent-ink-muted transition-colors hover:bg-agent-surface-sunken hover:text-agent-ink focus-visible:outline-2 focus-visible:outline-agent-focus disabled:opacity-50"
                @click="handleManualEdit"
              >
                <AppIcon name="tabler:edit" :size="16" />
              </button>
            </AppTooltip>

            <div class="mx-0.5 h-3.5 w-px bg-agent-border-subtle" />

            <!-- 关闭按钮 -->
            <DialogClose
              :aria-label="t('skills.closePreview')"
              class="flex h-7 w-7 items-center justify-center rounded-lg text-agent-ink-muted transition-colors hover:bg-agent-surface-sunken hover:text-agent-ink focus-visible:outline-2 focus-visible:outline-agent-focus"
            >
              <AppIcon name="tabler:x" :size="16" />
            </DialogClose>
          </div>
        </header>

        <!-- 弹窗内容主体 -->
        <div class="flex min-h-0 flex-1 flex-col overflow-hidden bg-agent-canvas">
          <!-- 弹窗内 Loading 状态（Hide and Seek 字符波浪升降动效） -->
          <div v-if="skills.previewLoading.value" class="flex flex-1 items-center justify-center py-28" role="status" :aria-label="t('skills.loadingDefinition')">
            <div class="loader" aria-hidden="true">
              <span class="letter l">L</span>
              <span class="letter o">O</span>
              <span class="letter a">A</span>
              <span class="letter d">D</span>
              <span class="letter ispan i">I</span>
              <span class="letter n">N</span>
              <span class="letter g">G</span>
            </div>
          </div>

          <!-- 加载失败错误提示 -->
          <div v-else-if="skills.error.value && !skills.preview.value" class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <div role="alert" class="rounded-xl border border-red-500/20 bg-red-500/5 px-5 py-4 text-xs text-red-600 dark:text-red-400">
              <p class="font-medium">
                {{ t('skills.loadFailed') }}
              </p>
              <p class="mt-1 text-agent-ink-muted">
                {{ skills.error.value }}
              </p>
              <button
                v-if="skills.previewItem.value"
                class="mt-3 inline-flex items-center gap-1 rounded-md border border-red-500/30 bg-agent-surface px-2.5 py-1 text-xs font-medium text-agent-ink hover:bg-agent-surface-sunken"
                @click="skills.showPreview(skills.previewItem.value, true)"
              >
                <span>{{ t('skills.retry') }}</span>
              </button>
            </div>
          </div>

          <!-- 源码展示主体（无嵌套卡片边框，源码平铺沉浸阅读） -->
          <div v-else class="flex min-h-0 flex-1 flex-col overflow-hidden">
            <!-- 运行期错误条 -->
            <div
              v-if="skills.error.value"
              role="alert"
              class="mx-5 mt-4 flex items-center justify-between rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-600 dark:text-red-400"
            >
              <span>{{ skills.error.value }}</span>
              <button
                v-if="skills.preview.value"
                :disabled="skills.busy.value"
                class="text-xs underline hover:no-underline"
                @click="skills.showPreview(skills.preview.value, true)"
              >
                <span>{{ t('skills.reload') }}</span>
              </button>
            </div>

            <!-- 源码查看容器：直接平铺，无内部边框 -->
            <div v-if="file?.encoding === 'utf8'" class="min-h-0 flex-1 overflow-auto p-5 sm:p-6">
              <pre class="m-0 min-h-full whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-agent-ink-soft select-text">{{ file.content }}</pre>
            </div>

            <!-- 二进制资源提示 -->
            <div v-else class="flex flex-1 flex-col items-center justify-center py-16 text-center text-xs text-agent-ink-muted">
              <AppIcon name="tabler:file-binary" :size="32" class="mb-2 text-agent-ink-faint" />
              <p>{{ t('skills.binaryFile', { path: file?.path ?? '' }) }}</p>
            </div>
          </div>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.preview-panel {
  --preview-panel-bg: var(--agent-surface-raised);
  --preview-edge: color-mix(in oklch, var(--agent-ink) 10%, transparent);

  background: var(--preview-panel-bg);
  box-shadow:
    inset 0 0 0 1px var(--preview-edge),
    0 1px 2px rgb(0 0 0 / 6%),
    0 2px 8px rgb(0 0 0 / 24%);
}

[data-agent-workspace-theme='olive-ember'] .preview-panel {
  --preview-panel-bg: color-mix(in oklch, var(--agent-surface-sunken), white 4%);
}

.preview-panel[data-state='open'] {
  animation: preview-panel-in 180ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.preview-panel[data-state='closed'] {
  animation: preview-panel-out 140ms ease-in both;
}

.preview-overlay[data-state='open'] {
  animation: preview-fade-in 180ms ease-out both;
}

.preview-overlay[data-state='closed'] {
  animation: preview-fade-in 140ms ease-in reverse both;
}

@keyframes preview-panel-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
}

@keyframes preview-panel-out {
  to {
    opacity: 0;
    transform: scale(0.96);
  }
}

@keyframes preview-fade-in {
  from {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .preview-panel[data-state='open'],
  .preview-panel[data-state='closed'] {
    animation-name: preview-fade-in;
  }

  .loader .letter {
    animation: none !important;
    transform: translateY(0) !important;
  }
}

/* 动效：Hide and Seek 3D 立体硬阴影字符波浪动效（100% 还原图 1 效果） */
.loader {
  --ANIMATION-DELAY-MULTIPLIER: 70ms;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  height: 4.5rem;
  overflow: hidden;
  user-select: none;
}

.loader .letter {
  display: inline-block;
  width: fit-content;
  height: 4.5rem;
  line-height: 4.5rem;
  font-family: "Arial Black", Impact, Gadget, system-ui, -apple-system, sans-serif;
  font-size: 3rem;
  font-weight: 900;
  color: #fda4af;
  -webkit-text-stroke: 2px var(--agent-ink);
  text-shadow:
    1px 1px 0 var(--agent-ink),
    2px 2px 0 var(--agent-ink),
    3px 3px 0 var(--agent-ink),
    4px 4px 0 var(--agent-ink),
    5px 5px 0 var(--agent-ink),
    6px 6px 0 var(--agent-ink);
  letter-spacing: -0.01em;
  margin-inline: 1px;
  transform: translateY(5rem);
  animation: hideAndSeek 1s alternate infinite cubic-bezier(0.86, 0, 0.07, 1);
}

.loader .letter:last-child {
  letter-spacing: 0;
}

.loader .i {
  margin-inline: 4px;
}

.loader .l {
  animation-delay: calc(var(--ANIMATION-DELAY-MULTIPLIER) * 0);
}

.loader .o {
  animation-delay: calc(var(--ANIMATION-DELAY-MULTIPLIER) * 1);
}

.loader .a {
  animation-delay: calc(var(--ANIMATION-DELAY-MULTIPLIER) * 2);
}

.loader .d {
  animation-delay: calc(var(--ANIMATION-DELAY-MULTIPLIER) * 3);
}

.loader .ispan {
  animation-delay: calc(var(--ANIMATION-DELAY-MULTIPLIER) * 4);
}

.loader .n {
  animation-delay: calc(var(--ANIMATION-DELAY-MULTIPLIER) * 5);
}

.loader .g {
  animation-delay: calc(var(--ANIMATION-DELAY-MULTIPLIER) * 6);
}

@keyframes hideAndSeek {
  0% {
    transform: translateY(5rem);
  }

  100% {
    transform: translateY(0rem);
  }
}
</style>
