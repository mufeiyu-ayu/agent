<script setup lang="ts">
import type { McpPlugin } from '@agent/contracts'
import type { TableColumnsType } from 'ant-design-vue'
import {
  AppstoreOutlined,
  DownOutlined,
  InfoCircleOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  ToolOutlined,
} from '@ant-design/icons-vue'
import {
  Alert,
  Button,
  Input,
  Modal,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
} from 'ant-design-vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import DataTable from '@/components/common/DataTable.vue'
import PageContainer from '@/components/common/PageContainer.vue'
import PageHeader from '@/components/common/PageHeader.vue'
import PluginForm from '@/features/mcp/PluginForm.vue'
import { useSystemPlugins } from '@/features/mcp/useSystemPlugins'

const { t } = useI18n()
const p = useSystemPlugins()
const search = ref('')
const statusFilter = ref<'ALL' | 'AVAILABLE' | 'UNAVAILABLE'>('ALL')
const headers = ref<Record<string, string>>({})
const expandedTools = ref<Set<string>>(new Set())

const statusOptions = computed(() => [
  { label: t('plugins.statusAll'), value: 'ALL' },
  { label: t('plugins.statusAvailable'), value: 'AVAILABLE' },
  { label: t('plugins.statusUnavailable'), value: 'UNAVAILABLE' },
])

const rows = computed(() =>
  p.rows.value.filter((item) => {
    const q = search.value.trim().toLowerCase()
    const matchesSearch = !q || `${item.name} ${item.description}`.toLowerCase().includes(q)
    const matchesStatus
      = statusFilter.value === 'ALL'
        ? true
        : statusFilter.value === 'AVAILABLE'
          ? item.available
          : !item.available
    return matchesSearch && matchesStatus
  }),
)

const currentTestTools = computed(() => {
  const pluginId = p.testPlugin.value?.id
  if (!pluginId)
    return []
  return p.rows.value.find(row => row.id === pluginId)?.tools ?? []
})

const allExpanded = computed(() =>
  currentTestTools.value.length > 0 && currentTestTools.value.every(tool => expandedTools.value.has(tool.name)),
)

function toggleToolExpand(name: string) {
  if (expandedTools.value.has(name)) {
    expandedTools.value.delete(name)
  }
  else {
    expandedTools.value.add(name)
  }
}

function toggleAllTools() {
  if (allExpanded.value) {
    expandedTools.value.clear()
  }
  else {
    expandedTools.value = new Set(currentTestTools.value.map(tool => tool.name))
  }
}

function getFirstLine(text?: string): string {
  if (!text)
    return ''
  const trimmed = text.trim()
  const firstNewline = trimmed.indexOf('\n')
  const line = firstNewline === -1 ? trimmed : trimmed.slice(0, firstNewline)
  return line.length > 120 ? `${line.slice(0, 120)}…` : line
}

const columns = computed<TableColumnsType<McpPlugin>>(() => [
  {
    title: t('plugins.columns.name'),
    key: 'name',
  },
  {
    title: t('plugins.columns.authType'),
    key: 'authType',
    width: 140,
  },
  {
    title: '上架状态',
    key: 'available',
    width: 120,
    align: 'center',
  },
  {
    title: t('plugins.columns.actions'),
    key: 'actions',
    width: 190,
    align: 'right',
  },
])

function test(plugin: McpPlugin) {
  headers.value = {}
  p.testMessage.value = ''
  p.testPlugin.value = plugin
  p.error.value = ''
  expandedTools.value.clear()
}
</script>

