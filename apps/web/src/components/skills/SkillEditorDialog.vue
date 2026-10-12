<script setup lang="ts">
import type { SkillResource } from '@agent/contracts'
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
import AgentMarkdownContent from '@/components/agent/AgentMarkdownContent.vue'
import AppIcon from '@/components/common/AppIcon.vue'
import AppTooltip from '@/components/common/AppTooltip.vue'
import { useSkills } from '@/hooks/useSkills'
import { readSkillMarkdown, writeSkillMarkdown } from '@/utils/skill-markdown'

const { t } = useI18n()

const skills = useSkills()

// 复制一份正在编辑的文件列表，避免直接变异源对象
const draftFiles = ref<SkillResource[]>([])
const selectedPath = ref('SKILL.md')
const saveStatus = ref<'idle' | 'saving' | 'saved' | 'publishing' | 'error'>('idle')
const activeMobileTab = ref<'edit' | 'preview'>('edit')

// 技能核心元数据与正文独立响应式状态
const skillName = ref('')
const skillDescription = ref('')
const skillBody = ref('')

let isSyncing = false

// 同步表单内容回 draftFiles 中的 SKILL.md 文件
function syncSkillMarkdownFile() {
  const skillFile = draftFiles.value.find(f => f.path === 'SKILL.md')
  if (skillFile) {
    skillFile.content = writeSkillMarkdown(skillFile.content, skillName.value, skillDescription.value, skillBody.value)
    saveStatus.value = 'idle'
  }
}

// 监听编辑对象变化，初始化文件数据与表单状态
watch(() => skills.editingSkill.value, (skill) => {
  if (skill) {
    draftFiles.value = skill.files.map(f => ({ ...f }))
    selectedPath.value = draftFiles.value.some(f => f.path === 'SKILL.md')
      ? 'SKILL.md'
      : (draftFiles.value[0]?.path ?? 'SKILL.md')
    saveStatus.value = 'idle'
    activeMobileTab.value = 'edit'

    const skillFile = draftFiles.value.find(f => f.path === 'SKILL.md')
    isSyncing = true
    if (skillFile) {
      const parsed = readSkillMarkdown(skillFile.content)
      skillName.value = parsed.name || skill.name || ''
      skillDescription.value = parsed.description || skill.description || ''
      skillBody.value = parsed.body
    }
    else {
      skillName.value = skill.name || ''
      skillDescription.value = skill.description || ''
      skillBody.value = ''
    }
    syncSkillMarkdownFile()
    isSyncing = false
  }
  else {
    draftFiles.value = []
    skillName.value = ''
    skillDescription.value = ''
    skillBody.value = ''
  }
}, { immediate: true })

// 监听表单项变更，自动写回 SKILL.md
watch([skillName, skillDescription, skillBody], () => {
  if (isSyncing)
    return
  syncSkillMarkdownFile()
})

const currentFile = computed(() => draftFiles.value.find(f => f.path === selectedPath.value))

const currentFileContent = computed({
  get: () => currentFile.value?.content ?? '',
  set: (val: string) => {
    if (currentFile.value) {
      currentFile.value.content = val
      saveStatus.value = 'idle'
    }
  },
})

// 校验技能元数据与正文规则
const skillParseResult = computed(() => {
  const skillFile = draftFiles.value.find(f => f.path === 'SKILL.md')
  if (!skillFile || skillFile.encoding !== 'utf8') {
    return { name: '', description: '', body: '', error: t('skills.missingMain') }
  }

  const name = skillName.value
  const description = skillDescription.value.trim()
  const body = skillBody.value

  if (!name)
    return { name, description, body, error: t('skills.nameRequired') }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name) || name.length > 64)
    return { name, description, body, error: t('skills.nameInvalid') }
  if (!description)
    return { name, description, body, error: t('skills.triggerRequired') }
  if (description.length > 1024)
    return { name, description, body, error: t('skills.descriptionTooLong') }
  if (!body.trim())
    return { name, description, body, error: t('skills.bodyRequired') }

  // 检查引用的资源是否存在
  const paths = new Set(draftFiles.value.map(f => f.path))
  for (const refMatch of body.matchAll(/`((?:references|scripts|assets)\/[\w./-]+\.[a-z0-9]+)`/giu)) {
    const p = refMatch[1]!
    if (!paths.has(p))
      return { name, description, body, error: t('skills.missingReference', { path: p }) }
  }

  return { name, description, body, error: undefined }
})

