<script setup lang="ts">
import { useTemplateRef } from 'vue'

import HomeHeroDemo from '@/components/home/HomeHeroDemo.vue'

const demo = useTemplateRef('demo')
</script>

<template>
  <header id="top" class="hero">
    <div class="wrap hero-grid">
      <div class="hero-copy">
        <h1 class="display">
          Ask your company&rsquo;s data. <span class="line2">Share what you <span class="hl">find.</span></span>
        </h1>
        <p class="lede">
          Connect the data your team runs on, ask in plain words, and get reports and charts the whole team can open.
        </p>
        <div class="cta-row">
          <RouterLink class="btn btn-primary" to="/workspace">
            Start asking <svg class="ic ic-go" aria-hidden="true"><use href="#i-go" /></svg>
          </RouterLink>
          <button id="tourBtn" class="btn btn-ghost" type="button" @click="demo?.playTour()">
            <span class="play-dot"><svg class="ic" aria-hidden="true"><use href="#i-play" /></svg></span>Watch the tour
          </button>
        </div>
      </div>

      <div class="hero-stage">
        <div class="glow" aria-hidden="true" />
        <HomeHeroDemo ref="demo" />
      </div>
    </div>
  </header>
</template>

<style scoped>
/* ---------- hero ---------- */
.hero {
  position: relative; overflow: clip;
  padding-block: clamp(112px, 10vw, 140px) clamp(80px, 8vw, 120px);
  background: radial-gradient(1100px 560px at 50% -12%, var(--surface) 0%, transparent 72%), var(--ground);
}
/* dappled light: soft palm shadows (Unsplash photo 1789302557549), multiplied onto the warm ground */
.hero::before {
  content: ""; position: absolute; inset: 0 0 auto; height: min(100%, 1000px); pointer-events: none;
  background: var(--palm) 50% 35% / cover no-repeat;
  mix-blend-mode: multiply; opacity: .34;
  filter: sepia(.35) brightness(1.1) contrast(1.05);
  -webkit-mask-image: linear-gradient(#000 40%, transparent 100%);
  mask-image: linear-gradient(#000 40%, transparent 100%);
  transform-origin: 50% 0;
  animation: sway 24s ease-in-out infinite alternate;
}
@keyframes sway {
  from { transform: translate3d(-1%, 0, 0) rotate(-.5deg) scale(1.05); }
  to { transform: translate3d(1%, .8%, 0) rotate(.5deg) scale(1.07); }
}
.hero-stage > .glow { left: -11%; right: -11%; top: 6%; height: 80%; }
.hero-grid {
  position: relative; z-index: 1;
  display: flex; flex-direction: column; align-items: center; gap: clamp(34px, 3.6vw, 50px);
}
.hero-copy { display: flex; flex-direction: column; align-items: center; max-width: 1000px; text-align: center; }
.hero-copy .cta-row { justify-content: center; margin-top: 28px; }
.display {
  font: 600 clamp(38px, 4.6vw, 62px)/1.08 var(--f-display);
  letter-spacing: -.035em; text-wrap: balance;
}
.display .line2 { display: block; color: var(--ink-3); }
.display .hl {
  color: var(--ink);
  background: linear-gradient(var(--wheat), var(--wheat)) no-repeat 0 88% / 100% .28em;
  animation: marker 1.1s .95s cubic-bezier(.6, 0, .2, 1) both;
}
@keyframes marker { from { background-size: 0 .3em; } }
.lede { margin-top: 18px; max-width: 34em; font-size: clamp(17px, 1.3vw, 19px); line-height: 1.55; color: var(--ink-2); }
.hero-stage { position: relative; width: min(1200px, 100%); padding-bottom: 48px; }
.js-motion .hero-copy > * { animation: rise 1s cubic-bezier(.2, .7, .2, 1) both; }
.js-motion .hero-copy > :nth-child(2) { animation-delay: .1s; }
.js-motion .hero-copy > :nth-child(3) { animation-delay: .2s; }
@keyframes rise { from { opacity: 0; translate: 0 22px; } }
</style>
