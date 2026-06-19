<script setup lang="ts">
import { RouterLink } from 'vue-router'

import AppIcon from '@/components/common/AppIcon.vue'
import SeoHeroAccentBackdrop from './SeoHeroAccentBackdrop.vue'
import SeoProcessMap from './SeoProcessMap.vue'

const navItems = [
  { label: 'Product', href: '#product', dropdown: true },
  { label: 'How it works', href: '#workflow', dropdown: false },
  { label: 'Use cases', href: '#workspace-entry', dropdown: true },
  { label: 'Pricing', href: '#workspace-entry', dropdown: false },
  { label: 'Resources', href: '#workflow', dropdown: true },
] as const
</script>

<template>
  <main id="product" class="relative min-h-screen overflow-x-hidden bg-[#101312] text-[#f5eee4]">
    <div class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(221,180,137,0.08),transparent_34%),linear-gradient(115deg,rgba(26,31,28,0.98)_0%,rgba(13,14,13,0.99)_50%,rgba(31,22,17,0.98)_100%)]" />
    <SeoHeroAccentBackdrop />
    <div class="pointer-events-none absolute inset-0 opacity-[0.026] [background-image:linear-gradient(rgba(255,255,255,0.16)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.14)_1px,transparent_1px)] [background-size:56px_56px]" />
    <div class="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[#d7b18a]/10 to-transparent" />
    <div class="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-[#070806]/72 to-transparent" />

    <section class="relative z-10 mx-auto flex min-h-screen w-[calc(100vw-32px)] max-w-[1600px] flex-col pb-6 pt-5 sm:w-[calc(100vw-64px)] lg:w-[calc(100vw-96px)] min-[1800px]:w-[calc(100vw-360px)] min-[1800px]:pb-8 min-[1800px]:pt-6">
      <header class="mx-auto grid h-12 w-full max-w-[1280px] grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-6 min-[1800px]:max-w-[1360px]">
        <RouterLink
          to="/"
          class="flex min-w-0 items-center gap-3 justify-self-start focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#d7b18a]/45"
          aria-label="SEO Agent home"
        >
          <span class="flex size-8 shrink-0 items-center justify-center text-[#f1d2ae]">
            <AppIcon name="tabler:sparkles" :size="30" />
          </span>
          <span class="min-w-0">
            <span class="block text-xl font-bold leading-6 text-[#fff7ed]">SEO Agent</span>
          </span>
        </RouterLink>

        <nav class="hidden items-center gap-8 justify-self-center md:flex min-[1800px]:gap-9" aria-label="Home navigation">
          <a
            v-for="item in navItems"
            :key="item.href"
            :href="item.href"
            class="inline-flex items-center gap-1.5 text-sm font-medium text-[#e8e2d8]/82 transition hover:text-[#fff7ed] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#d7b18a]/40"
          >
            <span>{{ item.label }}</span>
            <AppIcon
              v-if="item.dropdown"
              name="tabler:chevron-down"
              :size="14"
            />
          </a>
        </nav>

        <RouterLink
          to="/workspace"
          class="inline-flex h-11 shrink-0 items-center justify-center gap-2 justify-self-end rounded-lg border border-white/16 bg-white/[0.025] px-5 text-sm font-medium text-[#f0e5d8] transition hover:-translate-y-0.5 hover:border-white/24 hover:bg-white/[0.06] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#d7c5aa]/40"
          aria-label="Open AI SEO workspace"
        >
          <span class="hidden sm:inline">Open workspace</span>
          <span class="sm:hidden">Workspace</span>
          <AppIcon name="tabler:arrow-up-right" :size="17" />
        </RouterLink>
      </header>

      <div class="seo-hero-stage mx-auto flex w-full flex-1 flex-col">
        <section id="workflow" class="hidden min-w-0 items-center pt-14 lg:flex" aria-label="SEO Agent workflow visual">
          <div class="relative mx-auto h-[clamp(350px,38dvh,400px)] w-full overflow-visible min-[1800px]:h-[clamp(390px,34dvh,440px)]">
            <SeoProcessMap class="absolute inset-0 z-10 h-full w-full" />
          </div>
        </section>

        <section class="relative z-10 mx-auto w-full pb-4 pt-3 text-center lg:pt-[clamp(2rem,5dvh,4.5rem)]">
          <h1 class="seo-home-title mx-auto max-w-[1220px] text-[38px] font-normal leading-[1.05] text-[#fff8ef] sm:text-5xl lg:text-[58px] min-[1800px]:max-w-[1360px] min-[1800px]:text-[72px]">
            Turn pages into search-ready briefs
          </h1>

          <p class="mx-auto mt-4 max-w-[690px] text-lg font-medium leading-8 text-[#d4ddd0]/70 min-[1800px]:max-w-[820px] min-[1800px]:text-xl">
            An AI workspace for audits, keywords, and content plans that stays grounded in page context.
          </p>

          <div id="workspace-entry" class="mt-7 flex flex-col justify-center gap-3 sm:flex-row sm:items-center min-[1800px]:mt-8">
            <RouterLink
              to="/workspace"
              class="inline-flex h-13 min-w-[230px] items-center justify-center gap-7 rounded-lg bg-[#eee3d2] px-7 text-base font-semibold text-[#111412] shadow-[0_8px_18px_rgba(0,0,0,0.24)] transition hover:-translate-y-0.5 hover:bg-[#fff3e1] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#e8d7bf]/45 min-[1800px]:h-14 min-[1800px]:min-w-[250px]"
              aria-label="Analyze a page in SEO Agent workspace"
            >
              Analyze a page
              <AppIcon name="tabler:arrow-right" :size="18" />
            </RouterLink>

            <a
              href="#workflow"
              class="inline-flex h-13 min-w-[188px] items-center justify-center gap-2 rounded-lg border border-white/16 bg-white/[0.02] px-5 text-base font-medium text-[#e9e1d7]/86 transition hover:bg-white/[0.06] hover:text-[#fff7ed] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#f0c18f]/35 min-[1800px]:h-14 min-[1800px]:min-w-[210px]"
            >
              View example
            </a>
          </div>
        </section>

        <form
          class="relative z-10 mx-auto mb-[clamp(0.75rem,2dvh,1.5rem)] mt-auto w-full max-w-[1068px] rounded-xl border border-white/12 bg-[#151817]/88 p-4 transition-colors focus-within:border-[#d8c8ad]/42 focus-within:bg-[#171b19]/94 focus-within:ring-1 focus-within:ring-[#d8c8ad]/18 min-[1800px]:max-w-[1180px] min-[1800px]:p-5"
          aria-label="SEO Agent static input example"
          @submit.prevent
        >
          <div class="flex min-h-[120px] flex-col min-[1800px]:min-h-[134px]">
            <label class="sr-only" for="home-seo-topic">Page topic</label>
            <textarea
              id="home-seo-topic"
              class="block min-h-[54px] w-full resize-none bg-transparent px-1 py-1 text-base font-medium leading-7 text-[#eee4d9] outline-none placeholder:text-[#c7bbad] min-[1800px]:min-h-[60px] min-[1800px]:text-lg"
              rows="2"
              placeholder="Drop a URL or describe the page..."
            />

            <div class="mt-auto flex min-w-0 items-end justify-between gap-3 pt-5">
              <span class="inline-flex h-10 min-w-0 items-center gap-2 rounded-lg border border-white/10 bg-black/26 px-3 text-xs font-medium text-[#e5d8c8]">
                <AppIcon name="tabler:sparkles" :size="16" />
                <span class="truncate">DeepSeek V4 Flash</span>
                <AppIcon name="tabler:chevron-down" :size="15" />
              </span>

              <button
                type="submit"
                class="inline-flex size-11 shrink-0 items-center justify-center rounded-lg bg-[#eee3d2] text-[#111412] transition hover:-translate-y-0.5 hover:bg-[#fff3e1] focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-[#e8d7bf]/42 min-[1800px]:size-12"
                aria-label="Submit static example"
                title="Submit"
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
