<script setup lang="ts">
import type { QaTranslationScore } from '@agent/contracts'
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Result,
  Skeleton,
} from 'ant-design-vue'
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import PageContainer from '@/components/common/PageContainer.vue'
import {
  fetchQaArticleDetail,
  fetchQaDiagnoseMessages,
  fetchQaTranslationDetail,
} from '@/features/qa/qa-api'
import { formatShortDateTime } from '@/features/runs/run.utils'
import { createDetailFetchState } from '@/features/shared/detail-fetch.state'

const route = useRoute()
const router = useRouter()
const { locale, t } = useI18n()

const articleId = computed(() => String(route.params.articleId ?? ''))

const articleState = createDetailFetchState(
  () => articleId.value,
  (id, signal) => fetchQaArticleDetail(id, { signal }),
)
const article = articleState.data

/** 中文原文在档案矩阵中的固定行标识；原文不是译文，不走译文详情接口 */
const SOURCE_LANGUAGE = 'zh'

const selectedLanguage = ref('')
const translationState = createDetailFetchState(
  () => (
    selectedLanguage.value && selectedLanguage.value !== SOURCE_LANGUAGE
      ? `${articleId.value}:${selectedLanguage.value}`
      : ''
  ),
  (_key, signal) => fetchQaTranslationDetail(articleId.value, selectedLanguage.value, { signal }),
)
const translation = translationState.data
const score = computed<QaTranslationScore | null>(() => translation.value?.score ?? null)

const historyState = createDetailFetchState(
  () => articleId.value,
  (id, signal) => fetchQaDiagnoseMessages(id, { signal }),
)
const diagnoseMessages = computed(() => historyState.data.value?.items ?? [])

watch(article, (value) => {
  if (!value)
    return
  const known = selectedLanguage.value === SOURCE_LANGUAGE
    || value.translations.some(item => item.languageCode === selectedLanguage.value)
  if (!selectedLanguage.value || !known)
    selectedLanguage.value = value.translations[0]?.languageCode ?? SOURCE_LANGUAGE
}, { immediate: true })

watch(selectedLanguage, (value) => {
  if (value && value !== SOURCE_LANGUAGE)
    void translationState.load()
})

void articleState.load()
void historyState.load()
onBeforeUnmount(() => {
  articleState.cancel()
  translationState.cancel()
  historyState.cancel()
})

const verdictTone: Record<string, string> = {
  PASS: 'pass',
  REVIEW: 'warn',
  REJECT: 'fail',
}
const reviewTone: Record<string, string> = {
  PENDING: 'neutral',
  APPROVED: 'pass',
  REJECTED: 'fail',
}

function openWorkbench() {
  void router.push({ name: 'qa-workbench', query: { articleId: articleId.value } })
}

// ---- 正文预览抽屉 ----
const previewOpen = ref(false)
const isSourcePreview = computed(() => selectedLanguage.value === SOURCE_LANGUAGE)
const previewTitle = computed(() => (
  isSourcePreview.value
    ? `zh · ${article.value?.title ?? ''}`
    : `${translation.value?.languageCode ?? ''} · ${translation.value?.title ?? ''}`
))
const previewHtml = computed(() => (
  isSourcePreview.value
    ? article.value?.contentHtml ?? ''
    : translation.value?.contentHtml ?? ''
))
</script>

