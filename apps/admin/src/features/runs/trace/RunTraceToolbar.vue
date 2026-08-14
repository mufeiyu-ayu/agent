<script setup lang="ts">
import { SearchOutlined } from '@ant-design/icons-vue'
import { useI18n } from 'vue-i18n'

import { formatDuration } from '../run.utils'

defineProps<{
  durationMs: number | null
  requestCount: number
  callCount: number
  query: string
  filteredCount: number
  totalCount: number
  collapsedCount: number
}>()

const emit = defineEmits<{
  'update:query': [value: string]
  'expandAll': []
  'collapseRequests': []
}>()

const { locale, t } = useI18n()
</script>

<template>
  <div class="trace-toolbar" role="toolbar" :aria-label="t('runTrace.toolbar.ariaLabel')">
    <dl class="trace-toolbar__stats">
      <div>
        <dt>{{ t('runDetail.fields.duration') }}</dt>
        <dd>{{ formatDuration(durationMs) }}</dd>
      </div>
      <div>
        <dt>{{ t('runTrace.header.requests') }}</dt>
        <dd>{{ requestCount.toLocaleString(locale) }}</dd>
      </div>
      <div>
        <dt>{{ t('runDetail.fields.toolCalls') }}</dt>
        <dd>{{ callCount.toLocaleString(locale) }}</dd>
      </div>
    </dl>

    <div class="trace-toolbar__actions">
      <button
        type="button"
        class="trace-toolbar__button"
        :disabled="query.trim().length > 0 || collapsedCount === 0"
        @click="emit('expandAll')"
      >
        {{ t('runTrace.toolbar.expandAll') }}
      </button>
      <button
        type="button"
        class="trace-toolbar__button"
        :disabled="query.trim().length > 0 || requestCount === 0 || collapsedCount === requestCount"
        @click="emit('collapseRequests')"
      >
        {{ t('runTrace.toolbar.collapseRequests') }}
      </button>
    </div>

    <label class="trace-toolbar__search">
      <SearchOutlined aria-hidden="true" />
      <span class="sr-only">{{ t('runTrace.toolbar.searchLabel') }}</span>
      <input
        type="search"
        :value="query"
        :placeholder="t('runTrace.toolbar.searchPlaceholder')"
        @input="emit('update:query', ($event.target as HTMLInputElement).value)"
      >
    </label>

    <output class="trace-toolbar__count" aria-live="polite">
      {{ t('runTrace.toolbar.filteredCount', { filtered: filteredCount, total: totalCount }) }}
    </output>
  </div>
</template>

<style scoped>
.trace-toolbar {
  display: flex;
  flex: none;
  min-width: 0;
  min-height: 40px;
  align-items: center;
  gap: 14px;
  padding: 3px 12px;
  border-bottom: 1px solid var(--admin-border);
  background: color-mix(in srgb, var(--admin-bg-deep) 38%, var(--admin-surface));
}

.trace-toolbar__stats {
  display: flex;
  flex: none;
  margin: 0;
}

.trace-toolbar__stats > div {
  display: flex;
  align-items: baseline;
  gap: 5px;
  padding: 0 10px;
  border-left: 1px solid var(--admin-border);
}

.trace-toolbar__stats > div:first-child {
  padding-left: 2px;
  border-left: 0;
}

.trace-toolbar__stats dt,
.trace-toolbar__count {
  color: var(--admin-text-muted);
  font-size: 11px;
}

.trace-toolbar__stats dd {
  margin: 0;
  color: var(--admin-text);
  font-family: monospace;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.trace-toolbar__actions {
  display: flex;
  flex: none;
  gap: 4px;
}

.trace-toolbar__button {
  min-height: 32px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: var(--admin-radius);
  color: var(--admin-text-muted);
  background: transparent;
  cursor: pointer;
  font-size: 12px;
  transition: background-color 160ms ease, border-color 160ms ease, color 160ms ease, transform 160ms ease;
}

.trace-toolbar__button:hover:not(:disabled) {
  border-color: var(--admin-border);
  color: var(--admin-text);
  background: var(--admin-hover);
}

.trace-toolbar__button:disabled {
  color: var(--admin-text-subtle);
  cursor: not-allowed;
  opacity: 0.6;
}

.trace-toolbar__button:active:not(:disabled) {
  transform: translateY(1px);
}

.trace-toolbar__search {
  display: flex;
  flex: 1 1 230px;
  min-width: 180px;
  max-width: 360px;
  height: 34px;
  align-items: center;
  gap: 8px;
  margin-left: auto;
  padding: 0 10px;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius);
  color: var(--admin-text-muted);
  background: var(--admin-surface);
  font-size: 12px;
}

.trace-toolbar__search:focus-within {
  border-color: var(--admin-primary);
  box-shadow: 0 0 0 2px var(--admin-primary-soft);
}

.trace-toolbar__search input {
  width: 100%;
  min-width: 0;
  padding: 0;
  border: 0;
  outline: 0;
  color: var(--admin-text);
  background: transparent;
  font-size: 12px;
}

.trace-toolbar__search input::placeholder {
  color: var(--admin-text-muted);
}

.trace-toolbar__count {
  flex: none;
  min-width: 86px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

@container run-trace (max-width: 760px) {
  .trace-toolbar {
    flex-wrap: wrap;
  }

  .trace-toolbar__search {
    order: 3;
    max-width: none;
    margin-left: 0;
  }
}
</style>
