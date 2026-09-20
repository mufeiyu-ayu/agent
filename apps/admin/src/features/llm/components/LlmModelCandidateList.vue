<script setup lang="ts">
import type { AdminLlmModelTestResult } from '@agent/contracts'
import { CheckCircleFilled, CloseCircleFilled, LoadingOutlined, SearchOutlined } from '@ant-design/icons-vue'
import { Button, Checkbox, Empty, Input, Skeleton, Tooltip } from 'ant-design-vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

/**
 * 拉取回来的模型名清单：搜索、多选、已存在的置灰。
 * 服务商弹窗里使用；选中项由父组件持有。
 */
const props = defineProps<{
  candidates: string[]
  /** 当前服务商已有的 wireName，置灰不可选。 */
  existing: string[]
  loading: boolean
  modelValue: string[]
  /** 自动测试的结果，按 wireName 取；没测过的不显示标记。 */
  testResults?: Record<string, AdminLlmModelTestResult>
  /** 已发起、结果还没回来的名字。 */
  testingNames?: Set<string>
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string[]]
}>()

const { t } = useI18n()
const searchQuery = ref('')

const existingSet = computed(() => new Set(props.existing))
const selectedSet = computed(() => new Set(props.modelValue))

const filteredCandidates = computed(() => {
  const query = searchQuery.value.trim().toLowerCase()

  return query
    ? props.candidates.filter(item => item.toLowerCase().includes(query))
    : props.candidates
})

const selectableFiltered = computed(() => (
  filteredCandidates.value.filter(item => !existingSet.value.has(item))
))

function toggle(name: string) {
  if (existingSet.value.has(name))
    return

  emit('update:modelValue', selectedSet.value.has(name)
    ? props.modelValue.filter(item => item !== name)
    : [...props.modelValue, name])
}

function selectAllFiltered() {
  emit('update:modelValue', [...new Set([...props.modelValue, ...selectableFiltered.value])])
}

function deselectAll() {
  emit('update:modelValue', [])
}
</script>

<template>
  <Skeleton v-if="loading" active :paragraph="{ rows: 4 }" />

  <div v-else class="candidate-list">
    <div class="candidate-list__toolbar">
      <Input
        v-model:value="searchQuery"
        :placeholder="t('llmModels.fetch.searchPlaceholder')"
        allow-clear
        size="small"
        class="candidate-list__search"
      >
        <template #prefix>
          <SearchOutlined class="candidate-list__search-icon" />
        </template>
      </Input>

      <div class="candidate-list__actions">
        <Button
          size="small"
          type="text"
          class="action-btn"
          :disabled="selectableFiltered.length === 0"
          @click="selectAllFiltered"
        >
          {{ t('llmModels.fetch.selectAll') }}
        </Button>
        <Button
          size="small"
          type="text"
          class="action-btn"
          :disabled="modelValue.length === 0"
          @click="deselectAll"
        >
          {{ t('llmModels.fetch.deselectAll') }}
        </Button>
        <span class="candidate-list__badge" :class="{ 'is-selected': modelValue.length > 0 }">
          {{ t('llmModels.fetch.selectedCount', { count: modelValue.length }) }}
        </span>
      </div>
    </div>

    <Empty
      v-if="filteredCandidates.length === 0"
      :image="Empty.PRESENTED_IMAGE_SIMPLE"
      :description="candidates.length === 0 ? t('llmModels.fetch.emptyCandidates') : t('llmModels.fetch.noSearchResults')"
      class="candidate-empty"
    />

    <div v-else class="candidate-list__rows">
      <div
        v-for="name in filteredCandidates"
        :key="name"
        class="candidate-row"
        :class="{ 'is-existing': existingSet.has(name), 'is-selected': selectedSet.has(name) }"
        @click="toggle(name)"
      >
        <Checkbox
          :checked="selectedSet.has(name)"
          :disabled="existingSet.has(name)"
          class="candidate-row__checkbox"
          @click.stop
          @change="toggle(name)"
        >
          <span class="candidate-row__name">{{ name }}</span>
        </Checkbox>
        <span class="candidate-row__side">
          <template v-if="testResults?.[name]">
            <CheckCircleFilled v-if="testResults[name]!.ok" class="candidate-row__result is-ok" />
            <Tooltip v-else :title="testResults[name]!.error">
              <CloseCircleFilled class="candidate-row__result is-failed" />
            </Tooltip>
          </template>
          <LoadingOutlined v-else-if="testingNames?.has(name)" class="candidate-row__result is-testing" />
          <span v-if="existingSet.has(name)" class="candidate-row__tag">
            {{ t('llmModels.fetch.alreadyExists') }}
          </span>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.candidate-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.candidate-list__toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.candidate-list__search {
  flex: 1;
  min-width: 0;
}

.candidate-list__search :deep(.ant-input) {
  font-size: var(--admin-font-xs);
}

.candidate-list__search-icon {
  color: var(--admin-text-subtle);
  font-size: 12px;
}

.candidate-list__actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.action-btn {
  font-size: var(--admin-font-xs);
  padding: 0 6px;
  height: 24px;
  line-height: 24px;
}

.candidate-list__badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: var(--admin-radius-sm);
  background: var(--admin-hover);
  color: var(--admin-text-muted);
  font-size: var(--admin-font-2xs);
  font-weight: 500;
  white-space: nowrap;
  transition: all 120ms ease;
}

.candidate-list__badge.is-selected {
  background: var(--admin-primary-soft);
  color: var(--admin-primary);
  font-weight: 600;
}

.candidate-empty {
  margin: 16px 0;
}

.candidate-empty :deep(.ant-empty-description) {
  font-size: var(--admin-font-xs);
  color: var(--admin-text-subtle);
}

.candidate-list__rows {
  max-height: 200px;
  overflow-y: auto;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-sm);
  background: var(--admin-surface);
}

.candidate-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  border-bottom: 1px solid var(--admin-border);
  cursor: pointer;
  transition: background-color 100ms ease;
}

.candidate-row:last-child {
  border-bottom: none;
}

.candidate-row:hover:not(.is-existing) {
  background: var(--admin-hover);
}

.candidate-row.is-selected {
  background: var(--admin-primary-soft);
}

.candidate-row.is-existing {
  background: var(--admin-surface-muted);
  cursor: not-allowed;
  opacity: 0.7;
}

.candidate-row__checkbox {
  display: flex;
  align-items: center;
  min-width: 0;
}

.candidate-row__name {
  color: var(--admin-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--admin-font-xs);
  user-select: none;
}

.candidate-row__side {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.candidate-row__result {
  font-size: 14px;
}

.candidate-row__result.is-ok {
  color: var(--admin-success);
}

.candidate-row__result.is-failed {
  color: var(--admin-danger);
}

.candidate-row__result.is-testing {
  color: var(--admin-text-subtle);
}

.candidate-row__tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--admin-hover);
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-2xs);
  line-height: 1.4;
  white-space: nowrap;
}
</style>
