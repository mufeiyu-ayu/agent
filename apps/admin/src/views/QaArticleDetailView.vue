<script setup lang="ts">
import type { QaTranslationScore } from '@agent/contracts'
import { SendOutlined } from '@ant-design/icons-vue'
import {
  Alert,
  App as AntApp,
  Button,
  Empty,
  Modal,
  Result,
  Select,
  SelectOption,
  Skeleton,
  Tag,
  Textarea,
} from 'ant-design-vue'
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import PageContainer from '@/components/common/PageContainer.vue'
import {
  diagnoseQaArticle,
  fetchQaArticleDetail,
  fetchQaTranslationDetail,
  requestQaTranslation,
  reviewQaTranslation,
  scoreQaTranslation,
} from '@/features/qa/qa-api'
import { formatAdminRunError } from '@/features/shared/admin-api'
import { createDetailFetchState } from '@/features/shared/detail-fetch.state'

const route = useRoute()
const router = useRouter()
const { message } = AntApp.useApp()
const { t } = useI18n()

const articleId = computed(() => String(route.params.articleId ?? ''))

const articleState = createDetailFetchState(
  () => articleId.value,
  (id, signal) => fetchQaArticleDetail(id, { signal }),
)
const article = articleState.data

const selectedLanguage = ref('')
const translationState = createDetailFetchState(
  () => (selectedLanguage.value ? `${articleId.value}:${selectedLanguage.value}` : ''),
  (_key, signal) => fetchQaTranslationDetail(articleId.value, selectedLanguage.value, { signal }),
)
const translation = translationState.data
const score = computed<QaTranslationScore | null>(() => translation.value?.score ?? null)

watch(article, (value) => {
  if (!value)
    return
  if (!selectedLanguage.value || !value.translations.some(item => item.languageCode === selectedLanguage.value))
    selectedLanguage.value = value.translations[0]?.languageCode ?? ''
}, { immediate: true })

watch(selectedLanguage, (value) => {
  if (value)
    void translationState.load()
})

void articleState.load()
onBeforeUnmount(() => {
  articleState.cancel()
  translationState.cancel()
})

// ---- 动作：打分 / 审核 / 翻译 ----
const actionLoading = ref(false)

async function runAction(action: () => Promise<void>) {
  actionLoading.value = true
  try {
    await action()
  }
  catch (cause) {
    message.error(formatAdminRunError(cause))
  }
  finally {
    actionLoading.value = false
  }
}

function handleScore() {
  void runAction(async () => {
    await scoreQaTranslation(articleId.value, selectedLanguage.value)
    message.success(t('qaArticleDetail.scoreDone'))
    await Promise.all([translationState.load(), articleState.load()])
  })
}

function handleApprove() {
  void runAction(async () => {
    await reviewQaTranslation(articleId.value, selectedLanguage.value, { decision: 'APPROVED' })
    message.success(t('qaArticleDetail.approved'))
    await Promise.all([translationState.load(), articleState.load()])
  })
}

const rejectModalOpen = ref(false)
const rejectNote = ref('')

function handleReject() {
  void runAction(async () => {
    await reviewQaTranslation(articleId.value, selectedLanguage.value, {
      decision: 'REJECTED',
      note: rejectNote.value.trim() || undefined,
    })
    rejectModalOpen.value = false
    rejectNote.value = ''
    message.success(t('qaArticleDetail.rejected'))
    await Promise.all([translationState.load(), articleState.load()])
  })
}

// undefined 才能让 antd Select 显示 placeholder（'' 会被当成真实值）
const translateLanguage = ref<string | undefined>(undefined)
const translateLanguagePending = computed(() => (
  !!translateLanguage.value
  && !!article.value?.pendingLanguages.includes(translateLanguage.value)
))

function handleTranslate(languageCode: string) {
  void runAction(async () => {
    const result = await requestQaTranslation(articleId.value, languageCode)
    message.success(t(
      result.alreadyQueued ? 'qaArticleDetail.alreadyQueued' : 'qaArticleDetail.queued',
      { language: languageCode },
    ))
    translateLanguage.value = undefined
    await Promise.all([articleState.load(), translationState.load()])
  })
}

