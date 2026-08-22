<script setup lang="ts">
import type { TableColumnsType } from 'ant-design-vue'
import type { RunListItem } from '@/features/runs/run.model'
import { EyeOutlined, RobotOutlined, UserOutlined } from '@ant-design/icons-vue'
import {
  Alert,
  Button,
  Card,
  Empty,
  Pagination,
  Result,
  Skeleton,
  Table,
  TabPane,
  Tabs,
  Tooltip,
} from 'ant-design-vue'
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import PageContainer from '@/components/common/PageContainer.vue'
import { createConversationDetailState } from '@/features/conversations/conversation-detail.state'
import RunStatusTag from '@/features/runs/components/RunStatusTag.vue'
import { fetchAdminRuns } from '@/features/runs/run-api'
import {
  formatDateTime,
  formatDuration,
  formatShortDateTime,
  formatTokens,
} from '@/features/runs/run.utils'
import { createPagedListState } from '@/features/shared/paged-list.state'

const route = useRoute()
const router = useRouter()
const { locale, t } = useI18n()

const activeTab = ref('transcript')
const conversationId = computed(() => String(route.params.conversationId ?? ''))
const detailState = createConversationDetailState(() => conversationId.value)
const {
  cancel: cancelDetailLoad,
  conversation,
  error: loadError,
  load: loadDetail,
  loading,
  notFound,
} = detailState

const runsState = createPagedListState<RunListItem>(
  async (page, pageSize, signal) => {
    const result = await fetchAdminRuns(
      { conversationId: conversationId.value, page, pageSize },
      { signal },
    )
    return { items: result.items, pagination: result.pagination }
  },
)

const runColumns = computed<TableColumnsType<RunListItem>>(() => [
  { title: t('runs.columns.runId'), dataIndex: 'id', key: 'id', width: 176, fixed: 'left' },
  { title: t('runs.columns.question'), dataIndex: 'questionPreview', key: 'question', width: 220 },
  { title: t('runs.columns.status'), dataIndex: 'status', key: 'status', width: 92 },
  { title: t('runs.columns.tokens'), dataIndex: 'totalTokens', key: 'tokens', width: 78, align: 'right' },
  { title: t('runs.columns.duration'), dataIndex: 'durationMs', key: 'duration', width: 78, align: 'right' },
  { title: t('runs.columns.createdAt'), dataIndex: 'createdAt', key: 'createdAt', width: 126 },
  { title: '', key: 'action', width: 54, fixed: 'right', align: 'center' },
])

// ponytail: transcript API 仍一次性返回全部消息（Issue #88 决策，payload 小），
// 前端按块渲染避免长会话一次挂载全部 DOM；payload 成为瓶颈时升级为服务端分页。
const TRANSCRIPT_CHUNK = 30
const visibleCount = ref(TRANSCRIPT_CHUNK)
const transcriptEl = ref<HTMLElement>()
const sentinelEl = ref<HTMLElement>()
const visibleMessages = computed(() => conversation.value?.messages.slice(0, visibleCount.value) ?? [])
const hasMoreMessages = computed(() => (conversation.value?.messages.length ?? 0) > visibleCount.value)
let transcriptObserver: IntersectionObserver | undefined
let runsLoaded = false

watch(conversation, () => {
  activeTab.value = 'transcript'
  visibleCount.value = TRANSCRIPT_CHUNK
}, { immediate: true })

// AdminLayout 以 $route.path 为 key，每个路径独立实例：setup 加载一次即可。
// 不 watch conversationId——离场过渡期间 param 变空只会让垂死实例发请求、闪 404。
void loadDetail()

// 运行记录 tab 首次激活才拉取，避免每次打开详情页都多一次被丢弃的请求。
watch(activeTab, (tab) => {
  if (tab === 'runs' && !runsLoaded) {
    runsLoaded = true
    void runsState.load()
  }
})

