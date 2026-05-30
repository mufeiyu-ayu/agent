<script setup lang="ts">
import AppHeader from '../components/layout/AppHeader.vue'
import AppSidebar from '../components/layout/AppSidebar.vue'
import SeoInputPanel from '../components/seo/SeoInputPanel.vue'
import SeoResultPanel from '../components/seo/SeoResultPanel.vue'
import { useSeoWorkspace } from '../hooks/useSeoWorkspace'

const {
  pageTopic,
  language,
  keywordInput,
  keywords,
  status,
  lastGeneratedAt,
  copiedField,
  seoTitle,
  metaDescription,
  seoChecks,
  titleCharacterCount,
  descriptionCharacterCount,
  pageTopicCharacterCount,
  completionPercent,
  statusCardTitle,
  statusCardDescription,
  addKeyword,
  removeKeyword,
  resetWorkspace,
  generateSeoContent,
  copyResult,
} = useSeoWorkspace()
</script>

<template>
  <main class="min-h-screen w-full overflow-y-auto p-3 text-slate-950 xl:h-screen xl:overflow-hidden xl:p-3">
    <div class="grid min-h-0 w-full gap-3 lg:grid-cols-[76px_minmax(0,1fr)] xl:h-full">
      <AppSidebar />

      <div class="flex min-h-0 min-w-0 flex-col rounded-[28px] border border-slate-200/80 bg-white/55 p-4 shadow-[0_20px_70px_rgb(30_41_72/9%)] backdrop-blur-xl xl:h-full">
        <AppHeader />

        <section class="grid min-h-0 flex-1 grid-cols-1 overflow-hidden rounded-[28px] border border-slate-200 bg-white/82 shadow-[0_22px_55px_rgb(31_42_68/8%)] xl:grid-cols-[1fr_1px_1fr]">
          <SeoInputPanel
            v-model:page-topic="pageTopic"
            v-model:language="language"
            v-model:keyword-input="keywordInput"
            :keywords="keywords"
            :status="status"
            :page-topic-character-count="pageTopicCharacterCount"
            :status-card-title="statusCardTitle"
            :status-card-description="statusCardDescription"
            :completion-percent="completionPercent"
            @add-keyword="addKeyword"
            @remove-keyword="removeKeyword"
            @generate="generateSeoContent"
            @reset="resetWorkspace"
          />

          <div class="hidden xl:block xl:h-full xl:w-px xl:bg-slate-200" />

          <SeoResultPanel
            :status="status"
            :last-generated-at="lastGeneratedAt"
            :seo-title="seoTitle"
            :meta-description="metaDescription"
            :title-character-count="titleCharacterCount"
            :description-character-count="descriptionCharacterCount"
            :seo-checks="seoChecks"
            :copied-field="copiedField"
            @copy="copyResult"
          />
        </section>
      </div>
    </div>
  </main>
</template>
