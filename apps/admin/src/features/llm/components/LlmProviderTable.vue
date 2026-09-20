<script setup lang="ts">
import type { AdminLlmProvider } from '@agent/contracts'
import {
  Button,
  Empty,
  Popconfirm,
  Skeleton,
  Switch,
  Tooltip,
} from 'ant-design-vue'
import { useI18n } from 'vue-i18n'

import LlmFamilyLogo from '@/features/llm/components/LlmFamilyLogo.vue'
import LlmIcon from '@/features/llm/components/LlmIcon.vue'
import { formatShortDateTime } from '@/features/runs/run.utils'

defineProps<{
  providers: AdminLlmProvider[]
  selectedId: string | null
  loading: boolean
}>()

const emit = defineEmits<{
  select: [id: string]
  edit: [provider: AdminLlmProvider]
  delete: [id: string]
  toggleEnabled: [id: string, enabled: boolean]
}>()

const { locale, t } = useI18n()
</script>

<template>
  <div class="provider-panel">
    <div v-if="loading && !providers.length" class="skeleton-list">
      <div v-for="i in 3" :key="i" class="provider-skeleton-card">
        <Skeleton active :paragraph="{ rows: 2 }" :title="{ width: '50%' }" />
      </div>
    </div>

    <div v-else-if="!providers.length" class="empty-wrap">
      <Empty :image="Empty.PRESENTED_IMAGE_SIMPLE" :description="t('llmModels.providers.empty')" />
    </div>

    <div v-else class="provider-list">
      <article
        v-for="provider in providers"
        :key="provider.id"
        class="provider-card"
        :class="{
          'is-selected': provider.id === selectedId,
          'is-disabled': !provider.enabled,
        }"
        @click="emit('select', provider.id)"
      >
        <div class="provider-card__head">
          <div class="provider-card__title-wrap">
            <LlmFamilyLogo :family="provider.family" :size="14" badge />
            <div class="provider-card__title-body">
              <strong class="provider-card__name">
                {{ t(`llmModels.families.${provider.family}`) }}
              </strong>
              <span v-if="provider.note" class="provider-card__note" :title="provider.note">
                {{ provider.note }}
              </span>
            </div>
          </div>

          <div class="provider-card__switch" @click.stop>
            <Tooltip :title="provider.enabled ? t('llmModels.statusEnabled') : t('llmModels.statusDisabled')">
              <Switch
                :checked="provider.enabled"
                size="small"
                @change="(checked) => emit('toggleEnabled', provider.id, Boolean(checked))"
              />
            </Tooltip>
          </div>
        </div>

        <div class="provider-card__meta">
          <div class="meta-row" :title="provider.baseUrl">
            <LlmIcon name="globe" :size="12" class="meta-icon" />
            <code class="meta-url">{{ provider.baseUrl }}</code>
          </div>
          <div class="meta-row">
            <LlmIcon name="key" :size="12" class="meta-icon" />
            <span class="meta-key">••••{{ provider.apiKeyLast4 }}</span>
          </div>
        </div>

        <div class="provider-card__footer">
          <div class="footer-left">
            <span class="badge-count">
              {{ t('llmModels.providerBadge', { count: provider.modelCount }) }}
            </span>
            <span class="date-text">
              {{ formatShortDateTime(provider.updatedAt, locale) }}
            </span>
          </div>

          <div class="footer-actions" @click.stop>
            <Tooltip :title="t('llmModels.actions.edit')">
              <Button
                type="text"
                size="small"
                class="action-btn"
                @click="emit('edit', provider)"
              >
                <template #icon>
                  <LlmIcon name="edit" :size="13" />
                </template>
              </Button>
            </Tooltip>

            <Popconfirm
              :title="t('llmModels.providers.deleteConfirmTitle')"
              :description="t('llmModels.providers.deleteConfirmDescription')"
              :ok-text="t('llmModels.actions.confirm')"
              :cancel-text="t('llmModels.actions.cancel')"
              placement="topRight"
              @confirm="emit('delete', provider.id)"
            >
              <Tooltip :title="t('llmModels.actions.delete')">
                <Button
                  type="text"
                  danger
                  size="small"
                  class="action-btn is-danger"
                >
                  <template #icon>
                    <LlmIcon name="delete" :size="13" />
                  </template>
                </Button>
              </Tooltip>
            </Popconfirm>
          </div>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.provider-panel {
  display: flex;
  flex: 1;
  height: 100%;
  flex-direction: column;
}

