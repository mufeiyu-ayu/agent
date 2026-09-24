import type { Ref } from 'vue'

import { onBeforeUnmount, ref, watch } from 'vue'

/** 逐字间隔带小幅波动，保留手打感又不忽快忽慢。 */
const TYPE_BASE_MS = 65
const TYPE_JITTER_MS = 15
const PUNCTUATION_PAUSE_MS = 140
const HOLD_MS = 2200
const DELETE_MS = 24
const EMPTY_PAUSE_MS = 380

const PUNCTUATION = /[，。、,.;；:：]/

/**
 * 空态输入框的打字机提示：逐字打出一句、停留、退格，再换下一句。
 * `active` 为 false（用户已输入）时停止计时；减少动效时只静态显示第一句。
 */
export function useTypewriterPlaceholder(phrases: Ref<string[]>, active: Ref<boolean>) {
  const text = ref('')
  /** 正在打字或退格；光标此时常亮，停下来才闪烁。 */
  const isTyping = ref(false)

  let timer: ReturnType<typeof setTimeout> | undefined
  let phraseIndex = 0

  function stop() {
    clearTimeout(timer)
    timer = undefined
    isTyping.value = false
  }

  function schedule(delay: number, step: () => void) {
    timer = setTimeout(step, delay)
  }

  function typeNext(chars: string[], length: number) {
    isTyping.value = true
    text.value = chars.slice(0, length).join('')

    if (length >= chars.length) {
      isTyping.value = false
      schedule(HOLD_MS, () => deleteNext(chars, chars.length - 1))
      return
    }

    const pause = PUNCTUATION.test(chars[length - 1] ?? '') ? PUNCTUATION_PAUSE_MS : 0
    schedule(TYPE_BASE_MS + Math.random() * TYPE_JITTER_MS + pause, () => typeNext(chars, length + 1))
  }

  function deleteNext(chars: string[], length: number) {
    isTyping.value = true
    text.value = chars.slice(0, length).join('')

    if (length <= 0) {
      isTyping.value = false
      phraseIndex = (phraseIndex + 1) % phrases.value.length
      schedule(EMPTY_PAUSE_MS, startPhrase)
      return
    }

    schedule(DELETE_MS, () => deleteNext(chars, length - 1))
  }

  function startPhrase() {
    // Array.from 按码点切分，不会把代理对拆成半个字。
    typeNext(Array.from(phrases.value[phraseIndex] ?? ''), 1)
  }

  function restart() {
    stop()
    text.value = ''

    if (!active.value || phrases.value.length === 0)
      return

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      text.value = phrases.value[0]
      return
    }

    phraseIndex %= phrases.value.length
    schedule(EMPTY_PAUSE_MS, startPhrase)
  }

  watch([active, phrases], restart, { immediate: true })
  onBeforeUnmount(stop)

  return { text, isTyping }
}
