<script setup lang="ts">
import type { RunDetail } from '../run.model'
import type { TraceRecord, TraceRequestGroup } from './run-trace.model'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  createRunTraceProjection,
  filterTraceRecords,
  getVisibleTraceRecords,
  resolveTraceSelection,
} from './run-trace.presenter'
import RunTraceHeader from './RunTraceHeader.vue'
import RunTraceInspector from './RunTraceInspector.vue'
import RunTraceLedger from './RunTraceLedger.vue'
import RunTraceOverview from './RunTraceOverview.vue'
import RunTraceToolbar from './RunTraceToolbar.vue'

const props = defineProps<{
  run: RunDetail
}>()

const { t } = useI18n()

const query = ref('')
const collapsedRequestIds = ref<Set<string>>(new Set())
const selectedId = ref<string>()

// 检查器宽度拖拽调整；null 表示使用 CSS 默认宽度。
const MIN_INSPECTOR_WIDTH = 300
const MIN_LEDGER_WIDTH = 320
const RESIZE_KEYBOARD_STEP = 16
// CSS 默认宽度 clamp(320px, 28%, 440px) 的 28%，用作 aria 初始值。
const DEFAULT_INSPECTOR_PERCENT = 28
const bodyEl = ref<HTMLElement>()
const inspectorEl = ref<HTMLElement>()
const inspectorWidth = ref<number | null>(null)
const resizerValuePercent = ref(DEFAULT_INSPECTOR_PERCENT)
const resizing = ref(false)
const activePointerId = ref<number | null>(null)
const dragStartX = ref(0)
const dragStartWidth = ref(0)

// min() 让容器变窄时由 CSS 自动重新收紧，始终给左侧列表保留 MIN_LEDGER_WIDTH。
const bodyStyle = computed(() => inspectorWidth.value === null
  ? undefined
  : {
      gridTemplateColumns:
        `minmax(0, 1fr) min(${inspectorWidth.value}px, calc(100% - ${MIN_LEDGER_WIDTH}px))`,
    })

const projection = computed(() => createRunTraceProjection(props.run))
const visibleRecords = computed(() => getVisibleTraceRecords(
  projection.value,
  query.value,
  collapsedRequestIds.value,
))
const filteredCount = computed(() => filterTraceRecords(
  projection.value.records,
  query.value,
).length)
const recordsById = computed(() => new Map(
  projection.value.records.map(record => [record.id, record]),
))
const requestGroupsById = computed(() => new Map(
  projection.value.requestGroups.map(group => [group.id, group]),
))
const selectedRecord = computed<TraceRecord | undefined>(() => selectedId.value
  ? recordsById.value.get(selectedId.value)
  : undefined)
const selectedRequestGroup = computed<TraceRequestGroup | undefined>(() => {
  const record = selectedRecord.value
  return record?.requestId
    ? requestGroupsById.value.get(record.requestId)
    : undefined
})
const searchActive = computed(() => query.value.trim().length > 0)

watch(
  () => props.run.id,
  () => {
    query.value = ''
    collapsedRequestIds.value = new Set()
    selectedId.value = projection.value.defaultSelectionId
  },
  { immediate: true },
)

watch(visibleRecords, (records) => {
  selectedId.value = resolveTraceSelection(
    projection.value,
    records,
    selectedId.value,
  )
})

function setQuery(value: string) {
  query.value = value
}

function selectRecord(recordId: string) {
  const record = recordsById.value.get(recordId)
  if (!record)
    return

  if (
    searchActive.value
    && !visibleRecords.value.some(candidate => candidate.id === recordId)
  ) {
    query.value = ''
  }

  const group = record.requestId
    ? requestGroupsById.value.get(record.requestId)
    : undefined
  if (
    !searchActive.value
    && group
    && group.samplingRecordId !== record.id
    && collapsedRequestIds.value.has(group.id)
  ) {
    const next = new Set(collapsedRequestIds.value)
    next.delete(group.id)
    collapsedRequestIds.value = next
  }

  selectedId.value = recordId
}

