<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <div class="flex flex-1 items-center justify-center py-28" role="status" :aria-label="t('skills.loadingDefinition')">
    <div class="loader" aria-hidden="true">
      <span class="letter l">L</span>
      <span class="letter o">O</span>
      <span class="letter a">A</span>
      <span class="letter d">D</span>
      <span class="letter ispan i">I</span>
      <span class="letter n">N</span>
      <span class="letter g">G</span>
    </div>
  </div>
</template>

<style scoped>
.loader {
  --ANIMATION-DELAY-MULTIPLIER: 70ms;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: row;
  justify-content: center;
  align-items: center;
  height: 4.5rem;
  overflow: hidden;
  user-select: none;
}

.loader .letter {
  display: inline-block;
  width: fit-content;
  height: 4.5rem;
  line-height: 4.5rem;
  font-family: "Arial Black", Impact, Gadget, system-ui, -apple-system, sans-serif;
  font-size: 3rem;
  font-weight: 900;
  color: #fda4af;
  -webkit-text-stroke: 2px var(--agent-ink);
  text-shadow:
    1px 1px 0 var(--agent-ink),
    2px 2px 0 var(--agent-ink),
    3px 3px 0 var(--agent-ink),
    4px 4px 0 var(--agent-ink),
    5px 5px 0 var(--agent-ink),
    6px 6px 0 var(--agent-ink);
  letter-spacing: -0.01em;
  margin-inline: 1px;
  transform: translateY(5rem);
  animation: hideAndSeek 1s alternate infinite cubic-bezier(0.86, 0, 0.07, 1);
}

.loader .letter:last-child {
  letter-spacing: 0;
}

.loader .i {
  margin-inline: 4px;
}

.loader .l {
  animation-delay: calc(var(--ANIMATION-DELAY-MULTIPLIER) * 0);
}

.loader .o {
  animation-delay: calc(var(--ANIMATION-DELAY-MULTIPLIER) * 1);
}

.loader .a {
  animation-delay: calc(var(--ANIMATION-DELAY-MULTIPLIER) * 2);
}

.loader .d {
  animation-delay: calc(var(--ANIMATION-DELAY-MULTIPLIER) * 3);
}

.loader .ispan {
  animation-delay: calc(var(--ANIMATION-DELAY-MULTIPLIER) * 4);
}

.loader .n {
  animation-delay: calc(var(--ANIMATION-DELAY-MULTIPLIER) * 5);
}

.loader .g {
  animation-delay: calc(var(--ANIMATION-DELAY-MULTIPLIER) * 6);
}

@keyframes hideAndSeek {
  0% {
    transform: translateY(5rem);
  }

  100% {
    transform: translateY(0rem);
  }
}

@media (prefers-reduced-motion: reduce) {
  .loader .letter {
    animation: none !important;
    transform: translateY(0) !important;
  }
}
</style>
