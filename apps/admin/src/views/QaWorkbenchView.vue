<script setup lang="ts">
import type {
  QaArticleListItem,
  QaDiagnoseMessage,
  QaTranslateTaskResponse,
  QaTranslationScore,
} from '@agent/contracts'
import { SearchOutlined, SendOutlined, ThunderboltOutlined } from '@ant-design/icons-vue'
import {
  Alert,
  App as AntApp,
  Button,
  Checkbox,
  Empty,
  InputSearch,
  Modal,
  Pagination,
  Popover,
  Skeleton,
  Textarea,
} from 'ant-design-vue'
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'

import PageContainer from '@/components/common/PageContainer.vue'
import {
  diagnoseQaArticle,
  fetchQaArticleDetail,
  fetchQaArticles,
  fetchQaDiagnoseMessages,
  fetchQaTranslationDetail,
  requestQaTranslation,
  reviewQaTranslation,
  scoreQaTranslation,
} from '@/features/qa/qa-api'
import { formatAdminRunError } from '@/features/shared/admin-api'
import { createDetailFetchState } from '@/features/shared/detail-fetch.state'
import { createPagedListState } from '@/features/shared/paged-list.state'

const route = useRoute()
const router = useRouter()
const { message } = AntApp.useApp()
const { locale, t } = useI18n()

// ---- 文章队列 ----
const searchText = ref('')
const qaCandidateOnly = ref(true)

const queueState = createPagedListState<QaArticleListItem>(
  (page, pageSize, signal) => fetchQaArticles({
    page,
    pageSize,
    search: searchText.value,
    qaCandidateOnly: qaCandidateOnly.value,
  }, { signal }),
  20,
)

function applyQueueFilters() {
  void queueState.setPage(1)
}

// antd InputSearch 的清除按钮只触发 change 不触发 search，清空时主动刷新列表
function handleQueueSearchChange(event: Event) {
  if (!(event.target as HTMLInputElement).value)
    applyQueueFilters()
}

// ---- 当前文章 ----
// 路由 tab 只按 path 记忆，重进工作台会丢 query；用 sessionStorage 兜底恢复上次选中的文章
const WORKBENCH_ARTICLE_KEY = 'qa-workbench-article-id'
const selectedArticleId = ref(
  String(route.query.articleId ?? '') || sessionStorage.getItem(WORKBENCH_ARTICLE_KEY) || '',
)

const articleState = createDetailFetchState(
  () => selectedArticleId.value,
  (id, signal) => fetchQaArticleDetail(id, { signal }),
)
const article = articleState.data

const selectedLanguage = ref('')
const isMissingSelected = computed(() => !!article.value?.missingLanguages.includes(selectedLanguage.value))
const isPendingSelected = computed(() => !!article.value?.pendingLanguages.includes(selectedLanguage.value))

const translationState = createDetailFetchState(
  () => (
    selectedLanguage.value && !isMissingSelected.value
      ? `${selectedArticleId.value}:${selectedLanguage.value}`
      : ''
  ),
  (_key, signal) => fetchQaTranslationDetail(selectedArticleId.value, selectedLanguage.value, { signal }),
)
const translation = translationState.data
const score = computed<QaTranslationScore | null>(() => translation.value?.score ?? null)

watch(article, (value) => {
  if (!value)
    return
  const known = value.translations.some(item => item.languageCode === selectedLanguage.value)
    || value.missingLanguages.includes(selectedLanguage.value)
  if (!selectedLanguage.value || !known)
    selectedLanguage.value = value.translations[0]?.languageCode ?? value.missingLanguages[0] ?? ''
}, { immediate: true })

watch(selectedLanguage, (value) => {
  if (value && !isMissingSelected.value)
    void translationState.load()
})

const actionLoading = ref(false)

// ---- 诊断历史（问答已落库，应答仍为占位实现）----
const historyState = createDetailFetchState(
  () => selectedArticleId.value,
  (id, signal) => fetchQaDiagnoseMessages(id, { signal }),
)
const diagnoseMessages = ref<QaDiagnoseMessage[]>([])
watch(historyState.data, (value) => {
  diagnoseMessages.value = value?.items ? [...value.items] : []
})

function selectArticle(item: QaArticleListItem) {
  if (item.id === selectedArticleId.value)
    return
  selectedArticleId.value = item.id
  selectedLanguage.value = ''
  resetRun()
  sessionStorage.setItem(WORKBENCH_ARTICLE_KEY, item.id)
  void articleState.load()
  void historyState.load()
  void router.replace({ query: { articleId: item.id } })
}

// ---- 流程面板：翻译（演示流，末步真实入队）与规则质检（真实执行）共用 ----
const TRANSLATE_STEP_KEYS = ['read', 'terms', 'translate', 'check', 'submit'] as const
const SCORE_STEP_KEYS = ['extract', 'measure', 'band', 'write'] as const
const TRANSLATE_STEP_MS = 900
const SCORE_STEP_MS = 600

type RunKind = 'translate' | 'score'

interface RunStep {
  key: string
  status: 'pending' | 'running' | 'done'
}

const runKind = ref<RunKind>('translate')
const runStatus = ref<'idle' | 'running' | 'done' | 'failed'>('idle')
const runSteps = ref<RunStep[]>([])
/** score 流程绑定的语种；翻译批量流程用 runLanguages */
const runLanguage = ref('')
const runLanguages = ref<string[]>([])
const translateSummary = shallowRef<{ queued: number, already: number } | null>(null)
const scoreRunResult = shallowRef<QaTranslationScore | null>(null)
let runTimers: ReturnType<typeof setTimeout>[] = []

