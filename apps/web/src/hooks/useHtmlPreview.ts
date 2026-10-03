import type { InjectionKey, Ref } from 'vue'
import { nextTick, provide, ref, shallowRef, watch } from 'vue'

import { isPreviewableHtml } from '@/utils/html-preview'

interface HtmlPreviewContext {
  isOpen: Ref<boolean>
  source: Ref<(() => string) | undefined>
  open: (source: () => string, trigger: HTMLElement) => void
  close: () => void
  release: (source: () => string) => void
}

export const HTML_PREVIEW: InjectionKey<HtmlPreviewContext | undefined> = Symbol('html-preview')

/** 工作区持有选择与打开状态，深层代码卡片只请求打开，不创建自己的预览。 */
export function useHtmlPreview(conversationId: Ref<string | null>) {
  const isOpen = ref(false)
  const source = shallowRef<() => string>()
  const layout = ref([50, 50])
  let trigger: HTMLElement | undefined

  function open(code: () => string, element: HTMLElement) {
    source.value = code
    trigger = element
    isOpen.value = true
  }

  async function close() {
    isOpen.value = false
    await nextTick()
    if (trigger?.isConnected)
      trigger.focus({ preventScroll: true })
  }

  function release(code: () => string) {
    if (source.value === code) {
      isOpen.value = false
      source.value = undefined
      trigger = undefined
    }
  }

  watch(conversationId, () => {
    isOpen.value = false
    source.value = undefined
    trigger = undefined
  }, { flush: 'sync' })

  watch(() => source.value?.(), (code) => {
    if (code !== undefined && !isPreviewableHtml(code, 'html')) {
      isOpen.value = false
      source.value = undefined
    }
  }, { flush: 'sync' })

  function rememberLayout(sizes: number[]) {
    if (sizes.length === 2)
      layout.value = sizes
  }

  const preview = { isOpen, source, open, close, release }
  provide(HTML_PREVIEW, preview)
  return { ...preview, layout, rememberLayout }
}
