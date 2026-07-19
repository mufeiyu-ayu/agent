<script setup lang="ts">
import {
  ApiOutlined,
  AppstoreOutlined,
  BranchesOutlined,
  EyeOutlined,
} from '@ant-design/icons-vue'
import { Card } from 'ant-design-vue'

import PageContainer from '@/components/common/PageContainer.vue'
import PageHeader from '@/components/common/PageHeader.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'

const foundations = [
  {
    icon: AppstoreOutlined,
    label: '应用边界',
    value: 'apps/admin',
    detail: '独立 Vue + Vite 应用',
    tone: 'info' as const,
    status: 'Ready',
  },
  {
    icon: BranchesOutlined,
    label: '当前路由',
    value: '3 routes',
    detail: 'Overview / Runs / Detail',
    tone: 'success' as const,
    status: 'Static',
  },
  {
    icon: ApiOutlined,
    label: 'Runtime API',
    value: 'Not connected',
    detail: '后续 Task 再接入',
    tone: 'neutral' as const,
    status: 'Planned',
  },
]
</script>

<template>
  <PageContainer>
    <PageHeader
      eyebrow="Runtime workspace"
      title="Overview"
      description="用于后续观察 AgentRun、AgentStep 与 Tool Execution 的后台入口。当前任务只建立可靠、克制的前端基础壳。"
    >
      <template #actions>
        <StatusBadge tone="success">
          Foundation online
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
          <h2>Console foundation</h2>
          <p>Task 0 建立视觉与状态边界，真实可观测数据仍保持明确隔离。</p>
        </div>
      </div>

      <div class="scope-list">
        <div>
          <span>01</span>
          <strong>Shell</strong>
          <p>Sidebar、Header、Breadcrumb、Route Tabs 和 Page Content。</p>
        </div>
        <div>
          <span>02</span>
          <strong>Preferences</strong>
          <p>明暗 / 系统主题与 Sidebar 折叠状态保存在本地。</p>
        </div>
        <div>
          <span>03</span>
          <strong>Data boundary</strong>
          <p>不连接 Run API，只展示明确标注的类型化 Demo Mock。</p>
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
