<script setup lang="ts">
import type { AdminRetrievalInspector, AdminRunTimelineItem } from '@agent/contracts'
import { Empty, Tag } from 'ant-design-vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import {
  createRetrievalCallCards,
  createRetrievalInspectorCounts,
  resolveCallStatusTone,
  toRefIdentity,
  toTagColor,
} from '../retrieval-inspector.presenter'
import InspectorFieldList from './InspectorFieldList.vue'

const props = defineProps<{
  inspector: AdminRetrievalInspector
  timeline: AdminRunTimelineItem[]
}>()

const { t } = useI18n()
const unavailable = computed(() => t('runTrace.inspector.unavailable'))
const cards = computed(() => createRetrievalCallCards(props.inspector, props.timeline))
const counts = computed(() => createRetrievalInspectorCounts(cards.value, props.inspector.citations))
/** 没有证据类调用、没有 finalization Step、也没有持久化 Grounding：本 Run 从未进入检索链路。 */
const notApplicable = computed(
  () => props.inspector.retrievalCalls.length === 0
    && props.inspector.citations === null
    && !props.timeline.some(item => item.type === 'grounded_finalization'),
)

const overviewFields = computed(() => [
  {
    label: t('retrieval.fields.callCount'),
    value: counts.value.callCount,
  },
  {
    label: t('retrieval.fields.failedCallCount'),
    value: counts.value.failedCallCount,
  },
  {
    label: t('retrieval.fields.candidateCount'),
    value: show(counts.value.candidateCount),
  },
  {
    label: t('retrieval.fields.evidenceRefCount'),
    value: counts.value.evidenceRefCount,
  },
  {
    label: t('retrieval.fields.citedSourceCount'),
    value: show(counts.value.citedSourceCount),
  },
  {
    label: t('retrieval.fields.matchedCitations'),
    value: counts.value.citationCount === null
      ? unavailable.value
      : `${counts.value.matchedCitationCount} / ${counts.value.citationCount}`,
  },
])

function show(value: string | number | null): string | number {
  return value ?? unavailable.value
}

function yesNo(value: boolean): string {
  return value ? t('common.yes') : t('common.no')
}

function callStatusLabel(ok: boolean | null): string {
  if (ok === null)
    return t('retrieval.call.unknown')

  return ok ? t('retrieval.call.ok') : t('retrieval.call.failed')
}

function callStatusColor(ok: boolean | null): string {
  return toTagColor(resolveCallStatusTone(ok))
}
</script>

