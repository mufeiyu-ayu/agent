<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{
  messages: readonly string[]
  visible: boolean
}>()

const displayedText = ref('')

let reducedMotionQuery: MediaQueryList | undefined
let promptTimer: number | undefined
let activeRunId = 0
let messageIndex = 0

const promptMessages = computed(() => {
  return props.messages
    .map(message => message.trim())
    .filter(Boolean)
})

watch(
  () => props.visible,
  () => restartPromptLoop(),
)

watch(promptMessages, () => {
  restartPromptLoop()
})

onMounted(() => {
  reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  reducedMotionQuery.addEventListener('change', restartPromptLoop)
  document.addEventListener('visibilitychange', restartPromptLoop)
  restartPromptLoop()
})

onUnmounted(() => {
  reducedMotionQuery?.removeEventListener('change', restartPromptLoop)
  document.removeEventListener('visibilitychange', restartPromptLoop)
  stopPromptLoop()
})

function restartPromptLoop(): void {
  stopPromptLoop()

  const messages = promptMessages.value
  const fallback = messages[0] ?? ''

  if (!fallback) {
    displayedText.value = ''
    return
  }

  if (!shouldPlayMotion()) {
    displayedText.value = fallback
    return
  }

  runPromptMessage(activeRunId)
}

function stopPromptLoop(): void {
  activeRunId += 1

  if (promptTimer !== undefined) {
    window.clearTimeout(promptTimer)
    promptTimer = undefined
  }
}

function shouldPlayMotion(): boolean {
  if (typeof document === 'undefined')
    return props.visible && !reducedMotionQuery?.matches

  return props.visible && document.visibilityState !== 'hidden' && !reducedMotionQuery?.matches
}

function runPromptMessage(runId: number): void {
  const messages = promptMessages.value
  const message = messages[messageIndex % messages.length]

  if (!message || runId !== activeRunId || !shouldPlayMotion())
    return

  const characters = Array.from(message)
  const typeInterval = getTypeDuration(characters.length) / Math.max(characters.length, 1)
  let visibleCount = 0

  displayedText.value = ''

  function typeNextCharacter(): void {
    if (runId !== activeRunId || !shouldPlayMotion())
      return

    visibleCount += 1
    displayedText.value = characters.slice(0, visibleCount).join('')

    if (visibleCount < characters.length) {
      schedulePromptStep(runId, typeNextCharacter, typeInterval)
      return
    }

    const holdDuration = messageIndex === 0 ? 5400 : 4850

    schedulePromptStep(runId, () => {
      messageIndex = (messageIndex + 1) % messages.length
      runPromptMessage(runId)
    }, holdDuration)
  }

  schedulePromptStep(runId, typeNextCharacter, 340)
}

function schedulePromptStep(runId: number, callback: () => void, delay: number): void {
  promptTimer = window.setTimeout(() => {
    promptTimer = undefined

    if (runId === activeRunId)
      callback()
  }, delay)
}

function getTypeDuration(length: number): number {
  if (length <= 0)
    return 0

  return clampNumber(length * 50, 900, 2200)
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
</script>

<template>
  <div
    class="seo-home-animated-placeholder pointer-events-none absolute inset-x-1 top-1 z-0 flex min-h-[54px] min-w-0 items-start px-0 text-left transition-opacity duration-150 min-[1800px]:min-h-[60px]"
    :class="visible ? 'opacity-100' : 'opacity-0'"
    aria-hidden="true"
  >
    <span
      class="seo-home-prompt-phrase relative z-10 min-w-0 max-w-full text-base font-medium leading-7 text-[#d9cec0] min-[1800px]:text-lg"
    >
      <span class="seo-home-prompt-text">
        {{ displayedText }}
      </span>
      <span
        class="seo-home-prompt-cursor h-[1.18em] w-px rounded-full bg-[#efdfc9] shadow-[0_0_16px_rgb(239_223_201/55%)]"
      />
    </span>
  </div>
</template>

<style scoped>
.seo-home-prompt-phrase {
  display: inline-flex;
  align-items: flex-start;
  overflow: hidden;
  white-space: nowrap;
}

.seo-home-prompt-text {
  display: block;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.seo-home-prompt-cursor {
  flex: 0 0 auto;
  margin-left: 4px;
  margin-top: 5px;
  animation: seo-home-prompt-cursor-blink 1.16s ease-in-out infinite;
  will-change: opacity;
}

@media (min-width: 1800px) {
  .seo-home-prompt-cursor {
    margin-top: 6px;
  }
}

@media (prefers-reduced-motion: reduce) {
  .seo-home-animated-placeholder {
    transition-duration: 0ms;
  }

  .seo-home-prompt-cursor {
    animation: none;
    opacity: 0.42;
  }
}

@keyframes seo-home-prompt-cursor-blink {
  0%,
  100% {
    opacity: 1;
  }

  50% {
    opacity: 0.24;
  }
}
</style>