<template>
  <PageContainer wide class="qa-archive-page">
    <h1 class="sr-only">
      {{ t('qaArticleDetail.title') }}
    </h1>

    <template v-if="articleState.loading.value && !article">
      <div class="board-card state-block">
        <Skeleton active :paragraph="{ rows: 10 }" />
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
      <header class="page-head">
        <div class="page-head__main">
          <h2 class="page-head__title">
            {{ article.title }}
          </h2>
          <div class="page-head__meta">
            <code>{{ article.slug }}</code>
            <span v-if="article.isQaCandidate" class="pill pill--primary">
              {{ t('qaArticles.candidateTag') }}
            </span>
            <span>{{ t('qaArticleDetail.termHits', { count: article.termHitCount ?? '—' }) }}</span>
          </div>
        </div>
        <Button type="primary" @click="openWorkbench">
          {{ t('qaArticleDetail.openWorkbench') }}
        </Button>
      </header>

      <section class="board-card archive">
        <header class="archive__head">
          <h3>{{ t('qaArticleDetail.languagesTitle') }}</h3>
          <p>{{ t('qaArticleDetail.languagesDescription') }}</p>
        </header>

        <div class="archive__body">
          <div class="archive__list">
            <button
              type="button"
              class="lang-row"
              :class="{ 'lang-row--selected': selectedLanguage === SOURCE_LANGUAGE }"
              :aria-pressed="selectedLanguage === SOURCE_LANGUAGE"
              @click="selectedLanguage = SOURCE_LANGUAGE"
            >
              <span class="lang-row__code">zh</span>
              <span class="lang-row__score">—</span>
              <span class="pill pill--primary">{{ t('qaArticleDetail.sourceLabel') }}</span>
            </button>
            <button
              v-for="item in article.translations"
              :key="item.languageCode"
              type="button"
              class="lang-row"
              :class="{ 'lang-row--selected': item.languageCode === selectedLanguage }"
              :aria-pressed="item.languageCode === selectedLanguage"
              @click="selectedLanguage = item.languageCode"
            >
              <span class="lang-row__code">{{ item.languageCode }}</span>
              <span class="lang-row__score">{{ item.ruleScore ?? '—' }}</span>
              <span
                v-if="item.verdict"
                class="pill"
                :class="`pill--${verdictTone[item.verdict]}`"
              >
                {{ t(`qaShared.verdict.${item.verdict}`) }}
              </span>
              <span v-else class="pill pill--neutral">{{ t('qaShared.notScored') }}</span>
              <span
                v-if="item.reviewStatus && item.reviewStatus !== 'PENDING'"
                class="pill"
                :class="`pill--${reviewTone[item.reviewStatus]}`"
              >
                {{ t(`qaShared.review.${item.reviewStatus}`) }}
              </span>
              <span v-if="item.hasPendingTask" class="pill pill--warn">
                {{ t('qaShared.pendingTask') }}
              </span>
            </button>

            <div v-if="article.missingLanguages.length" class="archive__missing">
              <span class="archive__missing-label">{{ t('qaArticleDetail.missingTitle') }}</span>
              <span
                v-for="code in article.missingLanguages"
                :key="code"
                class="lang-chip lang-chip--missing"
                :class="{ 'lang-chip--pending': article.pendingLanguages.includes(code) }"
              >
                {{ article.pendingLanguages.includes(code)
                  ? `${code} · ${t('qaShared.pendingTask')}`
                  : code }}
              </span>
            </div>
          </div>

          <div class="archive__panel">
            <Empty
              v-if="!selectedLanguage"
              :description="t('qaArticleDetail.noTranslation')"
            />
            <template v-else-if="selectedLanguage === SOURCE_LANGUAGE">
              <header class="panel-head">
                <span class="lang-chip lang-chip--static">zh</span>
                <span class="pill pill--primary">{{ t('qaArticleDetail.sourceLabel') }}</span>
                <span class="panel-head__title">{{ article.title }}</span>
              </header>
              <Button class="panel-preview-button" @click="previewOpen = true">
                {{ t('qaArticleDetail.sourcePreviewTitle') }}
              </Button>
            </template>
            <Skeleton
              v-else-if="translationState.loading.value"
              active
              :paragraph="{ rows: 6 }"
            />
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
            <Empty
              v-else-if="translationState.notFound.value"
              :description="t('qaArticleDetail.noTranslation')"
            />

            <template v-else-if="translation">
              <header class="panel-head">
                <span class="lang-chip lang-chip--static">{{ translation.languageCode }}</span>
                <span class="panel-head__title">{{ translation.title }}</span>
              </header>

              <dl class="panel-facts">
                <div class="panel-facts__row">
                  <dt>{{ t('qaShared.ruleScore') }}</dt>
                  <dd>{{ score?.ruleScore ?? '—' }}</dd>
                </div>
                <div class="panel-facts__row">
                  <dt>{{ t('qaShared.lengthRatio') }}</dt>
                  <dd>{{ score?.lengthRatio ?? '—' }}</dd>
                </div>
                <div class="panel-facts__row">
                  <dt>{{ t('qaArticleDetail.verdictLabel') }}</dt>
                  <dd>
                    <span
                      v-if="score?.verdict"
                      class="pill"
                      :class="`pill--${verdictTone[score.verdict]}`"
                    >
                      {{ t(`qaShared.verdict.${score.verdict}`) }}
                    </span>
                    <span v-else class="pill pill--neutral">{{ t('qaShared.notScored') }}</span>
                  </dd>
                </div>
                <div class="panel-facts__row">
                  <dt>{{ t('qaArticleDetail.reviewLabel') }}</dt>
                  <dd>
                    <span
                      v-if="score"
                      class="pill"
                      :class="`pill--${reviewTone[score.reviewStatus]}`"
                    >
                      {{ t(`qaShared.review.${score.reviewStatus}`) }}
                    </span>
                    <span v-else>—</span>
                  </dd>
                </div>
                <div class="panel-facts__row">
                  <dt>{{ t('qaArticleDetail.scoredAt') }}</dt>
                  <dd>{{ score?.scoredAt ? formatShortDateTime(score.scoredAt, locale) : '—' }}</dd>
                </div>
                <div class="panel-facts__row">
                  <dt>{{ t('qaArticleDetail.reviewedAt') }}</dt>
                  <dd>{{ score?.reviewedAt ? formatShortDateTime(score.reviewedAt, locale) : '—' }}</dd>
                </div>
              </dl>

              <div v-if="score?.reviewNote" class="review-note">
                <strong>{{ t('qaArticleDetail.reviewNote') }}</strong>
                <p>{{ score.reviewNote }}</p>
              </div>

              <Button class="panel-preview-button" @click="previewOpen = true">
                {{ t('qaArticleDetail.previewTitle') }}
              </Button>
            </template>
          </div>
        </div>
      </section>

      <section class="board-card log">
        <header class="log__head">
          <h3>{{ t('qaArticleDetail.diagnoseTitle') }}</h3>
        </header>

        <Alert
          v-if="historyState.error.value"
          class="log__state"
          type="error"
          show-icon
          :message="t('qaArticleDetail.diagnoseLoadFailed')"
        >
          <template #action>
            <Button size="small" @click="historyState.retry">
              {{ t('common.actions.retry') }}
            </Button>
          </template>
        </Alert>
        <Skeleton
          v-else-if="historyState.loading.value && !diagnoseMessages.length"
          active
          class="log__state"
          :paragraph="{ rows: 2 }"
        />
        <p v-else-if="!diagnoseMessages.length" class="log__empty">
          {{ t('qaArticleDetail.diagnoseEmpty') }}
        </p>
        <div v-else class="log__thread">
          <div
            v-for="entry in diagnoseMessages"
            :key="entry.id"
            class="bubble"
            :class="entry.role === 'USER' ? 'bubble--user' : 'bubble--assistant'"
          >
            {{ entry.content }}
          </div>
        </div>
      </section>

      <Drawer
        v-model:open="previewOpen"
        placement="right"
        width="min(880px, 94vw)"
        :title="previewTitle"
      >
        <!-- contentHtml 由 API 通过标签白名单净化并移除全部属性 -->
        <div class="qa-preview-rich" v-html="previewHtml" />
      </Drawer>
    </template>
  </PageContainer>