// ---- 诊断（mock）----
interface DiagnoseEntry {
  question: string
  answer: string
}
const diagnoseQuestion = ref('')
const diagnoseLoading = ref(false)
const diagnoseEntries = shallowRef<DiagnoseEntry[]>([])

// IME 组合态的 Enter（确认候选字）不应触发发送；Safari 在 compositionend 后
// 才更新 isComposing，故同时检查 keyCode 229（与 SeoChatComposer 同一守卫）
function handleDiagnoseKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229)
    return
  event.preventDefault()
  void handleDiagnose()
}

async function handleDiagnose() {
  const question = diagnoseQuestion.value.trim()
  if (!question || diagnoseLoading.value)
    return
  diagnoseLoading.value = true
  try {
    const response = await diagnoseQaArticle(articleId.value, question)
    diagnoseEntries.value = [...diagnoseEntries.value, { question, answer: response.answer }]
    diagnoseQuestion.value = ''
  }
  catch (cause) {
    message.error(formatAdminRunError(cause))
  }
  finally {
    diagnoseLoading.value = false
  }
}

const verdictColor: Record<string, string> = {
  PASS: 'green',
  REVIEW: 'gold',
  REJECT: 'red',
}
const reviewColor: Record<string, string> = {
  PENDING: 'default',
  APPROVED: 'green',
  REJECTED: 'red',
}
const hasRuleScore = computed(() => score.value?.ruleScore != null && score.value.verdict != null)
const ruleScorePercent = computed(() => Math.min(100, Math.max(0, score.value?.ruleScore ?? 0)))
const reviewDone = computed(() => hasRuleScore.value && score.value?.reviewStatus !== 'PENDING')
</script>

