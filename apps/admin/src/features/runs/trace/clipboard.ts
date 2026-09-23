/**
 * 写剪贴板。`navigator.clipboard` 只在安全上下文里存在，局域网 IP 走 HTTP 打开管理台时没有它，
 * 退回隐藏 textarea + `execCommand('copy')`（与前台 `useCopyFeedback` 同一做法）。
 */
export async function writeClipboardText(text: string): Promise<void> {
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
