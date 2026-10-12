<script setup lang="ts">
import type { AdminSkillDetail, AdminSkillSummary } from '@agent/contracts'
import type { TableColumnsType } from 'ant-design-vue'
import {
  PlusOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
} from '@ant-design/icons-vue'
import {
  App as AntApp,
  Button,
  Input,
  Popconfirm,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
} from 'ant-design-vue'
import { computed, onMounted, onScopeDispose } from 'vue'

import { useI18n } from 'vue-i18n'
import DataTable from '@/components/common/DataTable.vue'
import PageContainer from '@/components/common/PageContainer.vue'
import PageHeader from '@/components/common/PageHeader.vue'
import SkillDetailDrawer from '@/features/skills/components/SkillDetailDrawer.vue'
import SkillFormModal from '@/features/skills/components/SkillFormModal.vue'
import { createSkillsState } from '@/features/skills/skills.state'
import { isBuiltinSkill } from '@/features/skills/skills.utils'

const { t } = useI18n()
const { message } = AntApp.useApp()

const state = createSkillsState()
onScopeDispose(state.dispose)

onMounted(() => {
  void state.load()
})

const columns = computed<TableColumnsType<AdminSkillSummary>>(() => [
  {
    key: 'name',
    title: t('skills.columns.name'),
    width: 260,
  },
  {
    key: 'description',
    title: t('skills.columns.description'),
  },
  {
    key: 'status',
    title: t('skills.columns.status'),
    width: 120,
    align: 'center',
  },
  {
    key: 'actions',
    title: t('skills.columns.actions'),
    width: 190,
    align: 'right',
  },
])

const statusOptions = computed(() => [
  { label: t('skills.statusAll'), value: 'ALL' },
  { label: t('skills.statusEnabled'), value: 'ENABLED' },
  { label: t('skills.statusDisabled'), value: 'DISABLED' },
])

async function handleToggle(skill: AdminSkillSummary) {
  try {
    const nextState = !skill.enabled
    if (!await state.toggleSkill(skill))
      return
    void message.success(t(nextState ? 'skills.enabledSuccess' : 'skills.disabledSuccess'))
  }
  catch (caught) {
    void message.error(caught instanceof Error ? caught.message : t('errors.generic'))
  }
}

async function handleDelete(skill: AdminSkillSummary) {
  try {
    if (!await state.deleteSkill(skill))
      return
    void message.success(t('skills.deleted'))
  }
  catch (caught) {
    void message.error(caught instanceof Error ? caught.message : t('errors.generic'))
  }
}

async function handleSaveSkill(input: { name: string, description: string, body: string }) {
  if (state.busy.value || state.formOutcomeUnknown.value)
    return
  try {
    const isEdit = state.editingSkill.value !== null
    await state.saveSkill(input)
    void message.success(t(isEdit ? 'skills.updated' : 'skills.created'))
  }
  catch (caught) {
    void message.error(caught instanceof Error ? caught.message : t('errors.generic'))
  }
}

async function handleOpenEdit(skill: AdminSkillSummary | AdminSkillDetail) {
  try {
    await state.openEdit(skill)
  }
  catch (caught) {
    void message.error(caught instanceof Error ? caught.message : t('errors.generic'))
  }
}
</script>

