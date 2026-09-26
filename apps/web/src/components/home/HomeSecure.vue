<script setup lang="ts">
import { ref, useTemplateRef } from 'vue'

import { homeMotion, useSceneEntrance, useTraceReplay } from '@/hooks/useHomeMotion'

// 审计日志 8 行：s / d 是起止毫秒（轴长 4000ms），t / detail 是详情条内容
const rows = [
  { c: 'sage', s: 0, d: 24, label: 'Check identity', ms: '24 ms', t: 'Check identity', detail: 'Asked as Lin · the SEO team can read Search Console and the blog CMS' },
  { c: 'primary', s: 24, d: 1380, label: 'Model call', ms: '1,380 ms', t: 'Model call', detail: 'Picked the topuplist-indexing-audit skill · planned 2 gateway calls' },
  { c: 'clay', s: 1404, d: 220, label: 'collect_posts', code: true, ms: '220 ms', t: 'topuplist · collect_posts', detail: 'Read-only · 42 posts · runs on your side, the model only sees the result' },
  { c: 'clay', s: 1624, d: 610, label: 'url_inspection', code: true, ms: '610 ms', t: 'search-console · url_inspection', detail: 'Read-only · the Google token stays in the gateway, never with the model · 42 / 2,000 quota' },
  { c: 'good', s: 2234, d: 12, label: 'Mask fields', ms: '12 ms', t: 'Mask fields', detail: 'Author emails removed before the model saw the data' },
  { c: 'primary', s: 2246, d: 1580, label: 'Model call', ms: '1,580 ms', t: 'Model call', detail: 'Wrote the answer and the page · 2,380 tokens in, 412 out' },
  { c: 'good', s: 3826, d: 9, label: 'Verify sources', ms: '9 ms', t: 'Verify sources', detail: '2 of 2 citations matched what this run actually read' },
  { c: 'good', s: 3835, d: 30, label: 'Write audit log', ms: '30 ms', t: 'Write audit log', detail: 'Who asked, what was read and what was answered, saved together' },
]
const active = ref(3)

const motion = homeMotion()
const panel = useTemplateRef('panel')
const replay = useTraceReplay()
useSceneEntrance(panel, (phase, el) => {
  if (phase === 'enter')
    replay(el, false)
})
</script>

