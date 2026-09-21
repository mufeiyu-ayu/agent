import { onUnmounted, ref } from 'vue'

/** 回复和代码共用复制失败语义、局域网 HTTP 回退及短暂反馈。 */
export function useCopyFeedback() {
  const copied = ref(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  async function copy(text: string) {
    clearTimeout(timer)
    copied.value = false
    if (!text)
      return
    try {
      await writeClipboardText(text)
      if (disposed)
        return
      copied.value = true
      timer = setTimeout(() => {
        copied.value = false
      }, 1600)
    }
    catch {
      copied.value = false
    }
  }

  onUnmounted(() => {
    disposed = true
    clearTimeout(timer)
  })
  return { copied, copy }
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text)
    return
  }
  const focused = document.activeElement
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.inset = '-9999px'
  document.body.append(textarea)
  try {
    textarea.select()
    if (!document.execCommand('copy'))
      throw new Error('Copy failed')
  }
  finally {
    textarea.remove()
    if (focused instanceof HTMLElement)
      focused.focus({ preventScroll: true })
  }
}