<template>
  <PageContainer wide>
    <PageHeader
      :title="t('plugins.title')"
      :description="t('plugins.description')"
    >
      <template #actions>
        <Space>
          <Button :disabled="p.busy.value" :loading="p.loading.value" @click="p.reload">
            <template #icon>
              <ReloadOutlined />
            </template>
            {{ t('plugins.refresh') }}
          </Button>
          <Button type="primary" :disabled="p.busy.value" @click="p.edit(null)">
            <template #icon>
              <PlusOutlined />
            </template>
            {{ t('plugins.create') }}
          </Button>
        </Space>
      </template>
    </PageHeader>

    <Alert
      v-if="p.error.value && !p.editorOpen.value && !p.testPlugin.value"
      type="error"
      :message="p.error.value"
      show-icon
      class="plugins-error-alert"
    />

    <DataTable
      row-key="id"
      :columns="columns"
      :data-source="rows"
      :loading="p.loading.value"
      :error="!p.rows.value.length && p.error.value ? p.error.value : ''"
      :error-title="t('plugins.loadFailed')"
      :summary="t('plugins.total', { count: p.rows.value.length })"
      :empty-text="search || statusFilter !== 'ALL' ? t('plugins.emptyFilter') : t('plugins.empty')"
      :scroll-x="750"
      @retry="p.reload"
    >
      <!-- 列表顶部工具栏：搜索与状态筛选，样式参考 skills 模块 -->
      <template #toolbar>
        <div class="plugins-toolbar">
          <Input
            v-model:value="search"
            allow-clear
            :placeholder="t('plugins.searchPlaceholder')"
            class="plugins-search-input"
          >
            <template #prefix>
              <SearchOutlined style="color: var(--admin-text-muted);" />
            </template>
          </Input>

          <Select
            v-model:value="statusFilter"
            :options="statusOptions"
            class="plugins-status-select"
          />
        </div>
      </template>

      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'name'">
          <div class="plugin-name-cell">
            <img v-if="record.icon" :src="record.icon" alt="" class="plugin-icon">
            <div v-else class="plugin-icon-placeholder">
              <AppstoreOutlined />
            </div>
            <div class="plugin-info">
              <div class="plugin-name">
                {{ record.name }}
              </div>
              <div v-if="record.description" class="plugin-desc" :title="record.description">
                {{ record.description }}
              </div>
            </div>
          </div>
        </template>

        <template v-else-if="column.key === 'authType'">
          <Tag v-if="record.authType === 'oauth'" color="blue">
            OAuth
          </Tag>
          <Tag v-else-if="record.authType === 'headers'" color="orange">
            个人密钥
          </Tag>
          <span v-else class="plugin-auth-none">无需认证</span>
        </template>

        <!-- 独立上架状态列：Switch 开关 -->
        <template v-else-if="column.key === 'available'">
          <Switch
            :checked="record.available"
            :disabled="p.busy.value"
            :loading="p.togglingId.value === record.id"
            :aria-label="`上架状态：${record.name}`"
            size="small"
            @change="p.toggle(record as McpPlugin)"
          />
        </template>

        <template v-else-if="column.key === 'actions'">
          <Space size="small">
            <Button size="small" :disabled="p.busy.value" @click="p.edit(record as McpPlugin)">
              编辑
            </Button>
            <Button size="small" :disabled="p.busy.value" @click="test(record as McpPlugin)">
              测试
            </Button>
            <Popconfirm
              title="删除后，用户将无法继续调用此插件。确认删除？"
              ok-text="删除"
              cancel-text="取消"
              :disabled="p.busy.value"
              @confirm="p.remove(record as McpPlugin)"
            >
              <Button danger size="small" :disabled="p.busy.value">
                删除
              </Button>
            </Popconfirm>
          </Space>
        </template>
      </template>
    </DataTable>

    <PluginForm
      v-model:open="p.editorOpen.value"
      :plugin="p.selected.value"
      :busy="p.busy.value"
      :error="p.error.value"
      @save="p.save"
    />

    <!-- 测试插件连接弹窗：带最大高度限制、平滑滚动、结构化工具卡片与展开/收起 -->
    <Modal
      :open="!!p.testPlugin.value"
      title="测试插件连接"
      ok-text="测试连接"
      cancel-text="关闭"
      :confirm-loading="p.busy.value"
      :closable="!p.busy.value"
      :mask-closable="!p.busy.value"
      :keyboard="!p.busy.value"
      :cancel-button-props="{ disabled: p.busy.value }"
      :width="680"
      :centered="true"
      class="plugin-test-modal"
      @ok="p.test(headers)"
      @cancel="p.testPlugin.value = null"
    >
      <div class="plugin-test-modal-scroll">
        <div class="plugin-test-tip-banner">
          <InfoCircleOutlined class="plugin-test-tip-icon" />
          <span>测试凭据仅属于当前管理员，不会提供给其他用户。OAuth 服务会跳转授权页面。</span>
        </div>

        <div v-if="p.testPlugin.value?.headerNames?.length" class="plugin-test-headers">
          <div v-for="name in p.testPlugin.value.headerNames" :key="name" class="plugin-test-field">
            <label class="plugin-test-label">{{ name }}</label>
            <Input
              v-model:value="headers[name]"
              type="password"
              :placeholder="`请输入 ${name}`"
              :disabled="p.busy.value"
              class="plugin-test-input"
            />
          </div>
        </div>

        <Alert
          v-if="p.error.value"
          type="error"
          show-icon
          :message="p.error.value"
          class="plugin-test-alert"
        />

        <Alert
          v-if="p.redirecting.value"
          type="info"
          show-icon
          message="正在跳转授权，完成授权后请重新测试连接。"
          class="plugin-test-alert"
        />

        <Alert
          v-if="p.testMessage.value"
          type="success"
          show-icon
          :message="p.testMessage.value"
          class="plugin-test-alert"
        />

        <!-- 结构化展示发现的工具列表 -->
        <div v-if="p.testMessage.value && currentTestTools.length" class="plugin-test-tools-section">
          <div class="plugin-test-tools-header">
            <div class="plugin-test-tools-title-group">
              <span class="plugin-test-tools-title">可用工具</span>
              <span class="plugin-test-tools-count">{{ currentTestTools.length }}</span>
            </div>
            <Button
              v-if="currentTestTools.length > 1"
              type="link"
              size="small"
              class="plugin-test-expand-all"
              @click="toggleAllTools"
            >
              {{ allExpanded ? '全部收起' : '全部展开' }}
            </Button>
          </div>

          <div class="plugin-test-tools-list">
            <div
              v-for="tool in currentTestTools"
              :key="tool.name"
              class="test-tool-card"
            >
              <div class="test-tool-card-head" @click="toggleToolExpand(tool.name)">
                <div class="test-tool-card-identity">
                  <ToolOutlined class="test-tool-icon" />
                  <span class="test-tool-name">{{ tool.name }}</span>
                  <Tag color="green" class="test-tool-tag">
                    可用
                  </Tag>
                </div>
                <button
                  type="button"
                  class="test-tool-expand-btn"
                  :aria-label="expandedTools.has(tool.name) ? '折叠详情' : '展开详情'"
                >
                  <DownOutlined :rotate="expandedTools.has(tool.name) ? 180 : 0" class="test-tool-chevron" />
                </button>
              </div>

              <!-- 折叠状态：预览第一行 -->
              <div
                v-if="!expandedTools.has(tool.name) && tool.description"
                class="test-tool-preview"
                @click="toggleToolExpand(tool.name)"
              >
                {{ getFirstLine(tool.description) }}
              </div>

              <!-- 展开状态：完整描述显示在代码/文本块中，支持局部滚动 -->
              <div v-if="expandedTools.has(tool.name) && tool.description" class="test-tool-expanded">
                <pre class="test-tool-desc-pre">{{ tool.description }}</pre>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  </PageContainer>