// 当前编辑预览的正文
const previewMarkdown = computed(() => {
  if (selectedPath.value === 'SKILL.md')
    return skillBody.value
  if (currentFile.value?.encoding === 'utf8')
    return currentFile.value.content
  return ''
})

// 行数与统计（完整文件）
const lineCount = computed(() => {
  const content = selectedPath.value === 'SKILL.md'
    ? (draftFiles.value.find(f => f.path === 'SKILL.md')?.content ?? '')
    : currentFileContent.value
  return (content.match(/\n/g)?.length ?? 0) + 1
})
const charCount = computed(() => {
  const content = selectedPath.value === 'SKILL.md'
    ? (draftFiles.value.find(f => f.path === 'SKILL.md')?.content ?? '')
    : currentFileContent.value
  return content.length
})

// Tab 键插入空格
function handleTabKey(e: KeyboardEvent) {
  const textarea = e.target as HTMLTextAreaElement
  const start = textarea.selectionStart
  const end = textarea.selectionEnd
  const value = textarea.value
  textarea.value = `${value.substring(0, start)}  ${value.substring(end)}`
  textarea.selectionStart = textarea.selectionEnd = start + 2
  if (selectedPath.value === 'SKILL.md') {
    skillBody.value = textarea.value
  }
  else {
    currentFileContent.value = textarea.value
  }
}

// 保存草稿
async function handleSaveDraft() {
  if (!skills.editingSkill.value || skills.busy.value || skills.editorOutcomeUnknown.value || skillParseResult.value.error)
    return
  syncSkillMarkdownFile()
  saveStatus.value = 'saving'
  try {
    await skills.saveDraft(skills.editingSkill.value.id, draftFiles.value, skills.editingSkill.value.fingerprint)
    saveStatus.value = 'saved'
    setTimeout(() => {
      if (saveStatus.value === 'saved')
        saveStatus.value = 'idle'
    }, 2500)
  }
  catch {
    saveStatus.value = 'error'
  }
}

// 发布生效
async function handlePublish() {
  if (!skills.editingSkill.value || skills.busy.value || skills.editorOutcomeUnknown.value || skillParseResult.value.error)
    return
  syncSkillMarkdownFile()
  saveStatus.value = 'publishing'
  try {
    await skills.publishEditor(skills.editingSkill.value.id, draftFiles.value, skills.editingSkill.value.fingerprint)
    saveStatus.value = 'idle'
  }
  catch {
    saveStatus.value = 'error'
  }
}

function handleOpenChange(open: boolean) {
  if (!open && (!skills.busy.value || skills.editorLoading.value))
    skills.closeEditor()
}
</script>

