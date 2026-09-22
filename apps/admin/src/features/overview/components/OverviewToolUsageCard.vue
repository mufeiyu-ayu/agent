<script setup lang="ts">
import type { OverviewToolRow } from '../overview.model'

import { useI18n } from 'vue-i18n'

import OverviewCard from './OverviewCard.vue'

defineProps<{
  rows: OverviewToolRow[]
}>()

const { locale, t } = useI18n()
</script>

<template>
  <OverviewCard :title="t('overview.tools.title')" :subtitle="t('overview.tools.subtitle')">
    <template v-if="rows.length > 0">
      <div class="tool-bar">
        <span
          v-for="row in rows"
          :key="row.name"
          class="tool-bar__segment"
          :style="{ width: `${row.share}%`, background: row.color }"
        />
      </div>
      <ul class="tool-list">
        <li v-for="row in rows" :key="row.name" class="tool-item">
          <span class="tool-item__swatch" :style="{ background: row.color }" />
          <span class="tool-item__name">{{ row.name }}</span>
          <span class="tool-item__count">{{ row.count.toLocaleString(locale) }}</span>
          <span class="tool-item__share">{{ row.share.toFixed(1) }}%</span>
        </li>
      </ul>
    </template>
    <p v-else class="tool-empty">
      {{ t('overview.tools.empty') }}
    </p>
  </OverviewCard>
</template>

<style scoped>
.tool-bar {
  display: flex;
  height: 8px;
  gap: 2px;
  border-radius: 4px;
  overflow: hidden;
  margin-bottom: 12px;
}

.tool-bar__segment {
  display: block;
  height: 100%;
  border-radius: 2px;
  transition: width 300ms ease;
}

.tool-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.tool-item {
  display: grid;
  grid-template-columns: 8px minmax(0, 1fr) auto 52px;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.tool-item__swatch {
  width: 8px;
  height: 8px;
  border-radius: 2px;
}

.tool-item__name {
  color: var(--admin-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-item__count {
  color: var(--admin-text);
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}

.tool-item__share {
  color: var(--admin-text-subtle);
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.tool-empty {
  margin: 0;
  color: var(--admin-text-subtle);
  font-size: 13px;
}
</style>
