<script setup lang="ts">
import type { AdminSkillDetail, AdminSkillSummary, SkillResource } from '@agent/contracts'
import {
  CodeOutlined,
  DownloadOutlined,
  FileImageOutlined,
  FileOutlined,
  FileTextOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons-vue'
import {
  Alert,
  Button,
  Descriptions,
  DescriptionsItem,
  Drawer,
  Empty,
  Skeleton,
  Space,
  Switch,
  Tag,
} from 'ant-design-vue'
import { computed, ref, watch } from 'vue'

import { useI18n } from 'vue-i18n'
import ConversationMarkdown from '@/features/conversations/ConversationMarkdown.vue'
import { formatDateTime } from '@/features/runs/run.utils'
import {
  downloadSkillResource,
  estimateFileBytes,
  formatBytes,
  isBuiltinSkill,
  parseSkillMarkdown,
} from '../skills.utils'

const props = defineProps<{
  open: boolean
  skill: AdminSkillDetail | null
  loading: boolean
  error: string
  pending: boolean
}>()

const emit = defineEmits<{
  'update:open': [value: boolean]
  'toggle': [skill: AdminSkillSummary]
  'edit': [skill: AdminSkillDetail]
}>()

const { t, locale } = useI18n()

const selectedFilePath = ref<string>('SKILL.md')
const viewMode = ref<'rendered' | 'raw'>('rendered')

// 当打开新技能或文件列表变动时，默认选中 SKILL.md
watch(
  () => props.skill?.id,
  () => {
    selectedFilePath.value = 'SKILL.md'
    viewMode.value = 'rendered'
  },
)

const files = computed<SkillResource[]>(() => props.skill?.files || [])

const selectedFile = computed<SkillResource | undefined>(() => {
  return files.value.find(f => f.path === selectedFilePath.value) || files.value[0]
})

const parsedSkillMd = computed(() => {
  const main = selectedFile.value?.path === 'SKILL.md' ? selectedFile.value : undefined
  if (!main)
    return null
  return parseSkillMarkdown(main.content)
})

const isBuiltin = computed(() => {
  return props.skill ? isBuiltinSkill(props.skill.id) : false
})

const isImageFile = computed(() => {
  const path = selectedFile.value?.path.toLowerCase() || ''
  return /\.(?:png|jpe?g|svg|webp|gif|ico)$/iu.test(path)
})

const imageSource = computed(() => {
  const file = selectedFile.value
  if (!file || !isImageFile.value)
    return ''
  const ext = file.path.split('.').at(-1)?.toLowerCase()
  const type = ext === 'svg' ? 'image/svg+xml' : ext === 'jpg' ? 'image/jpeg' : ext === 'ico' ? 'image/x-icon' : `image/${ext}`
  return file.encoding === 'base64' ? `data:${type};base64,${file.content}` : `data:${type};charset=utf-8,${encodeURIComponent(file.content)}`
})

const isMarkdownFile = computed(() => {
  const path = selectedFile.value?.path.toLowerCase() || ''
  return path.endsWith('.md')
})

function getFileIcon(path: string) {
  const lower = path.toLowerCase()
  if (lower.endsWith('.md'))
    return FileTextOutlined
  if (/\.(?:png|jpe?g|svg|webp|gif|ico)$/iu.test(lower))
    return FileImageOutlined
  if (/\.(?:json|yaml|yml|ts|js|py|sh)$/iu.test(lower))
    return CodeOutlined
  return FileOutlined
}

function handleDownloadCurrentFile() {
  if (!selectedFile.value)
    return
  downloadSkillResource(selectedFile.value)
}
</script>

<template>
  <Drawer
    :open="open"
    width="min(880px, 94vw)"
    placement="right"
    destroy-on-close
    class="skill-detail-drawer"
    @update:open="emit('update:open', $event)"
  >
    <template #title>
      <div class="skill-detail-drawer__title-bar">
        <Space align="center" size="middle">
          <span class="skill-detail-drawer__title">{{ skill?.name || t('skills.title') }}</span>
          <Tag v-if="isBuiltin" color="purple" class="skill-detail-drawer__tag">
            <template #icon>
              <SafetyCertificateOutlined />
            </template>
            {{ t('skills.builtinBadge') }}
          </Tag>
          <Tag :color="skill?.enabled ? 'success' : 'default'">
            {{ skill?.enabled ? t('skills.statusEnabled') : t('skills.statusDisabled') }}
          </Tag>
        </Space>
      </div>
    </template>

    <template #extra>
      <Space>
        <Button
          v-if="skill"
          :disabled="pending"
          type="primary"
          size="small"
          @click="emit('edit', skill)"
        >
          {{ t('skills.edit') }}
        </Button>
      </Space>
    </template>

    <!-- 加载中骨架屏 -->
    <div v-if="loading" class="skill-detail-drawer__loading">
      <Skeleton active :paragraph="{ rows: 12 }" />
    </div>

    <!-- 错误反馈 -->
    <Alert
      v-else-if="error"
      type="error"
      show-icon
      :message="t('skills.detail.loadFailed')"
      :description="error"
      class="skill-detail-drawer__error"
    />

    <!-- 详情内容 -->
    <div v-else-if="skill" class="skill-detail-drawer__content">
      <!-- 基础元数据信息卡片 -->
      <section class="skill-meta-card">
        <Descriptions size="small" :column="2" bordered>
          <DescriptionsItem :label="t('skills.columns.name')">
            <span class="skill-meta-mono">{{ skill.name }}</span>
          </DescriptionsItem>
          <DescriptionsItem :label="t('skills.columns.status')">
            <Space align="center">
              <span>{{ skill.enabled ? t('skills.statusEnabled') : t('skills.statusDisabled') }}</span>
              <Switch
                :checked="skill.enabled"
                :loading="pending"
                :disabled="pending"
                size="small"
                @change="emit('toggle', skill)"
              />
            </Space>
          </DescriptionsItem>
          <DescriptionsItem :label="t('skills.columns.description')" :span="2">
            <p class="skill-meta-desc">
              {{ skill.description }}
            </p>
          </DescriptionsItem>
          <DescriptionsItem v-if="skill.updatedAt" :label="t('skills.columns.updatedAt')">
            <span class="skill-meta-muted">{{ formatDateTime(skill.updatedAt, locale) }}</span>
          </DescriptionsItem>
          <DescriptionsItem :label="t('skills.columns.files')">
            <span>{{ t('skills.filesCount', { count: files.length }) }}</span>
          </DescriptionsItem>
        </Descriptions>
      </section>

      <!-- 文件与代码浏览器 -->
      <section class="skill-browser">
        <div class="skill-browser__header">
          <div class="skill-browser__title">
            <CodeOutlined />
            <span>{{ t('skills.detail.fileListTitle') }}</span>
          </div>

          <Space size="small">
            <template v-if="isMarkdownFile">
              <Button
                size="small"
                :type="viewMode === 'rendered' ? 'primary' : 'default'"
                @click="viewMode = 'rendered'"
              >
                {{ t('skills.detail.viewModeRendered') }}
              </Button>
              <Button
                size="small"
                :type="viewMode === 'raw' ? 'primary' : 'default'"
                @click="viewMode = 'raw'"
              >
                {{ t('skills.detail.viewModeRaw') }}
              </Button>
            </template>
            <Button
              v-if="selectedFile"
              size="small"
              @click="handleDownloadCurrentFile"
            >
              <template #icon>
                <DownloadOutlined />
              </template>
              {{ t('skills.detail.downloadFile') }}
            </Button>
          </Space>
        </div>

        <div class="skill-browser__body">
          <!-- 左侧文件列表导航 -->
          <div class="skill-browser__sidebar">
            <div
              v-for="file in files"
              :key="file.path"
              class="skill-browser__file-item"
              :class="{ 'is-active': selectedFilePath === file.path }"
              @click="selectedFilePath = file.path"
            >
              <component :is="getFileIcon(file.path)" class="skill-browser__file-icon" />
              <span class="skill-browser__file-path" :title="file.path">{{ file.path }}</span>
              <span class="skill-browser__file-size">{{ formatBytes(estimateFileBytes(file)) }}</span>
            </div>
          </div>

          <!-- 右侧文件内容展示（文本安全展示，避免不可信 HTML 执行） -->
          <div class="skill-browser__viewer">
            <template v-if="selectedFile">
              <!-- 图片文件预览 -->
              <div v-if="isImageFile" class="skill-browser__image-preview">
                <img :src="imageSource" :alt="selectedFile.path" class="skill-browser__img">
              </div>

              <!-- 二进制非文本文件 -->
              <div v-else-if="selectedFile.encoding === 'base64'" class="skill-browser__binary-notice">
                <FileOutlined class="skill-browser__binary-icon" />
                <p class="skill-browser__binary-title">
                  {{ t('skills.detail.binaryFile', { encoding: selectedFile.encoding }) }}
                </p>
                <p class="skill-browser__binary-desc">
                  {{ t('skills.detail.binaryFileTip') }}
                </p>
                <Button type="primary" size="small" @click="handleDownloadCurrentFile">
                  <template #icon>
                    <DownloadOutlined />
                  </template>
                  {{ t('skills.detail.downloadFile') }}
                </Button>
              </div>

              <!-- Markdown 文件安全渲染视图 -->
              <div v-else-if="isMarkdownFile && viewMode === 'rendered'" class="skill-browser__markdown-view">
                <div v-if="parsedSkillMd?.rawFrontmatter" class="skill-frontmatter-block">
                  <div class="skill-frontmatter-header">
                    YAML Frontmatter
                  </div>
                  <pre class="skill-code-pre"><code>{{ parsedSkillMd.rawFrontmatter }}</code></pre>
                </div>
                <div class="skill-markdown-body">
                  <div class="skill-markdown-header">
                    指令与步骤正文
                  </div>
                  <ConversationMarkdown :content="parsedSkillMd?.body || selectedFile.content" />
                </div>
              </div>

              <!-- 纯文本与源码高亮展示 -->
              <div v-else class="skill-browser__raw-view">
                <pre class="skill-code-pre"><code>{{ selectedFile.content }}</code></pre>
              </div>
            </template>

            <Empty v-else :description="t('skills.detail.emptyFiles')" />
          </div>
        </div>
      </section>
    </div>
  </Drawer>
</template>

<style scoped>
.skill-detail-drawer :deep(.ant-drawer-body) {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 16px 20px;
  overflow: hidden;
}

.skill-detail-drawer__title-bar {
  display: flex;
  align-items: center;
  gap: 10px;
}

.skill-detail-drawer__title {
  font-size: 16px;
  font-weight: 600;
  color: var(--admin-text);
}

.skill-detail-drawer__tag {
  font-weight: 500;
}

.skill-detail-drawer__loading {
  padding: 24px;
}

.skill-detail-drawer__content {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  height: 100%;
  gap: 14px;
}

.skill-meta-card {
  flex: none;
  background: var(--admin-bg-deep);
  border-radius: var(--admin-radius-md);
  overflow: hidden;
}

.skill-meta-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12.5px;
}

