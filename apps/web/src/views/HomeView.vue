<script setup lang="ts">
import { useTemplateRef } from 'vue'

import palmUrl from '@/assets/hero-palm.jpg'
import HomeBuild from '@/components/home/HomeBuild.vue'
import HomeConnect from '@/components/home/HomeConnect.vue'
import HomeFinal from '@/components/home/HomeFinal.vue'
import HomeFooter from '@/components/home/HomeFooter.vue'
import HomeHero from '@/components/home/HomeHero.vue'
import HomeKnow from '@/components/home/HomeKnow.vue'
import HomeNav from '@/components/home/HomeNav.vue'
import HomeSecure from '@/components/home/HomeSecure.vue'
import HomeShare from '@/components/home/HomeShare.vue'
import { homeMotion, useHomeScroll } from '@/hooks/useHomeMotion'

const motion = homeMotion()
useHomeScroll(useTemplateRef('root'), motion)
</script>

<template>
  <div ref="root" class="home" :class="{ 'js-motion': motion }" lang="en" :style="{ '--palm': `url(${palmUrl})` }">
    <svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false">
      <defs>
        <symbol id="i-asterisk" viewBox="0 0 24 24"><path d="M12 12l8-4.5" /><path d="M12 12v9" /><path d="M12 12l-8-4.5" /><path d="M12 12l8 4.5" /><path d="M12 3v9" /><path d="M12 12l-8 4.5" /></symbol>
        <symbol id="i-zap" viewBox="0 0 24 24"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z" /></symbol>
        <symbol id="i-go" viewBox="0 0 24 24"><path d="M5 12h14" /><path d="m12 5 7 7-7 7" /></symbol>
        <symbol id="i-up" viewBox="0 0 24 24"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></symbol>
        <symbol id="i-play" viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z" fill="currentColor" /></symbol>
        <symbol id="i-check" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" /></symbol>
        <symbol id="i-table" viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="M3 15h18" /><path d="M12 3v18" /></symbol>
        <symbol id="i-chart" viewBox="0 0 24 24"><path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="M18 17V9" /><path d="M13 17V5" /><path d="M8 17v-3" /></symbol>
        <symbol id="i-page" viewBox="0 0 24 24"><rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18" /><path d="M9 21V9" /></symbol>
        <symbol id="i-file" viewBox="0 0 24 24"><path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" /><path d="M14 2v4a2 2 0 0 0 2 2h4" /><path d="M16 13H8" /><path d="M16 17H8" /></symbol>
        <symbol id="i-db" viewBox="0 0 24 24"><ellipse cx="12" cy="5" rx="9" ry="3" /><path d="M3 5v14a9 3 0 0 0 18 0V5" /><path d="M3 12a9 3 0 0 0 18 0" /></symbol>
        <symbol id="i-folder" viewBox="0 0 24 24"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" /></symbol>
        <symbol id="i-plus" viewBox="0 0 24 24"><path d="M5 12h14" /><path d="M12 5v14" /></symbol>
        <symbol id="i-down" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><path d="m7 10 5 5 5-5" /><path d="M12 15V3" /></symbol>
        <symbol id="i-link" viewBox="0 0 24 24"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" /></symbol>
        <symbol id="i-replay" viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></symbol>
        <symbol id="i-search" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></symbol>
        <symbol id="i-users" viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></symbol>
        <symbol id="i-msg" viewBox="0 0 24 24"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" /></symbol>
        <symbol id="i-lock" viewBox="0 0 24 24"><rect width="18" height="11" x="3" y="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></symbol>
      </defs>
    </svg>

    <HomeNav />
    <HomeHero />
    <main>
      <HomeConnect />
      <HomeBuild />
      <HomeShare />
      <HomeSecure />
      <HomeKnow />
      <HomeFinal />
    </main>
    <HomeFooter />
  </div>
</template>

<style scoped>
/*
 * 设计稿（agent-homepage.html）里跨部分共用的规则。原稿挂在 :root / html / body / * 上的规则改挂首页根元素，
 * 其余用 :deep() 下发，只作用在首页根元素内。各部分自己的规则在对应组件里。
 */