</template>

<style scoped>
.qa-archive-page {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.board-card {
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-lg);
  background: var(--admin-surface);
  box-shadow: var(--admin-shadow-sm);
}

.state-block {
  padding: 22px 18px;
}

/* ---- 页头 ---- */
.page-head {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px 18px;
  padding: 2px 2px 0;
}

.page-head__main {
  min-width: 0;
}

.page-head__title {
  margin: 0 0 6px;
  color: var(--admin-text);
  font-size: var(--admin-font-xl);
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.4;
}

.page-head__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
}

.page-head__meta code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

/* ---- 通用 pill / chip ---- */
.pill {
  display: inline-flex;
  align-items: center;
  padding: 2px 9px;
  border-radius: 999px;
  font-size: var(--admin-font-2xs);
  font-weight: 600;
  line-height: 1.5;
}

.pill--primary {
  background: var(--admin-primary-soft);
  color: var(--admin-primary);
}

.pill--pass {
  background: var(--admin-success-soft);
  color: var(--admin-success-strong);
}

.pill--warn {
  background: var(--admin-warning-soft);
  color: var(--admin-warning-strong);
}

.pill--fail {
  background: var(--admin-danger-soft);
  color: var(--admin-danger-strong);
}

.pill--neutral {
  background: var(--admin-surface-muted);
  color: var(--admin-text-muted);
}