const runLanguageLabel = computed(() => (
  runKind.value === 'score'
    ? runLanguage.value
    : runLanguages.value.join(locale.value.startsWith('zh') ? '、' : ', ')
))

// 递增令牌：reset 后仍在途的请求回调据此放弃 UI 更新，避免旧 run 的结果“复活”到新文章上
let runSequence = 0

function resetRun() {
  runSequence += 1
  runTimers.forEach(timer => clearTimeout(timer))
  runTimers = []
  runStatus.value = 'idle'
  runSteps.value = []
  translateSummary.value = null
  scoreRunResult.value = null
  runLanguage.value = ''
  runLanguages.value = []
}

function startRun(
  kind: RunKind,
  keys: readonly string[],
  stepMs: number,
  submit: (isCurrent: () => boolean) => Promise<void>,
): boolean {
  if (runStatus.value === 'running' || actionLoading.value)
    return false
  resetRun()
  const runId = runSequence
  // submit 内部据此判断本 run 是否仍有效，避免被取消的旧请求把结果写进新 run
  const isCurrent = () => runId === runSequence
  runKind.value = kind
  runLanguage.value = selectedLanguage.value
  runSteps.value = keys.map(key => ({ key, status: 'pending' }))
  runStatus.value = 'running'

  // 真实请求在流程启动时立即发出，演示时间线只做过程可视化；
  // 中途切换文章/语种只会取消动画，不会丢请求
  const submission = submit(isCurrent).then(
    () => null,
    (cause: unknown) => {
      message.error(formatAdminRunError(cause))
      return cause
    },
  )

  keys.forEach((_, index) => {
    runTimers.push(setTimeout(() => {
      const step = runSteps.value[index]
      if (step)
        step.status = 'running'
    }, index * stepMs))
    if (index < keys.length - 1) {
      runTimers.push(setTimeout(() => {
        const step = runSteps.value[index]
        if (step)
          step.status = 'done'
      }, (index + 1) * stepMs))
    }
  })
  runTimers.push(setTimeout(() => {
    void submission.then((cause) => {
      if (runId !== runSequence)
        return
      finishLastRunStep()
      runStatus.value = cause ? 'failed' : 'done'
    })
  }, keys.length * stepMs))
  return true
}

function startTranslateRun(languages: string[]) {
  const targets = [...new Set(languages)].filter(Boolean)
  if (!targets.length)
    return
  if (startRun('translate', TRANSLATE_STEP_KEYS, TRANSLATE_STEP_MS, isCurrent => submitTranslateRun(targets, isCurrent)))
    runLanguages.value = targets
}

function startScoreRun(languageCode: string) {
  startRun('score', SCORE_STEP_KEYS, SCORE_STEP_MS, isCurrent => submitScoreRun(languageCode, isCurrent))
}

function finishLastRunStep() {
  const lastStep = runSteps.value[runSteps.value.length - 1]
  if (lastStep)
    lastStep.status = 'done'
}

async function submitTranslateRun(languages: string[], isCurrent: () => boolean) {
  const articleId = selectedArticleId.value
  // 逐语种独立结算：一个语种失败不吞掉其余已排队语种的事实
  const settled = await Promise.allSettled(
    languages.map(code => requestQaTranslation(articleId, code)),
  )
  const fulfilled = settled.filter(
    (item): item is PromiseFulfilledResult<QaTranslateTaskResponse> => item.status === 'fulfilled',
  )
  if (!isCurrent())
    return
  if (!fulfilled.length) {
    const firstRejected = settled.find(item => item.status === 'rejected') as PromiseRejectedResult | undefined
    throw firstRejected?.reason ?? new Error('translate submit failed')
  }
  const failedCount = settled.length - fulfilled.length
  if (failedCount)
    message.error(t('qaWorkbench.batchPartialFailed', { count: failedCount }))
  const already = fulfilled.filter(item => item.value.alreadyQueued).length
  translateSummary.value = { queued: fulfilled.length - already, already }
  await articleState.refresh()
  // 重译当前已有译文的语种后，刷新译文详情让“翻译排队中”标记立即可见
  if (languages.includes(selectedLanguage.value) && !isMissingSelected.value)
    await translationState.refresh()
}

// ---- 多语种翻译选择（下拉勾选） ----
const translateDropdownOpen = ref(false)
const translateSelection = ref<string[]>([])

// 打开下拉时默认勾选还没排队的缺失语种；已有译文的作为重译按需勾选
watch(translateDropdownOpen, (open) => {
  if (!open)
    return
  translateSelection.value = article.value
    ? article.value.missingLanguages.filter(code => !article.value?.pendingLanguages.includes(code))
    : []
})

function toggleTranslateLanguage(code: string) {
  translateSelection.value = translateSelection.value.includes(code)
    ? translateSelection.value.filter(item => item !== code)
    : [...translateSelection.value, code]
}

function confirmTranslate() {
  translateDropdownOpen.value = false
  startTranslateRun(translateSelection.value)
}

// 翻译批量流程独立于当前语种，切 chips 不中断；打分流程绑定语种，切换即复位
watch(selectedLanguage, () => {
  if (runKind.value === 'score')
    resetRun()
})

async function submitScoreRun(languageCode: string, isCurrent: () => boolean) {
  const result = await scoreQaTranslation(selectedArticleId.value, languageCode)
  if (!isCurrent())
    return
  scoreRunResult.value = result.score
  await Promise.all([translationState.refresh(), articleState.refresh()])
}

// ---- 审核 ----
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