.home {
  /* mirrors apps/web/src/style.css (warm ledger) */
  --ground: oklch(0.955 0.007 72);
  --ground-2: oklch(0.925 0.008 72);
  --ground-3: oklch(0.890 0.012 72);
  --surface: oklch(0.992 0.002 72);
  --surface-2: oklch(0.978 0.004 72);
  --ink: oklch(0.190 0.018 65);
  --ink-2: oklch(0.360 0.016 65);
  --ink-3: oklch(0.530 0.012 65);
  --line: oklch(0.190 0.018 65 / .09);
  --line-2: oklch(0.190 0.018 65 / .16);
  --border-soft: oklch(0.855 0.009 72);
  --border: oklch(0.780 0.012 72);
  --primary: oklch(0.205 0.020 65);
  --primary-hover: oklch(0.270 0.024 65);
  --accent: oklch(0.455 0.080 38);
  --clay: oklch(0.620 0.120 42);
  --rose: oklch(0.620 0.085 22);
  --sage: oklch(0.580 0.060 150);
  --wheat: oklch(0.870 0.085 82);
  --good: oklch(0.470 0.070 148);
  --good-ink: oklch(0.400 0.060 145);
  --bar-old: oklch(0.880 0.012 72);
  --focus: oklch(0.620 0.060 42);
  --shadow-lg: 0 40px 80px -36px rgb(61 49 36 / 30%), 0 12px 28px -14px rgb(61 49 36 / 16%);
  --shadow-md: 0 16px 36px -18px rgb(61 49 36 / 30%);
  --f-display: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --f-body: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  --f-mono: "JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace;
  color-scheme: light;

  /* 原稿 html / body */
  -webkit-text-size-adjust: 100%;
  margin: 0;
  background: var(--ground);
  color: var(--ink);
  font: 400 17px/1.6 var(--f-body);
  -webkit-font-smoothing: antialiased;
  /* 抵消 style.css 在 :root 上设的全局排版，原稿没有这些 */
  -moz-osx-font-smoothing: auto;
  text-rendering: auto;
  font-synthesis: initial;
}

