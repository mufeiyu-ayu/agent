<script setup lang="ts">
import type { AgentRunErrorCode } from '@agent/contracts'
import type { OverviewFailureReasonRow } from '../overview.model'

import { useI18n } from 'vue-i18n'

import { formatPercentage } from '@/features/runs/run.utils'

import OverviewCard from './OverviewCard.vue'

defineProps<{
  rows: OverviewFailureReasonRow[]
}>()

const emit = defineEmits<{
  select: [errorCode: AgentRunErrorCode]
}>()

const { locale, t } = useI18n()

function label(errorCode: AgentRunErrorCode | null): string {
  return errorCode ? t(`runTrace.errorCodes.${errorCode}`) : t('runTrace.inspector.unavailable')
}
</script>

<template>
  <OverviewCard :title="t('overview.failures.title')" :subtitle="t('overview.failures.subtitle')">
    <ul v-if="rows.length > 0" class="failure-list">
      <li v-for="row in rows" :key="row.key">
        <button
          v-if="row.errorCode"
          type="button"
          class="failure-item is-link"
          :title="t('overview.failures.open')"
          @click="emit('select', row.errorCode)"
        >
          <span class="failure-item__label">
            {{ label(row.errorCode) }}
            <code class="failure-item__code">{{ row.errorCode }}</code>
          </span>
          <span class="failure-item__count">{{ row.count.toLocaleString(locale) }}</span>
          <span class="failure-item__bar"><span class="failure-item__fill" :style="{ width: `${row.share * 100}%` }" /></span>
          <span class="failure-item__share">{{ formatPercentage(row.share, locale) }}</span>
        </button>
        <div v-else class="failure-item" :title="t('overview.failures.unrecordedHint')">
          <span class="failure-item__label">{{ label(null) }}</span>
          <span class="failure-item__count">{{ row.count.toLocaleString(locale) }}</span>
          <span class="failure-item__bar"><span class="failure-item__fill is-muted" :style="{ width: `${row.share * 100}%` }" /></span>
          <span class="failure-item__share">{{ formatPercentage(row.share, locale) }}</span>
        </div>
      </li>
    </ul>
    <p v-else class="failure-empty">
      {{ t('overview.failures.empty') }}
    </p>
  </OverviewCard>
</template>

<style scoped>
.failure-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.failure-item {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas:
    'label count'
    'bar share';
  gap: 4px 10px;
  align-items: center;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: var(--admin-text);
  font: inherit;
  font-size: 12px;
  text-align: left;
}

.failure-item.is-link {
  cursor: pointer;
  transition: background 150ms ease;
}

.failure-item.is-link:hover,
.failure-item.is-link:focus-visible {
  background: var(--admin-bg-deep);
  outline: none;
}

.failure-item__label {
  grid-area: label;
  display: flex;
  align-items: baseline;
  gap: 6px;
  min-width: 0;
  overflow: hidden;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.failure-item__code {
  color: var(--admin-text-subtle);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  font-weight: 400;
}

.failure-item__count {
  grid-area: count;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.failure-item__bar {
  grid-area: bar;
  height: 4px;
  border-radius: 2px;
  background: var(--admin-bg-deep);
  overflow: hidden;
}

.failure-item__fill {
  display: block;
  height: 100%;
  border-radius: 2px;
  background: var(--admin-danger-strong);
}

.failure-item__fill.is-muted {
  background: var(--admin-text-subtle);
}

.failure-item__share {
  grid-area: share;
  color: var(--admin-text-subtle);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.failure-empty {
  margin: 0;
  color: var(--admin-text-subtle);
  font-size: 13px;
}
</style>