function handleApprove() {
  void runAction(async () => {
    await reviewQaTranslation(selectedArticleId.value, selectedLanguage.value, { decision: 'APPROVED' })
    message.success(t('qaWorkbench.approved'))
    await Promise.all([translationState.refresh(), articleState.refresh()])
  })
}

const rejectModalOpen = ref(false)
const rejectNote = ref('')

function handleReject() {
  void runAction(async () => {
    await reviewQaTranslation(selectedArticleId.value, selectedLanguage.value, {
      decision: 'REJECTED',
      note: rejectNote.value.trim() || undefined,
    })
    rejectModalOpen.value = false
    rejectNote.value = ''
    message.success(t('qaWorkbench.rejected'))
    await Promise.all([translationState.refresh(), articleState.refresh()])
  })
}

// ---- 诊断对话 ----
const diagnoseQuestion = ref('')
const diagnoseLoading = ref(false)

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
  const targetArticleId = selectedArticleId.value
  diagnoseLoading.value = true
  try {
    const response = await diagnoseQaArticle(targetArticleId, question)
    diagnoseQuestion.value = ''
    // 应答返回前用户切换了文章：问答已在服务端落库，但不渲染进新文章的线程
    if (selectedArticleId.value !== targetArticleId)
      return
    const sentAt = new Date().toISOString()
    diagnoseMessages.value = [
      ...diagnoseMessages.value,
      { id: `local-q-${Date.now()}`, role: 'USER', content: question, createdAt: sentAt },
      { id: `local-a-${Date.now()}`, role: 'ASSISTANT', content: response.answer, createdAt: sentAt },
    ]
  }
  catch (cause) {
    message.error(formatAdminRunError(cause))
  }
  finally {
    diagnoseLoading.value = false
  }
}

// ---- 展示辅助 ----
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
const hasRuleScore = computed(() => score.value?.ruleScore != null && score.value.verdict != null)
const currentTone = computed(() => (
  hasRuleScore.value && score.value?.verdict ? verdictTone[score.value.verdict] : 'neutral'
))
// 操作栏可用性：打分/重译需要当前语种已有译文，通过/打回还需要已有规则分
const canScore = computed(() => !!selectedLanguage.value && !isMissingSelected.value && !!translation.value)
const canReview = computed(() => canScore.value && hasRuleScore.value)
const busy = computed(() => actionLoading.value || runStatus.value === 'running')

onMounted(() => {
  void queueState.load()
  if (selectedArticleId.value) {
    void articleState.load()
    void historyState.load()
  }
})

onBeforeUnmount(() => {
  queueState.cancel()
  articleState.cancel()
  translationState.cancel()
  historyState.cancel()
  resetRun()
})
</script>