.lang-chip {
  display: inline-flex;
  height: 24px;
  align-items: center;
  padding: 0 10px;
  border: 1px solid var(--admin-border-strong);
  border-radius: 999px;
  color: var(--admin-text-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--admin-font-2xs);
}

.lang-chip--missing {
  border-style: dashed;
  color: var(--admin-text-subtle);
}

.lang-chip--pending {
  border-color: color-mix(in srgb, var(--admin-warning) 45%, transparent);
  color: var(--admin-warning-strong);
}

.lang-chip--static {
  background: var(--admin-surface-muted);
  font-weight: 600;
}

/* ---- 语种档案 ---- */
.archive__head {
  padding: 16px 18px 0;
}

.archive__head h3 {
  margin: 0;
  color: var(--admin-text);
  font-size: var(--admin-font-md);
  font-weight: 700;
}

.archive__head p {
  margin: 4px 0 0;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
}

.archive__body {
  display: grid;
  grid-template-columns: minmax(260px, 340px) minmax(0, 1fr);
  gap: 0;
  margin-top: 14px;
  border-top: 1px solid var(--admin-border);
}

.archive__list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px;
  border-right: 1px solid var(--admin-border);
}

.lang-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: var(--admin-radius-sm);
  background: transparent;
  text-align: start;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease;
}

.lang-row:hover {
  background: var(--admin-surface-muted);
}

.lang-row--selected,
.lang-row--selected:hover {
  border-color: color-mix(in srgb, var(--admin-primary) 40%, transparent);
  background: var(--admin-primary-soft);
}

.lang-row__code {
  min-width: 42px;
  color: var(--admin-text);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--admin-font-xs);
  font-weight: 650;
}

.lang-row__score {
  min-width: 26px;
  color: var(--admin-text);
  font-size: var(--admin-font-xs);
  font-variant-numeric: tabular-nums;
  font-weight: 650;
}

.archive__missing {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  padding: 12px 10px 6px;
  margin-top: 6px;
  border-top: 1px dashed var(--admin-border);
}

.archive__missing-label {
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-2xs);
}

.archive__panel {
  min-width: 0;
  padding: 16px 18px;
}

.panel-head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.panel-head__title {
  overflow: hidden;
  color: var(--admin-text);
  font-size: var(--admin-font-sm);
  font-weight: 650;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.panel-facts {
  margin: 14px 0 0;
}

.panel-facts__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 0;
  border-top: 1px solid var(--admin-border);
  font-size: var(--admin-font-xs);
}

.panel-facts__row dt {
  color: var(--admin-text-muted);
}

.panel-facts__row dd {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  color: var(--admin-text);
  font-variant-numeric: tabular-nums;
  font-weight: 600;
}

.review-note {
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-sm);
}

.review-note strong {
  color: var(--admin-text);
  font-size: var(--admin-font-2xs);
}

.review-note p {
  margin: 4px 0 0;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
  line-height: 1.65;
  overflow-wrap: anywhere;
}

