<script setup lang="ts">
import { useTemplateRef } from 'vue'

import { useConnectRouting } from '@/hooks/useConnectRouting'
import { useSceneEntrance } from '@/hooks/useHomeMotion'

// 先注册路由 hook，入场回调里才能开始打字
const { startTyping } = useConnectRouting(useTemplateRef('route'))
useSceneEntrance(useTemplateRef('visual'), (phase) => {
  if (phase !== 'wait')
    startTyping(phase === 'enter')
})
</script>

<template>
  <section id="product" class="scene ask" data-parallax>
    <div class="wrap grid12">
      <div class="copy">
        <p class="kicker" data-reveal>
          <i style="--c:var(--sage)" />Connect
        </p>
        <h2 class="h2" data-reveal style="--i:1">
          Plug in the data your team already runs on.
        </h2>
        <p class="body" data-reveal style="--i:2">
          Search Console, GA4, your order system, last quarter&rsquo;s finance reports. Connect a source once and everyone on the team can ask it in plain words — no SQL, no ticket to the data team.
        </p>
      </div>
      <div ref="visual" class="visual" data-scene="ask">
        <div id="route" ref="route" class="route">
          <div class="ask-card">
            <div class="ask-input">
              <p class="ask-text">
                <span id="typeText">Which landing pages lost the most clicks this week?</span><span class="caret" aria-hidden="true" />
              </p>
              <span id="askSend" class="send" aria-hidden="true"><svg class="ic" aria-hidden="true"><use href="#i-up" /></svg></span>
            </div>
            <p id="askStatus" class="ask-status" aria-live="polite">
              <i /><span>4 sources connected</span>
            </p>
          </div>
          <div class="gw-row" aria-hidden="true">
            <span class="gw-line" />
            <span id="gateway" class="gateway"><svg class="ic" aria-hidden="true"><use href="#i-lock" /></svg>Gateway<em>read-only</em></span>
          </div>
          <svg class="fan" aria-hidden="true"><path class="base" d="" /><path class="hot" d="" pathLength="1" style="--c:var(--good)" /><path class="base" d="" /><path class="hot" d="" pathLength="1" style="--c:var(--clay)" /><path class="base" d="" /><path class="hot" d="" pathLength="1" style="--c:var(--primary)" /><path class="base" d="" /><path class="hot" d="" pathLength="1" style="--c:var(--rose)" /></svg>
          <div class="srcs">
            <div class="tile" data-k="gsc" style="--c:var(--good);--i:0">
              <span class="tile-ic"><svg class="ic" aria-hidden="true"><use href="#i-search" /></svg></span><b>Search Console</b><span class="tile-meta">Google · OAuth</span><span class="tile-hit"><svg class="ic" aria-hidden="true"><use href="#i-check" /></svg><span /></span>
            </div>
            <div class="tile" data-k="ga4" style="--c:var(--clay);--i:1">
              <span class="tile-ic"><svg class="ic" aria-hidden="true"><use href="#i-chart" /></svg></span><b>GA4</b><span class="tile-meta">Google · OAuth</span><span class="tile-hit"><svg class="ic" aria-hidden="true"><use href="#i-check" /></svg><span /></span>
            </div>
            <div class="tile" data-k="orders" style="--c:var(--primary);--i:2">
              <span class="tile-ic"><svg class="ic" aria-hidden="true"><use href="#i-db" /></svg></span><b>Orders API</b><span class="tile-meta">Your API · read-only</span><span class="tile-hit"><svg class="ic" aria-hidden="true"><use href="#i-check" /></svg><span /></span>
            </div>
            <div class="tile" data-k="finance" style="--c:var(--rose);--i:3">
              <span class="tile-ic"><svg class="ic" aria-hidden="true"><use href="#i-folder" /></svg></span><b>Finance</b><span class="tile-meta">12 PDFs · uploaded</span><span class="tile-hit"><svg class="ic" aria-hidden="true"><use href="#i-check" /></svg><span /></span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* scene: ask */
