<script setup lang="ts">
import { ref, toRef } from 'vue'

import { useTypewriterPlaceholder } from '@/hooks/useTypewriterPlaceholder'

/** 空态输入框的打字机提示；独立成组件，逐字更新只重渲染这一小块。 */
const props = defineProps<{
  phrases: string[]
  /** 输入框聚焦时它自带光标，隐藏假光标以免出现两个。 */
  hideCaret: boolean
}>()

// 只在需要时挂载，挂载期间一直播放。
const { text, isTyping } = useTypewriterPlaceholder(toRef(props, 'phrases'), ref(true))
</script>

<template>
  <p
    aria-hidden="true"
    class="pointer-events-none absolute inset-x-1.5 top-1.5 select-none text-base leading-6 text-agent-ink-muted"
  >
    {{ text }}<span
      v-if="!hideCaret"
      class="typewriter-caret"
      :class="{ 'typewriter-caret--idle': !isTyping }"
    />
  </p>
</template>

<style scoped>
.typewriter-caret {
  display: inline-block;
  width: 1.5px;
  height: 1.1em;
  margin-left: 1px;
  vertical-align: -0.15em;
  border-radius: 1px;
  background: var(--color-agent-accent);
  opacity: 0.75;
}

.typewriter-caret--idle {
  animation: typewriter-caret-blink 1.06s step-end infinite;
}

@keyframes typewriter-caret-blink {
  50% {
    opacity: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .typewriter-caret {
    display: none;
  }
}
</style>
