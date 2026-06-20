<script setup lang="ts">
import { gsap } from 'gsap'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps<{
  messages: readonly string[]
  visible: boolean
}>()

const promptLayerRef = ref<HTMLElement | null>(null)
const promptPhraseRef = ref<HTMLElement | null>(null)
const promptTextRef = ref<HTMLElement | null>(null)
const promptCursorRef = ref<HTMLElement | null>(null)
const displayedText = ref('')

let motionContext: ReturnType<typeof gsap.context> | undefined
let promptTimeline: gsap.core.Timeline | undefined
let reducedMotionQuery: MediaQueryList | undefined

const promptMessages = computed(() => {
  return props.messages
    .map(message => message.trim())
    .filter(Boolean)
})

watch(
  () => props.visible,
  (visible) => {
    syncTimelinePlayback()

    const layer = promptLayerRef.value
    if (!layer || reducedMotionQuery?.matches)
      return

    gsap.to(layer, {
      autoAlpha: visible ? 1 : 0,
      duration: visible ? 0.22 : 0.14,
      ease: 'power2.out',
      overwrite: 'auto',
      y: visible ? 0 : -2,
    })
  },
)

watch(promptMessages, () => {
  restartMotion()
})

onMounted(() => {
  reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
  reducedMotionQuery.addEventListener('change', restartMotion)
  document.addEventListener('visibilitychange', syncTimelinePlayback)
  restartMotion()
})

onUnmounted(() => {
  reducedMotionQuery?.removeEventListener('change', restartMotion)
  document.removeEventListener('visibilitychange', syncTimelinePlayback)
  stopMotion()
})

function restartMotion(): void {
  stopMotion()

  const messages = promptMessages.value
  const fallback = messages[0] ?? ''

  if (!fallback) {
    displayedText.value = ''
    return
  }

  if (reducedMotionQuery?.matches) {
    displayedText.value = fallback
    return
  }

  const layer = promptLayerRef.value
  const phrase = promptPhraseRef.value
  const text = promptTextRef.value

  if (!layer || !phrase || !text) {
    displayedText.value = fallback
    return
  }

  motionContext = gsap.context(() => {
    displayedText.value = ''

    gsap.set(layer, {
      autoAlpha: props.visible ? 1 : 0,
      y: props.visible ? 0 : -2,
    })

    if (promptCursorRef.value) {
      gsap.to(promptCursorRef.value, {
        autoAlpha: 0.24,
        duration: 0.58,
        ease: 'sine.inOut',
        repeat: -1,
        yoyo: true,
      })
    }

    gsap.set(phrase, { autoAlpha: 1, y: 0 })
    gsap.set(phrase, { '--prompt-reveal': '0%' })

    const timeline = gsap.timeline({
      defaults: { ease: 'power2.inOut' },
      paused: !shouldPlayMotion(),
      repeat: -1,
    })

    messages.forEach((message, index) => {
      appendPromptSequence(timeline, phrase, message, index)
    })

    promptTimeline = timeline
  }, layer)
}

function stopMotion(): void {
  motionContext?.revert()
  motionContext = undefined
  promptTimeline = undefined
}

function syncTimelinePlayback(): void {
  promptTimeline?.paused(!shouldPlayMotion())
}

function shouldPlayMotion(): boolean {
  if (typeof document === 'undefined')
    return props.visible

  return props.visible && document.visibilityState !== 'hidden'
}

function appendPromptSequence(
  timeline: gsap.core.Timeline,
  phrase: HTMLElement,
  message: string,
  index: number,
): void {
  const characters = Array.from(message)
  // 用一个 proxy 对象承载“已显示字数”，由单条 tween 连续驱动，
  // 避免逐字符的 .call() + 空 .to() 把节奏量化到帧边界导致卡顿。
  const typeState = { value: 0 }
  let renderedCount = -1

  const renderTyping = (): void => {
    const count = Math.min(characters.length, Math.round(typeState.value))

    // 仅在字数真正变化时写入，减少无意义的响应式更新。
    if (count === renderedCount)
      return

    renderedCount = count
    displayedText.value = characters.slice(0, count).join('')
  }

  timeline
    .call(() => {
      renderedCount = -1
      displayedText.value = ''
      gsap.set(phrase, { autoAlpha: 1, y: 0 })
    })
    .to({}, { duration: 0.34 })
    .fromTo(
      typeState,
      { value: 0 },
      {
        value: characters.length,
        duration: getTypeDuration(characters.length),
        ease: 'none',
        immediateRender: false,
        onUpdate: renderTyping,
        onComplete: renderTyping,
      },
    )
    .to({}, { duration: index === 0 ? 5.4 : 4.85 })
    .to(
      phrase,
      {
        autoAlpha: 0,
        duration: 0.38,
        ease: 'power2.inOut',
        y: -1,
      },
    )
    .to({}, { duration: 0.82 })
}

function getTypeDuration(length: number): number {
  if (length <= 0)
    return 0

  // 均匀连续的打字节奏：单条文案约 0.9s–2.2s 打完，
  // 比逐字符离散延时更顺滑，也保留“逐字出现”的手感。
  return gsap.utils.clamp(0.9, 2.2, length * 0.05)
}
</script>

<template>
  <div
    ref="promptLayerRef"
    class="seo-home-animated-placeholder pointer-events-none absolute inset-x-1 top-1 z-0 flex min-h-[54px] min-w-0 items-start px-0 text-left transition-opacity duration-150 min-[1800px]:min-h-[60px]"
    :class="visible ? 'opacity-100' : 'opacity-0'"
    aria-hidden="true"
  >
    <span
      ref="promptPhraseRef"
      class="seo-home-prompt-phrase relative z-10 min-w-0 max-w-full text-base font-medium leading-7 text-[#d9cec0] min-[1800px]:text-lg"
    >
      <span ref="promptTextRef" class="seo-home-prompt-text">
        {{ displayedText }}
      </span>
      <span
        ref="promptCursorRef"
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
    display: none;
  }
}
</style>
