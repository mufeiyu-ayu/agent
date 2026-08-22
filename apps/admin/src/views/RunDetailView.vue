<script setup lang="ts">
import type { AdminDebugModelIOCapture } from '@agent/contracts'
import {
  Alert,
  Button,
  Card,
  Result,
  Skeleton,
  TabPane,
  Tabs,
  Tag,
} from 'ant-design-vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import PageContainer from '@/components/common/PageContainer.vue'
import RunStatusTag from '@/features/runs/components/RunStatusTag.vue'
import { createRunDetailState } from '@/features/runs/run-detail.state'
import { formatDateTime } from '@/features/runs/run.utils'
import DebugJsonPane from '@/features/runs/trace/inspectors/DebugJsonPane.vue'
import RunTraceWorkspace from '@/features/runs/trace/RunTraceWorkspace.vue'

const route = useRoute()
const router = useRouter()
const { locale, t } = useI18n()

const activeTab = ref('trace')
const runId = computed(() => String(route.params.runId ?? ''))
const runDetailState = createRunDetailState(() => runId.value)
const {
  cancel: cancelRunLoad,
  error: loadError,
  load: loadRun,
  loading,
  notFound,
  run,
} = runDetailState
const safeRawCapture = computed<AdminDebugModelIOCapture>(() => ({
  truncated: false,
  value: run.value?.safeRawData ?? {},
}))

watch(run, () => {
  activeTab.value = 'trace'
}, { immediate: true })

// AdminLayout 以 $route.path 为 key，每个路径独立实例：setup 加载一次即可。
// 不再 watch runId——离场过渡期间 param 变化只会让垂死实例发无效请求、闪 404。
void loadRun()

onBeforeUnmount(cancelRunLoad)
</script>

<template>
  <PageContainer wide>
    <h1 class="sr-only">
      {{ t('runDetail.title') }}
    </h1>

    <template v-if="loading">
      <Card class="overview-card" :bordered="false">
        <Skeleton active :paragraph="{ rows: 8 }" />
      </Card>
    </template>

    <template v-else-if="run">
      <Card class="detail-tabs-card" :bordered="false">
        <Tabs v-model:active-key="activeTab" class="detail-tabs">
          <TabPane key="trace" :tab="t('runDetail.tabs.trace')">
            <RunTraceWorkspace :run="run" />
          </TabPane>

          <TabPane key="messages" :tab="t('runDetail.tabs.messages')">
            <Alert
              class="tab-notice"
              type="info"
              show-icon
              :message="t('runDetail.transcriptOnly')"
              :description="t('runDetail.transcriptDescription')"
            />

            <div class="message-list">
              <article
                v-for="item in run.messages"
                :key="item.id"
                class="message-card"
                :class="`is-${item.role.toLowerCase()}`"
              >
                <header>
                  <div>
                    <Tag :color="item.role === 'USER' ? 'blue' : 'green'">
                      {{ item.role }}
                    </Tag>
                    <RunStatusTag :status="item.status" />
                  </div>
                  <time :title="t('runDetail.messageCreated', { time: formatDateTime(item.createdAt, locale) })">
                    {{ t('runDetail.messageUpdated', { time: formatDateTime(item.updatedAt, locale) }) }}
                  </time>
                </header>
                <p>{{ item.contentPreview }}</p>
                <code>{{ item.id }}</code>
              </article>
            </div>
          </TabPane>

          <TabPane key="safe-raw" :tab="t('runDetail.tabs.safeRaw')">
            <Alert
              class="tab-notice"
              type="warning"
              show-icon
              :message="t('runDetail.safeRawTitle')"
              :description="t('runDetail.safeRawDescription')"
            />

            <div class="safe-raw-json">
              <DebugJsonPane :capture="safeRawCapture" />
            </div>
          </TabPane>
        </Tabs>
      </Card>
    </template>

    <Result
      v-else-if="notFound"
      status="404"
      :title="t('runDetail.notFoundTitle')"
      :sub-title="t('runDetail.notFoundDescription')"
    >
      <template #extra>
        <Button @click="loadRun">
          {{ t('common.actions.retry') }}
        </Button>
        <Button type="primary" @click="router.push('/runs')">
          {{ t('common.actions.backToRuns') }}
        </Button>
      </template>
    </Result>

    <Result
      v-else
      status="error"
      :title="t('runDetail.loadFailedTitle')"
      :sub-title="loadError || t('errors.generic')"
    >
      <template #extra>
        <Button type="primary" @click="loadRun">
          {{ t('common.actions.retry') }}
        </Button>
        <Button @click="router.push('/runs')">
          {{ t('common.actions.backToRuns') }}
        </Button>
      </template>
    </Result>
  </PageContainer>
</template>

<style scoped>
.overview-card,
.detail-tabs-card {
  border: 1px solid var(--admin-border);
  background: var(--admin-surface);
  box-shadow: var(--admin-card-shadow);
}

.detail-tabs-card {
  min-width: 0;
}

.detail-tabs-card :deep(> .ant-card-body) {
  min-width: 0;
  padding: 0;
}

.detail-tabs :deep(.ant-tabs-nav) {
  margin: 0;
  padding: 0 18px;
}

.detail-tabs :deep(.ant-tabs-tab) {
  padding: 14px 4px 12px;
  font-size: 13px;
  font-weight: 600;
}

.detail-tabs :deep(.ant-tabs-content-holder) {
  min-width: 0;
}

.tab-notice {
  margin: 14px 14px 12px;
}

.tab-notice :deep(.ant-alert-message) {
  font-size: 13px;
  font-weight: 650;
}

.tab-notice :deep(.ant-alert-description) {
  font-size: 12px;
}

.message-list {
  display: grid;
  gap: 10px;
  padding: 0 14px 14px;
}

.message-card {
  min-width: 0;
  padding: 14px 16px;
  border: 1px solid var(--admin-border);
  border-radius: 8px;
  background: var(--admin-surface);
}

.message-card.is-user {
  border-color: color-mix(in srgb, var(--admin-primary) 24%, var(--admin-border));
  background: color-mix(in srgb, var(--admin-primary-soft) 45%, var(--admin-surface));
}

.message-card.is-assistant {
  border-color: color-mix(in srgb, var(--admin-success) 24%, var(--admin-border));
  background: color-mix(in srgb, var(--admin-success-soft) 45%, var(--admin-surface));
}

.message-card header,
.message-card header > div {
  display: flex;
  align-items: center;
}

.message-card header {
  justify-content: space-between;
  gap: 12px;
}

.message-card header > div {
  gap: 5px;
}

.message-card :deep(.ant-tag) {
  margin: 0;
}

.message-card time,
.message-card code {
  color: var(--admin-text-subtle);
  font-family: monospace;
  font-size: 9px;
}

.message-card p {
  margin: 12px 0 10px;
  color: var(--admin-text);
  font-size: 12px;
  line-height: 1.75;
  overflow-wrap: anywhere;
}

.message-card code {
  overflow-wrap: anywhere;
}

.safe-raw-json {
  min-width: 0;
  margin: 0 14px 14px;
}

/* 详情页整页可滚动，JSON 区比检查器侧栏（60vh）给得更高 */
.safe-raw-json :deep(.debug-json-tree),
.safe-raw-json :deep(.debug-json-preview) {
  max-height: 75vh;
}
</style>