<template>
  <PageContainer wide class="workbench-page">
    <h1 class="sr-only">
      {{ t('qaWorkbench.title') }}
    </h1>

    <div class="workbench">
      <aside class="queue">
        <header class="queue__head">
          <h2>{{ t('qaWorkbench.queueTitle') }}</h2>
          <Checkbox v-model:checked="qaCandidateOnly" @change="applyQueueFilters">
            {{ t('qaWorkbench.filterCandidate') }}
          </Checkbox>
        </header>
        <div class="queue__search">
          <InputSearch
            v-model:value="searchText"
            :placeholder="t('qaWorkbench.searchPlaceholder')"
            allow-clear
            @search="applyQueueFilters"
            @change="handleQueueSearchChange"
          >
            <template #enterButton>
              <Button>
                <SearchOutlined />
              </Button>
            </template>
          </InputSearch>
        </div>

        <Alert
          v-if="queueState.error.value"
          class="queue__state"
          type="error"
          show-icon
          :message="t('qaWorkbench.queueLoadFailed')"
        >
          <template #action>
            <Button size="small" @click="queueState.retry">
              {{ t('common.actions.retry') }}
            </Button>
          </template>
        </Alert>
        <Skeleton
          v-else-if="queueState.loading.value && !queueState.items.value.length"
          active
          class="queue__state"
          :paragraph="{ rows: 6 }"
        />
        <Empty
          v-else-if="!queueState.items.value.length"
          class="queue__state"
          :description="t('qaWorkbench.queueEmpty')"
        />
        <ul v-else class="queue__list">
          <li v-for="item in queueState.items.value" :key="item.id">
            <button
              type="button"
              class="queue-item"
              :class="{ 'queue-item--selected': item.id === selectedArticleId }"
              @click="selectArticle(item)"
            >
              <span class="queue-item__title">{{ item.title }}</span>
              <span v-if="item.isQaCandidate" class="pill pill--primary">{{ t('qaArticles.candidateTag') }}</span>
            </button>
          </li>
        </ul>

        <footer class="queue__footer">
          <Pagination
            simple
            size="small"
            :current="queueState.currentPage.value"
            :page-size="queueState.pageSize.value"
            :total="queueState.pagination.value.totalItems"
            @change="(page: number) => void queueState.setPage(page)"
          />
        </footer>
      </aside>

      <section class="stage">
        <div v-if="!selectedArticleId" class="stage-empty">
          <span class="stage-empty__icon">
            <ThunderboltOutlined />
          </span>
          <p>{{ t('qaWorkbench.emptyStage') }}</p>
        </div>

        <template v-else>
          <div v-if="articleState.loading.value && !article" class="stage-state">
            <Skeleton active :paragraph="{ rows: 8 }" />
          </div>
          <Alert
            v-else-if="articleState.notFound.value || articleState.error.value"
            type="error"
            show-icon
            :message="t('qaWorkbench.stageLoadFailed')"
            :description="articleState.error.value || undefined"
          >
            <template #action>
              <Button size="small" @click="articleState.retry">
                {{ t('common.actions.retry') }}
              </Button>
            </template>
          </Alert>

          <template v-else-if="article">
            <section class="workcard">
              <header class="workcard__head">
                <div class="workcard__titles">
                  <h2 class="workcard__title">
                    {{ article.title }}
                  </h2>
                  <div class="workcard__meta">
                    <code>{{ article.slug }}</code>
                    <span v-if="article.isQaCandidate" class="pill pill--primary">
                      {{ t('qaArticles.candidateTag') }}
                    </span>
                    <span>{{ t('qaArticleDetail.termHits', { count: article.termHitCount ?? '—' }) }}</span>
                  </div>
                </div>
                <RouterLink :to="{ name: 'qa-article-detail', params: { articleId: article.id } }">
                  <Button size="small">
                    {{ t('qaWorkbench.viewArchive') }}
                  </Button>
                </RouterLink>
              </header>

              <div class="lang-rail">
                <button
                  v-for="item in article.translations"
                  :key="item.languageCode"
                  type="button"
                  class="lang-chip"
                  :class="{ 'lang-chip--selected': item.languageCode === selectedLanguage }"
                  :aria-pressed="item.languageCode === selectedLanguage"
                  @click="selectedLanguage = item.languageCode"
                >
                  {{ item.languageCode }}
                </button>
                <button
                  v-for="code in article.missingLanguages"
                  :key="code"
                  type="button"
                  class="lang-chip lang-chip--missing"
                  :class="{
                    'lang-chip--selected': code === selectedLanguage,
                    'lang-chip--pending': article.pendingLanguages.includes(code),
                  }"
                  :aria-pressed="code === selectedLanguage"
                  @click="selectedLanguage = code"
                >
                  {{ article.pendingLanguages.includes(code)
                    ? `${code} · ${t('qaShared.pendingTask')}`
                    : `+ ${code}` }}
                </button>
              </div>

              <div class="workcard__body">
                <div class="statusboard">
                  <p v-if="isMissingSelected || !selectedLanguage" class="statusboard__empty">
                    {{ isPendingSelected ? t('qaShared.pendingTask') : t('qaWorkbench.missingLanguage') }}
                  </p>
                  <Skeleton
                    v-else-if="translationState.loading.value"
                    active
                    :paragraph="{ rows: 4 }"
                  />
                  <Alert
                    v-else-if="translationState.error.value"
                    type="error"
                    show-icon
                    :message="t('qaWorkbench.translationLoadFailed')"
                    :description="translationState.error.value"
                  >
                    <template #action>
                      <Button size="small" @click="translationState.retry">
                        {{ t('common.actions.retry') }}
                      </Button>
                    </template>
                  </Alert>
                  <p v-else-if="translationState.notFound.value" class="statusboard__empty">
                    {{ t('qaArticleDetail.noTranslation') }}
                  </p>

                  <template v-else-if="translation">
                    <div class="decision__hero">
                      <div class="decision__scorebox" :class="`decision__scorebox--${currentTone}`">
                        <strong>{{ hasRuleScore ? score?.ruleScore : '—' }}</strong>
                        <span>{{ t('qaShared.ruleScore') }}</span>
                      </div>
                      <div class="decision__info">
                        <div class="decision__pills">
                          <span class="pill pill--lg" :class="`pill--${currentTone}`">
                            {{ hasRuleScore && score?.verdict
                              ? t(`qaShared.verdict.${score.verdict}`)
                              : t('qaShared.notScored') }}
                          </span>
                          <span v-if="score" class="pill" :class="`pill--${reviewTone[score.reviewStatus]}`">
                            {{ t(`qaShared.review.${score.reviewStatus}`) }}
                          </span>
                          <span v-if="translation.hasPendingTask" class="pill pill--warn">
                            {{ t('qaShared.pendingTask') }}
                          </span>
                        </div>
                        <p class="decision__summary">
                          {{ t(`qaWorkbench.summary.${hasRuleScore ? score?.verdict : 'PENDING'}`) }}
                        </p>
                        <div class="decision__facts">
                          <span class="fact">
                            <span class="fact__label">{{ t('qaShared.lengthRatio') }}</span>
                            <span class="fact__value">{{ score?.lengthRatio ?? '—' }}</span>
                          </span>
                        </div>
                        <div v-if="score?.reviewNote" class="review-note">
                          <strong>
                            {{ t(score.reviewStatus === 'REJECTED'
                              ? 'qaWorkbench.reviewNote'
                              : 'qaWorkbench.reviewNoteHistory') }}
                          </strong>
                          <p>{{ score.reviewNote }}</p>
                        </div>
                      </div>
                    </div>
                    <p class="decision__footnote">
                      {{ t('qaWorkbench.evidence') }}
                    </p>
                  </template>
                </div>

                <div
                  v-if="runStatus !== 'idle' && (runKind === 'translate' || runLanguage === selectedLanguage)"
                  class="run-panel"
                  aria-live="polite"
                >
                  <header class="run-panel__head">
                    <h3>{{ t(runKind === 'score' ? 'qaWorkbench.scoreRunTitle' : 'qaWorkbench.runTitle') }}</h3>
                    <span class="pill pill--ai">
                      {{ t(runKind === 'score' ? 'qaWorkbench.scoreRunTag' : 'qaWorkbench.runMock') }}
                    </span>
                  </header>
                  <ol class="run-steps">
                    <li
                      v-for="step in runSteps"
                      :key="step.key"
                      class="run-step"
                      :class="`run-step--${step.status}`"
                    >
                      <span class="run-step__indicator" aria-hidden="true" />
                      <div class="run-step__body">
                        <strong>{{ t(`qaWorkbench.runSteps.${step.key}`, { language: runLanguageLabel }) }}</strong>
                        <p>{{ t(`qaWorkbench.runSteps.${step.key}Detail`, { language: runLanguageLabel }) }}</p>
                      </div>
                    </li>
                  </ol>
                  <template v-if="runStatus === 'done'">
                    <div v-if="runKind === 'score' && scoreRunResult" class="run-panel__result">
                      <span
                        class="pill pill--lg"
                        :class="`pill--${scoreRunResult.verdict ? verdictTone[scoreRunResult.verdict] : 'neutral'}`"
                      >
                        {{ scoreRunResult.verdict
                          ? t(`qaShared.verdict.${scoreRunResult.verdict}`)
                          : t('qaShared.notScored') }}
                      </span>
                      <strong class="run-panel__score">{{ scoreRunResult.ruleScore ?? '—' }}</strong>
                      <span class="run-panel__ratio">
                        {{ t('qaShared.lengthRatio') }} {{ scoreRunResult.lengthRatio ?? '—' }}
                      </span>
                      <Button size="small" @click="resetRun">
                        {{ t('qaWorkbench.backToDecision') }}
                      </Button>
                    </div>
                    <div v-else class="run-panel__result">
                      <p class="run-panel__notice run-panel__notice--inline">
                        {{ t('qaWorkbench.batchQueuedNotice', {
                          queued: translateSummary?.queued ?? 0,
                          already: translateSummary?.already ?? 0,
                        }) }}
                      </p>
                      <Button size="small" @click="resetRun">
                        {{ t('qaWorkbench.runDismiss') }}
                      </Button>
                    </div>
                  </template>
                  <div v-else-if="runStatus === 'failed'" class="run-panel__result">
                    <Alert
                      class="run-panel__alert"
                      type="error"
                      show-icon
                      :message="t(runKind === 'score' ? 'qaWorkbench.scoreFailed' : 'qaWorkbench.runFailed')"
                    />
                    <Button size="small" @click="resetRun">
                      {{ t('qaWorkbench.runDismiss') }}
                    </Button>
                  </div>
                </div>
              </div>

              <div class="workcard__toolbar">
                <Popover
                  v-model:open="translateDropdownOpen"
                  trigger="click"
                  placement="topLeft"
                >
                  <template #content>
                    <div class="qa-translate-picker">
                      <template v-if="article.missingLanguages.length">
                        <p class="qa-translate-picker__label">
                          {{ t('qaWorkbench.translateModalMissing') }}
                        </p>
                        <div class="qa-translate-picker__chips">
                          <button
                            v-for="code in article.missingLanguages"
                            :key="code"
                            type="button"
                            class="qa-pick-chip"
                            :class="{
                              'qa-pick-chip--selected': translateSelection.includes(code),
                              'qa-pick-chip--pending': article.pendingLanguages.includes(code),
                            }"
                            :disabled="article.pendingLanguages.includes(code)"
                            :aria-pressed="translateSelection.includes(code)"
                            @click="toggleTranslateLanguage(code)"
                          >
                            {{ article.pendingLanguages.includes(code)
                              ? `${code} · ${t('qaShared.pendingTask')}`
                              : code }}
                          </button>
                        </div>
                      </template>
                      <template v-if="article.translations.length">
                        <p class="qa-translate-picker__label">
                          {{ t('qaWorkbench.translateModalExisting') }}
                        </p>
                        <div class="qa-translate-picker__chips">
                          <button
                            v-for="item in article.translations"
                            :key="item.languageCode"
                            type="button"
                            class="qa-pick-chip"
                            :class="{ 'qa-pick-chip--selected': translateSelection.includes(item.languageCode) }"
                            :aria-pressed="translateSelection.includes(item.languageCode)"
                            @click="toggleTranslateLanguage(item.languageCode)"
                          >
                            {{ item.languageCode }}
                          </button>
                        </div>
                      </template>
                      <div class="qa-translate-picker__footer">
                        <Button
                          type="primary"
                          size="small"
                          :disabled="!translateSelection.length"
                          @click="confirmTranslate"
                        >
                          {{ t('qaWorkbench.startTranslate') }}
                        </Button>
                      </div>
                    </div>
                  </template>
                  <Button :disabled="busy">
                    {{ t('qaWorkbench.batchTranslate') }}
                  </Button>
                </Popover>
                <Button
                  :type="canScore && !hasRuleScore ? 'primary' : 'default'"
                  :disabled="!canScore || busy"
                  @click="startScoreRun(selectedLanguage)"
                >
                  {{ t('qaWorkbench.score') }}
                </Button>
                <Button
                  :type="canReview ? 'primary' : 'default'"
                  :disabled="!canReview || busy"
                  @click="handleApprove"
                >
                  {{ t('qaWorkbench.approve') }}
                </Button>
                <Button danger :disabled="!canReview || busy" @click="rejectModalOpen = true">
                  {{ t('qaWorkbench.reject') }}
                </Button>
                <Button :disabled="!canScore || busy" @click="startTranslateRun([selectedLanguage])">
                  {{ t('qaWorkbench.retranslate') }}
                </Button>
              </div>
            </section>

            <section class="diagnose">
              <header class="diagnose__head">
                <h3>{{ t('qaWorkbench.diagnoseTitle') }}</h3>
                <span class="pill pill--ai">{{ t('qaWorkbench.diagnoseMock') }}</span>
              </header>

              <div class="diagnose__thread">
                <Alert
                  v-if="historyState.error.value"
                  type="error"
                  show-icon
                  :message="t('qaWorkbench.diagnoseLoadFailed')"
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
                  :paragraph="{ rows: 2 }"
                />
                <p v-else-if="!diagnoseMessages.length" class="diagnose__hint">
                  {{ t('qaWorkbench.diagnoseHint') }}
                </p>
                <template v-else>
                  <div
                    v-for="entry in diagnoseMessages"
                    :key="entry.id"
                    class="bubble"
                    :class="entry.role === 'USER' ? 'bubble--user' : 'bubble--assistant'"
                  >
                    {{ entry.content }}
                  </div>
                </template>
              </div>

              <div class="diagnose__composer">
                <Textarea
                  v-model:value="diagnoseQuestion"
                  :placeholder="t('qaWorkbench.diagnosePlaceholder')"
                  :auto-size="{ minRows: 1, maxRows: 4 }"
                  :maxlength="2000"
                  @keydown.enter.exact="handleDiagnoseKeydown($event)"
                />
                <Button
                  type="primary"
                  shape="circle"
                  :loading="diagnoseLoading"
                  :disabled="!diagnoseQuestion.trim()"
                  :aria-label="t('qaWorkbench.diagnoseSend')"
                  @click="handleDiagnose"
                >
                  <template #icon>
                    <SendOutlined />
                  </template>
                </Button>
              </div>
            </section>
          </template>
        </template>
      </section>
    </div>

    <Modal
      v-model:open="rejectModalOpen"
      :title="t('qaWorkbench.rejectTitle')"
      :confirm-loading="actionLoading"
      :ok-text="t('qaWorkbench.reject')"
      :cancel-text="t('common.actions.cancel')"
      ok-type="danger"
      @ok="handleReject"
    >
      <Textarea
        v-model:value="rejectNote"
        :placeholder="t('qaWorkbench.rejectNotePlaceholder')"
        :auto-size="{ minRows: 3, maxRows: 6 }"
        :maxlength="2000"
      />
    </Modal>
  </PageContainer>