<template>
  <PageContainer wide>
    <PageHeader :title="t('skills.title')">
      <template #actions>
        <Space>
          <Button :loading="state.loading.value" :disabled="state.busy.value" @click="state.load">
            <template #icon>
              <ReloadOutlined />
            </template>
            {{ t('skills.refresh') }}
          </Button>
          <Button type="primary" :disabled="state.busy.value" @click="state.openCreate">
            <template #icon>
              <PlusOutlined />
            </template>
            {{ t('skills.create') }}
          </Button>
        </Space>
      </template>
    </PageHeader>

    <DataTable
      row-key="id"
      :columns="columns"
      :data-source="state.filteredSkills.value"
      :loading="state.loading.value"
      :error="state.error.value"
      :error-title="t('skills.loadFailed')"
      :summary="t('skills.total', { count: state.skills.value.length })"
      :empty-text="state.keyword.value ? t('skills.emptyFilter') : t('skills.empty')"
      @retry="state.load"
    >
      <!-- 列表顶部工具栏：搜索与状态筛选 -->
      <template #toolbar>
        <div class="skills-toolbar">
          <Input
            v-model:value="state.keyword.value"
            allow-clear
            :placeholder="t('skills.searchPlaceholder')"
            class="skills-search-input"
          >
            <template #prefix>
              <SearchOutlined style="color: var(--admin-text-muted);" />
            </template>
          </Input>

          <Select
            v-model:value="state.statusFilter.value"
            :options="statusOptions"
            class="skills-status-select"
          />
        </div>
      </template>

      <!-- 单元格自定义渲染 -->
      <template #bodyCell="{ column, record }">
        <!-- 技能名称列 -->
        <template v-if="column.key === 'name'">
          <div class="skill-name-cell">
            <button
              type="button"
              :disabled="state.busy.value"
              class="skill-name-text"
              @click="state.openDetail(record.id)"
            >
              {{ record.name }}
            </button>
            <Tooltip
              v-if="isBuiltinSkill(record.id)"
              :title="t('skills.builtinTip')"
            >
              <Tag color="purple" class="skill-builtin-tag">
                <template #icon>
                  <SafetyCertificateOutlined />
                </template>
                {{ t('skills.builtinBadge') }}
              </Tag>
            </Tooltip>
          </div>
        </template>

        <!-- 用途描述列 -->
        <template v-else-if="column.key === 'description'">
          <div class="skill-desc-cell" :title="record.description">
            {{ record.description }}
          </div>
        </template>

        <!-- 启用状态列 -->
        <template v-else-if="column.key === 'status'">
          <Switch
            :disabled="state.busy.value"
            :checked="record.enabled"
            :loading="state.pendingIds.value.has(record.id)"
            size="small"
            @change="handleToggle(record)"
          />
        </template>

        <!-- 操作按钮列 -->
        <template v-else-if="column.key === 'actions'">
          <Space size="small">
            <Button
              size="small"
              :disabled="state.busy.value"
              @click="state.openDetail(record.id)"
            >
              {{ t('skills.viewDetail') }}
            </Button>
            <Button
              size="small"
              :loading="state.fetchingEditTarget.value && state.editingId.value === record.id"
              :disabled="state.busy.value"
              @click="handleOpenEdit(record)"
            >
              {{ t('skills.edit') }}
            </Button>

            <!-- 删除操作：内置技能禁用并展示受保护 Tooltip -->
            <Tooltip
              v-if="isBuiltinSkill(record.id)"
              :title="t('skills.deleteForbiddenForBuiltin')"
            >
              <Button size="small" danger disabled>
                {{ t('common.actions.delete', '删除') }}
              </Button>
            </Tooltip>
            <Popconfirm
              v-else
              :title="t('skills.confirmDeleteTitle', { name: record.name })"
              :description="t('skills.confirmDeleteDesc')"
              ok-text="确认删除"
              cancel-text="取消"
              ok-type="danger"
              @confirm="handleDelete(record)"
            >
              <Button
                size="small"
                danger
                :loading="state.pendingIds.value.has(record.id)"
                :disabled="state.busy.value"
              >
                {{ t('common.actions.delete', '删除') }}
              </Button>
            </Popconfirm>
          </Space>
        </template>
      </template>
    </DataTable>

    <!-- 技能详情侧边抽屉 -->
    <SkillDetailDrawer
      :open="state.detailOpen.value"
      :skill="state.detailData.value"
      :loading="state.detailLoading.value"
      :error="state.detailError.value"
      :pending="state.busy.value"
      @update:open="!$event && state.closeDetail()"
      @toggle="handleToggle"
      @edit="handleOpenEdit"
    />

    <!-- 技能新建与编辑弹窗 -->
    <SkillFormModal
      :open="state.formModalOpen.value"
      :skill="state.editingSkill.value"
      :saving="state.saving.value"
      :error="state.formError.value"
      :outcome-unknown="state.formOutcomeUnknown.value"
      @update:open="!$event && state.closeFormModal()"
      @reconcile="state.closeFormModal(); state.load()"
      @save="handleSaveSkill"
    />
  </PageContainer>
</template>

<style scoped>
.skills-toolbar {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
}

.skills-search-input {
  max-width: 320px;
}

.skills-status-select {
  width: 130px;
}

.skill-name-cell {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  max-width: 100%;
}

.skill-name-text {
  padding: 0;
  border: 0;
  background: none;
  text-align: left;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-weight: 600;
  color: var(--admin-text);
  cursor: pointer;
  transition: color 140ms ease;
  white-space: nowrap;
  word-break: keep-all;
  overflow: hidden;
  text-overflow: ellipsis;
}

.skill-name-text:hover {
  color: var(--admin-primary);
}

.skill-builtin-tag {
  font-size: 11px;
  line-height: 18px;
  font-weight: 500;
  flex-shrink: 0;
  white-space: nowrap;
  margin-inline-end: 0;
}

.skill-desc-cell {
  color: var(--admin-text);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
