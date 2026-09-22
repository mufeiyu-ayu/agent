<script setup lang="ts">
import type { OverviewWindowKey } from '../mock-data'
import { ReloadOutlined } from '@ant-design/icons-vue'
import { Button, Segmented } from 'ant-design-vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  activeWindow: OverviewWindowKey
  loading: boolean
}>()

const emit = defineEmits<{
  'update:activeWindow': [key: OverviewWindowKey]
  'refresh': []
}>()

const { t } = useI18n()

const windowOptions = computed(() => [
  { label: t('overview.windows.w24h'), value: '24h' },
  { label: t('overview.windows.w7d'), value: '7d' },
  { label: t('overview.windows.w30d'), value: '30d' },
])

function handleWindowChange(val: string | number) {
  emit('update:activeWindow', val as OverviewWindowKey)
}
</script>

<template>
  <header class="overview-header">
    <div class="overview-header__title-block">
      <div class="overview-header__title-row">
        <h1 class="overview-header__title">
          {{ t('overview.title') }}
        </h1>
        <span class="overview-header__badge">Live Trace</span>
      </div>
      <p class="overview-header__description">
        {{ t('overview.description') }}
      </p>
    </div>

    <div class="overview-header__actions">
      <Segmented
        :value="props.activeWindow"
        :options="windowOptions"
        class="overview-header__segmented"
        @change="handleWindowChange"
      />
      <Button
        :loading="props.loading"
        class="overview-header__refresh-btn"
        @click="emit('refresh')"
      >
        <template #icon>
          <ReloadOutlined />
        </template>
        {{ t('common.actions.refresh') }}
      </Button>
    </div>
  </header>
</template>

<style scoped>
.overview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 16px;
  margin-bottom: 20px;
}

.overview-header__title-block {
  min-width: 0;
}

.overview-header__title-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.overview-header__title {
  margin: 0;
  color: var(--admin-text);
  font-size: var(--admin-font-2xl, 24px);
  font-weight: 700;
  letter-spacing: -0.02em;
  line-height: 1.2;
}

.overview-header__badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--admin-primary-soft);
  color: var(--admin-primary);
  font-size: var(--admin-font-2xs, 11px);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.overview-header__description {
  margin: 6px 0 0;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-sm, 13px);
}

.overview-header__actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.overview-header__segmented {
  background: var(--admin-bg-deep);
  border: 1px solid var(--admin-border);
  padding: 2px;
}

.overview-header__refresh-btn {
  background: var(--admin-surface);
  border-color: var(--admin-border);
  color: var(--admin-text);
}

@media (max-width: 768px) {
  .overview-header {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