</template>

<style scoped>
/* 工作台按应用式布局固定在视口内：整页不滚动，各栏内部滚动。
   40px = admin-content 上下 padding（20px × 2）。 */
.workbench-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - var(--admin-header-height) - var(--admin-tabs-height) - 40px);
  min-height: 480px;
}

/* 整个工作台是一张大卡，内部用分界线分区 */
.workbench {
  display: grid;
  flex: 1;
  min-height: 0;
  align-items: stretch;
  grid-template-columns: 330px minmax(0, 1fr);
  overflow: hidden;
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-lg);
  background: var(--admin-surface);
  box-shadow: var(--admin-shadow-sm);
}

/* ---- 队列 ---- */
.queue {
  display: flex;
  min-height: 0;
  flex-direction: column;
  border-right: 1px solid var(--admin-border);
}

.queue__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 16px 0;
}

.queue__head h2 {
  margin: 0;
  color: var(--admin-text);
  font-size: var(--admin-font-md);
  font-weight: 700;
}

.queue__search {
  padding: 10px 16px 12px;
  border-bottom: 1px solid var(--admin-border);
}

.queue__state {
  margin: 14px 16px;
}

.queue__list {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 4px;
  padding: 10px;
  margin: 0;
  overflow-y: auto;
  list-style: none;
}

