<script setup lang="ts">
import {
  ArrowLeftOutlined,
  CheckOutlined,
  CopyOutlined,
} from '@ant-design/icons-vue'
import {
  Alert,
  App as AntApp,
  Button,
  Card,
  Descriptions,
  DescriptionsItem,
  Result,
  TabPane,
  Tabs,
  Tag,
} from 'ant-design-vue'
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import PageContainer from '@/components/common/PageContainer.vue'
import PageHeader from '@/components/common/PageHeader.vue'
import StatusBadge from '@/components/common/StatusBadge.vue'
import RunEventDetail from '@/features/runs/components/RunEventDetail.vue'
import RunStatusTag from '@/features/runs/components/RunStatusTag.vue'
import RunTimeline from '@/features/runs/components/RunTimeline.vue'
import { getMockRunDetail } from '@/features/runs/run.mocks'
import {
  formatDateTime,
  formatDuration,
  formatTokens,
  getDefaultTimelineItem,
} from '@/features/runs/run.utils'

const route = useRoute()
const router = useRouter()
const { message } = AntApp.useApp()

const activeTab = ref('trace')
const selectedTimelineId = ref<string>()
const runId = computed(() => String(route.params.runId ?? ''))
const run = computed(() => getMockRunDetail(runId.value))
const selectedTimelineItem = computed(() => run.value?.timeline.find(
  item => item.id === selectedTimelineId.value,
))
const safeRawJson = computed(() => JSON.stringify(run.value?.safeRawData ?? {}, null, 2))

watch(run, (detail) => {
  activeTab.value = 'trace'
  selectedTimelineId.value = detail
    ? getDefaultTimelineItem(detail.timeline)?.id
    : undefined
}, { immediate: true })

async function copySafeRawData() {
  try {
    await navigator.clipboard.writeText(safeRawJson.value)
    message.success('Safe Raw Data copied')
  }
  catch {
    message.error('Copy failed，请手动选择 JSON 文本。')
  }
}
</script>

<template>
  <PageContainer wide>
    <template v-if="run">
      <PageHeader
        eyebrow="Run inspector"
        title="Run Detail"
        description="检查 AgentRun 生命周期、durable AgentStep、用户可见 Messages 与安全 allowlist 投影。"
      >
        <template #actions>
          <div class="detail-header__actions">
            <Button @click="router.push('/runs')">
              <template #icon>
                <ArrowLeftOutlined />
              </template>
              Back to Runs
            </Button>
            <StatusBadge tone="info">
              Demo / Mock
            </StatusBadge>
          </div>
        </template>
      </PageHeader>

      <Card class="overview-card" :bordered="false">
        <div class="overview-card__heading">
          <div>
            <span>Run ID</span>
            <code>{{ run.id }}</code>
          </div>
          <RunStatusTag :status="run.status" />
        </div>

        <Descriptions size="small" :column="4">
          <DescriptionsItem label="Model">
            {{ run.model }}
          </DescriptionsItem>
          <DescriptionsItem label="Duration">
            {{ formatDuration(run.durationMs) }}
          </DescriptionsItem>
          <DescriptionsItem label="Tool Calls">
            {{ run.toolCallCount }}
          </DescriptionsItem>
          <DescriptionsItem label="Samplings">
            {{ run.samplingCount }}
          </DescriptionsItem>
          <DescriptionsItem label="Created">
            {{ formatDateTime(run.createdAt) }}
          </DescriptionsItem>
          <DescriptionsItem label="Started">
            {{ formatDateTime(run.startedAt) }}
          </DescriptionsItem>
          <DescriptionsItem label="Ended" :span="2">
            {{ formatDateTime(run.endedAt) }}
          </DescriptionsItem>
          <DescriptionsItem label="Total Tokens">
            {{ formatTokens(run.totalTokens) }}
          </DescriptionsItem>
          <DescriptionsItem label="Input Tokens">
            {{ formatTokens(run.inputTokens) }}
          </DescriptionsItem>
          <DescriptionsItem label="Output Tokens" :span="2">
            {{ formatTokens(run.outputTokens) }}
          </DescriptionsItem>
        </Descriptions>
      </Card>

      <Card class="detail-tabs-card" :bordered="false">
        <Tabs v-model:active-key="activeTab" class="detail-tabs">
          <TabPane key="trace" tab="Trace">
            <div class="trace-grid">
              <Card class="trace-panel trace-panel--timeline" :bordered="false" title="Execution Timeline">
                <template #extra>
                  <Tag>{{ run.timeline.length }} items</Tag>
                </template>
                <RunTimeline
                  :items="run.timeline"
                  :selected-id="selectedTimelineId"
                  @select="selectedTimelineId = $event"
                />
              </Card>

              <Card class="trace-panel" :bordered="false" title="Event Detail">
                <RunEventDetail :item="selectedTimelineItem" />
              </Card>
            </div>
          </TabPane>

          <TabPane key="messages" tab="Messages">
            <Alert
              class="tab-notice"
              type="info"
              show-icon
              message="User-visible transcript only"
              description="这里不展示 system prompt、Tool Observation 或内部 sampling message。"
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
                  <time :title="`Created ${formatDateTime(item.createdAt)}`">
                    Updated {{ formatDateTime(item.updatedAt) }}
                  </time>
                </header>
                <p>{{ item.contentPreview }}</p>
                <code>{{ item.id }}</code>
              </article>
            </div>
          </TabPane>

          <TabPane key="safe-raw" tab="Safe Raw Data">
            <Alert
              class="tab-notice"
              type="warning"
              show-icon
              message="Allowlist projection, not provider raw payload"
              description="不包含完整 prompt、完整 Tool arguments、Tool Result、Observation、stack、secret、Authorization 或 chain-of-thought。"
            />

            <section class="safe-raw-panel">
              <header>
                <div>
                  <CheckOutlined />
                  <span>Safe Mock JSON</span>
                </div>
                <Button size="small" @click="copySafeRawData">
                  <template #icon>
                    <CopyOutlined />
                  </template>
                  Copy
                </Button>
              </header>
              <pre>{{ safeRawJson }}</pre>
            </section>
          </TabPane>
        </Tabs>
      </Card>
    </template>

    <Result
      v-else
      status="404"
      title="Demo Run not found"
      sub-title="该 Run ID 不在本地类型化 Mock 集合中。"
    >
      <template #extra>
        <Button type="primary" @click="router.push('/runs')">
          Back to Runs
        </Button>
      </template>
    </Result>
  </PageContainer>