.home, .home::before, .home::after, :deep(*), :deep(*::before), :deep(*::after) { box-sizing: border-box; }
:deep([hidden]) { display: none !important; }
:deep(a) { color: inherit; }
:deep(button) { font: inherit; color: inherit; }
:deep(h1), :deep(h2), :deep(h3), :deep(p) { margin: 0; }
:deep(.ic) { width: 1em; height: 1em; flex: none; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
:deep(:focus-visible) { outline: 2.5px solid var(--focus); outline-offset: 3px; }
:deep(.wrap) { width: 100%; max-width: 1360px; margin-inline: auto; padding-inline: clamp(16px, 4vw, 48px); }

:deep(.brand) {
  display: inline-flex; align-items: center; gap: 10px; text-decoration: none;
  font: 700 20px/1 var(--f-display); letter-spacing: -.025em;
}
:deep(.brand img) { width: 32px; height: 32px; border-radius: 9px; }

/* ---------- buttons ---------- */
:deep(.btn) {
  display: inline-flex; align-items: center; justify-content: center; gap: 10px;
  height: 50px; padding: 0 22px; border: 0; border-radius: 12px;
  font: 600 16px/1 var(--f-body); text-decoration: none; white-space: nowrap; cursor: pointer;
  transition: transform .25s cubic-bezier(.2, .8, .2, 1), background-color .25s, box-shadow .25s;
}
:deep(.btn .ic) { width: 18px; height: 18px; transition: transform .25s; }
:deep(.btn:hover .ic-go) { transform: translateX(3px); }
:deep(.btn-primary) {
  background: var(--primary); color: #fff;
  box-shadow: 0 14px 30px -12px color-mix(in srgb, var(--primary) 85%, transparent), inset 0 1px 0 rgba(255, 255, 255, .25);
}
:deep(.btn-primary:hover) { background: var(--primary-hover); transform: translateY(-1px); }
:deep(.btn-ghost) {
  background: var(--surface); color: var(--ink);
  box-shadow: inset 0 0 0 1px var(--border-soft), 0 1px 2px rgb(61 49 36 / 4%);
  -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px);
}
:deep(.btn-ghost:hover) { background: var(--surface-2); }
/* 按钮区原有规则，放在 .btn .ic 之后才能按原稿的层叠顺序生效 */
:deep(.play-dot) { display: grid; place-items: center; width: 28px; height: 28px; margin-left: -8px; border-radius: 50%; background: var(--clay); color: #fff; }
:deep(.play-dot .ic) { width: 12px; height: 12px; }
:deep(.cta-row) { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 36px; }

:deep(.glow) {
  position: absolute; z-index: 0; pointer-events: none; border-radius: 50%;
  background:
    radial-gradient(38% 52% at 20% 58%, color-mix(in oklch, var(--wheat) 70%, transparent), transparent 72%),
    radial-gradient(34% 48% at 48% 30%, color-mix(in oklch, var(--rose) 40%, transparent), transparent 72%),
    radial-gradient(36% 52% at 80% 60%, color-mix(in oklch, var(--clay) 45%, transparent), transparent 72%),
    radial-gradient(30% 40% at 60% 92%, color-mix(in oklch, var(--sage) 35%, transparent), transparent 72%);
  filter: blur(56px); opacity: .6;
  animation: drift 18s ease-in-out infinite alternate;
}
@keyframes drift {
  from { transform: translate3d(-2.5%, 1.5%, 0) rotate(-2deg) scale(1); }
  to { transform: translate3d(2.5%, -2%, 0) rotate(2deg) scale(1.07); }
}

/* 演示窗口与 Connect 的输入光标 */
:deep(.caret) { display: none; width: 2px; height: 1.05em; margin-left: 1px; vertical-align: -.15em; background: currentColor; animation: blink 1s steps(1) infinite; }
@keyframes blink { 50% { opacity: 0; } }

/* 演示窗口、Build、Share 共用的小部件 */
:deep(.kicker-sm) { font: 600 10.5px/1 var(--f-mono); letter-spacing: .09em; text-transform: uppercase; color: var(--clay); }
:deep(.legend) { display: flex; flex-wrap: wrap; gap: 10px; font-size: 12.5px; color: var(--ink-2); white-space: nowrap; }
:deep(.legend span) { display: inline-flex; align-items: center; gap: 5px; }
:deep(.legend i) { width: 9px; height: 9px; border-radius: 3px; background: var(--c); }
:deep(.chip-btn) {
  display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 11px; border-radius: 9px;
  background: #fff; box-shadow: inset 0 0 0 1px var(--line-2);
  font-size: 12px; font-weight: 500; color: var(--ink-2); white-space: nowrap;
}
:deep(.chip-btn .ic) { width: 13px; height: 13px; }
:deep(.chip-btn.solid) { background: var(--ink); color: #fff; box-shadow: none; }
:deep(.face) {
  display: inline-grid; place-items: center; flex: none; width: 24px; height: 24px; border-radius: 50%;
  background: var(--c); color: #fff; font: 600 11px/1 var(--f-body); font-style: normal; box-shadow: 0 0 0 2px var(--surface);
}
:deep(.faces) { display: inline-flex; }
:deep(.faces .face + .face) { margin-left: -4px; }

/* ---------- sections ---------- */
:deep(section) { position: relative; }
:deep(.kicker) {
  display: flex; align-items: center; gap: 9px; margin-bottom: 20px;
  font: 600 12px/1 var(--f-mono); letter-spacing: .1em; text-transform: uppercase; color: var(--ink-2);
}
:deep(.kicker i) { width: 10px; height: 10px; border-radius: 3px; background: var(--c); }
:deep(.h2) { font: 600 clamp(30px, 3.5vw, 48px)/1.1 var(--f-display); letter-spacing: -.03em; text-wrap: balance; }
:deep(.body) { margin-top: 22px; max-width: 34em; font-size: clamp(17px, 1.3vw, 19px); line-height: 1.6; color: var(--ink-2); }

:deep(.scene) { padding-block: clamp(64px, 9vw, 120px); overflow-x: clip; }
:deep(.grid12) { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); column-gap: 24px; }

/* copy rises once, only if it starts below the fold */
.js-motion :deep([data-reveal]) { transition: opacity .9s cubic-bezier(.2, .7, .2, 1), translate .9s cubic-bezier(.2, .7, .2, 1); transition-delay: calc(var(--i, 0) * 90ms); }
.js-motion :deep([data-reveal].is-pending) { opacity: 0; translate: 0 30px; }

@media (prefers-reduced-motion: reduce) {
  .home, .home::before, .home::after, :deep(*), :deep(*::before), :deep(*::after) { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; }
}
</style>