<template>
  <PageContainer wide class="qa-detail-page">
    <h1 class="sr-only">
      {{ t('qaArticleDetail.title') }}
    </h1>

    <template v-if="articleState.loading.value && !article">
      <div class="detail-card">
        <Skeleton active :paragraph="{ rows: 10 }" class="table-skeleton" />
      </div>
    </template>

    <Result
      v-else-if="articleState.notFound.value"
      status="404"
      :title="t('qaArticleDetail.notFound')"
    >
      <template #extra>
        <Button type="primary" @click="router.push('/qa/articles')">
          {{ t('qaArticleDetail.backToList') }}
        </Button>
      </template>
    </Result>

    <Alert
      v-else-if="articleState.error.value"
      type="error"
      show-icon
      :message="t('qaArticleDetail.loadFailed')"
      :description="articleState.error.value"
    >
      <template #action>
        <Button size="small" @click="articleState.retry">
          {{ t('common.actions.retry') }}
        </Button>
      </template>
    </Alert>

    <template v-else-if="article">
      <header class="detail-header detail-card">
        <div class="detail-header__main">
          <h2 class="detail-header__title">
            {{ article.title }}
          </h2>
          <div class="detail-header__meta">
            <code>{{ article.slug }}</code>
            <Tag v-if="article.isQaCandidate" color="blue" class="meta-tag">
              {{ t('qaArticles.candidateTag') }}
            </Tag>
            <span>{{ t('qaArticleDetail.termHits', { count: article.termHitCount ?? '—' }) }}</span>
          </div>
        </div>

        <div class="detail-header__actions">
          <Select
            v-model:value="selectedLanguage"
            class="language-select"
            :aria-label="t('qaArticleDetail.language')"
          >
            <SelectOption
              v-for="item in article.translations"
              :key="item.languageCode"
              :value="item.languageCode"
            >
              {{ item.languageCode }}
            </SelectOption>
          </Select>

          <Select
            v-if="article.missingLanguages.length"
            v-model:value="translateLanguage"
            class="language-select"
            :placeholder="t('qaArticleDetail.missingLanguages')"
            :aria-label="t('qaArticleDetail.missingLanguages')"
          >
            <SelectOption
              v-for="code in article.missingLanguages"
              :key="code"
              :value="code"
              :disabled="article.pendingLanguages.includes(code)"
            >
              {{ code }}{{ article.pendingLanguages.includes(code) ? ` · ${t('qaArticleDetail.pendingTask')}` : '' }}
            </SelectOption>
          </Select>
          <Button
            v-if="article.missingLanguages.length"
            :disabled="!translateLanguage || translateLanguagePending || actionLoading"
            @click="translateLanguage && handleTranslate(translateLanguage)"
          >
            {{ t(translateLanguagePending ? 'qaArticleDetail.pendingTask' : 'qaArticleDetail.translate') }}
          </Button>
        </div>
      </header>

      <section v-if="selectedLanguage" class="quality-workspace">
        <div v-if="translationState.loading.value" class="detail-card quality-state">
          <Skeleton active :paragraph="{ rows: 5 }" />
        </div>
        <Alert
          v-else-if="translationState.error.value"
          type="error"
          show-icon
          :message="t('qaArticleDetail.translationLoadFailed')"
          :description="translationState.error.value"
        >
          <template #action>
            <Button size="small" @click="translationState.retry">
              {{ t('common.actions.retry') }}
            </Button>
          </template>
        </Alert>
        <div v-else-if="!translation" class="detail-card quality-state">
          <Empty :description="t('qaArticleDetail.noTranslation')" />
        </div>

        <template v-else>
          <article class="detail-card quality-summary">
            <header class="quality-summary__head">
              <div>
                <h3>{{ t('qaArticleDetail.analysis.title') }}</h3>
                <p>
                  {{ t(`qaArticleDetail.analysis.summary.${hasRuleScore ? score?.verdict : 'PENDING'}`) }}
                </p>
              </div>
              <Tag v-if="hasRuleScore && score?.verdict" :color="verdictColor[score.verdict]" class="quality-summary__verdict">
                {{ t(`qaArticleDetail.verdict.${score.verdict}`) }}
              </Tag>
              <Tag v-else class="quality-summary__verdict">
                {{ t('qaArticleDetail.notScored') }}
              </Tag>
            </header>

            <div class="quality-score">
              <div class="quality-score__value">
                <span>{{ t('qaArticleDetail.ruleScore') }}</span>
                <strong>{{ hasRuleScore ? score?.ruleScore : '—' }}</strong>
              </div>
              <div
                v-if="hasRuleScore"
                class="quality-score__track"
                role="progressbar"
                :aria-label="t('qaArticleDetail.ruleScore')"
                :aria-valuenow="score?.ruleScore ?? undefined"
                aria-valuemin="0"
                aria-valuemax="100"
              >
                <span :style="{ width: `${ruleScorePercent}%` }" />
              </div>
              <div v-else class="quality-score__track" aria-hidden="true" />
            </div>

            <dl class="quality-facts">
              <div>
                <dt>{{ t('qaArticleDetail.lengthRatio') }}</dt>
                <dd>{{ score?.lengthRatio ?? '—' }}</dd>
              </div>
              <div>
                <dt>{{ t('qaArticleDetail.analysis.reviewStatus') }}</dt>
                <dd>
                  <Tag v-if="score" :color="reviewColor[score.reviewStatus]" class="meta-tag">
                    {{ t(`qaArticleDetail.review.${score.reviewStatus}`) }}
                  </Tag>
                  <span v-else>—</span>
                </dd>
              </div>
              <div>
                <dt>{{ t('qaArticleDetail.analysis.taskStatus') }}</dt>
                <dd>{{ translation.hasPendingTask ? t('qaArticleDetail.pendingTask') : t('qaArticleDetail.analysis.noPendingTask') }}</dd>
              </div>
              <div>
                <dt>{{ t('qaArticleDetail.analysis.evidenceType') }}</dt>
                <dd>{{ t('qaArticleDetail.analysis.lengthRule') }}</dd>
              </div>
            </dl>

            <div class="analysis-scope">
              <strong>{{ t('qaArticleDetail.analysis.scopeTitle') }}</strong>
              <p>{{ t('qaArticleDetail.analysis.scopeDescription') }}</p>
            </div>

            <div v-if="score?.reviewNote" class="review-note">
              <strong>
                {{ t(score.reviewStatus === 'REJECTED'
                  ? 'qaArticleDetail.analysis.reviewNote'
                  : 'qaArticleDetail.analysis.reviewNoteHistory') }}
              </strong>
              <p>{{ score.reviewNote }}</p>
            </div>

            <div class="quality-actions">
              <Button :type="hasRuleScore ? 'default' : 'primary'" :loading="actionLoading" @click="handleScore">
                {{ t('qaArticleDetail.score') }}
              </Button>
              <Button type="primary" :disabled="!hasRuleScore || actionLoading" @click="handleApprove">
                {{ t('qaArticleDetail.approve') }}
              </Button>
              <Button danger :disabled="!hasRuleScore || actionLoading" @click="rejectModalOpen = true">
                {{ t('qaArticleDetail.reject') }}
              </Button>
              <Button :disabled="actionLoading" @click="handleTranslate(selectedLanguage)">
                {{ t('qaArticleDetail.retranslate') }}
              </Button>
            </div>
          </article>

          <aside class="detail-card decision-flow">
            <header class="decision-flow__head">
              <div>
                <h3>{{ t('qaArticleDetail.analysis.processTitle') }}</h3>
                <p>{{ t('qaArticleDetail.analysis.processDescription') }}</p>
              </div>
              <Tag class="meta-tag">
                A-2
              </Tag>
            </header>

            <ol class="decision-steps">
              <li class="decision-step decision-step--done">
                <span class="decision-step__index">1</span>
                <div>
                  <strong>{{ t('qaArticleDetail.analysis.sourceReady') }}</strong>
                  <p>{{ t('qaArticleDetail.analysis.sourceReadyDescription', { language: selectedLanguage }) }}</p>
                </div>
              </li>
              <li class="decision-step" :class="hasRuleScore ? 'decision-step--done' : 'decision-step--current'">
                <span class="decision-step__index">2</span>
                <div>
                  <strong>{{ t('qaArticleDetail.analysis.ruleScoring') }}</strong>
                  <p>
                    {{ hasRuleScore && score?.verdict
                      ? t('qaArticleDetail.analysis.ruleScoringDone', { verdict: t(`qaArticleDetail.verdict.${score.verdict}`) })
                      : t('qaArticleDetail.analysis.ruleScoringPending') }}
                  </p>
                </div>
              </li>
              <li
                class="decision-step"
                :class="reviewDone
                  ? 'decision-step--done'
                  : hasRuleScore ? 'decision-step--current' : 'decision-step--pending'"
              >
                <span class="decision-step__index">3</span>
                <div>
                  <strong>{{ t('qaArticleDetail.analysis.humanReview') }}</strong>
                  <p>
                    {{ reviewDone && score
                      ? t('qaArticleDetail.analysis.humanReviewDone', { status: t(`qaArticleDetail.review.${score.reviewStatus}`) })
                      : hasRuleScore
                        ? t('qaArticleDetail.analysis.humanReviewPending')
                        : t('qaArticleDetail.analysis.humanReviewBlocked') }}
                  </p>
                </div>
              </li>
            </ol>
          </aside>
        </template>
      </section>

      <details class="detail-card compare-disclosure">
        <summary>
          <span>
            <strong>{{ t('qaArticleDetail.analysis.compareTitle') }}</strong>
            <small>{{ t('qaArticleDetail.analysis.compareDescription') }}</small>
          </span>
          <code>zh → {{ selectedLanguage || '—' }}</code>
        </summary>

        <section class="compare">
          <article class="compare__pane">
            <header class="compare__head">
              <span class="compare__lang">zh</span>
              <span class="compare__title">{{ article.title }}</span>
            </header>
            <!-- contentHtml 由 API 通过标签白名单净化并移除全部属性 -->
            <div class="compare__body" v-html="article.contentHtml" />
          </article>

          <article class="compare__pane">
            <header class="compare__head">
              <span class="compare__lang">{{ selectedLanguage || '—' }}</span>
              <span class="compare__title">{{ translation?.title ?? '' }}</span>
            </header>
            <Skeleton
              v-if="translationState.loading.value"
              active
              :paragraph="{ rows: 8 }"
              class="compare__skeleton"
            />
            <Alert
              v-else-if="translationState.error.value"
              type="error"
              show-icon
              :message="t('qaArticleDetail.translationLoadFailed')"
              :description="translationState.error.value"
            />
            <Empty
              v-else-if="!translation"
              :description="t('qaArticleDetail.noTranslation')"
            />
            <!-- contentHtml 由 API 通过标签白名单净化并移除全部属性 -->
            <div v-else class="compare__body" v-html="translation.contentHtml" />
          </article>
        </section>
      </details>

      <section class="detail-card diagnose">
        <header class="diagnose__head">
          <span class="diagnose__title">{{ t('qaArticleDetail.diagnoseTitle') }}</span>
          <Tag color="default" class="meta-tag">
            {{ t('qaArticleDetail.diagnoseMock') }}
          </Tag>
        </header>
        <div v-if="diagnoseEntries.length" class="diagnose__entries">
          <div v-for="(entry, index) in diagnoseEntries" :key="index" class="diagnose__entry">
            <p class="diagnose__question">
              {{ entry.question }}
            </p>
            <p class="diagnose__answer">
              {{ entry.answer }}
            </p>
          </div>
        </div>
        <div class="diagnose__composer">
          <Textarea
            v-model:value="diagnoseQuestion"
            :placeholder="t('qaArticleDetail.diagnosePlaceholder')"
            :auto-size="{ minRows: 1, maxRows: 4 }"
            :maxlength="2000"
            @keydown.enter.exact="handleDiagnoseKeydown($event)"
          />
          <Button
            type="primary"
            :loading="diagnoseLoading"
            :disabled="!diagnoseQuestion.trim()"
            :aria-label="t('qaArticleDetail.diagnoseSend')"
            @click="handleDiagnose"
          >
            <template #icon>
              <SendOutlined />
            </template>
          </Button>
        </div>
      </section>
    </template>

    <Modal
      v-model:open="rejectModalOpen"
      :title="t('qaArticleDetail.rejectTitle')"
      :confirm-loading="actionLoading"
      :ok-text="t('qaArticleDetail.reject')"
      :cancel-text="t('common.actions.cancel')"
      ok-type="danger"
      @ok="handleReject"
    >
      <Textarea
        v-model:value="rejectNote"
        :placeholder="t('qaArticleDetail.rejectNotePlaceholder')"
        :auto-size="{ minRows: 3, maxRows: 6 }"
        :maxlength="2000"
      />
    </Modal>
  </PageContainer>
