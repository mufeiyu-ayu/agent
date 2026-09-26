<script setup lang="ts">
import logoUrl from '@/assets/logo.webp'
</script>

<template>
  <nav id="nav" class="nav" aria-label="Main">
    <div class="wrap nav-inner">
      <a class="brand" href="#top" aria-label="Agent home"><img :src="logoUrl" alt="">Agent</a>
      <div class="nav-links">
        <a href="#product">Product</a>
        <a href="#share">Teams</a>
        <a href="#security">Security</a>
        <a href="#know">Knowledge</a>
      </div>
      <RouterLink class="btn btn-primary" to="/workspace">
        Start asking
      </RouterLink>
    </div>
  </nav>
</template>

<style scoped>
.nav {
  position: fixed; inset: 0 0 auto; z-index: 60;
  padding-top: env(safe-area-inset-top, 0px);
  transition: background-color .3s, box-shadow .3s, translate .45s cubic-bezier(.2, .7, .2, 1);
}
.nav.is-scrolled {
  background: color-mix(in srgb, var(--ground) 82%, transparent);
  -webkit-backdrop-filter: saturate(1.5) blur(16px);
  backdrop-filter: saturate(1.5) blur(16px);
  box-shadow: 0 1px 0 var(--line);
}
.nav-inner { display: flex; align-items: center; gap: clamp(16px, 3vw, 40px); height: 72px; }
.nav-links { display: flex; gap: 30px; margin-left: auto; font-size: 15px; font-weight: 500; }
.nav-links a { text-decoration: none; color: var(--ink-2); transition: color .2s; }
.nav-links a:hover { color: var(--ink); }
.nav .btn { height: 42px; padding: 0 18px; font-size: 14.5px; }
.nav.is-hidden { translate: 0 -110%; }
.nav:focus-within { translate: 0 0; }
@media (max-width: 760px) {
  .nav-links { display: none; }
  .nav .btn { margin-left: auto; }
}
</style>