<template>
  <div class="retrieval-inspector" data-testid="retrieval-inspector">
    <Empty
      v-if="notApplicable"
      class="retrieval-inspector__empty"
      :description="t('retrieval.notApplicableDescription')"
    />

    <template v-else>
      <InspectorFieldList
        :title="t('retrieval.sections.overview')"
        :items="overviewFields"
      />

      <section class="retrieval-inspector__block">
        <h4>{{ t('retrieval.sections.calls') }}</h4>

        <p v-if="cards.length === 0" class="retrieval-inspector__hint">
          {{ t('retrieval.emptyCalls') }}
        </p>

        <ul v-else class="retrieval-inspector__list" data-testid="retrieval-calls">
          <li
            v-for="call in cards"
            :key="call.stepId"
            class="retrieval-inspector__card"
          >
            <div class="retrieval-inspector__card-head">
              <code>{{ call.toolName ?? unavailable }}</code>
              <Tag
                :color="callStatusColor(call.ok)"
                :data-testid="`retrieval-call-status-${call.stepId}`"
                :data-tone="resolveCallStatusTone(call.ok)"
              >
                {{ callStatusLabel(call.ok) }}
              </Tag>
            </div>

            <dl class="retrieval-inspector__facts">
              <div>
                <dt>{{ t('retrieval.fields.callId') }}</dt>
                <dd class="is-mono">
                  {{ call.callId ?? unavailable }}
                </dd>
              </div>
              <div>
                <dt>{{ t('retrieval.fields.strategy') }}</dt>
                <dd>{{ call.strategy ? `${call.strategy.name}@${call.strategy.version}` : unavailable }}</dd>
              </div>
              <div>
                <dt>{{ t('retrieval.fields.query') }}</dt>
                <dd>{{ call.query ?? unavailable }}</dd>
              </div>
              <div>
                <dt>{{ t('retrieval.fields.sourceCount') }}</dt>
                <dd>{{ show(call.sourceCount) }}</dd>
              </div>
              <div>
                <dt>{{ t('retrieval.fields.chunkEvidenceCount') }}</dt>
                <dd>{{ show(call.chunkEvidenceCount) }}</dd>
              </div>
              <div>
                <dt>{{ t('retrieval.fields.errorCode') }}</dt>
                <dd class="is-mono">
                  {{ call.code ?? unavailable }}
                </dd>
              </div>
              <div>
                <dt>{{ t('eventDetail.fields.truncated') }}</dt>
                <dd>{{ call.truncated === null ? unavailable : yesNo(call.truncated) }}</dd>
              </div>
            </dl>

            <ul v-if="call.refs.length > 0" class="retrieval-inspector__refs">
              <li v-for="ref in call.refs" :key="toRefIdentity(ref)">
                <code>#{{ ref.sourceId }}</code>
                <span>{{ ref.chunkId ?? t('retrieval.wholeArticle') }}</span>
              </li>
            </ul>
          </li>
        </ul>
      </section>

      <section class="retrieval-inspector__block">
        <h4>{{ t('retrieval.sections.citations') }}</h4>

        <p
          v-if="inspector.citations === null"
          class="retrieval-inspector__hint"
          data-testid="retrieval-no-citations"
        >
          {{ t('retrieval.emptyCitations') }}
        </p>

        <p
          v-else-if="inspector.citations.length === 0"
          class="retrieval-inspector__hint"
        >
          {{ t('retrieval.zeroCitations') }}
        </p>

        <ul v-else class="retrieval-inspector__list" data-testid="retrieval-citations">
          <li
            v-for="(citation, index) in inspector.citations"
            :key="citation.citationId"
            class="retrieval-inspector__card"
          >
            <div class="retrieval-inspector__card-head">
              <span class="retrieval-inspector__index">{{ index + 1 }}</span>
              <strong>{{ citation.title }}</strong>
            </div>

            <dl class="retrieval-inspector__facts">
              <div>
                <dt>{{ t('retrieval.fields.sourceId') }}</dt>
                <dd class="is-mono">
                  #{{ citation.sourceId }}
                </dd>
              </div>
              <div>
                <dt>{{ t('retrieval.fields.chunkId') }}</dt>
                <dd class="is-mono">
                  {{ citation.chunkId ?? t('retrieval.wholeArticle') }}
                </dd>
              </div>
              <div>
                <dt>{{ t('retrieval.fields.sectionPath') }}</dt>
                <dd>{{ citation.sectionPath ?? unavailable }}</dd>
              </div>
              <div>
                <dt>{{ t('retrieval.fields.languageCode') }}</dt>
                <dd>{{ citation.languageCode }}</dd>
              </div>
              <div>
                <dt>{{ t('retrieval.fields.strategy') }}</dt>
                <dd>{{ citation.strategy.name }}@{{ citation.strategy.version }}</dd>
              </div>
              <div>
                <dt>{{ t('retrieval.fields.matchedCalls') }}</dt>
                <dd class="is-mono">
                  {{ citation.matchedCallIds.length > 0 ? citation.matchedCallIds.join(', ') : unavailable }}
                </dd>
              </div>
            </dl>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.retrieval-inspector {
  min-width: 0;
  padding-top: 12px;
}

.retrieval-inspector__block {
  margin-top: 22px;
  min-width: 0;
}

.retrieval-inspector__block h4 {
  margin: 0 0 10px;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-2xs);
  font-weight: 700;
  letter-spacing: 0.07em;
  text-transform: uppercase;
}

.retrieval-inspector__hint {
  margin: 0;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-sm);
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.retrieval-inspector__list {
  display: grid;
  min-width: 0;
  margin: 0;
  padding: 0;
  gap: 10px;
  list-style: none;
}

.retrieval-inspector__card {
  min-width: 0;
  padding: 14px 16px;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-md);
  background: var(--admin-surface-raised);
  box-shadow: var(--admin-shadow-sm);
}

.retrieval-inspector__card-head {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
}

.retrieval-inspector__card-head :deep(.ant-tag) {
  margin: 0;
  border-radius: var(--admin-radius-sm);
  font-size: var(--admin-font-2xs);
}

.retrieval-inspector__card-head code,
.retrieval-inspector__card-head strong {
  min-width: 0;
  color: var(--admin-text);
  font-size: var(--admin-font-sm);
  overflow-wrap: anywhere;
}

.retrieval-inspector__index {
  display: inline-grid;
  width: 20px;
  height: 20px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: var(--admin-border);
  color: var(--admin-text-muted);
  font-size: var(--admin-font-2xs);
  font-weight: 700;
  place-content: center;
}

.retrieval-inspector__facts {
  display: grid;
  min-width: 0;
  margin: 0;
  gap: 6px 12px;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
}

.retrieval-inspector__facts > div {
  min-width: 0;
}

.retrieval-inspector__facts dt {
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
  line-height: 1.5;
}

.retrieval-inspector__facts dd {
  min-width: 0;
  margin: 0;
  color: var(--admin-text);
  font-size: var(--admin-font-sm);
  font-weight: 550;
  line-height: 1.5;
  overflow-wrap: anywhere;
}

.retrieval-inspector__facts dd.is-mono {
  font-variant-numeric: tabular-nums;
}

.retrieval-inspector__refs {
  display: grid;
  min-width: 0;
  margin: 10px 0 0;
  padding: 0;
  gap: 4px;
  list-style: none;
}

.retrieval-inspector__refs li {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  gap: 6px;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
  overflow-wrap: anywhere;
}

.retrieval-inspector__refs code {
  color: var(--admin-text);
}

.retrieval-inspector__empty {
  margin: 32px 0;
}
</style>