.queue-item {
  display: flex;
  width: 100%;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid transparent;
  border-radius: var(--admin-radius-md);
  background: transparent;
  text-align: start;
  cursor: pointer;
  transition: background-color 120ms ease, border-color 120ms ease;
}

.queue-item:hover {
  background: var(--admin-surface-muted);
}

.queue-item--selected,
.queue-item--selected:hover {
  border-color: color-mix(in srgb, var(--admin-primary) 40%, transparent);
  background: var(--admin-primary-soft);
}

.queue-item__title {
  display: -webkit-box;
  overflow: hidden;
  color: var(--admin-text);
  font-size: var(--admin-font-sm);
  font-weight: 600;
  line-height: 1.5;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.queue__footer {
  display: flex;
  justify-content: center;
  padding: 10px 16px;
  border-top: 1px solid var(--admin-border);
}

/* ---- 主舞台：工作卡 + 右侧诊断栏 ---- */
.stage {
  display: grid;
  min-width: 0;
  min-height: 0;
  align-items: stretch;
  grid-template-columns: minmax(0, 1fr) 380px;
  overflow: hidden;
}

.stage > .stage-empty,
.stage > .stage-state,
.stage > .ant-alert {
  grid-column: 1 / -1;
  align-self: start;
}

.stage-state {
  padding: 20px 18px;
}

.stage-empty {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  padding: 48px 24px;
}

.stage-empty__icon {
  display: grid;
  width: 52px;
  height: 52px;
  place-items: center;
  border-radius: 16px;
  background: linear-gradient(135deg, var(--admin-primary-soft), transparent);
  color: var(--admin-primary);
  font-size: 24px;
}

.stage-empty p {
  margin: 0;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-sm);
}

/* ---- 工作卡：标题 + 语种 + 状态一览 + 操作栏 ---- */
.workcard {
  display: flex;
  min-height: 0;
  flex-direction: column;
  padding: 20px 24px;
  overflow-y: auto;
  border-right: 1px solid var(--admin-border);
}

.workcard__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
}

.workcard__titles {
  min-width: 0;
}

.workcard__title {
  margin: 0 0 6px;
  color: var(--admin-text);
  font-size: 18px;
  font-weight: 700;
  letter-spacing: -0.01em;
  line-height: 1.45;
}

.workcard__meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 12px;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
}

