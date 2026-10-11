<script setup lang="ts">
import { DialogClose, DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { computed, ref, watch } from 'vue'
import { useSkills } from '@/hooks/useSkills'
import SkillsList from './SkillsList.vue'

defineProps<{ conversationId: string | null }>()
const skills = useSkills()
const selectedPath = ref('SKILL.md')
watch(skills.preview, () => {
  selectedPath.value = 'SKILL.md'
})
const file = computed(() => skills.preview.value?.files.find(file => file.path === selectedPath.value))
function download() {
  if (!file.value)
    return
  const content = file.value.encoding === 'utf8' ? new TextEncoder().encode(file.value.content) : Uint8Array.from(atob(file.value.content), c => c.charCodeAt(0))
  const url = URL.createObjectURL(new Blob([content], { type: 'application/octet-stream' }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = file.value.path.split('/').at(-1)!
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
const panelClass = 'fixed inset-0 z-[60] m-auto flex h-[min(800px,calc(100dvh-32px))] w-[min(900px,calc(100vw-24px))] flex-col overflow-auto rounded-2xl bg-agent-canvas p-5 text-agent-ink shadow-xl outline-none sm:p-8'
</script>

<template>
  <DialogRoot v-model:open="skills.open.value">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[60] bg-black/40" />
      <DialogContent :class="panelClass" :aria-describedby="undefined">
        <div class="mb-6 flex items-center justify-between gap-4">
          <DialogTitle class="text-xl font-semibold">
            {{ skills.mode.value === 'select' ? '选择技能' : '技能草稿' }}
          </DialogTitle>
          <DialogClose aria-label="关闭技能选择" class="rounded-lg px-3 py-2">
            关闭
          </DialogClose>
        </div>
        <SkillsList :select="skills.mode.value === 'select'" :drafts="skills.mode.value === 'drafts'" :conversation-id="conversationId" />
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
  <DialogRoot :open="skills.preview.value !== null" @update:open="!$event && (skills.preview.value = null)">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-[70] bg-black/40" />
      <DialogContent class="!z-[70]" :class="[panelClass]" :aria-describedby="undefined">
        <div class="mb-3 flex items-center justify-between gap-4">
          <DialogTitle class="break-all text-xl font-semibold">
            {{ skills.preview.value?.name }}
          </DialogTitle>
          <DialogClose aria-label="关闭技能预览" class="shrink-0 rounded-lg px-3 py-2">
            关闭
          </DialogClose>
        </div>
        <p class="mb-4 text-sm text-agent-ink-muted">
          {{ skills.preview.value?.description }}
        </p>
        <p v-if="skills.error.value" role="alert" class="mb-3 text-red-600">
          {{ skills.error.value }}
        </p>
        <button v-if="skills.error.value && skills.preview.value" :disabled="skills.busy.value" @click="skills.showPreview(skills.preview.value, true)">
          重新预览
        </button>
        <label class="mb-2 text-sm" for="skill-file">技能文件</label>
        <select id="skill-file" v-model="selectedPath" class="mb-3 rounded-lg border border-agent-border bg-agent-surface-raised p-2">
          <option v-for="resource in skills.preview.value?.files" :key="resource.path" :value="resource.path">
            {{ resource.path }}
          </option>
        </select>
        <pre v-if="file?.encoding === 'utf8'" class="min-h-40 flex-1 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-agent-surface-raised p-4 text-sm">{{ file.content }}</pre>
        <p v-else class="flex-1 py-8">
          二进制资源：{{ file?.path }}
        </p>
        <div class="mt-4 flex flex-wrap items-center gap-4">
          <button class="underline underline-offset-4" @click="download">
            下载当前文件
          </button>
          <template v-if="skills.preview.value && !skills.preview.value.builtin">
            <button @click="skills.start(skills.preview.value)">
              继续聊天修改
            </button>
            <button v-if="skills.preview.value.draft" :disabled="skills.busy.value" class="ml-auto rounded-lg bg-agent-ink px-4 py-2 text-agent-canvas disabled:opacity-50" @click="skills.publish()">
              <span>{{ skills.busy.value ? '正在发布…' : skills.preview.value.published ? '确认更新技能' : '发布到我的技能' }}</span>
            </button>
            <p v-else role="status" class="ml-auto text-agent-ink-muted">
              已发布
            </p>
          </template>
        </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
