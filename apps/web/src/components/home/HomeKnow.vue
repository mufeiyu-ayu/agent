<script setup lang="ts">
import { useTemplateRef } from 'vue'

import { useSceneEntrance } from '@/hooks/useHomeMotion'

useSceneEntrance(useTemplateRef('panel'))
</script>

<template>
  <section id="know" class="own">
    <div class="wrap">
      <div ref="panel" class="own-panel" data-scene="own">
        <div>
          <p class="kicker">
            <i style="--c:var(--good)" />Know
          </p>
          <h2 class="h2">
            Stop digging through docs. Just ask.
          </h2>
          <ul class="points">
            <li style="--i:0">
              <span class="pi" style="--c:var(--sage)"><svg class="ic" aria-hidden="true"><use href="#i-folder" /></svg></span><p><b>Upload once, the whole team benefits</b><span>Handbooks, SOPs, contracts and meeting notes become one place everyone can ask.</span></p>
            </li>
            <li style="--i:1">
              <span class="pi" style="--c:var(--clay)"><svg class="ic" aria-hidden="true"><use href="#i-lock" /></svg></span><p><b>Permissions come along</b><span>People only get answers from files they&rsquo;re allowed to open.</span></p>
            </li>
            <li style="--i:2">
              <span class="pi" style="--c:var(--primary)"><svg class="ic" aria-hidden="true"><use href="#i-check" /></svg></span><p><b>Answers point to the page</b><span>Every answer cites the file and section it came from, checked before you see it.</span></p>
            </li>
          </ul>
        </div>

        <div class="library" role="img" aria-label="An answer about refunds cites the exact passage in the Refund SOP; a leadership-only deck is skipped because the asker cannot open it">
          <article class="sheet sheet-a" aria-hidden="true">
            <header class="doc-head">
              <span class="doc-ic" style="--c:var(--primary)"><svg class="ic" aria-hidden="true"><use href="#i-file" /></svg></span><div><b>Employee handbook</b><span>PDF · 48 pages</span></div>
            </header>
            <div class="skel">
              <i style="--w:92%" /><i style="--w:74%" /><i style="--w:86%" /><i style="--w:60%" /><i style="--w:90%" /><i style="--w:70%" /><i style="--w:82%" />
            </div>
          </article>
          <article class="sheet sheet-b is-locked" aria-hidden="true">
            <header class="doc-head">
              <span class="doc-ic" style="--c:var(--ink)"><svg class="ic" aria-hidden="true"><use href="#i-file" /></svg></span><div><b>Q3 board deck</b><span>Slides · 32 pages</span></div><span class="lock"><svg class="ic" aria-hidden="true"><use href="#i-lock" /></svg>Leadership</span>
            </header>
            <div class="skel">
              <i style="--w:88%" /><i style="--w:70%" /><i style="--w:94%" /><i style="--w:64%" /><i style="--w:80%" /><i style="--w:72%" /><i style="--w:90%" />
            </div>
          </article>
          <article class="doc" aria-hidden="true">
            <header class="doc-head">
              <span class="doc-ic" style="--c:var(--clay)"><svg class="ic" aria-hidden="true"><use href="#i-file" /></svg></span><div><b>Refund SOP v3</b><span>Support · updated Sep 3</span></div>
            </header>
            <div class="skel">
              <i style="--w:94%" />
            </div>
            <p class="doc-h">
              2.1&ensp;Refunds over $500
            </p>
            <p class="doc-p">
              <mark>Refunds over $500 need a support manager&rsquo;s approval.</mark> Once approved, the money goes back to the original payment method <mark style="--d:1">within 5 business days</mark>.<span class="cite pin">1</span>
            </p>
            <div class="skel">
              <i style="--w:96%" /><i style="--w:82%" /><i style="--w:90%" /><i style="--w:58%" />
            </div>
          </article>
          <div class="kqa">
            <p class="kqa-q">
              What&rsquo;s our refund policy for orders over $500?
            </p>
            <p class="kqa-a">
              They need a manager&rsquo;s approval and are paid back within 5 business days.<span class="cite">1</span>
            </p>
            <p class="kqa-meta">
              <svg class="ic" aria-hidden="true"><use href="#i-search" /></svg>Searched 318 files · skipped 1 you can&rsquo;t open
            </p>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.cite {
  display: inline; margin-left: 2px; padding: 1px 4px;
  border-radius: 5px; background: var(--ground-2); color: var(--accent);
  font: 600 10px/1 var(--f-mono); vertical-align: .3em;
}
/* own it */
.own-panel {
  position: relative; overflow: hidden;
  display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: clamp(32px, 5vw, 64px); align-items: center;
  padding: clamp(28px, 5vw, 64px); border-radius: 34px;
  background:
    radial-gradient(600px 420px at 100% 0%, oklch(0.925 0.035 55) 0%, transparent 70%),
    radial-gradient(520px 420px at 0% 100%, oklch(0.935 0.028 145) 0%, transparent 70%),
    var(--surface-2);
}
.points { display: grid; gap: 18px; margin: 30px 0 0; padding: 0; list-style: none; }
.points li { display: grid; grid-template-columns: 40px 1fr; gap: 14px; align-items: start; }
.points .pi { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 12px; background: #fff; color: var(--c); box-shadow: var(--shadow-md); }
.points .pi .ic { width: 19px; height: 19px; }
.points b { display: block; font-size: 16px; }
.points span { font-size: 15px; color: var(--ink-2); }
/* the doc and the answer stay in flow, so the answer only ever covers the doc's trailing lines */
.library { position: relative; width: 100%; max-width: 560px; margin-inline: auto; padding-top: 104px; }
.sheet, .doc, .kqa { border-radius: 16px; background: var(--surface); box-shadow: var(--shadow-lg), 0 0 0 1px var(--line); }
.sheet { position: absolute; top: 0; width: 52%; padding: 16px 16px 22px; }
.sheet-a { left: 0; top: 26px; rotate: -6deg; }
.sheet-b { right: 0; rotate: 5deg; }
.doc { position: relative; z-index: 1; width: 66%; margin-left: 17%; padding: 18px 20px 20px; }
.doc-head { display: flex; align-items: center; gap: 10px; padding-bottom: 12px; margin-bottom: 12px; border-bottom: 1px solid var(--line); }
.doc-head > div { min-width: 0; }
.doc-ic { display: grid; place-items: center; flex: none; width: 30px; height: 30px; border-radius: 8px; background: color-mix(in srgb, var(--c) 13%, #fff); color: var(--c); }
.doc-ic .ic { width: 15px; height: 15px; }
.doc-head b { display: block; font-size: 13.5px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.doc-head div > span { display: block; font: 500 11px var(--f-mono); color: var(--ink-3); white-space: nowrap; }
.lock {
  position: absolute; top: 70px; right: 14px; display: inline-flex; align-items: center; gap: 5px; height: 24px; padding: 0 9px; border-radius: 999px;
  background: var(--ink); color: #fff; font-size: 11px; font-weight: 600; white-space: nowrap;
}
.lock .ic { width: 11px; height: 11px; }
.skel { display: grid; gap: 9px; }
.skel i { display: block; width: var(--w); height: 7px; border-radius: 4px; background: var(--ground-2); }
.sheet.is-locked .skel { filter: blur(2px); opacity: .6; }
.doc-h { margin: 16px 0 6px; font-size: 13px; font-weight: 700; }
.doc-p { margin-bottom: 16px; font-size: 13px; line-height: 1.65; color: var(--ink-2); }
.doc-p mark {
  color: var(--ink); background: linear-gradient(transparent 52%, color-mix(in srgb, var(--wheat) 80%, transparent) 52%) no-repeat 0 0 / 100% 100%;
}
.pin { background: var(--clay); color: #fff; }
.kqa { position: relative; z-index: 2; width: 70%; margin: -46px 0 0 -3%; display: grid; gap: 10px; padding: 16px; border-radius: 18px; }
.kqa-q {
  justify-self: end; max-width: 92%; padding: 8px 12px; border-radius: 12px;
  background: var(--ground-2); box-shadow: inset 0 0 0 1px oklch(0.820 0.010 72); font-size: 13px; line-height: 1.45;
}
.kqa-a { font-size: 14px; line-height: 1.55; }
.kqa .cite { background: var(--clay); color: #fff; }
.kqa-meta { display: flex; align-items: center; gap: 6px; padding-top: 10px; border-top: 1px solid var(--line); font: 500 11px var(--f-mono); color: var(--ink-3); }
.kqa-meta .ic { width: 12px; height: 12px; flex: none; }
.js-motion .points li { transition: opacity .6s ease, translate .8s cubic-bezier(.2, .7, .2, 1); transition-delay: calc(.2s + var(--i, 0) * 110ms); }
.js-motion .sheet { transition: opacity .6s ease .1s, translate 1s cubic-bezier(.2, .8, .2, 1) .1s, rotate 1s cubic-bezier(.2, .8, .2, 1) .1s; }
.js-motion .doc { transition: opacity .6s ease .4s, translate 1s cubic-bezier(.2, .8, .2, 1) .4s; }
.js-motion .doc-p mark { transition: background-size .8s cubic-bezier(.6, 0, .2, 1) calc(1.3s + var(--d, 0) * .55s); }
.js-motion .pin { transition: opacity .3s ease 2.3s, scale .5s cubic-bezier(.3, 1.6, .5, 1) 2.3s; }
.js-motion .kqa { transition: opacity .6s ease 1.7s, translate 1s cubic-bezier(.2, .8, .2, 1) 1.7s; }
.will-enter .points li { opacity: 0; translate: 0 18px; }
.will-enter .sheet { opacity: 0; translate: 0 40px; rotate: 0deg; }
.will-enter .doc { opacity: 0; translate: 0 48px; }
.will-enter .doc-p mark { background-size: 0% 100%; }
.will-enter .pin { opacity: 0; scale: .3; }
.will-enter .kqa { opacity: 0; translate: 0 36px; }
@media (max-width: 1080px) {
  .own-panel { grid-template-columns: 1fr; }
}
@media (max-width: 520px) {
  .library { padding-top: 96px; }
  .sheet { width: 66%; }
  .doc { width: 92%; margin-left: 4%; }
  .kqa { width: 94%; margin-left: 0; }
}
</style>