/* ---- 译文预览入口 ---- */
.panel-preview-button {
  margin-top: 14px;
}

/* ---- 沟通记录 ---- */
.log {
  padding: 16px 18px;
}

.log__head h3 {
  margin: 0;
  color: var(--admin-text);
  font-size: var(--admin-font-md);
  font-weight: 700;
}

.log__state {
  margin-top: 12px;
}

.log__empty {
  margin: 12px 0 0;
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-xs);
}

.log__thread {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 360px;
  margin-top: 14px;
  overflow-y: auto;
}

.bubble {
  max-width: 82%;
  padding: 9px 13px;
  border-radius: 14px;
  font-size: var(--admin-font-sm);
  line-height: 1.7;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}

.bubble--user {
  align-self: flex-end;
  border-bottom-right-radius: 4px;
  background: var(--admin-primary-soft);
  color: var(--admin-text);
}

.bubble--assistant {
  align-self: flex-start;
  border-bottom-left-radius: 4px;
  background: var(--admin-surface-muted);
  color: var(--admin-text-muted);
}

@media (max-width: 960px) {
  .archive__body {
    grid-template-columns: 1fr;
  }

  .archive__list {
    border-right: 0;
    border-bottom: 1px solid var(--admin-border);
  }
}
</style>

<!-- 预览抽屉经 antd portal 挂到 body 下，scoped 样式够不到，故用全局块 + 独有类名 -->
<style>
.qa-preview-rich {
  color: var(--admin-text);
  font-size: var(--admin-font-md);
  line-height: 1.8;
  overflow-wrap: anywhere;
}

.qa-preview-rich > :first-child {
  margin-top: 0;
}

.qa-preview-rich > :last-child {
  margin-bottom: 0;
}

.qa-preview-rich p,
.qa-preview-rich ul,
.qa-preview-rich ol,
.qa-preview-rich blockquote,
.qa-preview-rich pre,
.qa-preview-rich table {
  margin: 0 0 1em;
}

.qa-preview-rich h1,
.qa-preview-rich h2,
.qa-preview-rich h3,
.qa-preview-rich h4,
.qa-preview-rich h5,
.qa-preview-rich h6 {
  margin: 1.5em 0 0.65em;
  color: var(--admin-text);
  font-weight: 700;
  line-height: 1.35;
}

.qa-preview-rich h1 {
  font-size: 1.4em;
}

.qa-preview-rich h2 {
  padding-bottom: 0.3em;
  border-bottom: 1px solid var(--admin-border);
  font-size: 1.25em;
}

.qa-preview-rich h3 {
  font-size: 1.1em;
}

.qa-preview-rich h4,
.qa-preview-rich h5,
.qa-preview-rich h6 {
  font-size: 1em;
}

.qa-preview-rich ul,
.qa-preview-rich ol {
  padding-inline-start: 1.5em;
}

.qa-preview-rich li + li {
  margin-top: 0.3em;
}

.qa-preview-rich blockquote {
  padding: 10px 14px;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-sm);
  background: var(--admin-surface-muted);
  color: var(--admin-text-muted);
}

.qa-preview-rich pre {
  padding: 12px 14px;
  overflow-x: auto;
  border-radius: var(--admin-radius-sm);
  background: var(--admin-surface-muted);
  line-height: 1.6;
  white-space: pre;
}

.qa-preview-rich code {
  padding: 0.1em 0.35em;
  border-radius: 4px;
  background: var(--admin-surface-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.92em;
}

.qa-preview-rich pre code {
  padding: 0;
  background: transparent;
}

.qa-preview-rich table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--admin-font-sm);
}

.qa-preview-rich th,
.qa-preview-rich td {
  padding: 7px 9px;
  border: 1px solid var(--admin-border);
  text-align: start;
  vertical-align: top;
}

.qa-preview-rich th {
  background: var(--admin-surface-muted);
  font-weight: 650;
}

.qa-preview-rich hr {
  margin: 1.5em 0;
  border: 0;
  border-top: 1px solid var(--admin-border);
}
</style>
