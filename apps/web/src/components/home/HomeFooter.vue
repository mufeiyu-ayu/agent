<script setup lang="ts">
import logoUrl from '@/assets/logo.webp'
</script>

<template>
  <footer class="foot">
    <div class="wrap foot-grid">
      <div>
        <a class="brand" href="#top" aria-label="Agent home"><img :src="logoUrl" alt="">Agent</a>
        <p class="tag">
          The AI analyst your whole team shares.
        </p>
      </div>
      <div>
        <h4>Product</h4>
        <ul><li><a href="#top">Tour</a></li><li><a href="#share">Teams</a></li><li><a href="#security">Security</a></li><li><a href="#know">Knowledge</a></li></ul>
      </div>
      <div>
        <h4>Company</h4>
        <ul><li><a href="#">Docs</a></li><li><a href="#">Changelog</a></li><li><a href="#">Contact</a></li></ul>
      </div>
      <p class="small">
        © 2026 Agent<br>Built for teams that run on data.
      </p>
    </div>
  </footer>
</template>

<style scoped>
/* footer */
.foot { padding-block: 48px 56px; border-top: 1px solid var(--line); }
.foot-grid { display: grid; grid-template-columns: 1.4fr repeat(2, 1fr) 1.2fr; gap: 32px; align-items: start; }
.foot .tag { margin-top: 12px; font-size: 15px; color: var(--ink-2); }
.foot h4 { margin: 0 0 12px; font: 600 11.5px var(--f-mono); letter-spacing: .08em; text-transform: uppercase; color: var(--ink-3); }
.foot ul { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; font-size: 15px; }
.foot ul a { text-decoration: none; color: var(--ink-2); }
.foot ul a:hover { color: var(--ink); }
.foot .small { font-size: 13.5px; color: var(--ink-3); justify-self: end; text-align: right; }
@media (max-width: 1080px) {
  .foot-grid { grid-template-columns: 1fr 1fr; }
  .foot .small { justify-self: start; text-align: left; }
}
@media (max-width: 520px) {
  .foot-grid { grid-template-columns: 1fr; }
}
</style>