.skill-meta-desc {
  margin: 0;
  color: var(--admin-text);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.skill-meta-muted {
  color: var(--admin-text-muted);
  font-size: 12.5px;
}

.skill-fingerprint-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.skill-fingerprint-text {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--admin-text-muted);
}

/* 文件浏览器：自适应占满抽屉剩余垂直空间 */
.skill-browser {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--admin-border-strong);
  border-radius: var(--admin-radius-md);
  background: var(--admin-surface);
  overflow: hidden;
}

.skill-browser__header {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--admin-border-strong);
  background: var(--admin-bg-deep);
}

.skill-browser__title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--admin-text);
}

.skill-browser__body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 240px 1fr;
  overflow: hidden;
}

.skill-browser__sidebar {
  height: 100%;
  min-height: 0;
  border-right: 1px solid var(--admin-border-strong);
  background: var(--admin-bg-deep);
  padding: 8px 6px;
  display: flex;
  flex-direction: column;
  gap: 3px;
  overflow-y: auto;
}

.skill-browser__file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-radius: var(--admin-radius-sm);
  cursor: pointer;
  font-size: 12.5px;
  color: var(--admin-text);
  transition: background-color 140ms ease;
}

.skill-browser__file-item:hover {
  background: var(--admin-hover);
}

.skill-browser__file-item.is-active {
  background: var(--admin-primary-soft);
  color: var(--admin-primary);
  font-weight: 500;
}

