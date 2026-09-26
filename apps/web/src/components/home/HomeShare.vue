<script setup lang="ts">
import { useTemplateRef } from 'vue'

import { useSceneEntrance } from '@/hooks/useHomeMotion'

useSceneEntrance(useTemplateRef('stage'))
</script>

<template>
  <section id="share" class="scene share" data-parallax>
    <div class="wrap">
      <div class="head">
        <div class="h2wrap" data-reveal>
          <p class="kicker">
            <i style="--c:var(--rose)" />Share
          </p>
          <h2 class="h2">
            Share the answer, not a screenshot.
          </h2>
        </div>
        <p class="body" data-reveal style="--i:1">
          Post a report to your team&rsquo;s space in one click. Teammates open the live report and, if you choose, the whole conversation behind it — so they can pick up the thread or have their own agent review it.
        </p>
      </div>

      <div ref="stage" class="share-stage" data-scene="share">
        <div class="channel">
          <div class="ch-head">
            <span class="hash">#</span>SEO team<span class="members"><span class="faces"><i class="face" style="--c:var(--clay)">L</i><i class="face" style="--c:var(--sage)">M</i><i class="face" style="--c:var(--accent)">J</i></span>6 members</span>
          </div>
          <div class="ch-body">
            <div class="post" style="--i:0">
              <i class="face" style="--c:var(--clay)">L</i>
              <div>
                <p class="post-meta">
                  <b>Lin</b> shared a report · 9:14
                </p>
                <p class="post-text">
                  Indexing check for last week. The 4 missing posts are all from 9/19–20, so I&rsquo;ll resubmit them.
                </p>
                <div class="report">
                  <div class="report-top">
                    <div>
                      <p class="kicker-sm">
                        Generated page
                      </p><h4>Blog indexing, Sep 14–20</h4>
                    </div>
                    <b class="report-kpi">71%</b>
                  </div>
                  <div class="mini-bars" aria-hidden="true">
                    <i style="--a:100%;--b:100%;--j:0" /><i style="--a:100%;--b:100%;--j:1" /><i style="--a:83.3%;--b:100%;--j:2" /><i style="--a:83.3%;--b:100%;--j:3" /><i style="--a:66.7%;--b:100%;--j:4" /><i style="--a:50%;--b:66.7%;--j:5" /><i style="--a:16.7%;--b:66.7%;--j:6" />
                  </div>
                  <div class="report-foot">
                    <span class="convo"><svg class="ic" aria-hidden="true"><use href="#i-msg" /></svg>Conversation included · 12 messages</span>
                    <span class="chip-btn"><svg class="ic" aria-hidden="true"><use href="#i-replay" /></svg>Re-run with latest data</span>
                    <span class="chip-btn solid">Open</span>
                  </div>
                </div>
              </div>
            </div>
            <div class="post" style="--i:1">
              <i class="face" style="--c:var(--sage)">M</i>
              <div>
                <p class="post-meta">
                  <b>Maya</b> · 9:31
                </p>
                <p class="post-text">
                  Had my agent review the whole conversation. It also found 3 posts missing from the sitemap, so I&rsquo;m adding them now.
                </p>
                <span class="review-tag"><svg class="ic" aria-hidden="true"><use href="#i-zap" /></svg>Reviewed with the full conversation</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
/* scene: share */
.share .head { display: grid; grid-template-columns: repeat(12, minmax(0, 1fr)); column-gap: 24px; align-items: end; }
.share .head .h2wrap { grid-column: 1 / 8; }
.share .head .body { grid-column: 8 / 13; margin-top: 0; }
.share-stage {
  position: relative;
  width: min(100%, 820px); margin: clamp(48px, 6vw, 80px) 0 0 auto;
}
.share-stage::before {
  content: ""; position: absolute; inset: -12% -8% -18% 10%; pointer-events: none;
  background:
    radial-gradient(closest-side, color-mix(in srgb, var(--rose) 26%, transparent), transparent) 70% 40% / 55% 80% no-repeat,
    radial-gradient(closest-side, color-mix(in oklch, var(--sage) 22%, transparent), transparent) 20% 70% / 60% 70% no-repeat;
  filter: blur(8px); translate: 0 calc(var(--py, 0) * 1px);
}
.channel { position: relative; z-index: 1; overflow: hidden; border-radius: 26px; background: var(--surface); box-shadow: var(--shadow-lg); }
.ch-head {
  display: flex; align-items: center; gap: 7px; padding: 16px clamp(18px, 2.6vw, 26px);
  border-bottom: 1px solid var(--line); background: var(--surface-2); font-size: 15px; font-weight: 600;
}
.ch-head .hash { color: var(--ink-3); }
.members { display: inline-flex; align-items: center; gap: 10px; margin-left: auto; font: 500 12px var(--f-mono); color: var(--ink-3); }
.members .face { box-shadow: 0 0 0 2px var(--surface-2); }
.ch-body { display: grid; gap: 26px; padding: clamp(18px, 2.6vw, 26px); }
.post { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 14px; }
.post > .face { width: 34px; height: 34px; font-size: 13px; box-shadow: none; }
.post-meta { font-size: 13.5px; line-height: 1.4; color: var(--ink-3); }
.post-meta b { font-weight: 600; color: var(--ink); }
.post-text { margin-top: 4px; font-size: 15px; line-height: 1.55; }
.report { margin-top: 12px; padding: 16px 18px; border-radius: 16px; background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--line); }
.report-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
.report h4 { margin: 7px 0 0; font: 700 17px/1.2 var(--f-display); letter-spacing: -.015em; }
.report-kpi { font: 700 28px/1 var(--f-display); letter-spacing: -.03em; }
.mini-bars { display: flex; gap: 8px; height: 56px; margin: 16px 0 14px; }
.mini-bars i { flex: 1; border-radius: 4px; background: linear-gradient(to top, var(--ink-2) var(--a), var(--clay) var(--a) var(--b), var(--bar-old) var(--b)); }
.report-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.convo { display: inline-flex; align-items: center; gap: 6px; margin-right: auto; font-size: 12.5px; color: var(--ink-2); }
.convo .ic { width: 14px; height: 14px; color: var(--clay); }
.review-tag {
  display: inline-flex; align-items: center; gap: 6px; margin-top: 10px; padding: 5px 10px 5px 8px; border-radius: 8px;
  background: color-mix(in srgb, var(--clay) 10%, #fff); color: var(--accent); font-size: 12.5px; font-weight: 500;
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--clay) 22%, transparent);
}
.review-tag .ic { width: 13px; height: 13px; }
.js-motion .channel { transition: opacity .8s ease, translate 1s cubic-bezier(.2, .7, .2, 1); }
.js-motion .post { transition: opacity .6s ease, translate .8s cubic-bezier(.2, .7, .2, 1); transition-delay: calc(.5s + var(--i, 0) * .7s); }
.js-motion .mini-bars i { transform-origin: bottom; transition: scale .7s cubic-bezier(.2, .8, .2, 1) calc(.9s + var(--j, 0) * 60ms); }
.will-enter .channel { opacity: 0; translate: 0 44px; }
.will-enter .post { opacity: 0; translate: 0 16px; }
.will-enter .mini-bars i { scale: 1 0; }
@media (max-width: 1080px) {
  .share .head .h2wrap, .share .head .body { grid-column: 1 / -1; }
  .share .head .body { margin-top: 22px; }
}
</style>
