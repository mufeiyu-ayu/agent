<script setup lang="ts">
import type { ChatAttachment } from '@/types/chat'
import { computed, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AttachmentPreviewPanel from '@/components/agent/AttachmentPreviewPanel.vue'
import AppIcon from '@/components/common/AppIcon.vue'
import { useSkills } from '@/hooks/useSkills'

defineProps<{ focusClose?: boolean }>()

const emit = defineEmits<{ close: [] }>()

const { t } = useI18n()

const skills = useSkills()
const selectedPath = ref('SKILL.md')
const file = computed(() => skills.preview.value?.files.find(file => file.path === selectedPath.value) ?? skills.preview.value?.files.find(file => file.path === 'SKILL.md'))
const attachment = shallowRef<ChatAttachment>()

watch(file, (resource, _old, onCleanup) => {
  attachment.value = undefined
  if (!resource)
    return
  const bytes = resource.encoding === 'utf8' ? new TextEncoder().encode(resource.content) : Uint8Array.from(atob(resource.content), character => character.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([bytes], { type: resource.path.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream' }))
  onCleanup(() => URL.revokeObjectURL(url))
  attachment.value = { id: `${skills.preview.value!.fingerprint}:${resource.path}`, kind: 'file', name: resource.path, bytes: bytes.length, url }
}, { immediate: true })
</script>

<template>
  <AttachmentPreviewPanel
    v-if="attachment"
    data-skill-preview-panel
    :attachment="attachment"
    :preview-mode="file?.encoding === 'utf8' ? 'text' : undefined"
    :focus-close="focusClose"
    :full-text="file?.encoding === 'utf8'"
    @close="emit('close')"
  >
    <!-- 仅在多文件或有错误时才展示精简工具条；单文件（如仅 SKILL.md）时不展示多余的下拉框 -->
    <template #toolbar>
      <div
        v-if="(skills.preview.value?.files && skills.preview.value.files.length > 1) || skills.error.value"
        class="border-b border-agent-border-subtle bg-agent-surface px-3 py-2 text-xs"
      >
        <div v-if="skills.preview.value?.files && skills.preview.value.files.length > 1" class="flex items-center gap-2">
          <label for="skill-file-select" class="shrink-0 text-agent-ink-muted">{{ t('skills.switchFile') }}</label>
          <select
            id="skill-file-select"
            v-model="selectedPath"
            class="h-7 min-w-0 flex-1 rounded-md border border-agent-border-subtle bg-agent-surface px-2 text-xs text-agent-ink focus:border-agent-border focus:outline-none"
          >
            <option v-for="resource in skills.preview.value?.files" :key="resource.path" :value="resource.path">
              {{ resource.path }}
            </option>
          </select>
        </div>
        <div v-if="skills.error.value" role="alert" class="mt-1 flex items-center justify-between text-xs text-red-600 dark:text-red-400">
          <span>{{ skills.error.value }}</span>
          <button
            v-if="skills.preview.value"
            :disabled="skills.busy.value"
            class="text-xs underline hover:no-underline"
            @click="skills.showPreview(skills.preview.value, true, 'panel')"
          >
            <span>{{ t('skills.previewAgain') }}</span>
          </button>
        </div>
      </div>
    </template>

    <!-- 高质感、视觉均衡的底部操作栏 -->
    <template #footer>
      <div
        v-if="skills.preview.value"
        class="flex h-12 shrink-0 items-center justify-between border-t border-agent-border-subtle bg-agent-surface-raised px-4"
      >
        <!-- 左侧状态指示 -->
        <div class="flex min-w-0 items-center gap-1.5 text-xs text-agent-ink-muted">
          <template v-if="skills.preview.value.draft">
            <span class="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" />
            <span>{{ t('skills.pendingDraft') }}</span>
          </template>
          <template v-else>
            <span class="inline-block h-1.5 w-1.5 rounded-full bg-agent-moss" />
            <span role="status">{{ t('skills.published') }}</span>
          </template>
        </div>

        <!-- 右侧成组操作按钮 -->
        <div class="flex items-center gap-2">
          <button
            v-if="!skills.preview.value.builtin"
            :disabled="skills.busy.value"
            class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-agent-border-subtle bg-agent-surface px-3 text-agent-ink-soft transition-colors hover:bg-agent-surface-sunken hover:text-agent-ink focus-visible:outline-2 focus-visible:outline-agent-focus disabled:opacity-50"
            @click="skills.openEditor(skills.preview.value)"
          >
            <AppIcon name="tabler:edit" :size="14" class="text-agent-ink-muted" />
            <span class="text-xs font-medium">{{ t('skills.manualEdit') }}</span>
          </button>

          <button
            v-if="skills.preview.value.draft"
            :disabled="skills.busy.value"
            class="inline-flex h-8 items-center gap-1.5 rounded-lg bg-agent-ink px-3.5 text-agent-canvas shadow-xs transition-opacity hover:opacity-90 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-agent-focus disabled:opacity-50"
            @click="skills.publish()"
          >
            <AppIcon v-if="skills.busy.value" name="tabler:loader-2" :size="14" class="animate-spin" />
            <AppIcon v-else name="tabler:upload" :size="14" />
            <span class="text-xs font-medium">{{ skills.busy.value ? t('skills.publishing') : skills.preview.value.published ? t('skills.confirmSkillUpdate') : t('skills.publishToMine') }}</span>
          </button>
        </div>
      </div>
    </template>
  </AttachmentPreviewPanel>
</template>
