<script setup lang="ts">
import type {
  AdminGenericStep,
  AdminGroundedFinalizationStep,
  AdminModelSamplingStep,
  AdminRetrievalInspector,
  AdminRunTimelineItem,
} from '@agent/contracts'
import type { TraceRecord, TraceRequestGroup } from './run-trace.model'
import { Empty, Segmented, Tag } from 'ant-design-vue'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

import RunStatusTag from '../components/RunStatusTag.vue'
import { knownTimelineInspectorKeys, knownTimelineTitleKeys } from '../run.utils'
import GenericInspector from './inspectors/GenericInspector.vue'
import GroundedFinalizationInspector from './inspectors/GroundedFinalizationInspector.vue'
import MessageInspector from './inspectors/MessageInspector.vue'
import RequestInspector from './inspectors/RequestInspector.vue'
import RetrievalInspector from './inspectors/RetrievalInspector.vue'
import ToolExecutionInspector from './inspectors/ToolExecutionInspector.vue'

const props = defineProps<{
  record: TraceRecord | undefined
  requestGroup: TraceRequestGroup | undefined
  retrievalInspector: AdminRetrievalInspector
}>()

const { t } = useI18n()
/** Event 保持默认视图；切到 Retrieval 只换右栏内容，不改动 timeline 选中态。 */
const view = ref<'event' | 'retrieval'>('event')
const viewOptions = computed(() => [
  { value: 'event', label: t('retrieval.views.event') },
  { value: 'retrieval', label: t('retrieval.views.retrieval') },
])
const item = computed(() => props.record?.item)
type MessageTimelineItem = Extract<
  AdminRunTimelineItem,
  { type: 'assistant_output' | 'load_conversation_history' | 'receive_user_message' }
>

const sampling = computed<AdminModelSamplingStep | undefined>(() => {
  const selected = item.value

  if (selected?.kind !== 'known' || selected.type !== 'model_sampling')
    return undefined

  return props.requestGroup?.samplingRecordId === selected.id
    ? props.requestGroup.sampling
    : selected
})
const messageItem = computed<MessageTimelineItem | undefined>(() => {
  const selected = item.value

  if (selected?.kind !== 'known')
    return undefined

  return selected.type === 'assistant_output'
    || selected.type === 'load_conversation_history'
    || selected.type === 'receive_user_message'
    ? selected
    : undefined
})
const genericItem = computed<AdminGenericStep | undefined>(() => item.value?.kind === 'generic'
  ? item.value
  : undefined)
const finalizationItem = computed<AdminGroundedFinalizationStep | undefined>(() => {
  const selected = item.value

  return selected?.kind === 'known' && selected.type === 'grounded_finalization'
    ? selected
    : undefined
})
const requestNumber = computed(() => props.requestGroup?.number
  ?? props.record?.requestNumber
  ?? sampling.value?.samplingIndex
  ?? sampling.value?.sequence
  ?? 1)
const inspectorLabel = computed(() => {
  const selected = item.value

  if (!selected || selected.kind === 'generic')
    return t('timeline.inspectors.generic')

  return selected.type === 'model_sampling'
    ? t('runTrace.inspector.kinds.request')
    : t(knownTimelineInspectorKeys[selected.type])
})
const title = computed(() => {
  const selected = item.value

  if (!selected)
    return ''

  return selected.kind === 'known'
    ? t(knownTimelineTitleKeys[selected.type])
    : selected.title
})
</script>

<template>
  <aside class="run-trace-inspector" :aria-label="t('runTrace.inspector.ariaLabel')">
    <div class="run-trace-inspector__switch">
      <Segmented
        v-model:value="view"
        size="small"
        :options="viewOptions"
        :aria-label="t('retrieval.views.ariaLabel')"
        data-testid="inspector-view-switch"
      />
    </div>

    <template v-if="view === 'retrieval'">
      <div class="run-trace-inspector__body">
        <RetrievalInspector :inspector="retrievalInspector" />
      </div>
    </template>

    <template v-else-if="record && item">
      <header class="run-trace-inspector__header">
        <div class="run-trace-inspector__identity">
          <span>{{ inspectorLabel }}</span>
          <h3 :title="title">
            {{ title }}
          </h3>
          <code :title="item.type">{{ item.type }}</code>
        </div>

        <div class="run-trace-inspector__badges">
          <Tag v-if="item.kind === 'generic'">
            {{ t('common.generic') }}
          </Tag>
          <Tag v-else-if="item.type === 'model_sampling'" color="blue">
            {{ t('runTrace.inspector.requestLabel', { number: requestNumber }) }}
          </Tag>
          <RunStatusTag :status="item.status" />
        </div>
      </header>

      <div class="run-trace-inspector__body">
        <RequestInspector
          v-if="sampling"
          :item="sampling"
          :request-number="requestNumber"
        />
        <ToolExecutionInspector
          v-else-if="item.kind === 'known' && item.type === 'tool_execution'"
          :item="item"
        />
        <GroundedFinalizationInspector
          v-else-if="finalizationItem"
          :item="finalizationItem"
        />
        <MessageInspector
          v-else-if="messageItem"
          :item="messageItem"
          :content-preview="record.messagePreview"
        />
        <GenericInspector v-else-if="genericItem" :item="genericItem" />
      </div>
    </template>

    <Empty v-else class="run-trace-inspector__empty" :description="t('runTrace.inspector.empty')" />
  </aside>
</template>

<style scoped>
.run-trace-inspector {
  min-width: 0;
  height: 100%;
  min-height: 0;
  overflow: auto;
  color: var(--admin-text);
  background: var(--admin-surface);
  scrollbar-gutter: stable;
}

.run-trace-inspector__switch {
  position: sticky;
  z-index: 3;
  top: 0;
  display: flex;
  min-width: 0;
  padding: 12px 18px 0;
  background: var(--admin-surface);
}

.run-trace-inspector__switch :deep(.ant-segmented) {
  min-width: 0;
  max-width: 100%;
  overflow-x: auto;
}

.run-trace-inspector__header {
  position: sticky;
  z-index: 2;
  top: 40px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 18px 15px;
  border-bottom: 1px solid var(--admin-border);
  background: var(--admin-surface);
}

.run-trace-inspector__identity {
  min-width: 0;
}

.run-trace-inspector__identity > span {
  color: var(--admin-text-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.run-trace-inspector__identity h3 {
  margin: 6px 0 3px;
  overflow: hidden;
  color: var(--admin-text);
  font-size: 17px;
  font-weight: 680;
  line-height: 1.35;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.run-trace-inspector__identity code {
  display: block;
  overflow: hidden;
  color: var(--admin-text-muted);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.run-trace-inspector__badges {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 5px;
}

.run-trace-inspector__badges :deep(.ant-tag) {
  margin: 0;
  font-size: 11px;
}

.run-trace-inspector__body {
  padding: 0 18px 24px;
}

.run-trace-inspector__body :deep(.trace-inspector-tabs > .ant-tabs-nav) {
  position: sticky;
  z-index: 1;
  top: 88px;
  margin-bottom: 18px;
  background: var(--admin-surface);
}

.run-trace-inspector__body :deep(.trace-inspector-tabs .ant-tabs-tab) {
  padding-block: 12px;
  font-size: 13px;
}

.run-trace-inspector__empty {
  display: grid;
  min-height: 280px;
  place-content: center;
  margin: 0;
}

@media (max-width: 1180px) {
  .run-trace-inspector__header {
    position: static;
  }

  .run-trace-inspector__body :deep(.trace-inspector-tabs > .ant-tabs-nav) {
    position: static;
  }
}
</style>
