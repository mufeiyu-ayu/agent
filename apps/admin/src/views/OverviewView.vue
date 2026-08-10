<script setup lang="ts">
import {
  ApiOutlined,
  AppstoreOutlined,
  BranchesOutlined,
  EyeOutlined,
} from '@ant-design/icons-vue'
import { Card } from 'ant-design-vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import PageContainer from '@/components/common/PageContainer.vue'
import PageHeader from '@/components/common/PageHeader.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'

const { t } = useI18n()

const foundations = computed(() => [
  {
    icon: AppstoreOutlined,
    label: t('overview.cards.appBoundary'),
    value: t('overview.cards.appValue'),
    detail: t('overview.cards.appDetail'),
    tone: 'info' as const,
    status: t('overview.cards.ready'),
  },
  {
    icon: BranchesOutlined,
    label: t('overview.cards.routes'),
    value: t('overview.cards.routesValue'),
    detail: t('overview.cards.routesDetail'),
    tone: 'success' as const,
    status: t('overview.cards.ready'),
  },
  {
    icon: ApiOutlined,
    label: t('overview.cards.runtimeApi'),
    value: t('overview.cards.apiValue'),
    detail: t('overview.cards.apiDetail'),
    tone: 'success' as const,
    status: t('overview.cards.live'),
  },
])
</script>

<template>
  <PageContainer>
    <PageHeader
      :eyebrow="t('overview.eyebrow')"
      :title="t('overview.title')"
      :description="t('overview.description')"
    >
      <template #actions>
        <StatusBadge tone="success">
          {{ t('overview.foundationOnline') }}
        </StatusBadge>
      </template>
    </PageHeader>

    <div class="foundation-grid">
      <Card
        v-for="item in foundations"
        :key="item.label"
        class="foundation-card"
        :bordered="false"
      >
        <div class="foundation-card__top">
          <span class="foundation-card__icon">
            <component :is="item.icon" />
          </span>
          <StatusBadge :tone="item.tone">
            {{ item.status }}
          </StatusBadge>
        </div>
        <span class="foundation-card__label">{{ item.label }}</span>
        <strong>{{ item.value }}</strong>
        <small>{{ item.detail }}</small>
      </Card>
    </div>

    <Card class="scope-card" :bordered="false">
      <div class="scope-card__heading">
        <span class="scope-card__icon"><EyeOutlined /></span>
        <div>
          <h2>{{ t('overview.foundationTitle') }}</h2>
          <p>{{ t('overview.foundationDescription') }}</p>
        </div>
      </div>

      <div class="scope-list">
        <div>
          <span>01</span>
          <strong>{{ t('overview.scope.shell') }}</strong>
          <p>{{ t('overview.scope.shellDetail') }}</p>
        </div>
        <div>
          <span>02</span>
          <strong>{{ t('overview.scope.preferences') }}</strong>
          <p>{{ t('overview.scope.preferencesDetail') }}</p>
        </div>
        <div>
          <span>03</span>
          <strong>{{ t('overview.scope.data') }}</strong>
          <p>{{ t('overview.scope.dataDetail') }}</p>
        </div>
      </div>
    </Card>
  </PageContainer>
</template>

<style scoped>
.foundation-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
}

.foundation-card,
.scope-card {
  border: 1px solid var(--admin-border);
  background: var(--admin-surface);
  box-shadow: var(--admin-card-shadow);
}

.foundation-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 22px;
}

.foundation-card__icon,
.scope-card__icon {
  display: grid;
  width: 34px;
  height: 34px;
  place-items: center;
  border: 1px solid var(--admin-border);
  border-radius: 8px;
  color: var(--admin-primary);
  background: var(--admin-primary-soft);
  font-size: 16px;
}

.foundation-card__label {
  display: block;
  color: var(--admin-text-subtle);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.foundation-card strong {
  display: block;
  margin-top: 6px;
  color: var(--admin-text);
  font-size: 19px;
  font-weight: 650;
  letter-spacing: -0.02em;
}

.foundation-card small {
  display: block;
  margin-top: 7px;
  color: var(--admin-text-muted);
  font-size: 12px;
}

.scope-card {
  margin-top: 14px;
}

.scope-card__heading {
  display: flex;
  align-items: center;
  gap: 12px;
  padding-bottom: 18px;
  border-bottom: 1px solid var(--admin-border);
}

.scope-card h2,
.scope-card p {
  margin: 0;
}

.scope-card h2 {
  color: var(--admin-text);
  font-size: 14px;
  font-weight: 650;
}

.scope-card__heading p {
  margin-top: 4px;
  color: var(--admin-text-muted);
  font-size: 12px;
}

.scope-list {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 24px;
  padding-top: 20px;
}

.scope-list > div {
  display: grid;
  grid-template-columns: 28px 1fr;
  column-gap: 10px;
}

.scope-list span {
  grid-row: span 2;
  color: var(--admin-text-subtle);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
}

.scope-list strong {
  color: var(--admin-text);
  font-size: 12px;
}

.scope-list p {
  margin-top: 5px;
  color: var(--admin-text-muted);
  font-size: 12px;
  line-height: 1.55;
}
</style>
