<script setup lang="ts">
import type { AdminRetrievalInspector } from '@agent/contracts'
import { Empty, Tag } from 'ant-design-vue'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

import { formatDuration, formatTokens } from '../../run.utils'
import {
  createRetrievalInspectorCounts,
  resolveAvailabilityTone,
} from '../retrieval-inspector.presenter'
import InspectorFieldList from './InspectorFieldList.vue'

const props = defineProps<{
  inspector: AdminRetrievalInspector
}>()

const { locale, t } = useI18n()
const unavailable = computed(() => t('runTrace.inspector.unavailable'))
const counts = computed(() => createRetrievalInspectorCounts(props.inspector))
const notApplicable = computed(
  () => props.inspector.availability === 'not_applicable',
)
const availabilityTone = computed(
  () => resolveAvailabilityTone(props.inspector.availability),
)
const tagColor = computed(() => ({
  success: 'green',
  warning: 'orange',
  error: 'red',
  neutral: 'default',
}[availabilityTone.value]))

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
    value: show(counts.value.evidenceRefCount),
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
  {
    label: t('retrieval.fields.callsTruncated'),
    value: yesNo(props.inspector.callsTruncated),
  },
])

const finalizationFields = computed(() => {
  const finalization = props.inspector.finalization

  if (!finalization)
    return []

  return [
    {
      label: t('retrieval.fields.validation'),
      value: t(`retrieval.validation.${finalization.validation}`),
    },
    {
      label: t('retrieval.fields.evidenceAvailability'),
      value: finalization.evidenceAvailability === null
        ? unavailable.value
        : t(`retrieval.evidenceAvailability.${finalization.evidenceAvailability}`),
    },
    {
      label: t('retrieval.fields.outcome'),
      value: finalization.outcome === null
        ? unavailable.value
        : t(`retrieval.outcome.${finalization.outcome}`),
    },
    {
      label: t('retrieval.fields.attempts'),
      value: finalization.attemptCount === null
        ? unavailable.value
        : `${finalization.attemptCount} / ${finalization.maxAttempts}`,
    },
    {
      label: t('retrieval.fields.failureReason'),
      value: finalization.failureReason ?? unavailable.value,
      mono: true,
    },
    {
      label: t('retrieval.fields.rejectionCode'),
      value: finalization.rejectionCode ?? unavailable.value,
      mono: true,
    },
    {
      label: t('retrieval.fields.samplingFailure'),
      value: finalization.samplingFailure ?? unavailable.value,
      mono: true,
    },
    {
      label: t('retrieval.fields.registryRefCount'),
      value: show(finalization.registryRefCount),
    },
    {
      label: t('retrieval.fields.registryTruncated'),
      value: finalization.registryTruncated === null
        ? unavailable.value
        : yesNo(finalization.registryTruncated),
    },
    {
      label: t('retrieval.fields.citationCount'),
      value: show(finalization.citationCount),
    },
    {
      label: t('retrieval.fields.citationIntegrity'),
      value: finalization.citationIntegrity === null
        ? unavailable.value
        : t('retrieval.citationIntegrity.validated'),
    },
    {
      label: t('retrieval.fields.faithfulness'),
      value: finalization.faithfulnessStatus === null
        ? unavailable.value
        : t('retrieval.faithfulness.notEvaluated'),
    },
    {
      label: t('retrieval.fields.schemaVersion'),
      value: show(finalization.schemaVersion),
    },
    {
      label: t('retrieval.fields.tokens'),
      value: finalization.usage === null
        ? unavailable.value
        : formatTokens(finalization.usage.totalTokens, locale.value),
    },
    {
      label: t('eventDetail.fields.duration'),
      value: finalization.durationMs === null
        ? unavailable.value
        : formatDuration(finalization.durationMs),
    },
  ]
})

function show(value: string | number | null): string | number {
  return value ?? unavailable.value
}

function yesNo(value: boolean): string {
  return value ? t('common.yes') : t('common.no')
}

function callStatusLabel(ok: boolean | null): string {
  if (ok === null)
    return unavailable.value

  return ok ? t('retrieval.call.ok') : t('retrieval.call.failed')
}
</script>