</template>

<style scoped>
.detail-header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.overview-card,
.detail-tabs-card,
.trace-panel {
  border: 1px solid var(--admin-border);
  background: var(--admin-surface);
  box-shadow: var(--admin-card-shadow);
}

.overview-card :deep(.ant-card-body) {
  padding: 15px 18px 10px;
}

.overview-card__heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 13px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--admin-border);
}

.overview-card__heading > div {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.overview-card__heading span {
  color: var(--admin-text-subtle);
  font-size: 9px;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.overview-card__heading code {
  overflow: hidden;
  color: var(--admin-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.overview-card :deep(.ant-descriptions-item-label) {
  color: var(--admin-text-subtle);
  font-size: 10px;
}

.overview-card :deep(.ant-descriptions-item-content) {
  color: var(--admin-text);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.detail-tabs-card {
  min-width: 0;
  margin-top: 12px;
}

.detail-tabs-card :deep(> .ant-card-body) {
  min-width: 0;
  padding: 0 14px 14px;
}

.detail-tabs :deep(.ant-tabs-nav) {
  margin-bottom: 12px;
}

.detail-tabs :deep(.ant-tabs-tab) {
  padding: 12px 4px 10px;
  font-size: 11px;
  font-weight: 600;
}

.trace-grid {
  display: grid;
  grid-template-columns: minmax(290px, 340px) minmax(0, 1fr);
  gap: 12px;
  min-width: 0;
}

.trace-panel {
  min-width: 0;
  box-shadow: none;
}

.trace-panel :deep(.ant-card-head) {
  min-height: 42px;
  padding: 0 14px;
  border-bottom-color: var(--admin-border);
}

.trace-panel :deep(.ant-card-head-title) {
  padding: 11px 0;
  color: var(--admin-text);
  font-size: 11px;
  font-weight: 650;
}

.trace-panel :deep(.ant-card-extra) {
  padding: 8px 0;
}

.trace-panel :deep(.ant-card-extra .ant-tag) {
  margin: 0;
  font-size: 9px;
}

.trace-panel :deep(.ant-card-body) {
  min-width: 0;
  padding: 14px;
}

.trace-panel--timeline :deep(.ant-card-body) {
  max-height: 570px;
  overflow-y: auto;
}

.tab-notice {
  margin-bottom: 12px;
}

.tab-notice :deep(.ant-alert-message) {
  font-size: 11px;
  font-weight: 650;
}

.tab-notice :deep(.ant-alert-description) {
  font-size: 10px;
}

.message-list {
  display: grid;
  gap: 10px;
}

.message-card {
  min-width: 0;
  padding: 14px 16px;
  border: 1px solid var(--admin-border);
  border-radius: 8px;
  background: var(--admin-surface);
}

.message-card.is-user {
  border-left: 3px solid var(--admin-primary);
}

.message-card.is-assistant {
  border-left: 3px solid var(--admin-success);
}

.message-card header,
.message-card header > div,
.safe-raw-panel header,
.safe-raw-panel header > div {
  display: flex;
  align-items: center;
}

.message-card header,
.safe-raw-panel header {
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
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 9px;
}

.message-card p {
  margin: 12px 0 10px;
  color: var(--admin-text);
  font-size: 12px;
  line-height: 1.75;
}

.message-card code {
  overflow-wrap: anywhere;
}

.safe-raw-panel {
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--admin-border);
  border-radius: 8px;
  background: var(--admin-bg-deep);
}

.safe-raw-panel header {
  min-height: 44px;
  padding: 7px 10px 7px 14px;
  border-bottom: 1px solid var(--admin-border);
  background: var(--admin-surface);
}

.safe-raw-panel header > div {
  gap: 7px;
  color: var(--admin-success-strong);
}

.safe-raw-panel header span {
  color: var(--admin-text);
  font-size: 11px;
  font-weight: 650;
}

.safe-raw-panel pre {
  max-height: 520px;
  margin: 0;
  padding: 16px;
  overflow: auto;
  color: var(--admin-text-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  line-height: 1.65;
  tab-size: 2;
}

@media (max-width: 1120px) {
  .trace-grid {
    grid-template-columns: 1fr;
  }
}
</style>