.workcard__meta code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

.workcard__body {
  flex: 1;
  padding-top: 18px;
  margin-top: 16px;
  border-top: 1px solid var(--admin-border);
}

/* ---- 状态一览 ---- */
.statusboard__empty {
  margin: 0;
  padding: 28px 0;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-sm);
  text-align: center;
}

/* ---- 统一操作栏 ---- */
.workcard__toolbar {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  gap: 10px;
  padding-top: 16px;
  margin-top: 16px;
  border-top: 1px solid var(--admin-border);
}

.workcard__toolbar :deep(.ant-btn) {
  border-radius: 10px;
  padding-inline: 20px;
}

/* ---- 语种 chips ---- */
.lang-rail {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}

.lang-chip {
  height: 26px;
  padding: 0 11px;
  border: 1px solid var(--admin-border-strong);
  border-radius: 999px;
  background: var(--admin-surface);
  color: var(--admin-text-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--admin-font-xs);
  line-height: 1;
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease, background-color 120ms ease;
}

.lang-chip:hover {
  border-color: color-mix(in srgb, var(--admin-primary) 40%, var(--admin-border-strong));
  color: var(--admin-text);
}

.lang-chip--selected,
.lang-chip--selected:hover {
  border-color: color-mix(in srgb, var(--admin-primary) 55%, transparent);
  background: var(--admin-primary-soft);
  color: var(--admin-primary);
  font-weight: 600;
}

.lang-chip--missing {
  border-style: dashed;
  background: transparent;
  color: var(--admin-text-subtle);
}

.lang-chip--pending {
  border-color: color-mix(in srgb, var(--admin-warning) 45%, transparent);
  color: var(--admin-warning-strong);
}

/* ---- 通用 pill ---- */
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

.pill--ai {
  background: linear-gradient(120deg, var(--admin-primary-soft), var(--admin-success-soft));
  color: var(--admin-primary);
}

/* ---- Agent 翻译流程 ---- */
.run-panel {
  padding: 18px;
  margin-top: 18px;
  border: 1px solid color-mix(in srgb, var(--admin-primary) 26%, var(--admin-border));
  border-radius: var(--admin-radius-md);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--admin-primary) 5%, var(--admin-surface)), var(--admin-surface) 55%);
}

.run-panel__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.run-panel__head h3 {
  margin: 0;
  color: var(--admin-text);
  font-size: var(--admin-font-md);
  font-weight: 700;
}

.run-steps {
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 0;
  margin: 16px 0 0;
  list-style: none;
}

.run-step {
  position: relative;
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  gap: 10px;
  padding-bottom: 16px;
}

.run-step:last-child {
  padding-bottom: 0;
}

.run-step:not(:last-child)::after {
  position: absolute;
  top: 22px;
  bottom: 2px;
  left: 10px;
  width: 1px;
  background: color-mix(in srgb, var(--admin-primary) 22%, var(--admin-border));
  content: '';
}

.run-step__indicator {
  position: relative;
  z-index: 1;
  display: grid;
  width: 21px;
  height: 21px;
  margin-top: 1px;
  place-items: center;
  border: 1.5px solid var(--admin-border-strong);
  border-radius: 50%;
  background: var(--admin-surface);
}

.run-step--running .run-step__indicator {
  border-color: var(--admin-primary);
  border-top-color: transparent;
  animation: run-spin 700ms linear infinite;
}

.run-step--done .run-step__indicator {
  border-color: color-mix(in srgb, var(--admin-success) 55%, transparent);
  background: var(--admin-success-soft);
}

.run-step--done .run-step__indicator::before {
  color: var(--admin-success-strong);
  content: '✓';
  font-size: 11px;
  font-weight: 700;
}

@keyframes run-spin {
  to {
    transform: rotate(360deg);
  }
}

.run-step__body strong {
  display: block;
  color: var(--admin-text);
  font-size: var(--admin-font-sm);
  font-weight: 650;
}

.run-step--pending .run-step__body strong,
.run-step--pending .run-step__body p {
  color: var(--admin-text-subtle);
}

.run-step__body p {
  margin: 2px 0 0;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
  line-height: 1.6;
}

.run-panel__notice {
  margin: 14px 0 0;
  padding: 10px 14px;
  border-radius: var(--admin-radius-sm);
  background: var(--admin-success-soft);
  color: var(--admin-success-strong);
  font-size: var(--admin-font-xs);
  line-height: 1.6;
}

.run-panel__result {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid color-mix(in srgb, var(--admin-primary) 16%, var(--admin-border));
}

.run-panel__notice--inline {
  flex: 1;
  min-width: 200px;
  margin: 0;
}

.run-panel__alert {
  flex: 1;
  min-width: 220px;
}

.run-panel__score {
  color: var(--admin-text);
  font-size: 26px;
  font-variant-numeric: tabular-nums;
  font-weight: 800;
  letter-spacing: -0.02em;
  line-height: 1.1;
}

.run-panel__ratio {
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
}

.run-panel__result > .ant-btn {
  margin-left: auto;
}

.run-panel > .ant-alert {
  margin-top: 14px;
}

/* ---- 质量结论 ---- */
.decision__hero {
  display: flex;
  align-items: center;
  gap: 22px;
}

.decision__scorebox {
  display: flex;
  width: 104px;
  height: 104px;
  flex: none;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  border-radius: 22px;
  background: var(--admin-surface-muted);
}

.decision__scorebox strong {
  color: var(--admin-text);
  font-size: 38px;
  font-variant-numeric: tabular-nums;
  font-weight: 800;
  letter-spacing: -0.03em;
  line-height: 1.1;
}