watch([sentinelEl, transcriptEl], ([sentinel, rootEl]) => {
  transcriptObserver?.disconnect()
  if (!sentinel)
    return

  transcriptObserver = new IntersectionObserver((entries) => {
    if (!entries.some(entry => entry.isIntersecting))
      return

    visibleCount.value += TRANSCRIPT_CHUNK
    // 渲染增量后重新 observe，哨兵仍在视口内时才能继续触发下一块。
    transcriptObserver?.unobserve(sentinel)
    void nextTick(() => {
      const next = sentinelEl.value
      if (next)
        transcriptObserver?.observe(next)
    })
  }, { root: rootEl ?? null, rootMargin: '200px 0px' })
  transcriptObserver.observe(sentinel)
}, { flush: 'post' })

onBeforeUnmount(() => {
  cancelDetailLoad()
  runsState.cancel()
  transcriptObserver?.disconnect()
})

function getRunDetailLocation(runId: string) {
  return {
    name: 'run-detail',
    params: { runId },
  }
}

function handleRunsPageChange(page: number, pageSize: number) {
  if (pageSize !== runsState.pageSize.value) {
    void runsState.setPageSize(pageSize)
    return
  }

  void runsState.setPage(page)
}
</script>

<template>
  <PageContainer wide class="conversation-page">
    <h1 class="sr-only">
      {{ t('conversationDetail.title') }}
    </h1>

    <template v-if="loading">
      <Card class="detail-card" :bordered="false">
        <Skeleton active :paragraph="{ rows: 8 }" />
      </Card>
    </template>

    <template v-else-if="conversation">
      <Card class="detail-card" :bordered="false">
        <header class="conversation-header">
          <div class="conversation-header__identity">
            <strong :title="conversation.title">{{ conversation.title }}</strong>
            <code :title="conversation.id">{{ conversation.id }}</code>
          </div>
          <dl class="conversation-header__meta">
            <div>
              <dt>{{ t('conversationDetail.fields.messages') }}</dt>
              <dd>{{ conversation.messages.length.toLocaleString(locale) }}</dd>
            </div>
            <div>
              <dt>{{ t('conversationDetail.fields.runs') }}</dt>
              <dd>{{ conversation.runCount.toLocaleString(locale) }}</dd>
            </div>
            <div>
              <dt>{{ t('conversationDetail.fields.createdAt') }}</dt>
              <dd>{{ formatDateTime(conversation.createdAt, locale) }}</dd>
            </div>
            <div>
              <dt>{{ t('conversationDetail.fields.updatedAt') }}</dt>
              <dd>{{ formatDateTime(conversation.updatedAt, locale) }}</dd>
            </div>
          </dl>
        </header>

        <Tabs v-model:active-key="activeTab" class="detail-tabs">
          <TabPane key="transcript" :tab="t('conversationDetail.tabs.transcript')">
            <Empty
              v-if="!conversation.messages.length"
              class="transcript-empty"
              :description="t('conversationDetail.transcriptEmpty')"
            />

            <div
              v-else
              ref="transcriptEl"
              class="transcript"
              :aria-label="t('conversationDetail.tabs.transcript')"
            >
              <article
                v-for="message in visibleMessages"
                :key="message.id"
                class="transcript-message"
                :class="`is-${message.role.toLowerCase()}`"
              >
                <span class="transcript-message__avatar" aria-hidden="true">
                  <UserOutlined v-if="message.role === 'USER'" />
                  <RobotOutlined v-else />
                </span>
                <div class="transcript-message__body">
                  <div class="transcript-message__bubble">
                    <p>{{ message.content }}</p>
                  </div>
                  <footer>
                    <span>{{ message.role === 'USER' ? t('conversationDetail.roleUser') : t('conversationDetail.roleAssistant') }}</span>
                    <time>{{ formatShortDateTime(message.createdAt, locale) }}</time>
                    <RunStatusTag v-if="message.status !== 'COMPLETED'" :status="message.status" />
                  </footer>
                </div>
              </article>
              <div v-if="hasMoreMessages" ref="sentinelEl" class="transcript__sentinel" aria-hidden="true" />
            </div>
          </TabPane>

          <TabPane key="runs" :tab="t('conversationDetail.tabs.runs')">
            <Alert
              v-if="runsState.error.value"
              class="runs-error"
              type="error"
              show-icon
              :message="t('runs.loadFailed')"
              :description="runsState.error.value"
            >
              <template #action>
                <Button
                  size="small"
                  :loading="runsState.loading.value"
                  @click="runsState.retry"
                >
                  {{ t('common.actions.retry') }}
                </Button>
              </template>
            </Alert>

            <Table
              v-else
              class="runs-table"
              :columns="runColumns"
              :data-source="runsState.items.value"
              :loading="runsState.loading.value"
              :pagination="false"
              row-key="id"
              size="small"
              :scroll="{ x: 810 }"
            >
              <template #bodyCell="{ column, record }">
                <template v-if="column.key === 'id'">
                  <Tooltip :title="record.id">
                    <RouterLink class="run-id" :to="getRunDetailLocation(record.id)">
                      {{ record.id }}
                    </RouterLink>
                  </Tooltip>
                </template>
                <template v-else-if="column.key === 'question'">
                  <Tooltip :title="record.questionPreview">
                    <span class="question-preview">{{ record.questionPreview }}</span>
                  </Tooltip>
                </template>
                <template v-else-if="column.key === 'status'">
                  <RunStatusTag :status="record.status" />
                </template>
                <template v-else-if="column.key === 'tokens'">
                  <span class="numeric-cell">{{ formatTokens(record.totalTokens, locale) }}</span>
                </template>
                <template v-else-if="column.key === 'duration'">
                  <span class="numeric-cell">{{ formatDuration(record.durationMs) }}</span>
                </template>
                <template v-else-if="column.key === 'createdAt'">
                  <span class="numeric-cell">{{ formatShortDateTime(record.createdAt, locale) }}</span>
                </template>
                <template v-else-if="column.key === 'action'">
                  <Tooltip :title="t('runs.inspect')">
                    <Button
                      type="text"
                      shape="circle"
                      size="small"
                      :aria-label="t('runs.inspectAria', { id: record.id })"
                      @click="router.push(getRunDetailLocation(record.id))"
                    >
                      <template #icon>
                        <EyeOutlined />
                      </template>
                    </Button>
                  </Tooltip>
                </template>
              </template>

              <template #emptyText>
                <Empty
                  v-if="!runsState.loading.value && !runsState.error.value"
                  :description="t('conversationDetail.runsEmpty')"
                />
              </template>
            </Table>

            <footer v-if="!runsState.error.value" class="runs-footer">
              <span>
                {{ t('runs.showing', {
                  count: runsState.items.value.length,
                  total: runsState.pagination.value.totalItems,
                }) }}
              </span>
              <Pagination
                :current="runsState.currentPage.value"
                :page-size="runsState.pageSize.value"
                :total="runsState.pagination.value.totalItems"
                :page-size-options="['8', '20', '50']"
                show-size-changer
                size="small"
                @change="handleRunsPageChange"
              />
            </footer>
          </TabPane>
        </Tabs>
      </Card>
    </template>

    <Result
      v-else-if="notFound"
      status="404"
      :title="t('conversationDetail.notFoundTitle')"
      :sub-title="t('conversationDetail.notFoundDescription')"
    >
      <template #extra>
        <Button @click="loadDetail">
          {{ t('common.actions.retry') }}
        </Button>
        <Button type="primary" @click="router.push('/conversations')">
          {{ t('common.actions.backToConversations') }}
        </Button>
      </template>
    </Result>

    <Result
      v-else
      status="error"
      :title="t('conversationDetail.loadFailedTitle')"
      :sub-title="loadError || t('errors.generic')"
    >
      <template #extra>
        <Button type="primary" @click="loadDetail">
          {{ t('common.actions.retry') }}
        </Button>
        <Button @click="router.push('/conversations')">
          {{ t('common.actions.backToConversations') }}
        </Button>
      </template>
    </Result>
  </PageContainer>