<template>
  <DialogRoot :open="skills.editorOpen.value" @update:open="handleOpenChange">
    <DialogPortal>
      <DialogOverlay class="editor-overlay fixed inset-0 z-[70] bg-black/40 backdrop-blur-xs" />
      <DialogContent
        class="editor-panel fixed inset-0 z-[70] m-auto flex h-[min(840px,calc(100dvh-32px))] w-[min(1150px,calc(100vw-24px))] flex-col overflow-hidden rounded-xl text-agent-ink outline-none"
        :aria-describedby="undefined"
      >
        <!-- 顶部 Header -->
        <header class="flex h-13 shrink-0 items-center justify-between border-b border-agent-border-subtle bg-agent-surface-raised px-4 sm:px-6">
          <div class="flex min-w-0 items-center gap-3">
            <div class="flex items-center gap-2">
              <AppIcon name="tabler:code" :size="16" class="text-agent-ink-muted" />
              <DialogTitle class="text-sm font-semibold tracking-tight text-agent-ink">
                {{ skills.editingSkill.value?.id || skills.editorLoading.value ? t('skills.editTitle') : t('skills.create') }}
              </DialogTitle>
            </div>
            <DialogDescription class="sr-only">
              {{ t('skills.editorDescription') }}
            </DialogDescription>

            <!-- 技能标识胶囊 -->
            <span v-if="!skills.editorLoading.value && (skillParseResult.name || skills.editingSkill.value?.name)" class="hidden rounded-md border border-agent-border-subtle bg-agent-surface px-2 py-0.5 font-mono text-xs text-agent-ink-soft sm:inline-block">
              {{ skillParseResult.name || skills.editingSkill.value?.name }}
            </span>

            <!-- 多文件切换 -->
            <div v-if="!skills.editorLoading.value && draftFiles.length > 1" class="ml-2 flex items-center gap-1.5">
              <label for="editor-file-select" class="sr-only">{{ t('skills.chooseFile') }}</label>
              <select
                id="editor-file-select"
                v-model="selectedPath"
                :disabled="skills.busy.value"
                class="h-7 rounded-md border border-agent-border-subtle bg-agent-surface px-2 text-xs font-mono text-agent-ink focus:border-agent-border focus:outline-none"
              >
                <option v-for="file in draftFiles" :key="file.path" :value="file.path">
                  {{ file.path }}
                </option>
              </select>
            </div>
          </div>

          <!-- 窄屏下的 Edit / Preview 切换控制器 -->
          <div v-if="!skills.editorLoading.value" class="flex items-center gap-2 md:hidden">
            <div class="flex rounded-lg border border-agent-border-subtle bg-agent-surface p-0.5 text-xs">
              <button
                class="rounded-md px-2.5 py-1 transition-colors"
                :class="activeMobileTab === 'edit' ? 'bg-agent-surface-sunken font-medium text-agent-ink' : 'text-agent-ink-muted'"
                @click="activeMobileTab = 'edit'"
              >
                <span>{{ t('skills.edit') }}</span>
              </button>
              <button
                class="rounded-md px-2.5 py-1 transition-colors"
                :class="activeMobileTab === 'preview' ? 'bg-agent-surface-sunken font-medium text-agent-ink' : 'text-agent-ink-muted'"
                @click="activeMobileTab = 'preview'"
              >
                <span>{{ t('skills.preview') }}</span>
              </button>
            </div>
          </div>

          <!-- 右侧关闭按钮 -->
          <div class="flex items-center gap-2">
            <DialogClose
              :disabled="skills.busy.value && !skills.editorLoading.value"
              :aria-label="t('skills.closeEditor')"
              class="flex h-7 w-7 items-center justify-center rounded-lg text-agent-ink-muted transition-colors hover:bg-agent-surface-sunken hover:text-agent-ink focus-visible:outline-2 focus-visible:outline-agent-focus"
            >
              <AppIcon name="tabler:x" :size="16" />
            </DialogClose>
          </div>
        </header>

        <!-- 弹窗内 Loading 状态（Hide and Seek 字符波浪升降动效） -->
        <div v-if="skills.editorLoading.value" class="flex flex-1 items-center justify-center py-28" role="status" :aria-label="t('skills.loadingDefinition')">
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
        <div v-else-if="skills.editorError.value && !draftFiles.length" class="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <div role="alert" class="rounded-xl border border-red-500/20 bg-red-500/5 px-5 py-4 text-xs text-red-600 dark:text-red-400">
            <p class="font-medium">
              {{ t('skills.loadFailed') }}
            </p>
            <p class="mt-1 text-agent-ink-muted">
              {{ skills.editorError.value }}
            </p>
          </div>
        </div>

        <!-- 编辑与实时预览核心主体 -->
        <div v-else class="relative flex min-h-0 flex-1 overflow-hidden">
          <!-- 左栏：源码编辑器 -->
          <section
            class="flex flex-1 flex-col border-r border-agent-border-subtle bg-agent-surface"
            :class="{ 'hidden md:flex': activeMobileTab === 'preview' }"
          >
            <!-- 编辑器工具条 -->
            <div class="flex h-8 shrink-0 items-center justify-between border-b border-agent-border-subtle/60 px-4 text-[11px] text-agent-ink-muted">
              <span class="font-mono">{{ selectedPath }}</span>
              <div class="flex items-center gap-3 font-mono">
                <span>{{ t('skills.lines', { count: lineCount }) }}</span>
                <span>{{ t('skills.characters', { count: charCount }) }}</span>
              </div>
            </div>

            <!-- 编辑器主体内容 -->
            <template v-if="selectedPath === 'SKILL.md'">
              <!-- 结构化元数据区域 -->
              <div class="flex shrink-0 flex-col gap-3.5 border-b border-agent-border-subtle/80 bg-agent-surface-raised/40 p-4">
                <!-- 技能标识 -->
                <div class="flex flex-col gap-1.5">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-1.5">
                      <label for="skill-name" class="cursor-pointer text-[11px] font-medium text-agent-ink">
                        {{ t('skills.identifier') }}
                      </label>
                      <AppTooltip :content="t('skills.nameHelp')" side="top" multiline>
                        <button
                          type="button"
                          :aria-label="t('skills.nameHelpLabel')"
                          class="inline-flex h-4 w-4 items-center justify-center rounded-full text-agent-ink-muted transition-colors hover:bg-agent-surface-sunken hover:text-agent-ink focus-visible:outline-2 focus-visible:outline-agent-focus"
                        >
                          <AppIcon name="tabler:help-circle" :size="13" />
                        </button>
                      </AppTooltip>
                    </div>
                    <span class="font-mono text-[10px] text-agent-ink-muted">{{ skillName.length }}/64</span>
                  </div>
                  <input
                    id="skill-name"
                    v-model="skillName"
                    :disabled="skills.busy.value"
                    type="text"
                    maxlength="64"
                    :placeholder="t('skills.namePlaceholder')"
                    class="h-8 w-full rounded-lg border border-agent-border-subtle bg-agent-surface px-2.5 font-mono text-[11px] text-agent-ink placeholder:text-agent-ink-faint focus:border-agent-border focus:outline-none transition-colors"
                    spellcheck="false"
                  >
                </div>

                <!-- 触发场景描述 -->
                <div class="flex flex-col gap-1.5">
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-1.5">
                      <label for="skill-desc" class="cursor-pointer text-[11px] font-medium text-agent-ink">
                        {{ t('skills.trigger') }}
                      </label>
                      <AppTooltip :content="t('skills.triggerHelp')" side="top" multiline>
                        <button
                          type="button"
                          :aria-label="t('skills.triggerHelpLabel')"
                          class="inline-flex h-4 w-4 items-center justify-center rounded-full text-agent-ink-muted transition-colors hover:bg-agent-surface-sunken hover:text-agent-ink focus-visible:outline-2 focus-visible:outline-agent-focus"
                        >
                          <AppIcon name="tabler:help-circle" :size="13" />
                        </button>
                      </AppTooltip>
                    </div>
                    <span class="font-mono text-[10px] text-agent-ink-muted">{{ skillDescription.length }}/1024</span>
                  </div>
                  <textarea
                    id="skill-desc"
                    v-model="skillDescription"
                    :disabled="skills.busy.value"
                    rows="2"
                    maxlength="1024"
                    :placeholder="t('skills.triggerPlaceholder')"
                    class="w-full resize-none rounded-lg border border-agent-border-subtle bg-agent-surface p-2 text-[11px] leading-relaxed text-agent-ink placeholder:text-agent-ink-faint focus:border-agent-border focus:outline-none transition-colors"
                    spellcheck="false"
                  />
                </div>
              </div>

              <!-- 正文指令输入框 -->
              <div class="flex min-h-0 flex-1 flex-col">
                <div class="flex h-7 shrink-0 items-center justify-between border-b border-agent-border-subtle/50 bg-agent-surface/60 px-4 text-[11px] text-agent-ink-muted">
                  <div class="flex items-center gap-1.5">
                    <label for="skill-body" class="cursor-pointer font-medium">{{ t('skills.instructions') }}</label>
                    <AppTooltip :content="t('skills.bodyHelp')" side="top" multiline>
                      <button
                        type="button"
                        :aria-label="t('skills.bodyHelpLabel')"
                        class="inline-flex h-4 w-4 items-center justify-center rounded-full text-agent-ink-muted transition-colors hover:bg-agent-surface-sunken hover:text-agent-ink focus-visible:outline-2 focus-visible:outline-agent-focus"
                      >
                        <AppIcon name="tabler:help-circle" :size="12" />
                      </button>
                    </AppTooltip>
                  </div>
                  <span class="text-[10px] text-agent-ink-faint">{{ t('skills.markdownHint') }}</span>
                </div>
                <div class="relative min-h-0 flex-1">
                  <textarea
                    id="skill-body"
                    v-model="skillBody"
                    :disabled="skills.busy.value"
                    class="h-full w-full resize-none bg-transparent p-4 font-mono text-[11px] leading-relaxed text-agent-ink placeholder:text-agent-ink-faint focus:outline-none"
                    :placeholder="t('skills.bodyPlaceholder')"
                    spellcheck="false"
                    @keydown.tab.prevent="handleTabKey"
                  />
                </div>
              </div>
            </template>

            <!-- 非 SKILL.md 普通文件编辑器 -->
            <div v-else class="relative min-h-0 flex-1">
              <textarea
                v-model="currentFileContent"
                :disabled="skills.busy.value"
                class="h-full w-full resize-none bg-transparent p-4 font-mono text-[11px] leading-relaxed text-agent-ink placeholder:text-agent-ink-faint focus:outline-none"
                :placeholder="t('skills.filePlaceholder')"
                spellcheck="false"
                @keydown.tab.prevent="handleTabKey"
              />
            </div>
          </section>

          <!-- 右栏：实时 Markdown 渲染预览 -->
          <section
            class="flex flex-1 flex-col overflow-hidden bg-agent-canvas"
            :class="{ 'hidden md:flex': activeMobileTab === 'edit' }"
          >
            <!-- 预览顶栏 -->
            <div class="flex h-8 shrink-0 items-center justify-between border-b border-agent-border-subtle/60 bg-agent-surface-raised/40 px-4 text-[11px] text-agent-ink-muted">
              <div class="flex items-center gap-1.5">
                <AppIcon name="tabler:eye" :size="13" />
                <span>{{ t('skills.livePreview') }}</span>
              </div>
              <span v-if="selectedPath === 'SKILL.md'" class="text-[11px] opacity-75">
                {{ skillParseResult.name ? t('skills.skillName', { name: skillParseResult.name }) : '' }}
              </span>
            </div>

            <!-- 预览渲染内容容器 -->
            <div class="editor-markdown-view min-h-0 flex-1 overflow-y-auto px-6 py-5">
              <!-- SKILL.md 元数据卡片预览 -->
              <div
                v-if="selectedPath === 'SKILL.md' && (skillParseResult.name || skillParseResult.description)"
                class="mb-5 rounded-lg border border-agent-border-subtle bg-agent-surface p-3.5"
              >
                <div class="flex items-center gap-2">
                  <span class="text-[11px] font-semibold text-agent-ink">{{ skillParseResult.name }}</span>
                  <span class="text-[10px] text-agent-ink-muted">{{ t('skills.metadata') }}</span>
                </div>
                <p class="mt-1 text-[11px] leading-relaxed text-agent-ink-muted">
                  {{ skillParseResult.description }}
                </p>
              </div>

              <!-- 正文渲染 -->
              <AgentMarkdownContent
                v-if="previewMarkdown"
                :text="previewMarkdown"
              />
              <div v-else class="py-12 text-center text-[11px] text-agent-ink-faint">
                {{ t('skills.emptyBody') }}
              </div>
            </div>
          </section>
        </div>

        <!-- 底部 Footer：校验状态与操作按钮 -->
        <footer v-if="!skills.editorLoading.value && (!skills.editorError.value || draftFiles.length)" class="flex h-12 shrink-0 items-center justify-between border-t border-agent-border-subtle bg-agent-surface-raised px-4 sm:px-6">
          <!-- 左侧：实时校验与保存状态提示 -->
          <div class="flex min-w-0 items-center gap-2 text-xs">
            <template v-if="skillParseResult.error">
              <span class="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
              <span class="truncate text-amber-600 dark:text-amber-400">{{ skillParseResult.error }}</span>
            </template>
            <template v-else-if="skills.editorError.value">
              <span class="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
              <span class="truncate text-red-600 dark:text-red-400">{{ skills.editorError.value }}</span>
              <button v-if="skills.editorOutcomeUnknown.value" class="shrink-0 underline" @click="skills.closeEditor(); skills.reload()">
                {{ t('skills.reload') }}
              </button>
            </template>
            <template v-else-if="saveStatus === 'saved'">
              <span class="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-agent-moss" />
              <span class="text-agent-moss">{{ t('skills.draftSaved') }}</span>
            </template>
            <template v-else-if="saveStatus === 'saving'">
              <AppIcon name="tabler:loader-2" :size="13" class="animate-spin text-agent-ink-muted" />
              <span class="text-agent-ink-muted">{{ t('skills.savingDraft') }}</span>
            </template>
            <template v-else-if="saveStatus === 'publishing'">
              <AppIcon name="tabler:loader-2" :size="13" class="animate-spin text-agent-ink-muted" />
              <span class="text-agent-ink-muted">{{ t('skills.publishingSkill') }}</span>
            </template>
            <template v-else>
              <span class="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-agent-moss" />
              <span class="text-agent-ink-muted">{{ t('skills.valid') }}</span>
            </template>
          </div>

          <!-- 右侧：成组操作按钮 -->
          <div class="flex items-center gap-2">
            <button
              :disabled="skills.busy.value"
              class="inline-flex h-8 items-center rounded-lg px-3 text-agent-ink-muted transition-colors hover:bg-agent-surface-sunken hover:text-agent-ink disabled:opacity-50"
              @click="skills.closeEditor()"
            >
              <span class="text-xs">{{ t('skills.cancel') }}</span>
            </button>

            <button
              v-if="skills.editingSkill.value?.conversationId && !skills.editingSkill.value.published"
              :disabled="skills.busy.value || skills.editorOutcomeUnknown.value || !!skillParseResult.error"
              class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-agent-border-subtle bg-agent-surface px-3 text-agent-ink-soft transition-colors hover:bg-agent-surface-sunken hover:text-agent-ink focus-visible:outline-2 focus-visible:outline-agent-focus disabled:opacity-50"
              @click="handleSaveDraft"
            >
              <AppIcon name="tabler:device-floppy" :size="14" class="text-agent-ink-muted" />
              <span class="text-xs font-medium">{{ t('skills.saveDraft') }}</span>
            </button>

            <button
              :disabled="skills.busy.value || skills.editorOutcomeUnknown.value || !!skillParseResult.error"
              class="inline-flex h-8 items-center gap-1.5 rounded-lg bg-agent-ink px-3.5 text-agent-canvas shadow-xs transition-opacity hover:opacity-90 active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-agent-focus disabled:opacity-50"
              @click="handlePublish"
            >
              <AppIcon name="tabler:upload" :size="14" />
              <span class="text-xs font-medium">{{ skills.editingSkill.value?.published ? t('skills.saveChanges') : t('skills.publishNow') }}</span>
            </button>
          </div>
        </footer>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>

