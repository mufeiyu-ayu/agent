<script setup lang="ts">
import { useTemplateRef } from 'vue'

import { useCountUp, useSceneEntrance } from '@/hooks/useHomeMotion'

const kpi = useTemplateRef('kpi')
const money = (v: number) => `$${v.toFixed(2)}M`
const countUp = useCountUp()
useSceneEntrance(useTemplateRef('stack'), (phase) => {
  if (phase === 'wait')
    kpi.value!.textContent = money(0)
  else if (phase === 'enter')
    countUp(kpi.value!, 2.21, money, 1000, 800)
})
</script>

<template>
  <section class="scene build" data-parallax>
    <div class="wrap grid12">
      <div class="visual">
        <div ref="stack" class="stack" data-scene="build" aria-label="Three things Agent can build: a table, a chart and a report">
          <div class="art-slot slot-table">
            <article class="art">
              <header class="art-head">
                <span class="art-tag" style="--c:var(--sage)"><svg class="ic" aria-hidden="true"><use href="#i-table" /></svg>Table</span><span class="art-title">Unshipped orders</span>
              </header>
              <table class="tbl">
                <thead><tr><th>Order</th><th>Region</th><th>Value</th></tr></thead>
                <tbody>
                  <tr><td>#48213</td><td>EU</td><td>$1,240</td></tr>
                  <tr><td>#48207</td><td>US</td><td>$860</td></tr>
                  <tr><td>#48196</td><td>APAC</td><td>$2,015</td></tr>
                  <tr><td>#48190</td><td>US</td><td>$540</td></tr>
                  <tr><td>#48174</td><td>EU</td><td>$1,105</td></tr>
                </tbody>
              </table>
            </article>
          </div>
          <div class="art-slot slot-chart">
            <article class="art">
              <header class="art-head">
                <span class="art-tag" style="--c:var(--primary)"><svg class="ic" aria-hidden="true"><use href="#i-chart" /></svg>Chart</span><span class="art-title">Sessions by channel · GA4</span>
              </header>
              <svg class="line-chart" viewBox="0 0 260 112" role="img" aria-label="Line chart: organic sessions climb steadily over eight weeks while paid sessions stay flat.">
                <defs>
                  <linearGradient id="orgFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" style="stop-color: var(--clay)" stop-opacity=".22" />
                    <stop offset="1" style="stop-color: var(--clay)" stop-opacity="0" />
                  </linearGradient>
                </defs>
                <line x1="8" x2="252" y1="28" y2="28" /><line x1="8" x2="252" y1="60" y2="60" /><line x1="8" x2="252" y1="92" y2="92" />
                <path class="org-area" d="M10 80 L44 72 L78 74 L112 62 L146 56 L180 48 L214 40 L248 26 L248 104 L10 104 Z" fill="url(#orgFill)" />
                <polyline class="org-line" pathLength="1" points="10,80 44,72 78,74 112,62 146,56 180,48 214,40 248,26" fill="none" style="stroke: var(--clay)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
                <polyline points="10,90 44,86 78,88 112,82 146,84 180,78 214,80 248,74" fill="none" style="stroke: var(--ink-3)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="1 5" />
                <circle class="org-dot" cx="248" cy="26" r="4.5" fill="#fff" style="stroke: var(--clay)" stroke-width="2.5" />
              </svg>
              <div class="legend" aria-hidden="true">
                <span><i style="--c:var(--clay)" />Organic</span><span><i style="--c:var(--ink-3)" />Paid</span>
              </div>
            </article>
          </div>
          <div class="art-slot slot-page">
            <article class="art">
              <header class="art-head">
                <span class="art-tag" style="--c:var(--clay)"><svg class="ic" aria-hidden="true"><use href="#i-page" /></svg>Report</span><span class="art-title">September revenue</span>
              </header>
              <div class="pg-kpi">
                <b ref="kpi">$2.21M</b><span>+12% vs August</span>
              </div>
              <p class="pg-note">
                5 weeks · from the Orders API
              </p>
              <div class="pg-bars" aria-hidden="true">
                <i style="--h:83%;--i:0" /><i style="--h:88%;--i:1" /><i style="--h:78%;--i:2" /><i style="--h:95%;--i:3" /><i style="--h:100%;--i:4" />
              </div>
              <div class="pg-actions">
                <span class="chip-btn solid"><svg class="ic" aria-hidden="true"><use href="#i-down" /></svg>Export CSV</span>
                <span class="chip-btn"><svg class="ic" aria-hidden="true"><use href="#i-users" /></svg>Share to team</span>
              </div>
            </article>
          </div>
        </div>
      </div>
      <div class="copy">
        <p class="kicker" data-reveal>
          <i style="--c:var(--clay)" />Build
        </p>
        <h2 class="h2" data-reveal style="--i:1">
          Get a report, not a paragraph.
        </h2>
        <p class="body" data-reveal style="--i:2">
          Answers come back as things you can work with: a table you can sort, a chart you can tweak, a report you can send to the team. Export to CSV when you&rsquo;re done.
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* scene: build */
.build .visual { grid-column: 1 / 8; position: relative; }
.build .copy { grid-column: 9 / 13; align-self: end; padding-bottom: 32px; }
.build .visual::before {
  content: ""; position: absolute; inset: -10% 5% -10% -30%; pointer-events: none;
  background:
    radial-gradient(closest-side, color-mix(in srgb, var(--wheat) 45%, transparent), transparent) 20% 60% / 60% 70% no-repeat,
    radial-gradient(closest-side, color-mix(in srgb, var(--clay) 30%, transparent), transparent) 70% 30% / 55% 60% no-repeat;
  filter: blur(10px); translate: 0 calc(var(--py, 0) * 1px);
}
.stack { position: relative; height: clamp(420px, 42vw, 520px); }
.art-slot {
  position: absolute;
  transform: translate(calc((1 - var(--p, 1)) * var(--dx, 0px)), calc((1 - var(--p, 1)) * var(--dy, 0px))) rotate(calc(var(--rot) * (.3 + .7 * var(--p, 1))));
}
.slot-table { left: 0; top: 10%; width: 54%; --rot: -7deg; }
.slot-chart { left: 33%; top: 0; width: 56%; --rot: 3deg; }
.slot-page { left: 42%; top: 40%; width: 56%; --rot: -2deg; }
.art {
  position: relative; padding: 16px; border-radius: 18px;
  background: var(--surface); box-shadow: var(--shadow-lg), 0 0 0 1px rgba(23, 20, 46, .05);
  transition: transform .6s cubic-bezier(.2, .8, .2, 1);
}
.stack:hover .slot-table .art { transform: translate(-5%, 3%) rotate(-2deg); }
.stack:hover .slot-chart .art { transform: translate(0, -5%) rotate(1deg); }
.stack:hover .slot-page .art { transform: translate(4%, 4%) rotate(1deg); }
.art-head { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; }
.art-tag {
  display: inline-flex; align-items: center; gap: 5px; padding: 5px 8px; border-radius: 7px;
  font: 600 10.5px/1 var(--f-mono); letter-spacing: .08em; text-transform: uppercase;
  background: color-mix(in srgb, var(--c) 14%, #fff); color: color-mix(in srgb, var(--c) 72%, var(--ink));
}
.art-tag .ic { width: 12px; height: 12px; }
.art-title { font-size: 13.5px; font-weight: 600; }
.tbl { width: 100%; border-collapse: collapse; font-size: 12.5px; font-variant-numeric: tabular-nums; }
.tbl th { padding: 0 0 8px; text-align: left; font: 500 10.5px var(--f-mono); letter-spacing: .06em; text-transform: uppercase; color: var(--ink-3); }
.tbl td { padding: 7px 0; border-top: 1px solid var(--line); }
.tbl th:not(:first-child), .tbl td:not(:first-child) { text-align: right; }
.line-chart { display: block; width: 100%; height: auto; }
.line-chart line { stroke: var(--line); }
.art .legend { margin-top: 8px; }
.pg-kpi { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.pg-kpi b { font: 700 30px/1 var(--f-display); letter-spacing: -.03em; }
.pg-kpi span { font-size: 12.5px; font-weight: 600; color: var(--good-ink); }
.pg-note { margin-top: 3px; font-size: 12px; color: var(--ink-3); }
.pg-bars { display: flex; align-items: flex-end; gap: 7px; height: 72px; margin: 16px 0; }
.pg-bars i { flex: 1; height: var(--h); border-radius: 6px 6px 3px 3px; background: color-mix(in srgb, var(--clay) 38%, #fff); }
.pg-bars i:last-child { background: var(--clay); }
.pg-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.js-motion .art-slot { transition: transform .15s linear; }
.tbl tbody tr:nth-child(2) { --i: 1; }
.tbl tbody tr:nth-child(3) { --i: 2; }
.tbl tbody tr:nth-child(4) { --i: 3; }
.tbl tbody tr:nth-child(5) { --i: 4; }
.js-motion .tbl tbody tr { transition: opacity .5s ease calc(.35s + var(--i, 0) * 70ms); }
.js-motion .org-line { stroke-dasharray: 1; transition: stroke-dashoffset 1.5s cubic-bezier(.45, 0, .2, 1) .45s; }
.js-motion .org-area { transition: opacity .8s ease 1.3s; }
.js-motion .org-dot { transform-box: fill-box; transform-origin: center; transition: scale .5s cubic-bezier(.3, 1.6, .5, 1) 1.85s; }
.js-motion .pg-bars i { transform-origin: bottom; transition: scale .8s cubic-bezier(.2, .8, .2, 1) calc(.8s + var(--i, 0) * 80ms); }
.will-enter .tbl tbody tr { opacity: 0; }
.will-enter .org-line { stroke-dashoffset: 1; }
.will-enter .org-area { opacity: 0; }
.will-enter .org-dot { scale: 0; }
.will-enter .pg-bars i { scale: 1 0; }
@media (max-width: 1080px) {
  .build .visual, .build .copy { grid-column: 1 / -1; }
  .build .copy { order: -1; padding-bottom: 32px; }
}
@media (max-width: 760px) {
  .stack { height: 470px; }
  .art-slot { width: 78%; }
  .slot-chart { left: 18%; }
  .slot-page { left: 16%; top: 38%; width: 82%; }
}
</style>