</template>

<style scoped>
.plugins-error-alert {
  margin-bottom: 16px;
}

.plugins-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.plugins-search-input {
  max-width: 320px;
}

.plugins-status-select {
  width: 130px;
}

.plugin-name-cell {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
}

.plugin-icon {
  width: 36px;
  height: 36px;
  border-radius: var(--admin-radius-sm);
  object-fit: contain;
  border: 0.5px solid var(--admin-border);
  background: var(--admin-surface-muted);
  flex-shrink: 0;
}

.plugin-icon-placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--admin-radius-sm);
  border: 0.5px solid var(--admin-border);
  background: var(--admin-surface-muted);
  color: var(--admin-text-muted);
  font-size: 18px;
  flex-shrink: 0;
}

.plugin-info {
  min-width: 0;
  flex: 1;
}

.plugin-name {
  font-weight: 600;
  color: var(--admin-text);
  line-height: 1.4;
}

.plugin-desc {
  margin-top: 2px;
  font-size: var(--admin-font-xs);
  color: var(--admin-text-muted);
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plugin-auth-none {
  color: var(--admin-text-muted);
  font-size: var(--admin-font-sm);
}

/* 测试弹窗内部样式 */
.plugin-test-modal-scroll {
  max-height: calc(75vh - 110px);
  overflow-y: auto;
  padding-right: 4px;
}

.plugin-test-modal-scroll::-webkit-scrollbar {
  width: 6px;
}

.plugin-test-modal-scroll::-webkit-scrollbar-thumb {
  background: var(--admin-border-strong);
  border-radius: 3px;
}

.plugin-test-modal-scroll::-webkit-scrollbar-track {
  background: transparent;
}

.plugin-test-tip-banner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  border-radius: var(--admin-radius-sm);
  background: var(--admin-surface-muted);
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
  line-height: 1.5;
  margin-bottom: 16px;
}