.decision__scorebox span {
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-2xs);
}

.decision__scorebox--pass {
  background: var(--admin-success-soft);
}

.decision__scorebox--pass strong {
  color: var(--admin-success-strong);
}

.decision__scorebox--warn {
  background: var(--admin-warning-soft);
}

.decision__scorebox--warn strong {
  color: var(--admin-warning-strong);
}

.decision__scorebox--fail {
  background: var(--admin-danger-soft);
}

.decision__scorebox--fail strong {
  color: var(--admin-danger-strong);
}

.decision__info {
  min-width: 0;
  flex: 1;
}

.decision__pills {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.pill--lg {
  padding: 4px 13px;
  font-size: var(--admin-font-sm);
}

.decision__summary {
  max-width: 56ch;
  margin: 8px 0 0;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-sm);
  line-height: 1.7;
}

.decision__facts {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 18px;
  margin-top: 10px;
}

.fact {
  display: inline-flex;
  align-items: baseline;
  gap: 6px;
}

.fact__label {
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-xs);
}

.fact__value {
  color: var(--admin-text);
  font-size: var(--admin-font-sm);
  font-variant-numeric: tabular-nums;
  font-weight: 650;
}

.review-note {
  margin-top: 12px;
  padding: 2px 0 2px 12px;
  border-left: 3px solid color-mix(in srgb, var(--admin-danger) 45%, transparent);
}

.review-note strong {
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-2xs);
  font-weight: 600;
}

.review-note p {
  margin: 3px 0 0;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-xs);
  line-height: 1.65;
  overflow-wrap: anywhere;
}

.decision__footnote {
  margin: 14px 0 0;
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-2xs);
  line-height: 1.6;
}

/* ---- 诊断对话：填满剩余高度的聊天区 ---- */
.diagnose {
  display: flex;
  min-height: 0;
  flex-direction: column;
  padding: 16px 20px;
}

.diagnose__head {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.diagnose__head h3 {
  margin: 0;
  color: var(--admin-text);
  font-size: var(--admin-font-md);
  font-weight: 700;
}

.diagnose__thread {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  gap: 10px;
  padding: 16px;
  margin: 14px 0 12px;
  overflow-y: auto;
  border-radius: 14px;
  background: var(--admin-surface-muted);
}

.diagnose__hint {
  margin: auto;
  color: var(--admin-text-subtle);
  font-size: var(--admin-font-xs);
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
  border: 1px solid var(--admin-border);
  border-bottom-left-radius: 4px;
  background: var(--admin-surface);
  color: var(--admin-text-muted);
}

.diagnose__composer {
  display: flex;
  flex: none;
  align-items: flex-end;
  gap: 8px;
  padding: 6px 6px 6px 14px;
  border: 1px solid var(--admin-border-strong);
  border-radius: 16px;
  background: var(--admin-surface);
  transition: border-color 120ms ease;
}

.diagnose__composer:focus-within {
  border-color: color-mix(in srgb, var(--admin-primary) 55%, transparent);
}

.diagnose__composer :deep(.ant-input) {
  padding-inline: 0;
  border: 0;
  background: transparent;
  box-shadow: none;
}

@media (max-width: 1100px) {
  .workbench-page {
    height: auto;
    min-height: 0;
  }

  .workbench {
    grid-template-columns: 1fr;
  }

  .queue {
    max-height: 420px;
    border-right: 0;
    border-bottom: 1px solid var(--admin-border);
  }

  .stage {
    display: flex;
    flex-direction: column;
    overflow: visible;
  }

  .workcard {
    overflow: visible;
    border-right: 0;
    border-bottom: 1px solid var(--admin-border);
  }

  .diagnose {
    min-height: 360px;
  }
}
</style>

<!-- 语种多选弹窗经 antd portal 挂到 body 下，scoped 样式够不到，故用全局块 + 独有类名 -->
<style>
.qa-translate-picker {
  display: flex;
  max-width: 360px;
  flex-direction: column;
  gap: 6px;
}

.qa-translate-picker__footer {
  display: flex;
  justify-content: flex-end;
  padding-top: 10px;
  margin-top: 8px;
  border-top: 1px solid var(--admin-border);
}

.qa-translate-picker__label {
  margin: 8px 0 2px;
  color: var(--admin-text-muted);
  font-size: var(--admin-font-2xs);
  font-weight: 600;
  letter-spacing: 0.05em;
}

.qa-translate-picker__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.qa-pick-chip {
  height: 28px;
  padding: 0 12px;
  border: 1px solid var(--admin-border-strong);
  border-radius: 999px;
  background: var(--admin-surface);
  color: var(--admin-text-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: var(--admin-font-xs);
  line-height: 1;
  cursor: pointer;
  transition: color 120ms ease, border-color 120ms ease, background-color 120ms ease;
}

.qa-pick-chip:hover {
  border-color: color-mix(in srgb, var(--admin-primary) 40%, var(--admin-border-strong));
  color: var(--admin-text);
}

.qa-pick-chip--selected,
.qa-pick-chip--selected:hover {
  border-color: color-mix(in srgb, var(--admin-primary) 55%, transparent);
  background: var(--admin-primary-soft);
  color: var(--admin-primary);
  font-weight: 600;
}

.qa-pick-chip--pending,
.qa-pick-chip--pending:hover {
  border-color: color-mix(in srgb, var(--admin-warning) 45%, transparent);
  background: var(--admin-warning-soft);
  color: var(--admin-warning-strong);
  cursor: not-allowed;
}

.qa-pick-chip:disabled {
  cursor: not-allowed;
}
</style>
