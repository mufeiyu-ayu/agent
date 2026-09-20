<script setup lang="ts">
import type { AdminLlmProvider } from '@agent/contracts'
import {
  DeleteOutlined,
  EditOutlined,
  GlobalOutlined,
  KeyOutlined,
} from '@ant-design/icons-vue'
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
            <span class="family-icon" :title="t(`llmModels.families.${provider.family}`)">
              <LlmFamilyLogo :family="provider.family" :size="16" />
            </span>
            <span
              class="status-dot"
              :class="{ 'is-active': provider.enabled }"
              :title="provider.enabled ? t('llmModels.statusEnabled') : t('llmModels.statusDisabled')"
            />
            <strong class="provider-card__name" :title="provider.note">
              {{ t(`llmModels.families.${provider.family}`) }}
              <span class="provider-card__note">{{ provider.note }}</span>
            </strong>
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
            <GlobalOutlined class="meta-icon" />
            <code class="meta-url">{{ provider.baseUrl }}</code>
          </div>
          <div class="meta-row">
            <KeyOutlined class="meta-icon" />
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
                  <EditOutlined />
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
                    <DeleteOutlined />
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
  gap: 10px;
  padding: 14px 14px 12px;
  border: 1px solid var(--admin-border);
  border-left: 3px solid transparent;
  border-radius: var(--admin-radius-sm);
  background: var(--admin-surface);
  cursor: pointer;
  transition: all 160ms ease;
}

.provider-card:hover {
  border-color: var(--admin-border-strong);
  background: var(--admin-hover);
  transform: translateY(-1px);
}

.provider-card.is-selected {
  border-color: var(--admin-primary);
  border-left-color: var(--admin-primary);
  background: var(--admin-primary-soft);
  box-shadow: var(--admin-shadow-sm);
}

.provider-card.is-disabled {
  opacity: 0.72;
}

.provider-card__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.provider-card__title-wrap {
  display: flex;
  min-width: 0;
  align-items: center;
  gap: 8px;
}

.family-icon {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
}

.status-dot {
  width: 7px;
  height: 7px;
  flex: 0 0 7px;
  border-radius: 50%;
  background: var(--admin-text-subtle);
  transition: background-color 160ms ease;
}

.status-dot.is-active {
  background: var(--admin-success);
  box-shadow: 0 0 0 3px var(--admin-success-soft);
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
  margin-left: 6px;
  color: var(--admin-text-muted);
  font-weight: 500;
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
  opacity: 0.7;
  transition: opacity 140ms ease;
}

.provider-card:hover .footer-actions,
.provider-card.is-selected .footer-actions {
  opacity: 1;
}

.action-btn {
  width: 26px;
  height: 26px;
  padding: 0;
  border-radius: var(--admin-radius-sm);
  color: var(--admin-text-muted);
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
