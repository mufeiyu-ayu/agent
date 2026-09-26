<script setup lang="ts">
import { useTemplateRef } from 'vue'

import avatarUrl from '@/assets/avatar-warm.webp'
import { useHeroTour } from '@/hooks/useHeroTour'

const { playTour } = useHeroTour(useTemplateRef('demo'))
defineExpose({ playTour })
</script>

<template>
  <div class="frame-wrap">
    <div id="demo" ref="demo" class="demo" role="group" aria-label="Product tour: a question about company data becomes a report, shared with the team">
      <div id="scene" class="cam-scene">
        <div class="demo-bar">
          <span class="lights" aria-hidden="true"><i /><i /><i /></span>
          <span class="demo-title">topuplist · SEO</span>
        </div>

        <div id="demoBody" class="demo-body is-split">
          <div id="demoChat" class="demo-chat">
            <div id="chatEmpty" class="chat-empty is-off">
              <p class="greet">
                <svg class="ic" aria-hidden="true"><use href="#i-asterisk" /></svg>What would you like to know today?
              </p>
            </div>
            <div class="chat-log">
              <div id="bubble" class="bubble">
                What share of last week's topuplist blog posts are indexed on Google?
              </div>
              <div id="agentMsg" class="agent-msg">
                <div class="agent-head">
                  <img :src="avatarUrl" alt=""><span id="thinking" class="thinking" hidden>Reading your question…</span><span id="skillPill" class="skill-pill"><svg class="ic" aria-hidden="true"><use href="#i-zap" /></svg><em>Skill</em>topuplist-indexing-audit</span>
                </div>
                <ol id="steps" class="steps">
                  <li class="is-done">
                    <span class="st"><svg class="ic"><use href="#i-check" /></svg></span><b><span class="srv">topuplist</span> · collect_posts</b><em>42 posts</em>
                  </li>
                  <li class="is-done">
                    <span class="st"><svg class="ic"><use href="#i-check" /></svg></span><b><span class="srv">search-console</span> · url_inspection</b><em>42 / 2,000 quota</em>
                  </li>
                  <li class="is-done">
                    <span class="st"><svg class="ic"><use href="#i-check" /></svg></span>Building the page<em>live preview</em>
                  </li>
                </ol>
                <p id="answer" class="answer">
                  <span class="w">30</span> <span class="w">of</span> <span class="w">42</span> <span class="w">posts</span> <span class="w">(</span><u class="w">71%</u><span class="w">)</span> <span class="w">are</span> <span class="w">indexed</span><span class="cite w">1</span><span class="w">.</span> <span class="w">8</span> <span class="w">were</span> <span class="w">crawled</span> <span class="w">but</span> <span class="w">not</span> <span class="w">indexed,</span> <span class="w">and</span> <span class="w">the</span> <span class="w">4</span> <span class="w">Google</span> <span class="w">hasn't</span> <span class="w">found</span> <span class="w">yet</span> <span class="w">were</span> <span class="w">all</span> <span class="w">published</span> <span class="w">on</span> <u class="w">9/19–9/20</u><span class="cite w">2</span><span class="w">.</span>
                </p>
                <span id="verified" class="verified"><svg class="ic" aria-hidden="true"><use href="#i-check" /></svg>2 of 2 sources verified</span>
              </div>
            </div>
            <div id="composer" class="composer" aria-hidden="true">
              <p class="composer-input">
                <span id="composeText" /><span class="caret" /><span id="composePh" class="ph">Ask a question about your data…</span>
              </p>
              <div class="composer-row">
                <span class="composer-plus"><svg class="ic"><use href="#i-plus" /></svg></span>
                <span class="composer-model">deepseek-flash<span>High</span></span>
                <span id="sendBtn" class="composer-send"><svg class="ic"><use href="#i-up" /></svg></span>
              </div>
            </div>
            <div class="chat-chips" aria-hidden="true">
              <span>Check indexing</span><span>Weekly clicks report</span><span>Top landing pages</span>
            </div>
          </div>

          <div id="demoPage" class="demo-page" data-phase="real">
            <div class="page-stack">
              <div class="page-skel" aria-hidden="true">
                <div class="skel-label">
                  <span class="skel-spin" />Rendering page…
                </div>
                <div class="sk" style="height:18px;width:40%" />
                <div class="sk" style="height:26px;width:70%" />
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                  <div class="sk" style="height:58px" /><div class="sk" style="height:58px" />
                </div>
                <div class="sk" style="flex:1;min-height:120px" />
              </div>
              <div class="page-real">
                <div class="page-head">
                  <div>
                    <p class="kicker-sm">
                      Generated page
                    </p>
                    <h3>Blog indexing, Sep 14–20</h3>
                    <p class="page-sub">
                      English posts · checked 9/22 09:12 PT
                    </p>
                  </div>
                  <div class="legend" aria-hidden="true">
                    <span><i style="--c:var(--ink-2)" />Indexed</span><span><i style="--c:var(--clay)" />Crawled</span><span><i style="--c:var(--bar-old)" />Not found</span>
                  </div>
                </div>
                <div class="kpis">
                  <div class="kpi">
                    <b id="kpiRev">71%</b><span>Strict indexing rate</span>
                  </div>
                  <div class="kpi">
                    <b id="kpiGrowth">30 / 42</b><span>Posts indexed</span>
                  </div>
                </div>
                <svg class="chart" viewBox="0 0 480 250" role="img" aria-label="Stacked bars of 42 English posts published Sep 14 to 20 by indexing status: 30 indexed, 8 crawled but not indexed, 4 not yet found by Google, all from Sep 19 and 20.">
                  <g class="grid">
                    <line x1="44" x2="472" y1="12" y2="12" /><line x1="44" x2="472" y1="81.3" y2="81.3" /><line x1="44" x2="472" y1="150.7" y2="150.7" /><line x1="44" x2="472" y1="220" y2="220" />
                  </g>
                  <text x="36" y="15.5" text-anchor="end">6</text>
                  <text x="36" y="84.8" text-anchor="end">4</text>
                  <text x="36" y="154.2" text-anchor="end">2</text>
                  <text x="36" y="223.5" text-anchor="end">0</text>
                  <rect class="bar new" x="57.6" y="12.0" width="34" height="208.0" rx="3" />
                  <rect class="bar new" x="118.7" y="12.0" width="34" height="208.0" rx="3" />
                  <rect class="bar new" x="179.9" y="46.7" width="34" height="173.3" rx="3" />
                  <rect class="bar lead" x="179.9" y="12.0" width="34" height="32.7" rx="3" />
                  <rect class="bar new" x="241.0" y="46.7" width="34" height="173.3" rx="3" />
                  <rect class="bar lead" x="241.0" y="12.0" width="34" height="32.7" rx="3" />
                  <rect class="bar new" x="302.1" y="81.3" width="34" height="138.7" rx="3" />
                  <rect class="bar lead" x="302.1" y="12.0" width="34" height="67.3" rx="3" />
                  <rect class="bar new" x="363.3" y="116.0" width="34" height="104.0" rx="3" />
                  <rect class="bar lead" x="363.3" y="81.3" width="34" height="32.7" rx="3" />
                  <rect class="bar old" x="363.3" y="12.0" width="34" height="67.3" rx="3" />
                  <rect class="bar new" x="424.4" y="185.3" width="34" height="34.7" rx="3" />
                  <rect class="bar lead" x="424.4" y="81.3" width="34" height="102.0" rx="3" />
                  <rect class="bar old" x="424.4" y="12.0" width="34" height="67.3" rx="3" />
                  <text x="74.6" y="242" text-anchor="middle">9/14</text>
                  <text x="135.7" y="242" text-anchor="middle">9/15</text>
                  <text x="196.9" y="242" text-anchor="middle">9/16</text>
                  <text x="258.0" y="242" text-anchor="middle">9/17</text>
                  <text x="319.1" y="242" text-anchor="middle">9/18</text>
                  <text x="380.3" y="242" text-anchor="middle">9/19</text>
                  <text x="441.4" y="242" text-anchor="middle">9/20</text>
                </svg>
                <div id="pageActions" class="page-actions">
                  <span class="chip-btn solid"><svg class="ic" aria-hidden="true"><use href="#i-down" /></svg>Export CSV</span>
                  <span id="shareBtn" class="chip-btn"><svg class="ic" aria-hidden="true"><use href="#i-link" /></svg>Share</span>
                  <div id="sharePop" class="share-pop is-off">
                    <p class="sp-label">
                      Share to
                    </p>
                    <div class="sp-team">
                      <span class="sp-hash">#</span><b>SEO team</b><span class="faces"><i class="face" style="--c:var(--clay)">L</i><i class="face" style="--c:var(--sage)">M</i><i class="face" style="--c:var(--accent)">J</i></span><em>6</em>
                    </div>
                    <div class="sp-opt">
                      <span class="sp-check"><svg class="ic"><use href="#i-check" /></svg></span>Include the conversation
                    </div>
                    <span id="spBtn" class="sp-btn"><span class="sp-go">Share</span><span class="sp-ok"><svg class="ic"><use href="#i-check" /></svg>Shared</span></span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <svg id="cursor" class="cursor" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 2.5v17l4.6-4.3 3 6.6 2.9-1.3-3-6.5H19z" fill="#221C16" stroke="#fff" stroke-width="1.6" stroke-linejoin="round" /></svg>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* demo window */