</template>

<style scoped>
.qa-detail-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.detail-card {
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-md);
  background: var(--admin-surface);
  box-shadow: var(--admin-shadow-sm);
}

.table-skeleton {
  padding: 22px 18px;
}

.detail-header {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px 18px;
  padding: 16px 18px;
}

.detail-header__main {
  min-width: 0;
}

.detail-header__title {
  margin: 0 0 6px;
  color: var(--admin-text);
  font-size: var(--admin-font-lg);
  font-weight: 700;
  line-height: 1.5;
}

.detail-header__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
}

.detail-header__meta code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.detail-header__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.language-select {
  min-width: 110px;
}

.meta-tag {
  margin: 0;
}

.quality-workspace {
  display: grid;
  grid-template-columns: minmax(0, 1.8fr) minmax(280px, 0.8fr);
  gap: 14px;
}

.quality-workspace > .ant-alert,
.quality-state {
  grid-column: 1 / -1;
}

.quality-state {
  padding: 22px 18px;
}

.quality-summary,
.decision-flow {
  padding: 18px;
}

.quality-summary__head,
.decision-flow__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.quality-summary__head h3,
.decision-flow__head h3 {
  margin: 0;
  color: var(--admin-text);
  font-size: var(--admin-font-lg);
  line-height: 1.4;
}

