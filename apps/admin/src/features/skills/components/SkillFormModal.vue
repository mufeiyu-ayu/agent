<script setup lang="ts">
import type { AdminSkillDetail } from '@agent/contracts'
import {
  EyeOutlined,
  FileTextOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons-vue'
import {
  Alert,
  Button,
  Empty,
  Input,
  Modal,
  Space,
  Tag,
  Textarea,
  Tooltip,
} from 'ant-design-vue'
import { computed, reactive, watch } from 'vue'

import { useI18n } from 'vue-i18n'
import ConversationMarkdown from '@/features/conversations/ConversationMarkdown.vue'
import {
  createDefaultSkillMarkdown,
  isBuiltinSkill,
  parseSkillMarkdown,
} from '../skills.utils'

const props = defineProps<{
  open: boolean
  skill: AdminSkillDetail | null
  saving: boolean
  error: string
  outcomeUnknown: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'reconcile': []
  'save': [data: { name: string, description: string, body: string }]
}>()

const { t } = useI18n()

const isEdit = computed(() => props.skill !== null)
const isBuiltin = computed(() => {
  return props.skill ? isBuiltinSkill(props.skill.id) : false
})

const formData = reactive<{
  name: string
  description: string
  body: string
}>({
  name: '',
  description: '',
  body: '',
})

// 字段校验错误提示
const errors = reactive<{
  name: string
  description: string
  body: string
}>({
  name: '',
  description: '',
  body: '',
})

// 统计正文行数与字符数
const lineCount = computed(() => {
  if (!formData.body)
    return 0
  return (formData.body.match(/\n/g)?.length ?? 0) + 1
})
const charCount = computed(() => formData.body.length)

// 监听弹窗打开与目标切换，初始化表单
watch(
  () => props.open,
  (open) => {
    if (!open)
      return

    errors.name = ''
    errors.description = ''
    errors.body = ''

    if (props.skill) {
      const mainFile = props.skill.files?.find(f => f.path === 'SKILL.md')
      const parsed = mainFile ? parseSkillMarkdown(mainFile.content) : null

      formData.name = props.skill.name
      formData.description = props.skill.description || parsed?.description || ''
      formData.body = parsed?.body || (mainFile ? mainFile.content : '')
    }
    else {
      formData.name = ''
      formData.description = ''
      formData.body = createDefaultSkillMarkdown().split('---')[2]?.trim() || ''
    }
  },
  { immediate: true },
)

function validate(): boolean {
  let valid = true
  errors.name = ''
  errors.description = ''
  errors.body = ''

  const name = formData.name.trim()
  if (!name) {
    errors.name = t('skills.form.validationNameRequired')
    valid = false
  }
  else if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name) || name.length > 64) {
    errors.name = t('skills.form.validationNameInvalid')
    valid = false
  }

  const desc = formData.description.trim()
  if (!desc) {
    errors.description = t('skills.form.validationDescriptionRequired')
    valid = false
  }
  else if (desc.length > 1024) {
    errors.description = t('skills.form.validationDescriptionTooLong')
    valid = false
  }

  if (!formData.body.trim()) {
    errors.body = t('skills.form.validationBodyRequired')
    valid = false
  }

  return valid
}

const otherFiles = computed(() => {
  if (!props.skill?.files)
    return []
  return props.skill.files.filter(f => f.path !== 'SKILL.md')
})

// 支持在编辑正文时按 Tab 键缩进 2 空格
function handleTabKey(e: KeyboardEvent) {
  const target = e.target as HTMLTextAreaElement
  const start = target.selectionStart
  const end = target.selectionEnd
  const value = target.value

  formData.body = `${value.substring(0, start)}  ${value.substring(end)}`
  requestAnimationFrame(() => {
    target.selectionStart = target.selectionEnd = start + 2
  })
}

function handleOk() {
  if (props.saving || props.outcomeUnknown)
    return

  if (!validate())
    return

  emit('save', {
    name: formData.name.trim(),
    description: formData.description.trim(),
    body: formData.body,
  })
}

function handleCancel() {
  if (props.saving)
    return
  emit('update:open', false)
}
</script>

