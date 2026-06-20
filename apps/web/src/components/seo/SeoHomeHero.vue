<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import AppIcon from '@/components/common/AppIcon.vue'
import LanguageSwitcher from '@/components/common/LanguageSwitcher.vue'
import SeoHeroAccentBackdrop from './SeoHeroAccentBackdrop.vue'
import SeoHomeAnimatedPlaceholder from './SeoHomeAnimatedPlaceholder.vue'
import SeoProcessMap from './SeoProcessMap.vue'

const { t } = useI18n()

const homeInput = ref('')
const homeTopicRef = ref<HTMLTextAreaElement | null>(null)
const isHomeInputFocused = ref(false)
const desktopWorkflowQuery = '(min-width: 1024px)'
const shouldRenderProcessMap = ref(isDesktopWorkflowViewport())

let desktopWorkflowMediaQuery: MediaQueryList | null = null

const navItems = [
  { labelKey: 'home.navigation.product', href: '#product', dropdown: true },
  { labelKey: 'home.navigation.workflow', href: '#workflow', dropdown: false },
  { labelKey: 'home.navigation.useCases', href: '#workspace-entry', dropdown: true },
  { labelKey: 'home.navigation.pricing', href: '#workspace-entry', dropdown: false },
  { labelKey: 'home.navigation.resources', href: '#workflow', dropdown: true },
] as const

const homePromptMessages = computed(() => [
  t('home.form.animatedPrompts.url'),
  t('home.form.animatedPrompts.brief'),
  t('home.form.animatedPrompts.keywords'),
])

const shouldShowAnimatedPrompt = computed(() => {
  return !isHomeInputFocused.value && homeInput.value.trim().length === 0
})

const homeSuggestions = computed(() => [
  { key: 'audit', label: t('home.suggestions.audit.label'), prompt: t('home.suggestions.audit.prompt') },
  { key: 'keywords', label: t('home.suggestions.keywords.label'), prompt: t('home.suggestions.keywords.prompt') },
  { key: 'content', label: t('home.suggestions.content.label'), prompt: t('home.suggestions.content.prompt') },
])

/**
 * 点击示例任务胶囊：把对应 prompt 填入首页输入框并聚焦，形成从示例到输入的引导。
 */
async function applySuggestion(prompt: string): Promise<void> {
  homeInput.value = prompt
  await nextTick()
  const textarea = homeTopicRef.value
  if (!textarea)
    return

  textarea.focus()
  textarea.setSelectionRange(prompt.length, prompt.length)
}

onMounted(() => {
  if (typeof window === 'undefined')
    return

  desktopWorkflowMediaQuery = window.matchMedia(desktopWorkflowQuery)
  shouldRenderProcessMap.value = desktopWorkflowMediaQuery.matches
  desktopWorkflowMediaQuery.addEventListener('change', handleDesktopWorkflowChange)
})

onUnmounted(() => {
  desktopWorkflowMediaQuery?.removeEventListener('change', handleDesktopWorkflowChange)
  desktopWorkflowMediaQuery = null
})

function handleDesktopWorkflowChange(event: MediaQueryListEvent): void {
  shouldRenderProcessMap.value = event.matches
}

function isDesktopWorkflowViewport(): boolean {
  if (typeof window === 'undefined')
    return false

  return window.matchMedia(desktopWorkflowQuery).matches
}
</script>