.quality-summary__head p,
.decision-flow__head p {
  max-width: 64ch;
  margin: 4px 0 0;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-sm);
  line-height: 1.65;
}

.quality-summary__verdict {
  flex: none;
  margin: 2px 0 0;
  font-size: var(--admin-font-sm);
}

.quality-score {
  margin-top: 20px;
}

.quality-score__value {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-sm);
}

.quality-score__value strong {
  color: var(--admin-text);
  font-size: var(--admin-font-xl);
  font-variant-numeric: tabular-nums;
}

.quality-score__track {
  height: 8px;
  margin-top: 8px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--admin-surface-muted);
}

.quality-score__track span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--admin-primary);
  transition: width 180ms ease-out;
}

.quality-facts {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 20px 0 0;
  border-block: 1px solid var(--admin-border);
}

.quality-facts > div {
  min-width: 0;
  padding: 14px 12px;
}

.quality-facts > div:first-child {
  padding-left: 0;
}

.quality-facts > div + div {
  border-left: 1px solid var(--admin-border);
}

.quality-facts dt {
  margin-bottom: 6px;
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-xs);
}

.quality-facts dd {
  margin: 0;
  overflow: hidden;
  color: var(--admin-text);
  font-size: var(--admin-font-sm);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.analysis-scope {
  margin-top: 16px;
  padding: 12px 14px;
  border-radius: var(--admin-radius-sm);
  background: var(--admin-surface-muted);
}

.analysis-scope strong {
  color: var(--admin-text);
  font-size: var(--admin-font-sm);
}

.analysis-scope p {
  margin: 4px 0 0;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
  line-height: 1.65;
}

.review-note {
  margin-top: 12px;
  padding: 10px 14px;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-sm);
}