</template>

<style scoped>
.conversation-page {
  display: flex;
  height: calc(100dvh - var(--admin-header-height) - var(--admin-tabs-height) - 40px);
  flex-direction: column;
}

.detail-card {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--admin-border);
  background: var(--admin-surface);
  box-shadow: var(--admin-card-shadow);
}

.detail-card :deep(> .ant-card-body) {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: 0;
}

.conversation-header {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--admin-border);
}

.conversation-header__identity {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 3px;
}

.conversation-header__identity strong {
  overflow: hidden;
  color: var(--admin-text);
  font-size: 15px;
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-header__identity code {
  overflow: hidden;
  color: var(--admin-text-subtle);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conversation-header__meta {
  display: flex;
  flex: none;
  gap: 22px;
  margin: 0;
}

.conversation-header__meta dt {
  color: var(--admin-text-muted);
  font-size: 10px;
  font-weight: 600;
}

.conversation-header__meta dd {
  margin: 2px 0 0;
  color: var(--admin-text);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}

.detail-tabs {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}

.detail-tabs :deep(.ant-tabs-nav) {
  flex: none;
  margin: 0;
  padding: 0 18px;
}

.detail-tabs :deep(.ant-tabs-tab) {
  padding: 12px 4px 10px;
  font-size: 13px;
  font-weight: 600;
}

.detail-tabs :deep(.ant-tabs-content-holder) {
  flex: 1;
  min-height: 0;
}

.detail-tabs :deep(.ant-tabs-content) {
  height: 100%;
}

.detail-tabs :deep(.ant-tabs-tabpane) {
  display: flex;
  height: 100%;
  flex-direction: column;
  overflow-y: auto;
}

.transcript-empty {
  margin: auto;
  padding: 32px 0;
}

.transcript {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 14px;
  padding: 16px;
  overflow-y: auto;
  background: var(--admin-bg-deep);
}

.transcript-message {
  display: flex;
  max-width: 78%;
  gap: 8px;
}

.transcript-message.is-user {
  align-self: flex-end;
  flex-direction: row-reverse;
}

.transcript-message.is-assistant {
  align-self: flex-start;
}

.transcript-message__avatar {
  display: grid;
  width: 30px;
  height: 30px;
  flex: none;
  place-items: center;
  border-radius: 50%;
  font-size: 14px;
}

.transcript-message.is-user .transcript-message__avatar {
  color: var(--admin-primary);
  background: var(--admin-primary-soft);
}

.transcript-message.is-assistant .transcript-message__avatar {
  color: var(--admin-success-strong);
  background: var(--admin-success-soft);
}

.transcript-message__body {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}

.transcript-message.is-user .transcript-message__body {
  align-items: flex-end;
}

.transcript-message.is-assistant .transcript-message__body {
  align-items: flex-start;
}

.transcript-message__bubble {
  padding: 10px 14px;
  border: 1px solid var(--admin-border);
  border-radius: 12px;
  background: var(--admin-surface);
}

.transcript-message.is-user .transcript-message__bubble {
  border-color: color-mix(in srgb, var(--admin-primary) 24%, var(--admin-border));
  background: color-mix(in srgb, var(--admin-primary-soft) 55%, var(--admin-surface));
}

.transcript-message__bubble p {
  margin: 0;
  color: var(--admin-text);
  font-size: 13px;
  line-height: 1.7;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.transcript-message footer {
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--admin-text-subtle);
  font-size: 10px;
}

.transcript-message footer :deep(.ant-tag) {
  margin: 0;
}

.transcript__sentinel {
  height: 1px;
  flex: none;
}

.runs-error {
  margin: 12px 14px;
}

.runs-table :deep(.ant-table-thead > tr > th) {
  height: 42px;
  color: var(--admin-text-muted);
  font-size: 10px;
  font-weight: 650;
  letter-spacing: 0.025em;
  white-space: nowrap;
}

.runs-table :deep(.ant-table-tbody > tr > td) {
  height: 47px;
  color: var(--admin-text-muted);
  font-size: 11px;
}

.run-id {
  display: block;
  overflow: hidden;
  color: var(--admin-primary);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.question-preview {
  display: block;
  overflow: hidden;
  color: var(--admin-text);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.numeric-cell {
  color: var(--admin-text-muted);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.runs-footer {
  display: flex;
  min-height: 48px;
  flex: none;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: auto;
  padding: 8px 14px;
  border-top: 1px solid var(--admin-border);
}

.runs-footer > span {
  color: var(--admin-text-subtle);
  font-size: 10px;
}
</style>