.plugin-test-tip-icon {
  margin-top: 2px;
  flex-shrink: 0;
  color: var(--admin-text-subtle);
}

.plugin-test-headers {
  margin-bottom: 16px;
}

.plugin-test-field {
  margin-bottom: 12px;
}

.plugin-test-label {
  display: block;
  margin-bottom: 6px;
  font-size: var(--admin-font-sm);
  font-weight: 500;
  color: var(--admin-text);
}

.plugin-test-input {
  width: 100%;
}

.plugin-test-alert {
  margin-top: 12px;
}

/* 测试工具列表 */
.plugin-test-tools-section {
  margin-top: 16px;
}

.plugin-test-tools-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}

.plugin-test-tools-title-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.plugin-test-tools-title {
  font-size: var(--admin-font-sm);
  font-weight: 600;
  color: var(--admin-text);
}

.plugin-test-tools-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: var(--admin-primary-soft);
  color: var(--admin-primary);
  font-size: var(--admin-font-2xs);
  font-weight: 600;
}

.plugin-test-expand-all {
  padding: 0;
  height: auto;
  font-size: var(--admin-font-xs);
}

.plugin-test-tools-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.test-tool-card {
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-sm);
  background: var(--admin-surface);
  transition: border-color 150ms ease;
  overflow: hidden;
}

.test-tool-card:hover {
  border-color: var(--admin-border-strong);
}

.test-tool-card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 9px 12px;
  cursor: pointer;
  user-select: none;
}

.test-tool-card-identity {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.test-tool-icon {
  font-size: 14px;
  color: var(--admin-text-muted);
  flex-shrink: 0;
}

.test-tool-name {
  font-family: var(--admin-font-mono);
  font-size: 13px;
  font-weight: 600;
  color: var(--admin-text);
  word-break: break-all;
}

.test-tool-tag {
  font-size: 11px;
  line-height: 16px;
  margin: 0;
  border-radius: 999px;
  padding: 0 6px;
}

.test-tool-expand-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 0;
  background: none;
  cursor: pointer;
  color: var(--admin-text-muted);
  padding: 0;
  border-radius: 4px;
  transition: color 150ms ease, background-color 150ms ease;
}

.test-tool-expand-btn:hover {
  color: var(--admin-text);
  background: var(--admin-hover);
}

.test-tool-chevron {
  font-size: 11px;
  transition: transform 200ms ease;
}

.test-tool-preview {
  padding: 0 12px 9px 34px;
  font-size: var(--admin-font-xs);
  color: var(--admin-text-muted);
  line-height: 1.45;
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.test-tool-expanded {
  border-top: 1px solid var(--admin-border);
  background: var(--admin-surface-muted);
  padding: 10px 12px;
}

.test-tool-desc-pre {
  margin: 0;
  max-height: 220px;
  overflow-y: auto;
  font-family: var(--admin-font-mono);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--admin-text);
}

.test-tool-desc-pre::-webkit-scrollbar {
  width: 5px;
}

.test-tool-desc-pre::-webkit-scrollbar-thumb {
  background: var(--admin-border-strong);
  border-radius: 2.5px;
}
</style>