function toggleRequest(requestId: string) {
  const group = requestGroupsById.value.get(requestId)
  if (!group)
    return

  const next = new Set(collapsedRequestIds.value)
  if (next.has(requestId)) {
    next.delete(requestId)
  }
  else {
    next.add(requestId)
    if (
      !searchActive.value
      && selectedId.value !== group.samplingRecordId
      && selectedId.value
      && group.recordIds.includes(selectedId.value)
    ) {
      selectedId.value = group.samplingRecordId
    }
  }
  collapsedRequestIds.value = next
}

function collapseRequests() {
  const next = new Set(projection.value.requestGroups.map(group => group.id))
  const record = selectedRecord.value
  const selectedGroup = record?.requestId
    ? requestGroupsById.value.get(record.requestId)
    : undefined

  if (
    !searchActive.value
    && selectedGroup
    && selectedId.value !== selectedGroup.samplingRecordId
  ) {
    selectedId.value = selectedGroup.samplingRecordId
  }

  collapsedRequestIds.value = next
}

function expandAll() {
  collapsedRequestIds.value = new Set()
}

function applyInspectorWidth(width: number) {
  const rect = bodyEl.value?.getBoundingClientRect()
  if (!rect)
    return

  const max = Math.max(MIN_INSPECTOR_WIDTH, rect.width - MIN_LEDGER_WIDTH)
  const clamped = Math.min(Math.max(width, MIN_INSPECTOR_WIDTH), max)
  inspectorWidth.value = clamped
  resizerValuePercent.value = Math.round((clamped / rect.width) * 100)
}

function currentInspectorWidth(): number {
  return inspectorWidth.value
    ?? inspectorEl.value?.offsetWidth
    ?? MIN_INSPECTOR_WIDTH
}

/** 聚焦时按真实布局同步 aria 值，修正默认 clamp 或窗口缩放造成的偏差。 */
function syncResizerValue() {
  const rect = bodyEl.value?.getBoundingClientRect()
  if (!rect || rect.width === 0)
    return

  resizerValuePercent.value = Math.round(
    (currentInspectorWidth() / rect.width) * 100,
  )
}

function onResizerPointerDown(event: PointerEvent) {
  // 只认第一个按下的 pointer，避免触屏第二根手指打断拖拽
  if (activePointerId.value !== null)
    return

  event.preventDefault()
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
  activePointerId.value = event.pointerId
  dragStartX.value = event.clientX
  dragStartWidth.value = currentInspectorWidth()
  resizing.value = true
}

function onResizerPointerMove(event: PointerEvent) {
  if (!resizing.value || event.pointerId !== activePointerId.value)
    return

  // 基于按下时的宽度做相对位移，起手不跳变
  applyInspectorWidth(
    dragStartWidth.value + (dragStartX.value - event.clientX),
  )
}

function onResizerPointerUp(event: PointerEvent) {
  if (event.pointerId !== activePointerId.value)
    return

  resizing.value = false
  activePointerId.value = null
  ;(event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId)
}

function onResizerKeydown(event: KeyboardEvent) {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
    return

  event.preventDefault()
  const delta = event.key === 'ArrowLeft'
    ? RESIZE_KEYBOARD_STEP
    : -RESIZE_KEYBOARD_STEP
  applyInspectorWidth(currentInspectorWidth() + delta)
}

function resetInspectorWidth() {
  inspectorWidth.value = null
  resizerValuePercent.value = DEFAULT_INSPECTOR_PERCENT
}
</script>

