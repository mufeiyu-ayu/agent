<script setup lang="ts">
import type { RunDetail } from '../run.model'
import type { TraceRecord, TraceRequestGroup } from './run-trace.model'
import { computed, ref, watch } from 'vue'

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

const query = ref('')
const collapsedRequestIds = ref<Set<string>>(new Set())
const selectedId = ref<string>()

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

      <div class="run-trace-workspace__body">
        <RunTraceLedger
          :records="visibleRecords"
          :request-groups="projection.requestGroups"
          :collapsed-request-ids="collapsedRequestIds"
          :selected-id="selectedId"
          :search-active="searchActive"
          @select="selectRecord"
          @toggle-request="toggleRequest"
        />

        <div class="run-trace-workspace__inspector">
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
  height: calc(100dvh - 156px);
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
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  border-left: 1px solid var(--admin-border-strong);
}

@container run-trace (max-width: 900px) {
  .run-trace-workspace__frame {
    height: 920px;
    min-height: 920px;
  }

  .run-trace-workspace__body {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(270px, 0.9fr) minmax(340px, 1.1fr);
  }

  .run-trace-workspace__inspector {
    border-top: 1px solid var(--admin-border-strong);
    border-left: 0;
  }
}
</style>