.ask .copy { grid-column: 1 / 6; align-self: start; padding-top: 24px; }
.ask .visual { grid-column: 6 / 13; margin-top: clamp(24px, 4vw, 56px); position: relative; }
/* a faint dot field behind the routing diagram */
.ask .visual::before {
  content: ""; position: absolute; inset: -16% -8% -14% -10%; pointer-events: none;
  background: radial-gradient(circle, color-mix(in srgb, var(--ink) 14%, transparent) 1px, transparent 1.6px) 0 0 / 22px 22px;
  -webkit-mask-image: radial-gradient(ellipse 58% 58% at 50% 60%, #000 25%, transparent 78%);
  mask-image: radial-gradient(ellipse 58% 58% at 50% 60%, #000 25%, transparent 78%);
  translate: 0 calc(var(--py, 0) * 1px);
}
.route { position: relative; }
.ask-card { position: relative; z-index: 1; padding: 12px; border-radius: 24px; background: var(--surface); box-shadow: var(--shadow-lg); }
.ask-input {
  display: flex; align-items: flex-end; gap: 14px; min-height: 124px; padding: 20px 14px 14px 22px;
  border-radius: 18px; background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--line);
}
.ask-text { flex: 1; align-self: flex-start; font: 500 clamp(18px, 1.7vw, 22px)/1.4 var(--f-display); letter-spacing: -.01em; }
.ask-text .caret { display: inline-block; height: 1.1em; color: var(--primary); }
.send { display: grid; place-items: center; width: 44px; height: 44px; flex: none; border-radius: 14px; background: var(--primary); color: #fff; transition: scale .12s; }
.send.is-pressed { scale: .86; }
.send .ic { width: 20px; height: 20px; }
.ask-status { display: flex; align-items: center; gap: 8px; padding: 12px 10px 4px; font: 500 12px var(--f-mono); color: var(--ink-3); }
.ask-status i { width: 7px; height: 7px; border-radius: 50%; background: var(--good); box-shadow: 0 0 0 3px color-mix(in srgb, var(--good) 20%, transparent); }
.ask-status.is-busy i { background: var(--clay); box-shadow: 0 0 0 3px color-mix(in srgb, var(--clay) 22%, transparent); animation: blink .9s steps(1) infinite; }
.ask-status :deep(b) { font-weight: 600; color: var(--ink); }
.gw-row { position: relative; z-index: 1; display: grid; justify-items: center; }
.gw-line { position: relative; width: 2px; height: 30px; overflow: hidden; background: var(--line-2); }
.gw-line::after { content: ""; position: absolute; left: 0; top: -18px; width: 2px; height: 18px; background: linear-gradient(transparent, var(--clay)); }
.route.is-sending .gw-line::after { animation: drop .42s cubic-bezier(.5, 0, .7, 1) forwards; }
@keyframes drop { to { top: 100%; } }
.gateway {
  display: inline-flex; align-items: center; gap: 8px; height: 38px; padding: 0 15px 0 13px; border-radius: 999px;
  background: var(--ink); color: #fff; font-size: 13.5px; font-weight: 600; box-shadow: var(--shadow-md); transition: box-shadow .3s;
}
.gateway .ic { width: 15px; height: 15px; }
.gateway em {
  min-width: 8.5ch; margin-left: 2px; padding-left: 10px; border-left: 1px solid rgb(255 255 255 / 18%);
  font: 500 11.5px var(--f-mono); font-style: normal; color: oklch(0.780 0.020 70); transition: color .3s;
}
.gateway.is-check { box-shadow: 0 0 0 5px color-mix(in srgb, var(--clay) 30%, transparent), var(--shadow-md); }
.gateway.is-ok em { color: oklch(0.830 0.110 145); }
.fan { display: block; width: 100%; height: 58px; overflow: visible; }
.fan path { fill: none; stroke-linecap: round; }
.fan .base { stroke: var(--line-2); stroke-width: 1.5; stroke-dasharray: 2 5; }
.fan .hot { stroke: var(--c); stroke-width: 2; stroke-dasharray: 1; stroke-dashoffset: 1; transition: stroke-dashoffset .5s cubic-bezier(.5, 0, .2, 1); }
.fan .hot.is-on { stroke-dashoffset: 0; }
.srcs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.tile {
  display: grid; justify-items: start; gap: 2px; padding: 14px 14px 12px; border-radius: 16px;
  background: var(--surface); box-shadow: 0 0 0 1px var(--line), 0 10px 24px -16px rgb(61 49 36 / 30%);
  transition: translate .45s cubic-bezier(.2, .8, .2, 1), box-shadow .35s, filter .35s;
}
.tile-ic {
  display: grid; place-items: center; width: 34px; height: 34px; margin-bottom: 10px; border-radius: 10px;
  background: var(--ground-2); color: var(--ink-3); transition: background-color .35s, color .35s;
}
.tile-ic .ic { width: 17px; height: 17px; }
.tile b { max-width: 100%; font-size: 13.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tile-meta { max-width: 100%; font: 500 11px var(--f-mono); color: var(--ink-3); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.tile-hit {
  display: inline-flex; align-items: center; gap: 4px; height: 22px; margin-top: 10px; padding: 0 7px; border-radius: 6px;
  background: color-mix(in srgb, var(--good) 13%, #fff); color: var(--good-ink); font: 600 11px var(--f-mono); white-space: nowrap;
  opacity: 0; translate: 0 4px; transition: opacity .3s, translate .4s cubic-bezier(.2, .8, .2, 1);
}
.tile-hit .ic { width: 11px; height: 11px; stroke-width: 3; }
.tile.is-hit { translate: 0 -4px; box-shadow: 0 0 0 1.5px var(--c), 0 18px 32px -16px color-mix(in srgb, var(--c) 60%, transparent); }
.tile.is-hit .tile-ic { background: var(--c); color: #fff; }
.tile.is-hit .tile-hit { opacity: 1; translate: 0 0; }
.route.is-routing .tile:not(.is-hit) { filter: saturate(.3) opacity(.55); }
@keyframes blink { 50% { opacity: 0; } }
.js-motion .ask-card { transition: opacity .8s ease, translate 1s cubic-bezier(.2, .7, .2, 1); }
.js-motion .gw-row { transition: opacity .5s ease .45s, scale .6s cubic-bezier(.3, 1.5, .5, 1) .45s; }
.js-motion .fan .base { transition: opacity .8s ease .7s; }
.js-motion .tile { --dl: calc(.75s + var(--i, 0) * 90ms); transition: opacity .5s ease var(--dl), transform .7s cubic-bezier(.2, .7, .2, 1) var(--dl), translate .45s cubic-bezier(.2, .8, .2, 1), box-shadow .35s, filter .35s; }
.will-enter .ask-card { opacity: 0; translate: 0 56px; }
.will-enter .gw-row { opacity: 0; scale: .8; }
.will-enter .fan .base { opacity: 0; }
.will-enter .tile { opacity: 0; transform: translateY(18px); }
@media (max-width: 1080px) {
  .ask .copy, .ask .visual { grid-column: 1 / -1; }
  .ask .visual { margin-top: 40px; }
}
@media (max-width: 760px) {
  .srcs { grid-template-columns: 1fr 1fr; margin-top: 14px; }
  .fan { display: none; }
}
</style>