<template>
  <div class="retrieval-inspector" data-testid="retrieval-inspector">
    <header class="retrieval-inspector__status">
      <Tag :color="tagColor" data-testid="retrieval-availability">
        {{ t(`retrieval.availability.${inspector.availability}`) }}
      </Tag>
      <p>{{ t(`retrieval.availabilityHint.${inspector.availability}`) }}</p>
    </header>

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

        <p v-if="inspector.retrievalCalls.length === 0" class="retrieval-inspector__hint">
          {{ t('retrieval.emptyCalls') }}
        </p>

        <ul v-else class="retrieval-inspector__list" data-testid="retrieval-calls">
          <li
            v-for="call in inspector.retrievalCalls"
            :key="call.stepId"
            class="retrieval-inspector__card"
          >
            <div class="retrieval-inspector__card-head">
              <code>{{ call.toolName ?? unavailable }}@{{ call.toolVersion ?? '?' }}</code>
              <Tag :color="call.ok === false ? 'red' : 'green'">
                {{ callStatusLabel(call.ok) }}
              </Tag>
              <Tag v-if="!call.metadataTrusted" color="orange">
                {{ t('retrieval.call.untrusted') }}
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
                <dt>{{ t('runTrace.inspector.fields.originalChars') }}</dt>
                <dd>{{ show(call.originalChars) }}</dd>
              </div>
              <div>
                <dt>{{ t('runTrace.inspector.fields.observationChars') }}</dt>
                <dd>{{ show(call.observationChars) }}</dd>
              </div>
              <div>
                <dt>{{ t('eventDetail.fields.truncated') }}</dt>
                <dd>{{ call.truncated === null ? unavailable : yesNo(call.truncated) }}</dd>
              </div>
              <div>
                <dt>{{ t('eventDetail.fields.recordedDuration') }}</dt>
                <dd>{{ call.recordedDurationMs === null ? unavailable : formatDuration(call.recordedDurationMs) }}</dd>
              </div>
            </dl>

            <p v-if="call.refs.length === 0" class="retrieval-inspector__hint">
              {{ t('retrieval.call.noRefs') }}
            </p>

            <ul v-else class="retrieval-inspector__refs">
              <li v-for="ref in call.refs" :key="`${ref.sourceId}:${ref.chunkId ?? ''}`">
                <code>#{{ ref.sourceId }}</code>
                <span>{{ ref.chunkId ?? t('retrieval.granularity.article') }}</span>
              </li>
            </ul>

            <p v-if="call.refsTruncated" class="retrieval-inspector__hint">
              {{ t('retrieval.call.refsTruncated') }}
            </p>
          </li>
        </ul>
      </section>

      <InspectorFieldList
        v-if="inspector.finalization"
        :title="t('retrieval.sections.finalization')"
        :items="finalizationFields"
      />
      <section v-else class="retrieval-inspector__block">
        <h4>{{ t('retrieval.sections.finalization') }}</h4>
        <p class="retrieval-inspector__hint" data-testid="retrieval-no-finalization">
          {{ t('retrieval.emptyFinalization') }}
        </p>
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
            v-for="citation in inspector.citations"
            :key="citation.citationId"
            class="retrieval-inspector__card"
          >
            <div class="retrieval-inspector__card-head">
              <span class="retrieval-inspector__index">{{ citation.sequence }}</span>
              <strong>{{ citation.title }}</strong>
              <Tag :color="citation.correlation === 'matched' ? 'green' : 'orange'">
                {{ t(`retrieval.correlation.${citation.correlation}`) }}
              </Tag>
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
                  {{ citation.chunkId ?? unavailable }}
                </dd>
              </div>
              <div>
                <dt>{{ t('retrieval.fields.granularity') }}</dt>
                <dd>{{ t(`retrieval.granularity.${citation.granularity}`) }}</dd>
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
}

.retrieval-inspector__status {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 16px 0 4px;
}

.retrieval-inspector__status :deep(.ant-tag) {
  margin: 0;
}

.retrieval-inspector__status p {
  min-width: 0;
  margin: 0;
  color: var(--admin-text-muted);
  font-size: 12px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}

.retrieval-inspector__block {
  margin-top: 22px;
  min-width: 0;
}

.retrieval-inspector__block h4 {
  margin: 0 0 10px;
  color: var(--admin-text-muted);
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.retrieval-inspector__hint {
  margin: 0;
  color: var(--admin-text-muted);
  font-size: 12px;
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
  padding: 12px;
  border: 1px solid var(--admin-border);
  border-radius: 8px;
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
  font-size: 11px;
}

.retrieval-inspector__card-head code,
.retrieval-inspector__card-head strong {
  min-width: 0;
  color: var(--admin-text);
  font-size: 12px;
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
  font-size: 11px;
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
  font-size: 11px;
  line-height: 1.5;
}

.retrieval-inspector__facts dd {
  min-width: 0;
  margin: 0;
  color: var(--admin-text);
  font-size: 12px;
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
  font-size: 11px;
  overflow-wrap: anywhere;
}

.retrieval-inspector__refs code {
  color: var(--admin-text);
}

.retrieval-inspector__empty {
  margin: 32px 0;
}
</style>