<style scoped>
.editor-panel {
  --editor-panel-bg: var(--agent-surface-raised);
  --editor-edge: color-mix(in oklch, var(--agent-ink) 10%, transparent);

  background: var(--editor-panel-bg);
  box-shadow:
    inset 0 0 0 1px var(--editor-edge),
    0 1px 2px rgb(0 0 0 / 6%),
    0 2px 8px rgb(0 0 0 / 24%);
}

[data-agent-workspace-theme='olive-ember'] .editor-panel {
  --editor-panel-bg: color-mix(in oklch, var(--agent-surface-sunken), white 4%);
}

.editor-panel[data-state='open'] {
  animation: editor-panel-in 180ms cubic-bezier(0.16, 1, 0.3, 1) both;
}

.editor-panel[data-state='closed'] {
  animation: editor-panel-out 140ms ease-in both;
}

.editor-overlay[data-state='open'] {
  animation: editor-fade-in 180ms ease-out both;
}

.editor-overlay[data-state='closed'] {
  animation: editor-fade-in 140ms ease-in reverse both;
}

@keyframes editor-panel-in {
  from {
    opacity: 0;
    transform: scale(0.96);
  }
}

@keyframes editor-panel-out {
  to {
    opacity: 0;
    transform: scale(0.96);
  }
}

@keyframes editor-fade-in {
  from {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .editor-panel[data-state='open'],
  .editor-panel[data-state='closed'] {
    animation-name: editor-fade-in;
  }

  .loader .letter {
    animation: none !important;
    transform: translateY(0) !important;
  }
}

/* 动效：Hide and Seek 3D 立体硬阴影字符波浪动效（对齐 SkillsDialog 预览弹窗） */
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

/* 预览区 Markdown 字体小一号：统一缩减字号与行高 */
.editor-markdown-view :deep(.agent-markdown-content) {
  font-size: 13.5px !important;
  line-height: 1.6 !important;
}

.editor-markdown-view :deep(.agent-code-pre),
.editor-markdown-view :deep(.agent-code-pre code) {
  font-size: 11.5px !important;
}
</style>