.review-note strong {
  color: var(--admin-text);
  font-size: var(--admin-font-xs);
}

.review-note p {
  margin: 4px 0 0;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-sm);
  line-height: 1.65;
  overflow-wrap: anywhere;
}

.quality-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 16px;
}

.decision-steps {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0;
  margin: 20px 0 0;
  list-style: none;
}

.decision-step {
  position: relative;
  display: grid;
  grid-template-columns: 28px minmax(0, 1fr);
  gap: 10px;
  padding-bottom: 20px;
}

.decision-step:last-child {
  padding-bottom: 0;
}

.decision-step:not(:last-child)::after {
  position: absolute;
  top: 28px;
  bottom: 0;
  left: 13px;
  width: 1px;
  background: var(--admin-border-strong);
  content: '';
}

.decision-step__index {
  position: relative;
  z-index: 1;
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border: 1px solid var(--admin-border-strong);
  border-radius: 50%;
  color: var(--admin-text-subtle);
  background: var(--admin-surface);
  font-size: var(--admin-font-xs);
  font-weight: 700;
}

.decision-step--done .decision-step__index {
  border-color: color-mix(in srgb, var(--admin-success) 45%, var(--admin-border));
  color: var(--admin-success-strong);
  background: var(--admin-success-soft);
}

.decision-step--current .decision-step__index {
  border-color: color-mix(in srgb, var(--admin-primary) 45%, var(--admin-border));
  color: var(--admin-primary);
  background: var(--admin-primary-soft);
}

.decision-step strong {
  display: block;
  margin-top: 3px;
  color: var(--admin-text);
  font-size: var(--admin-font-sm);
}

.decision-step p {
  margin: 4px 0 0;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
  line-height: 1.6;
}

.decision-step--pending strong,
.decision-step--pending p {
  color: var(--admin-text-subtle);
}

.compare-disclosure {
  overflow: hidden;
}

.compare-disclosure > summary {
  display: flex;
  min-height: 56px;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 12px 18px;
  cursor: pointer;
  list-style: none;
}

.compare-disclosure > summary::-webkit-details-marker {
  display: none;
}

.compare-disclosure > summary::after {
  flex: none;
  color: var(--admin-text-subtle);
  content: '⌄';
  transition: transform 180ms ease-out;
}

.compare-disclosure[open] > summary::after {
  transform: rotate(180deg);
}

.compare-disclosure > summary > span {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  gap: 2px;
}

.compare-disclosure > summary strong {
  color: var(--admin-text);
  font-size: var(--admin-font-sm);
}

.compare-disclosure > summary small {
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
}

.compare-disclosure > summary code {
  flex: none;
  color: var(--admin-text-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--admin-font-xs);
}

.compare {
  display: grid;
  grid-template-columns: 1fr 1fr;
  border-top: 1px solid var(--admin-border);
  overflow: hidden;
}

.compare__pane {
  display: flex;
  min-width: 0;
  flex-direction: column;
}

.compare__pane + .compare__pane {
  border-left: 1px solid var(--admin-border);
}

.compare__head {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--admin-border);
  background: var(--admin-surface-muted);
}