<template>
  <main id="product" class="relative min-h-screen overflow-x-hidden bg-[#101312] text-[#f5eee4]">
    <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(221,180,137,0.08),transparent_34%),linear-gradient(115deg,rgba(26,31,28,0.98)_0%,rgba(13,14,13,0.99)_50%,rgba(31,22,17,0.98)_100%)]" />
    <SeoHeroAccentBackdrop />
    <div class="pointer-events-none absolute inset-0 opacity-[0.026] [background-image:linear-gradient(rgba(255,255,255,0.16)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.14)_1px,transparent_1px)] [background-size:56px_56px]" />
    <div class="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[#d7b18a]/10 to-transparent" />
    <div class="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-[#070806]/72 to-transparent" />

    <section class="relative z-10 mx-auto flex min-h-screen w-[calc(100vw-32px)] max-w-[1600px] flex-col pb-6 pt-5 sm:w-[calc(100vw-64px)] lg:w-[calc(100vw-96px)] min-[1800px]:w-[calc(100vw-360px)] min-[1800px]:pb-8 min-[1800px]:pt-6">
      <header class="mx-auto flex h-12 w-full max-w-[1360px] items-center gap-8 min-[1800px]:max-w-[1440px]">
        <RouterLink
          to="/"
          class="flex min-w-0 items-center gap-3 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#d7b18a]/45"
          :aria-label="t('home.header.logoAria')"
        >
          <span class="flex size-8 shrink-0 items-center justify-center text-[#f1d2ae]">
            <AppIcon name="tabler:sparkles" :size="30" />
          </span>
          <span class="min-w-0">
            <span class="block text-xl font-bold leading-6 text-[#fff7ed]">SEO Agent</span>
          </span>
        </RouterLink>

        <nav class="ml-6 hidden items-center gap-8 xl:flex min-[1800px]:gap-9" :aria-label="t('home.navigation.ariaLabel')">
          <a
            v-for="item in navItems"
            :key="item.href"
            :href="item.href"
            class="inline-flex items-center gap-1.5 text-base font-medium text-[#e8e2d8]/82 transition hover:text-[#fff7ed] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b18a]/40"
          >
            <span>{{ t(item.labelKey) }}</span>
            <AppIcon
              v-if="item.dropdown"
              name="tabler:chevron-down"
              :size="14"
            />
          </a>
        </nav>

        <div class="ml-auto flex items-center justify-end gap-2 sm:gap-3">
          <LanguageSwitcher variant="home" />

          <RouterLink
            to="/workspace"
            class="inline-flex h-10 w-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-white/16 bg-white/[0.025] px-0 text-sm font-medium text-[#f0e5d8] transition hover:-translate-y-0.5 hover:border-white/24 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#d7c5aa]/40 sm:h-11 sm:w-auto sm:px-5"
            :aria-label="t('home.actions.openWorkspaceAria')"
          >
            <span class="hidden sm:inline">{{ t('home.actions.openWorkspace') }}</span>
            <AppIcon name="tabler:arrow-up-right" :size="17" />
          </RouterLink>
        </div>
      </header>

      <div class="seo-hero-stage mx-auto flex w-full flex-1 flex-col">
        <section id="workflow" class="hidden min-w-0 items-center pt-14 lg:flex" :aria-label="t('home.workflow.ariaLabel')">
          <div
            v-if="shouldRenderProcessMap"
            class="relative mx-auto h-[clamp(350px,38dvh,400px)] w-full overflow-visible min-[1800px]:h-[clamp(390px,34dvh,440px)]"
          >
            <SeoProcessMap class="absolute inset-0 z-10 h-full w-full translate-y-7 min-[1800px]:translate-y-9" />
          </div>
        </section>

        <section class="relative z-10 mx-auto w-full pb-4 pt-3 text-center lg:pt-[clamp(2rem,5dvh,4.5rem)]">
          <h1 class="seo-home-title mx-auto max-w-[1220px] text-[38px] font-normal leading-[1.05] text-[#fff8ef] sm:text-5xl lg:text-[58px] min-[1800px]:max-w-[1360px] min-[1800px]:text-[72px]">
            {{ t('home.hero.title') }}
          </h1>

          <p class="mx-auto mt-4 max-w-[690px] text-lg font-medium leading-8 text-[#d4ddd0]/70 min-[1800px]:max-w-[820px] min-[1800px]:text-xl">
            {{ t('home.hero.description') }}
          </p>

          <div id="workspace-entry" class="mt-7 flex flex-col justify-center gap-3 sm:flex-row sm:items-center min-[1800px]:mt-8">
            <RouterLink
              to="/workspace"
              class="inline-flex h-13 min-w-[230px] items-center justify-center gap-7 rounded-lg bg-[#eee3d2] px-7 text-base font-semibold text-[#111412] shadow-[0_8px_18px_rgba(0,0,0,0.24)] transition hover:-translate-y-0.5 hover:bg-[#fff3e1] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#e8d7bf]/45 min-[1800px]:h-14 min-[1800px]:min-w-[250px]"
              :aria-label="t('home.actions.analyzeAria')"
            >
              {{ t('home.actions.analyze') }}
              <AppIcon name="tabler:arrow-right" :size="18" />
            </RouterLink>

            <a
              href="#workflow"
              class="inline-flex h-13 min-w-[188px] items-center justify-center gap-2 rounded-lg border border-white/16 bg-white/[0.02] px-5 text-base font-medium text-[#e9e1d7]/86 transition hover:bg-white/[0.06] hover:text-[#fff7ed] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#f0c18f]/35 min-[1800px]:h-14 min-[1800px]:min-w-[210px]"
            >
              {{ t('home.actions.viewExample') }}
            </a>
          </div>

          <div
            role="group"
            :aria-label="t('home.suggestions.ariaLabel')"
            class="mt-9 flex flex-col items-center gap-3 min-[1800px]:mt-11"
          >
            <span class="text-sm font-medium tracking-wide text-[#cdd5cb]/55">{{ t('home.suggestions.hint') }}</span>
            <div class="flex flex-wrap justify-center gap-2.5">
              <button
                v-for="item in homeSuggestions"
                :key="item.key"
                type="button"
                class="group inline-flex items-center gap-2 rounded-full border border-white/12 bg-white/[0.03] px-4 py-2 text-sm font-medium text-[#e6ddd0]/85 transition hover:-translate-y-0.5 hover:border-white/22 hover:bg-white/[0.07] hover:text-[#fff7ed] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b18a]/40 min-[1800px]:text-[15px]"
                @click="applySuggestion(item.prompt)"
              >
                <AppIcon name="tabler:sparkles" :size="15" class="text-[#e7c9a0] transition group-hover:text-[#f4d8b0]" />
                {{ item.label }}
              </button>
            </div>
          </div>
        </section>

        <form
          class="relative z-10 mx-auto mb-[clamp(0.75rem,2dvh,1.5rem)] mt-auto w-full max-w-[1068px] rounded-xl border border-white/12 bg-[#151817]/88 p-4 transition-colors focus-within:border-[#d8c8ad]/42 focus-within:bg-[#171b19]/94 focus-within:ring-1 focus-within:ring-[#d8c8ad]/18 min-[1800px]:max-w-[1180px] min-[1800px]:p-5"
          :aria-label="t('home.form.ariaLabel')"
          @submit.prevent
        >
          <div class="flex min-h-[120px] flex-col min-[1800px]:min-h-[134px]">
            <label class="sr-only" for="home-seo-topic">{{ t('home.form.topicLabel') }}</label>
            <div class="relative min-h-[54px] min-[1800px]:min-h-[60px]">
              <SeoHomeAnimatedPlaceholder
                :messages="homePromptMessages"
                :visible="shouldShowAnimatedPrompt"
              />

              <textarea
                id="home-seo-topic"
                ref="homeTopicRef"
                v-model="homeInput"
                class="relative z-10 block min-h-[54px] w-full resize-none bg-transparent px-1 py-1 text-base font-medium leading-7 text-[#eee4d9] outline-none placeholder:text-transparent min-[1800px]:min-h-[60px] min-[1800px]:text-lg"
                rows="2"
                placeholder=""
                :aria-placeholder="t('home.form.placeholder')"
                @blur="isHomeInputFocused = false"
                @focus="isHomeInputFocused = true"
              />
            </div>

            <div class="mt-auto flex min-w-0 items-end justify-between gap-3 pt-5">
              <span class="inline-flex h-10 min-w-0 items-center gap-2 rounded-lg border border-white/10 bg-black/26 px-3 text-xs font-medium text-[#e5d8c8]">
                <AppIcon name="tabler:sparkles" :size="16" />
                <span class="truncate">DeepSeek V4 Flash</span>
                <AppIcon name="tabler:chevron-down" :size="15" />
              </span>

              <button
                type="submit"
                class="inline-flex size-11 shrink-0 items-center justify-center rounded-lg bg-[#eee3d2] text-[#111412] transition hover:-translate-y-0.5 hover:bg-[#fff3e1] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#e8d7bf]/42 min-[1800px]:size-12"
                :aria-label="t('home.form.submit')"
                :title="t('home.form.submit')"
              >
                <AppIcon name="tabler:arrow-right" :size="22" />
              </button>
            </div>
          </div>
        </form>
      </div>
    </section>
  </main>
</template>

<style scoped>
.seo-home-title {
  font-family: "Libre Baskerville", Georgia, ui-serif, serif;
  letter-spacing: 0;
}

.seo-hero-stage {
  max-width: min(100%, 1360px);
}

@media (min-width: 1800px) {
  .seo-hero-stage {
    max-width: min(100%, 1440px);
  }
}
</style>