.skill-browser__file-icon {
  font-size: 14px;
  flex: none;
}

.skill-browser__file-path {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-browser__file-size {
  color: var(--admin-text-muted);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  flex: none;
}

.skill-browser__viewer {
  height: 100%;
  min-height: 0;
  padding: 16px 20px;
  overflow-y: auto;
  background: var(--admin-surface);
}

.skill-code-pre {
  margin: 0;
  padding: 12px;
  background: var(--admin-bg-deep);
  border: 1px solid var(--admin-border-strong);
  border-radius: var(--admin-radius-sm);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  line-height: 1.55;
  color: var(--admin-text);
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.skill-instruction-pre {
  margin: 0;
  padding: 14px;
  background: var(--admin-surface);
  border: 1px solid var(--admin-border-strong);
  border-radius: var(--admin-radius-sm);
  font-family: inherit;
  font-size: 13.5px;
  line-height: 1.65;
  color: var(--admin-text);
  white-space: pre-wrap;
  word-break: break-word;
}

.skill-frontmatter-block {
  margin-bottom: 14px;
}

.skill-frontmatter-header,
.skill-markdown-header {
  font-size: 11.5px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--admin-text-muted);
  margin-bottom: 6px;
}

.skill-browser__binary-notice {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 50px 20px;
  text-align: center;
}

.skill-browser__binary-icon {
  font-size: 40px;
  color: var(--admin-text-muted);
  margin-bottom: 12px;
}

.skill-browser__binary-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--admin-text);
  margin: 0 0 6px;
}

.skill-browser__binary-desc {
  font-size: 13px;
  color: var(--admin-text-muted);
  margin: 0 0 16px;
}

.skill-browser__image-preview {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background: var(--admin-bg-deep);
  border-radius: var(--admin-radius-sm);
}

.skill-browser__img {
  max-width: 100%;
  max-height: 320px;
  object-fit: contain;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}
</style>
