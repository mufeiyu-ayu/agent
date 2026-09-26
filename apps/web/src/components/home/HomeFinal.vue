<template>
  <section id="start" class="final">
    <div class="wrap">
      <div class="final-card">
        <div class="glow" aria-hidden="true" />
        <div class="final-copy">
          <h2 class="h2" data-reveal>
            Your data already knows. <span class="line2">Now your team can ask.</span>
          </h2>
          <p class="body" data-reveal style="--i:1">
            Connect a source, invite your team, and share your first report.
          </p>
          <div class="cta-row" data-reveal style="--i:2">
            <RouterLink class="btn btn-primary" to="/workspace">
              Start asking <svg class="ic ic-go" aria-hidden="true"><use href="#i-go" /></svg>
            </RouterLink>
            <a class="btn btn-ghost" href="#">Book a demo</a>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.final { padding-block: clamp(64px, 9vw, 120px); }
.final-card { position: relative; overflow: hidden; min-height: 440px; display: flex; align-items: center; border-radius: 36px; background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--line); }
.final-card > .glow { right: -12%; top: -30%; width: 72%; height: 160%; opacity: .8; }
.final-card::after {
  content: ""; position: absolute; inset: 0; pointer-events: none;
  background: radial-gradient(circle, color-mix(in srgb, var(--ink) 14%, transparent) 1px, transparent 1.6px) 0 0 / 24px 24px;
  -webkit-mask-image: radial-gradient(ellipse 55% 80% at 72% 50%, #000 15%, transparent 75%);
  mask-image: radial-gradient(ellipse 55% 80% at 72% 50%, #000 15%, transparent 75%);
}
.final-copy { position: relative; z-index: 1; max-width: 820px; padding: clamp(32px, 6vw, 80px); }
.final-copy .h2 { font-size: clamp(32px, 3.9vw, 54px); }
.final-copy .h2 .line2 { display: block; color: var(--ink-3); }
.final-copy .body { margin-top: 20px; }
.js-motion .final-card { scale: calc(.94 + .06 * var(--p, 1)); transition: scale .15s linear; }
@media (max-width: 760px) {
  .final-card > .glow { right: -30%; top: 45%; width: 130%; height: 90%; }
  .final-card { align-items: flex-start; min-height: 520px; }
}
</style>