<template>
  <section class="run-trace-workspace">
    <div class="run-trace-workspace__frame">
      <RunTraceHeader
        :run="run"
        :request-count="projection.requestGroups.length"
      />

      <RunTraceToolbar
        :duration-ms="run.durationMs"
        :request-count="projection.requestGroups.length"
        :call-count="run.toolCallCount"
        :query="query"
        :filtered-count="filteredCount"
        :total-count="projection.records.length"
        :collapsed-count="collapsedRequestIds.size"
        @update:query="setQuery"
        @expand-all="expandAll"
        @collapse-requests="collapseRequests"
      />

      <RunTraceOverview
        :spans="projection.overviewSpans"
        :records="projection.records"
        :timeline-start-ms="projection.timelineStartMs"
        :timeline-end-ms="projection.timelineEndMs"
        :selected-id="selectedId"
        @select="selectRecord"
      />

      <div ref="bodyEl" class="run-trace-workspace__body" :style="bodyStyle">
        <RunTraceLedger
          :records="visibleRecords"
          :request-groups="projection.requestGroups"
          :collapsed-request-ids="collapsedRequestIds"
          :selected-id="selectedId"
          :search-active="searchActive"
          @select="selectRecord"
          @toggle-request="toggleRequest"
        />

        <div ref="inspectorEl" class="run-trace-workspace__inspector">
          <div
            class="run-trace-workspace__resizer"
            :class="{ 'run-trace-workspace__resizer--active': resizing }"
            role="separator"
            aria-orientation="vertical"
            :aria-label="t('runTrace.inspector.resizerLabel')"
            :aria-valuenow="resizerValuePercent"
            tabindex="0"
            @pointerdown="onResizerPointerDown"
            @pointermove="onResizerPointerMove"
            @pointerup="onResizerPointerUp"
            @pointercancel="onResizerPointerUp"
            @keydown="onResizerKeydown"
            @focus="syncResizerValue"
            @dblclick="resetInspectorWidth"
          />
          <RunTraceInspector
            :record="selectedRecord"
            :request-group="selectedRequestGroup"
            :retrieval-inspector="run.retrievalInspector"
          />
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.run-trace-workspace {
  --trace-model: hsl(257deg 38% 55%);
  --trace-tools: hsl(31deg 76% 49%);
  --trace-danger: hsl(1deg 65% 52%);

  container: run-trace / inline-size;
  min-width: 0;
  color: var(--admin-text);
  background: var(--admin-surface);
}

.run-trace-workspace__frame {
  display: flex;
  min-width: 0;
  /* 视口高度扣掉头部、路由标签与页面外框，随 token 自动跟随 */
  height: calc(100dvh - var(--admin-header-height) - var(--admin-tabs-height) - 68px);
  min-height: 590px;
  flex-direction: column;
  overflow: hidden;
}

.run-trace-workspace__body {
  display: grid;
  flex: 1;
  grid-template-columns: minmax(0, 1fr) clamp(320px, 28%, 440px);
  min-width: 0;
  min-height: 0;
}

.run-trace-workspace__inspector {
  position: relative;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-left: 1px solid var(--admin-border-strong);
}

.run-trace-workspace__resizer {
  position: absolute;
  z-index: 1;
  top: 0;
  bottom: 0;

  /* 检查器容器 overflow:hidden 会裁掉负偏移部分，把手必须完全落在容器内 */
  left: 0;
  width: 6px;
  cursor: col-resize;
  touch-action: none;
}

.run-trace-workspace__resizer:hover,
.run-trace-workspace__resizer:focus-visible,
.run-trace-workspace__resizer--active {
  background: color-mix(in srgb, var(--trace-model) 35%, transparent);
  outline: none;
}

@container run-trace (max-width: 900px) {
  .run-trace-workspace__frame {
    height: 920px;
    min-height: 920px;
  }

  .run-trace-workspace__body {
    /* 覆盖拖拽宽度的行内样式，堆叠布局下宽度调整无意义 */
    grid-template-columns: 1fr !important;
    grid-template-rows: minmax(270px, 0.9fr) minmax(340px, 1.1fr);
  }

  .run-trace-workspace__inspector {
    border-top: 1px solid var(--admin-border-strong);
    border-left: 0;
  }

  .run-trace-workspace__resizer {
    display: none;
  }
}
</style>