.skeleton-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
}

.provider-skeleton-card {
  padding: 14px;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-sm);
  background: var(--admin-surface);
}

.empty-wrap {
  display: grid;
  flex: 1;
  min-height: 240px;
  place-items: center;
  padding: 48px 16px;
}

.provider-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}

.provider-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 12px 14px;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-sm);
  background: var(--admin-surface);
  cursor: pointer;
  transition: border-color 150ms ease, background-color 150ms ease, box-shadow 150ms ease;
}

.provider-card:hover {
  border-color: var(--admin-border-strong);
  background: var(--admin-hover);
}

.provider-card.is-selected {
  border-color: color-mix(in srgb, var(--admin-primary) 42%, var(--admin-border));
  background: color-mix(in srgb, var(--admin-primary) 3.5%, var(--admin-surface));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--admin-primary) 22%, transparent), var(--admin-shadow-sm);
}

.provider-card.is-selected::before {
  content: '';
  position: absolute;
  left: -1px;
  top: 10px;
  bottom: 10px;
  width: 3.5px;
  border-radius: 0 3px 3px 0;
  background: var(--admin-primary);
  box-shadow: 0 0 6px color-mix(in srgb, var(--admin-primary) 40%, transparent);
}

.provider-card.is-disabled {
  opacity: 0.65;
}

.provider-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.provider-card__title-wrap {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
  flex: 1;
}

.provider-card__title-body {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}

.provider-card__name {
  overflow: hidden;
  color: var(--admin-text);
  font-size: var(--admin-font-sm);
  font-weight: 600;
  letter-spacing: -0.01em;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.provider-card__note {
  display: inline-block;
  padding: 0 6px;
  height: 18px;
  line-height: 18px;
  border-radius: 4px;
  background: var(--admin-surface-muted);
  border: 1px solid var(--admin-border);
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-2xs);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.provider-card__switch {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.provider-card__meta {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.meta-row {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
}

.meta-icon {
  flex: 0 0 13px;
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-xs);
}

.meta-url {
  overflow: hidden;
  color: var(--admin-text-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--admin-font-2xs);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.meta-key {
  color: var(--admin-text-subtle);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--admin-font-2xs);
  letter-spacing: 0.05em;
}

.provider-card__footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid var(--admin-border);
}

.footer-left {
  display: flex;
  align-items: center;
  gap: 8px;
}

.badge-count {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 4px;
  color: var(--admin-primary);
  background: var(--admin-primary-soft);
  font-size: var(--admin-font-2xs);
  font-weight: 550;
  transition: all 150ms ease;
}

.provider-card.is-selected .badge-count {
  background: var(--admin-surface);
  border: 1px solid color-mix(in srgb, var(--admin-primary) 30%, transparent);
  color: var(--admin-primary);
  font-weight: 600;
}

.date-text {
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-2xs);
  font-variant-numeric: tabular-nums;
}

.footer-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity 140ms ease;
}

.provider-card:hover .footer-actions,
.provider-card.is-selected .footer-actions {
  opacity: 1;
}

.action-btn {
  width: 24px;
  height: 24px;
  padding: 0;
  border-radius: var(--admin-radius-sm);
  color: var(--admin-text-subtle);
}

.action-btn:hover {
  color: var(--admin-primary);
  background: var(--admin-hover);
}

.action-btn.is-danger:hover {
  color: var(--admin-danger);
  background: var(--admin-danger-soft);
}
</style>