<template>
  <Modal
    :open="open"
    :title="isEdit ? t('skills.form.editTitle', { name: skill?.name ?? '' }) : t('skills.form.createTitle')"
    :confirm-loading="saving"
    :ok-button-props="{ disabled: outcomeUnknown }"
    :closable="!saving"
    :mask-closable="!saving"
    :keyboard="!saving"
    :cancel-button-props="{ disabled: saving }"
    :ok-text="t('skills.form.save')"
    :cancel-text="t('skills.form.cancel')"
    :centered="true"
    width="min(1820px, 96vw)"
    destroy-on-close
    class="skill-editor-modal"
    @ok="handleOk"
    @cancel="handleCancel"
  >
    <Alert v-if="error" type="error" show-icon :message="error" class="mb-4">
      <template v-if="outcomeUnknown" #action>
        <Button size="small" @click="emit('reconcile')">
          {{ t('skills.refreshAndCheck') }}
        </Button>
      </template>
    </Alert>
    <div class="skill-editor-layout">
      <!-- 左栏：源码与配置工作台 -->
      <section class="skill-editor-pane">
        <!-- 顶部元数据卡片区域 -->
        <div class="skill-meta-section">
          <!-- 技能名称 -->
          <div class="skill-field-group">
            <div class="skill-field-header">
              <label for="editor-skill-name" class="skill-field-label">
                <span class="skill-required-star">*</span>
                <span>{{ t('skills.form.name') }}</span>
              </label>
              <span class="skill-char-count font-mono">{{ formData.name.length }} / 64</span>
            </div>
            <Input
              id="editor-skill-name"
              v-model:value="formData.name"
              :placeholder="t('skills.form.namePlaceholder')"
              :disabled="isBuiltin || saving"
              :status="errors.name ? 'error' : undefined"
              class="skill-input-mono"
              autocomplete="off"
              @input="errors.name = ''"
            >
              <template v-if="isBuiltin" #suffix>
                <Tooltip :title="t('skills.form.nameDisabledTip')">
                  <SafetyCertificateOutlined style="color: var(--admin-primary);" />
                </Tooltip>
              </template>
            </Input>
            <div v-if="errors.name" class="skill-error-text">
              {{ errors.name }}
            </div>
            <div v-else class="skill-help-text">
              {{ isBuiltin ? t('skills.form.nameDisabledTip') : t('skills.form.nameHelp') }}
            </div>
          </div>

          <!-- 用途与描述 -->
          <div class="skill-field-group">
            <div class="skill-field-header">
              <label for="editor-skill-desc" class="skill-field-label">
                <span class="skill-required-star">*</span>
                <span>{{ t('skills.form.description') }}</span>
              </label>
              <span class="skill-char-count font-mono">{{ formData.description.length }} / 1024</span>
            </div>
            <Textarea
              id="editor-skill-desc"
              v-model:value="formData.description"
              :placeholder="t('skills.form.descriptionPlaceholder')"
              :disabled="saving"
              :rows="2"
              :maxlength="1024"
              :status="errors.description ? 'error' : undefined"
              class="skill-textarea-desc"
              @input="errors.description = ''"
            />
            <div v-if="errors.description" class="skill-error-text">
              {{ errors.description }}
            </div>
            <div v-else class="skill-help-text">
              {{ t('skills.form.descriptionHelp') }}
            </div>
          </div>
        </div>

        <!-- 下部：正文指令编辑器（占满剩余垂直空间） -->
        <div class="skill-body-section">
          <!-- 正文工具条 -->
          <div class="skill-body-header">
            <div class="skill-body-title">
              <span class="skill-required-star">*</span>
              <FileTextOutlined />
              <span>{{ t('skills.form.body') }}</span>
              <span class="skill-body-filename font-mono">(SKILL.md)</span>
            </div>
            <div class="skill-body-meta font-mono">
              <span>{{ t('skills.form.lines', { count: lineCount }) }}</span>
              <span class="skill-body-meta-divider">·</span>
              <span>{{ t('skills.form.characters', { count: charCount }) }}</span>
            </div>
          </div>

          <!-- 文本编辑框 -->
          <div class="skill-textarea-wrapper" :class="{ 'has-error': !!errors.body }">
            <textarea
              v-model="formData.body"
              :disabled="saving"
              :placeholder="t('skills.form.bodyPlaceholder')"
              class="skill-textarea-main"
              spellcheck="false"
              @input="errors.body = ''"
              @keydown.tab.prevent="handleTabKey"
            />
          </div>
          <div v-if="errors.body" class="skill-error-text">
            {{ errors.body }}
          </div>
        </div>

        <!-- 已保留包内辅助文件提示 -->
        <div v-if="isEdit && otherFiles.length > 0" class="skill-preserved-bar">
          <Alert type="info" show-icon class="skill-preserved-alert">
            <template #message>
              <div class="skill-preserved-content">
                <span>{{ t('skills.form.preservedFilesTitle', { count: otherFiles.length }) }}:</span>
                <Space wrap size="small">
                  <Tag v-for="f in otherFiles" :key="f.path" color="blue">
                    {{ f.path }}
                  </Tag>
                </Space>
              </div>
            </template>
          </Alert>
        </div>
      </section>

      <!-- 右栏：实时预览渲染 -->
      <section class="skill-preview-pane">
        <!-- 预览顶栏 -->
        <div class="skill-preview-header">
          <div class="skill-preview-title">
            <EyeOutlined />
            <span>{{ t('skills.form.livePreview') }}</span>
          </div>
          <span v-if="formData.name" class="skill-preview-badge font-mono">
            {{ formData.name }}
          </span>
        </div>

        <!-- 预览主体滚动区 -->
        <div class="skill-preview-body">
          <!-- 技能元数据卡片预览 -->
          <div
            v-if="formData.name || formData.description"
            class="skill-card-preview"
          >
            <div class="skill-card-header">
              <span class="skill-card-name font-mono">{{ formData.name || '未命名技能' }}</span>
              <Tag v-if="isBuiltin" color="purple">
                <template #icon>
                  <SafetyCertificateOutlined />
                </template>
                {{ t('skills.builtinBadge') }}
              </Tag>
            </div>
            <p v-if="formData.description" class="skill-card-desc">
              {{ formData.description }}
            </p>
          </div>

          <!-- Markdown 正文安全渲染 -->
          <div v-if="formData.body.trim()" class="skill-markdown-preview-wrapper">
            <ConversationMarkdown :content="formData.body" />
          </div>

          <!-- 空态说明 -->
          <div v-else class="skill-preview-empty">
            <Empty
              :image="Empty.PRESENTED_IMAGE_SIMPLE"
              :description="t('skills.form.previewEmpty')"
            />
          </div>
        </div>
      </section>
    </div>
  </Modal>