.frame-wrap { position: relative; z-index: 2; }
.demo {
  position: relative; overflow: hidden;
  background: var(--surface); border-radius: 18px;
  box-shadow: 0 0 0 1px rgb(61 49 36 / 9%), 0 30px 80px -30px rgb(61 49 36 / 28%), 0 12px 30px -18px rgb(61 49 36 / 14%);
}
.cam-scene { position: relative; transform-origin: 0 0; background: var(--surface); }
.cam-cut, .cam-cut * { transition: none !important; }
.demo-bar {
  display: flex; align-items: center; gap: 14px; height: 46px; padding: 0 12px 0 16px;
  background: var(--surface-2); border-bottom: 1px solid var(--line);
}
.lights { display: flex; gap: 6px; }
.lights i { width: 11px; height: 11px; border-radius: 50%; background: var(--ground-3); }
.lights i:nth-child(1) { background: #FF8A7A; }
.lights i:nth-child(2) { background: #FFD266; }
.lights i:nth-child(3) { background: #8FDB8C; }
.demo-title { font-size: 13px; font-weight: 600; color: var(--ink-2); }
.demo-body { position: relative; min-height: 580px; overflow: hidden; }

.demo-chat {
  --chat-px: 28px;
  display: flex; flex-direction: column; gap: 14px; width: 100%; min-height: 580px; padding: 24px var(--chat-px) 18px;
  background: var(--surface-2); transition: width .75s cubic-bezier(.2, .8, .2, 1);
}
.demo-body.is-split .demo-chat { width: 46%; }
.bubble {
  align-self: flex-end; max-width: min(92%, 380px);
  padding: 10px 16px; border-radius: 18px;
  background: var(--ground-2); color: var(--ink); font-size: 14.5px; line-height: 1.5;
  box-shadow: inset 0 0 0 1px oklch(0.820 0.010 72);
  transition: opacity .3s, transform .5s cubic-bezier(.2, .8, .2, 1);
}
.bubble.is-off { opacity: 0; transform: translateY(18px); }
.composer.is-typing .caret { display: inline-block; }
.steps { display: grid; gap: 9px; margin: 0; padding: 0; list-style: none; }
.steps li {
  display: flex; align-items: center; gap: 10px; font-size: 13.5px; line-height: 18px; color: var(--ink-2);
  transition: opacity .3s, transform .3s;
}
.steps li.is-off { opacity: 0; transform: translateY(5px); }
.steps li b { font: 500 13px var(--f-mono); color: var(--ink); }
.steps li em { margin-left: auto; font: 500 12px var(--f-mono); font-style: normal; color: var(--ink-3); font-variant-numeric: tabular-nums; white-space: nowrap; }
.st { display: grid; place-items: center; width: 18px; height: 18px; flex: none; border-radius: 50%; }
.st .ic { width: 11px; height: 11px; stroke-width: 3; opacity: 0; }
.steps li.is-run .st { border: 2px solid var(--ground-3); border-top-color: var(--primary); animation: spin .8s linear infinite; }
.steps li.is-done .st { background: color-mix(in srgb, var(--good) 15%, #fff); color: var(--good); }
.steps li.is-done .st .ic { opacity: 1; }
.answer { font-size: 15px; line-height: 1.65; font-weight: 400; color: var(--ink); }
.answer u { white-space: nowrap; }
.answer .w { transition: opacity .2s; }
.answer .w.is-off { opacity: 0; }
.answer u { text-decoration: none; }
.answer u { font-weight: 600; background: linear-gradient(transparent 62%, color-mix(in srgb, var(--wheat) 60%, transparent) 62%); }
.cite {
  display: inline; margin-left: 2px; padding: 1px 4px;
  border-radius: 5px; background: var(--ground-2); color: var(--accent);
  font: 600 10px/1 var(--f-mono); vertical-align: .3em;
}
.verified {
  display: inline-flex; align-items: center; gap: 8px; align-self: flex-start;
  padding: 7px 12px 7px 9px; border-radius: 999px;
  background: color-mix(in srgb, var(--good) 13%, #fff); color: var(--good-ink);
  font-size: 12.5px; font-weight: 600;
  transition: opacity .3s, transform .35s cubic-bezier(.3, 1.6, .5, 1);
}
.verified .ic { width: 14px; height: 14px; stroke-width: 2.6; }
.verified.is-off { opacity: 0; transform: scale(.85); }

.demo-chat { position: relative; }
.chat-log { position: relative; flex: 1; display: flex; flex-direction: column; gap: 16px; width: 100%; max-width: 660px; min-height: 0; margin-inline: auto; padding-bottom: 112px; }
.chat-empty {
  position: absolute; left: var(--chat-px); right: var(--chat-px); top: 0; bottom: calc(40% + 118px);
  display: grid; place-content: end center; justify-items: center; gap: 6px; text-align: center;
  font-size: 13.5px; color: var(--ink-3); transition: opacity .3s, visibility .3s;
}
.greet { display: flex; align-items: center; gap: 8px; font: 600 20px/1.3 var(--f-display); letter-spacing: -.02em; color: var(--ink); }
.greet .ic { width: 22px; height: 22px; color: var(--clay); stroke-width: 2.4; }
.chat-empty.is-off { opacity: 0; visibility: hidden; }
.agent-msg { display: flex; flex-direction: column; gap: 12px; transition: opacity .35s, transform .5s cubic-bezier(.2, .8, .2, 1); }
.agent-msg.is-off { opacity: 0; transform: translateY(10px); }
.agent-head { display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 600; }
.agent-head img, .ac-head img { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; background: var(--surface); box-shadow: 0 0 0 1px var(--line); }
.thinking { font-size: 12.5px; font-weight: 500; color: var(--ink-3); }
.skill-pill {
  display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 9px 0 7px; border-radius: 7px;
  background: color-mix(in oklch, var(--clay) 11%, var(--surface)); box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--clay) 26%, transparent);
  font: 500 12px var(--f-mono); color: var(--accent); white-space: nowrap;
}
.skill-pill .ic { width: 12px; height: 12px; color: var(--clay); }
.skill-pill em { font: 600 11.5px var(--f-body); font-style: normal; color: var(--ink-2); }
.steps li b .srv { color: var(--ink-3); font-weight: 500; }
.skill-pill:not([hidden]) { animation: pop .35s cubic-bezier(.3, 1.5, .5, 1) both; }
.steps li.is-done .st { animation: pop .3s cubic-bezier(.3, 1.5, .5, 1); }
.composer.is-keying .caret { animation: none; }
.thinking.is-live {
  color: transparent; -webkit-background-clip: text; background-clip: text;
  background-image: linear-gradient(90deg, var(--ink-3) 20%, var(--ink) 50%, var(--ink-3) 80%); background-size: 200% 100%;
  animation: shimmer 1.3s linear infinite;
}
.composer {
  position: absolute; left: 50%; width: min(660px, calc(100% - 2 * var(--chat-px))); translate: -50% 0; bottom: 18px;
  display: flex; flex-direction: column; gap: 6px; padding: 12px 10px 10px 14px; border-radius: 20px;
  background: var(--surface); box-shadow: inset 0 0 0 1px var(--border-soft), 0 1px 2px rgb(61 49 36 / 4%), 0 4px 8px rgb(61 49 36 / 5%);
  transition: bottom .65s cubic-bezier(.2, .8, .2, 1), box-shadow .25s;
}
.demo-chat.is-fresh .composer { bottom: 40%; }
.chat-chips {
  position: absolute; left: 50%; width: min(660px, calc(100% - 2 * var(--chat-px))); translate: -50% 0; bottom: calc(40% - 50px);
  display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; transition: opacity .3s, visibility .3s;
}
.chat-chips span {
  display: inline-flex; align-items: center; height: 30px; padding: 0 12px; border-radius: 999px;
  box-shadow: inset 0 0 0 1px var(--border-soft); font-size: 13px; color: var(--ink-2); white-space: nowrap;
}
.demo-chat:not(.is-fresh) .chat-chips { opacity: 0; visibility: hidden; }
.composer.is-typing { box-shadow: inset 0 0 0 1px var(--border), 0 1px 2px rgb(61 49 36 / 4%), 0 4px 8px rgb(61 49 36 / 5%); }
.composer-input { min-height: 2.9em; font-size: 14.5px; line-height: 1.45; color: var(--ink); }
.composer-input .ph { color: var(--ink-3); }
.composer-input .caret { color: var(--ink); }
.composer-row { display: flex; align-items: center; gap: 8px; }
.composer-plus { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 8px; color: var(--ink-2); }
.composer-plus .ic { width: 17px; height: 17px; }
.composer-model { margin-left: auto; font-size: 13px; font-weight: 500; color: var(--ink); white-space: nowrap; }
.composer-model span { margin-left: 5px; color: var(--ink-3); }
.composer-send {
  display: grid; place-items: center; width: 32px; height: 32px; flex: none; border-radius: 10px;
  background: var(--ground-2); color: var(--ink-3); transition: background-color .2s, color .2s, transform .12s;
}
.composer-send .ic { width: 16px; height: 16px; }
.composer-send.is-ready { background: var(--clay); color: #fff; }
.composer-send.is-pressed { transform: scale(.86); }
.cursor { position: absolute; z-index: 5; left: 0; top: 0; transform-origin: 5.8px 2.9px; width: 28px; height: 28px; opacity: 0; pointer-events: none; filter: drop-shadow(0 2px 3px rgba(23, 20, 46, .35)); transition: scale .1s; }
.cursor.is-down { scale: .82; }
.composer-send { position: relative; }
.composer-send::after {
  content: ""; position: absolute; inset: -4px; border-radius: 13px; pointer-events: none;
  border: 2px solid var(--clay); opacity: var(--ro, 0); transform: scale(var(--rs, 1));
}

.demo-page {
  position: absolute; top: 0; right: 0; bottom: 0; width: 54%;
  display: flex; flex-direction: column; padding: 24px;
  background: var(--surface); border-left: 1px solid var(--line);
  transform: translateX(100%); transition: transform .75s cubic-bezier(.2, .8, .2, 1);
}
.demo-body.is-split .demo-page { transform: none; }
.demo-page::after {
  content: ""; position: absolute; inset: 10px; border-radius: 14px; pointer-events: none; opacity: 0; transition: opacity .5s;
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--clay) 45%, transparent), 0 0 30px color-mix(in srgb, var(--clay) 18%, transparent);
}
.demo-page.is-landing::after { opacity: 1; }
.page-stack { display: grid; flex: 1; }
.page-stack > * { grid-area: 1 / 1; transition: opacity .35s ease, visibility .35s; }
.demo-page:not([data-phase="skel"]) .page-skel,
.demo-page:not([data-phase="real"]) .page-real { opacity: 0; visibility: hidden; }
.skel-label { display: flex; align-items: center; gap: 8px; font: 500 12px var(--f-mono); color: var(--ink-3); }
.skel-spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--ground-3); border-top-color: var(--clay); animation: spin .8s linear infinite; }
.page-skel { display: flex; flex-direction: column; gap: 12px; }
.sk { border-radius: 10px; background: linear-gradient(90deg, var(--ground-2) 0%, var(--surface-2) 50%, var(--ground-2) 100%) 0 0 / 200% 100%; animation: shimmer 1.3s linear infinite; }
@keyframes shimmer { to { background-position: -200% 0; } }
.page-real { display: flex; flex-direction: column; gap: 14px; }
.page-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.page-head h3 { margin-top: 7px; font: 700 21px/1.15 var(--f-display); letter-spacing: -.02em; }
.page-sub { margin-top: 4px; font-size: 13px; color: var(--ink-3); }
.kpis { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.kpi { padding: 12px 14px; border-radius: 12px; background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--line); }
.kpi b { display: block; font: 700 23px/1.1 var(--f-display); letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
.kpi span { font-size: 12.5px; color: var(--ink-3); }
.kpi .up { color: var(--good-ink); }
.chart { width: 100%; height: auto; display: block; overflow: visible; }
.chart .grid line { stroke: var(--line); }
.chart text { font-family: var(--f-mono); font-size: 12px; fill: var(--ink-3); }
.chart .bar { transform-box: view-box; transform-origin: 0 220px; transform: scaleY(var(--g, 1)); }
.chart .old { fill: var(--bar-old); }
.chart .new { fill: var(--ink-2); }
.chart .lead { fill: var(--clay); }
.page-actions { position: relative; display: flex; gap: 8px; margin-top: auto; transition: opacity .3s; }
.page-actions.is-off { opacity: 0; }
#shareBtn { transition: background-color .2s, transform .12s; }
#shareBtn.is-open { background: var(--ground-2); }
#shareBtn.is-pressed, .sp-btn.is-pressed { transform: scale(.94); }
.share-pop {
  position: absolute; z-index: 3; left: 0; bottom: calc(100% + 10px); width: 272px;
  display: grid; gap: 11px; padding: 14px; border-radius: 14px;
  background: #fff; box-shadow: 0 0 0 1px var(--line), var(--shadow-md);
  transform-origin: 40% 100%; transition: opacity .2s, transform .35s cubic-bezier(.3, 1.4, .5, 1);
}
.share-pop.is-off { opacity: 0; transform: translateY(6px) scale(.96); }
.sp-label { font: 600 10.5px/1 var(--f-mono); letter-spacing: .09em; text-transform: uppercase; color: var(--ink-3); }
.sp-team {
  display: flex; align-items: center; gap: 7px; height: 38px; padding: 0 10px; border-radius: 10px;
  background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--line-2); font-size: 13px;
}
.sp-hash { font-weight: 600; color: var(--ink-3); }
.sp-team b { font-weight: 600; }
.sp-team .faces { margin-left: auto; }
.sp-team .face { width: 20px; height: 20px; font-size: 9.5px; box-shadow: 0 0 0 2px var(--surface-2); }
.sp-team em { font: 500 11.5px var(--f-mono); font-style: normal; color: var(--ink-3); }
.sp-opt { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink-2); }
.sp-check { display: grid; place-items: center; width: 16px; height: 16px; border-radius: 5px; background: var(--clay); color: #fff; }
.sp-check .ic { width: 11px; height: 11px; stroke-width: 3; }
.sp-btn {
  justify-self: end; display: inline-grid; place-items: center; height: 30px; padding: 0 14px; border-radius: 9px;
  background: var(--ink); color: #fff; font-size: 12px; font-weight: 600; transition: background-color .25s, transform .12s;
}
.sp-btn > * { grid-area: 1 / 1; display: inline-flex; align-items: center; gap: 5px; transition: opacity .2s; }
.sp-btn .ic { width: 12px; height: 12px; stroke-width: 3; }
.sp-btn .sp-ok, .sp-btn.is-done .sp-go { opacity: 0; }
.sp-btn.is-done { background: var(--good); }
.sp-btn.is-done .sp-ok { opacity: 1; }
@keyframes spin { to { transform: rotate(360deg); } }
.js-motion .demo { animation: lift 1.3s cubic-bezier(.2, .75, .2, 1) .3s both; }
@keyframes lift { from { opacity: 0; transform: translateY(40px); } }
@keyframes pop { from { opacity: 0; scale: .7; } }
@media (max-width: 760px) {
  .demo-body.is-split .demo-chat { width: 100%; }
  .demo-chat { --chat-px: 20px; }
  .demo-page {
    inset: auto 0 0; width: 100%; height: 86%; overflow: hidden;
    border-left: 0; border-radius: 16px 16px 0 0; box-shadow: 0 -14px 30px -18px rgb(61 49 36 / 40%);
    transform: translateY(101%);
  }
  .demo-body.is-split .demo-page { transform: none; }
  .demo-body.is-split .demo-page.is-peek { transform: translateY(calc(100% - 120px)); }
  .page-head { flex-direction: column; gap: 8px; }
  .chart text { font-size: 18px; }
}
</style>