.compare__lang {
  flex: none;
  padding: 1px 8px;
  border: 1px solid var(--admin-border-strong);
  border-radius: 4px;
  color: var(--admin-text-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--admin-font-2xs);
}

.compare__title {
  overflow: hidden;
  color: var(--admin-text);
  font-size: var(--admin-font-sm);
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.compare__body {
  max-height: 64vh;
  padding: 22px 24px;
  overflow-y: auto;
  color: var(--admin-text);
  font-size: var(--admin-font-sm);
  line-height: 1.75;
  overflow-wrap: anywhere;
}

.compare__body :deep(> :first-child) {
  margin-top: 0;
}

.compare__body :deep(> :last-child) {
  margin-bottom: 0;
}

.compare__body :deep(p),
.compare__body :deep(ul),
.compare__body :deep(ol),
.compare__body :deep(blockquote),
.compare__body :deep(pre),
.compare__body :deep(table) {
  margin: 0 0 1em;
}

.compare__body :deep(h1),
.compare__body :deep(h2),
.compare__body :deep(h3),
.compare__body :deep(h4),
.compare__body :deep(h5),
.compare__body :deep(h6) {
  margin: 1.5em 0 0.65em;
  color: var(--admin-text);
  font-weight: 700;
  line-height: 1.35;
  text-wrap: balance;
}

.compare__body :deep(h1) {
  font-size: 1.45em;
}

.compare__body :deep(h2) {
  padding-bottom: 0.3em;
  border-bottom: 1px solid var(--admin-border);
  font-size: 1.3em;
}

.compare__body :deep(h3) {
  font-size: 1.15em;
}

.compare__body :deep(h4),
.compare__body :deep(h5),
.compare__body :deep(h6) {
  font-size: 1em;
}

.compare__body :deep(ul),
.compare__body :deep(ol) {
  padding-inline-start: 1.5em;
}

.compare__body :deep(li + li) {
  margin-top: 0.3em;
}

.compare__body :deep(blockquote) {
  padding: 10px 14px;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-sm);
  background: var(--admin-surface-muted);
  color: var(--admin-text-muted);
}

.compare__body :deep(pre) {
  padding: 12px 14px;
  overflow-x: auto;
  border-radius: var(--admin-radius-sm);
  background: var(--admin-surface-muted);
  line-height: 1.6;
  white-space: pre;
}

.compare__body :deep(code) {
  padding: 0.1em 0.35em;
  border-radius: 4px;
  background: var(--admin-surface-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.92em;
}

.compare__body :deep(pre code) {
  padding: 0;
  background: transparent;
}

.compare__body :deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--admin-font-xs);
}

.compare__body :deep(th),
.compare__body :deep(td) {
  padding: 7px 9px;
  border: 1px solid var(--admin-border);
  text-align: start;
  vertical-align: top;
}

.compare__body :deep(th) {
  background: var(--admin-surface-muted);
  font-weight: 650;
}

.compare__body :deep(hr) {
  margin: 1.5em 0;
  border: 0;
  border-top: 1px solid var(--admin-border);
}

.compare__skeleton {
  padding: 16px 18px;
}

@media (max-width: 1100px) {
  .quality-workspace {
    grid-template-columns: 1fr;
  }

  .compare {
    grid-template-columns: 1fr;
  }

  .compare__pane + .compare__pane {
    border-top: 1px solid var(--admin-border);
    border-left: 0;
  }

  .quality-facts {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .quality-facts > div:nth-child(3) {
    border-left: 0;
  }

  .quality-facts > div:nth-child(n + 3) {
    border-top: 1px solid var(--admin-border);
  }
}

.diagnose {
  padding: 14px 18px 16px;
}

.diagnose__head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.diagnose__title {
  color: var(--admin-text);
  font-size: var(--admin-font-md);
  font-weight: 600;
}

.diagnose__entries {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 12px;
}

.diagnose__question {
  margin: 0 0 4px;
  color: var(--admin-text);
  font-size: var(--admin-font-sm);
  font-weight: 600;
}

.diagnose__answer {
  margin: 0;
  padding: 10px 14px;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-sm);
  background: var(--admin-surface-muted);
  color: var(--admin-text-muted);
  font-size: var(--admin-font-sm);
  line-height: 1.8;
}

.diagnose__composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}
</style>