<template>
  <section id="security" class="scene trace">
    <div class="wrap">
      <div class="head">
        <div>
          <p class="kicker" data-reveal>
            <i style="--c:var(--primary)" />Secure
          </p>
          <h2 class="h2" data-reveal style="--i:1">
            AI never touches your database.
          </h2>
          <p class="body" data-reveal style="--i:2">
            Your team decides what Agent can reach: read-only operations behind a gateway, never raw access. It asks as the person asking, sees only what they&rsquo;re allowed to see, and every call is logged.
          </p>
        </div>
        <div class="kinds" aria-hidden="true" data-reveal style="--i:3">
          <span><i style="--c:var(--sage)" />Identity</span>
          <span><i style="--c:var(--primary)" />Model</span>
          <span><i style="--c:var(--clay)" />Gateway</span>
          <span><i style="--c:var(--good)" />Check &amp; log</span>
        </div>
      </div>

      <div ref="panel" class="wf-panel" data-scene="trace">
        <div class="wf-top">
          <b>Audit log</b><span>Lin · SEO team</span><span>9/22 09:12</span><span>3.9 s</span><span class="ok"><svg class="ic" aria-hidden="true"><use href="#i-check" /></svg>Every call allowed</span><button id="replayBtn" class="replay-btn" type="button" :hidden="!motion" @click="replay(panel!, true)">
            <svg class="ic" aria-hidden="true"><use href="#i-replay" /></svg>Replay
          </button>
        </div>
        <div class="wf-axis" aria-hidden="true">
          <span /><div class="wf-ticks">
            <span style="left:0">0 s</span><span style="left:25%">1 s</span><span style="left:50%">2 s</span><span style="left:75%">3 s</span><span style="left:100%">4 s</span>
          </div><span />
        </div>
        <div id="wfRows">
          <button
            v-for="(row, i) in rows" :key="i"
            class="wf-row" :class="{ 'is-active': i === active }" type="button" :style="`--c:var(--${row.c});--s:${row.s};--d:${row.d}`"
            @click="active = i" @mouseenter="active = i" @focus="active = i"
          >
            <span class="wf-label"><i /><code v-if="row.code">{{ row.label }}</code><template v-else>{{ row.label }}</template></span><span class="wf-track"><span class="wf-bar" /></span><span class="wf-ms">{{ row.ms }}</span>
          </button>
        </div>
        <p id="wfDetail" class="wf-detail" :style="`--c:var(--${rows[active]!.c})`" aria-live="polite">
          <b>{{ rows[active]!.t }}</b><span>{{ rows[active]!.detail }}</span>
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* trace */
.trace .head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; gap: 24px 48px; }
.trace .head > div { max-width: 640px; }
.kinds { display: flex; flex-wrap: wrap; gap: 8px 16px; font-size: 13px; color: var(--ink-2); }
.kinds span { display: inline-flex; align-items: center; gap: 7px; }
.kinds i { width: 10px; height: 10px; border-radius: 3px; background: var(--c); }
.wf-panel { margin-top: clamp(36px, 5vw, 56px); padding: clamp(18px, 2.6vw, 30px); border-radius: 26px; background: var(--surface); box-shadow: var(--shadow-lg); }
.wf-top { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin-bottom: 16px; font: 500 12.5px var(--f-mono); color: var(--ink-3); }
.wf-top b { font-weight: 600; color: var(--ink); }
.wf-top .ok { display: inline-flex; align-items: center; gap: 6px; margin-left: auto; color: var(--good-ink); font-weight: 600; }
.wf-top .ok .ic { width: 14px; height: 14px; stroke-width: 2.6; }
.wf-row, .wf-axis {
  display: grid; grid-template-columns: minmax(118px, 230px) minmax(0, 1fr) 64px; align-items: center; column-gap: 18px;
}
.wf-axis { height: 22px; font: 500 10.5px var(--f-mono); color: var(--ink-3); }
.wf-ticks { position: relative; height: 100%; }
.wf-ticks span { position: absolute; top: 3px; translate: -50% 0; white-space: nowrap; }
.wf-ticks span:first-child { translate: 0 0; }
.wf-ticks span:last-child { translate: -100% 0; }
.wf-row {
  width: 100%; padding: 9px 10px; margin: 0 -10px; width: calc(100% + 20px);
  border: 0; border-top: 1px solid var(--line); border-radius: 10px; background: transparent; text-align: left; cursor: pointer;
  transition: background-color .2s;
}
.wf-row:hover, .wf-row.is-active { background: var(--surface-2); }
.wf-row.is-active { box-shadow: inset 0 0 0 1px var(--line); }
.wf-label { display: flex; align-items: center; gap: 9px; min-width: 0; font-size: 13.5px; font-weight: 500; }
.wf-label i { width: 9px; height: 9px; flex: none; border-radius: 3px; background: var(--c); }
.wf-label code { font: 500 12.5px var(--f-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wf-track {
  position: relative; height: 16px;
  background: linear-gradient(90deg, var(--line) 1px, transparent 1px) 0 0 / 25% 100%;
  box-shadow: inset -1px 0 0 var(--line);
}
.wf-bar {
  position: absolute; top: 3px; height: 10px; border-radius: 5px; background: var(--c);
  left: calc(var(--s) / 4000 * 100%); width: max(4px, calc(var(--d) / 4000 * 100%));
}
.wf-row.is-active .wf-bar { box-shadow: 0 0 0 3px color-mix(in srgb, var(--c) 25%, transparent); }
.wf-ms { text-align: right; font: 500 12px var(--f-mono); color: var(--ink-2); font-variant-numeric: tabular-nums; }
.wf-detail {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; margin-top: 16px; padding: 14px 16px;
  border-radius: 14px; background: color-mix(in srgb, var(--c, var(--primary)) 9%, #fff);
  font-size: 14px; color: var(--ink-2);
}
.wf-detail b { font-weight: 600; color: var(--ink); }
.replay-btn {
  display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 10px; border: 0; border-radius: 8px; cursor: pointer;
  background: var(--ground-2); color: var(--ink-2); font: 500 12px var(--f-mono);
}
.replay-btn:hover { background: var(--ground-3); color: var(--ink); }
.replay-btn .ic { width: 13px; height: 13px; }
.js-motion .wf-bar { transform-origin: left center; transition: transform max(.3s, var(--d) / 4000 * 2.6s) cubic-bezier(.35, .6, .4, 1) calc(var(--s) / 4000 * 2.6s + .35s); }
.js-motion .wf-ms { transition: opacity .4s ease calc((var(--s) + var(--d)) / 4000 * 2.6s + .35s); }
.js-motion .wf-top .ok { transition: opacity .4s ease 3.05s, scale .6s cubic-bezier(.3, 1.6, .5, 1) 3.05s; }
.js-motion .wf-detail { transition: opacity .5s ease 3.2s, translate .6s cubic-bezier(.2, .7, .2, 1) 3.2s; }
.wf-track::after { content: ""; position: absolute; top: -10px; bottom: -10px; left: 0; width: 2px; border-radius: 1px; background: var(--ink); opacity: 0; pointer-events: none; }
.replaying .wf-track::after { animation: playhead 2.6s linear .35s both; }
@keyframes playhead { 0% { left: 0; opacity: .8; } 97% { left: 100%; opacity: .8; } 100% { left: 100%; opacity: 0; } }
.will-enter .wf-bar { transform: scaleX(0); }
.will-enter .wf-ms { opacity: 0; }
.will-enter .wf-top .ok { opacity: 0; scale: .8; }
.will-enter .wf-detail { opacity: 0; translate: 0 8px; }
.no-trans, .no-trans * { transition: none !important; }
@media (max-width: 520px) {
  .wf-row, .wf-axis { grid-template-columns: minmax(96px, 40%) minmax(0, 1fr) 50px; column-gap: 10px; }
  .wf-label { font-size: 12px; }
  .wf-label code { font-size: 11.5px; }
  .wf-ms { font-size: 11px; }
}
</style>