</template>

<style scoped>
.skill-editor-modal :deep(.ant-modal-body) {
  padding: 0;
}

.skill-editor-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  height: clamp(620px, 78vh, 960px);
  min-height: 0;
  border-top: 1px solid var(--admin-border-strong);
}

/* 左侧编辑区域 */
.skill-editor-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  border-right: 1px solid var(--admin-border-strong);
  padding: 16px 20px;
  background: var(--admin-surface);
  overflow-y: auto;
}

.skill-meta-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 14px;
}

.skill-field-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
}

.skill-field-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.skill-field-label {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 500;
  color: var(--admin-text);
}

.skill-required-star {
  color: var(--admin-danger);
  font-size: 13px;
  line-height: 1;
}

.skill-char-count {
  font-size: 11px;
  color: var(--admin-text-muted);
}

.skill-input-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 13px;
  width: 100%;
}

.skill-textarea-desc {
  width: 100%;
  font-size: 13px;
  line-height: 1.5;
  resize: none;
}

.skill-help-text {
  font-size: 11.5px;
  color: var(--admin-text-muted);
  line-height: 1.4;
}

.skill-error-text {
  font-size: 11.5px;
  color: var(--admin-danger);
  line-height: 1.4;
}

/* 正文编辑器区域（伸缩撑满剩余高） */
.skill-body-section {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 380px;
  margin-bottom: 8px;
}

.skill-body-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 2px;
}

.skill-body-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--admin-text);
}

.skill-body-filename {
  font-size: 11.5px;
  color: var(--admin-text-muted);
}

.skill-body-meta {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--admin-text-muted);
}

.skill-body-meta-divider {
  opacity: 0.6;
}

.skill-textarea-wrapper {
  display: flex;
  flex: 1;
  width: 100%;
  border: 1px solid var(--admin-border-strong);
  border-radius: var(--admin-radius-sm);
  background: var(--admin-surface);
  transition: border-color 140ms ease, box-shadow 140ms ease;
  overflow: hidden;
}

.skill-textarea-wrapper:focus-within {
  border-color: var(--admin-primary);
  box-shadow: 0 0 0 2px var(--admin-primary-soft);
}

.skill-textarea-wrapper.has-error {
  border-color: var(--admin-danger);
}

.skill-textarea-main {
  width: 100%;
  height: 100%;
  padding: 10px 12px;
  border: none;
  outline: none;
  background: transparent;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.6;
  color: var(--admin-text);
  resize: none;
  white-space: pre;
  tab-size: 2;
}

.skill-preserved-bar {
  margin-top: 6px;
}

.skill-preserved-alert {
  padding: 6px 10px;
}

.skill-preserved-content {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

/* 右侧实时预览面板 */
.skill-preview-pane {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  background: var(--admin-bg-deep);
  overflow: hidden;
}

.skill-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 16px;
  border-bottom: 1px solid var(--admin-border-strong);
  background: var(--admin-surface);
  flex: none;
}

.skill-preview-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--admin-text);
}

.skill-preview-badge {
  font-size: 11.5px;
  color: var(--admin-text-muted);
  background: var(--admin-bg-deep);
  padding: 1px 8px;
  border-radius: 4px;
  border: 1px solid var(--admin-border-strong);
}

.skill-preview-body {
  flex: 1;
  padding: 18px 20px;
  overflow-y: auto;
}

.skill-card-preview {
  margin-bottom: 16px;
  padding: 12px 14px;
  border-radius: var(--admin-radius-sm);
  background: var(--admin-surface);
  border: 1px solid var(--admin-border-strong);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

.skill-card-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.skill-card-name {
  font-weight: 600;
  font-size: 13.5px;
  color: var(--admin-text);
}

.skill-card-desc {
  margin: 0;
  font-size: 12.5px;
  color: var(--admin-text-muted);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.skill-markdown-preview-wrapper {
  padding: 4px 2px;
}

.skill-preview-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 280px;
}

.font-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
}
</style>
