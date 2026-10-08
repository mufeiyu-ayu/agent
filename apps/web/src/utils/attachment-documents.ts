import { attachmentPreviewMode } from './attachments'

export { formatSheetCell, PREVIEW_COLUMN_LIMIT, PREVIEW_ROW_LIMIT } from './attachment-sheet-cells'

/** 一张要渲染的表：CSV 是一张，xlsx 每个工作表一张。第一行当表头。 */
export interface PreviewTable {
  name: string
  rows: string[][]
}

// 解析库只在真的要看 docx 时才下载，不进首屏；xlsx 的那份打在 worker 自己的包里。
const loadDocxRenderer = () => import('docx-preview')

/**
 * 鼠标移到 Word 文件上就先把解析库拉下来，点开时少等一段。
 * xlsx 不预拉：主线程拉到的是另一份产物，worker 用不上。
 */
export function warmAttachmentPreview(name: string) {
  // 拉取失败不用管：真正打开时会再试一次并显示失败。
  if (attachmentPreviewMode(name) === 'docx')
    loadDocxRenderer().catch(() => {})
}

/** 全部工作表在独立线程里读取；切换/关闭预览会终止旧线程，超时同样终止。 */
export async function readSheets(file: Blob, signal?: AbortSignal): Promise<PreviewTable[]> {
  signal?.throwIfAborted()
  const worker = new Worker(new URL('./attachment-sheets.worker.ts', import.meta.url), { type: 'module' })
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => finish(() => reject(new Error('spreadsheet preview timed out'))), 30_000)
    const abort = () => finish(() => reject(signal?.reason ?? new Error('spreadsheet preview aborted')))
    function finish(settle: () => void) {
      window.clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      worker.terminate()
      settle()
    }
    worker.onmessage = (event: MessageEvent<{ tables?: PreviewTable[], failed?: boolean }>) => {
      finish(() => event.data.tables ? resolve(event.data.tables) : reject(new Error('spreadsheet preview failed')))
    }
    worker.onerror = () => finish(() => reject(new Error('spreadsheet preview worker failed')))
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted)
      abort()
    else
      worker.postMessage(file)
  })
}

const SAFE_LINK = /^(?:https?:|mailto:)/i

/**
 * 在脱离页面的容器里渲染并清洗 DOCX，再交给禁脚本、禁网的 iframe。
 * 不可信样式不能插入应用页面；每次调用独立渲染，迟到结果由面板按附件身份丢弃。
 * 不渲染内嵌 HTML，链接只留 http / https / mailto 并在新标签打开。
 */
export async function renderDocx(file: Blob): Promise<string> {
  const { renderAsync } = await loadDocxRenderer()
  const host = document.createElement('div')
  await renderAsync(file, host, undefined, {
    // 面板宽度不固定：不按纸张宽高排版、不分页，内容随面板自适应。
    inWrapper: false,
    ignoreWidth: true,
    ignoreHeight: true,
    breakPages: false,
    renderAltChunks: false,
    // iframe 没有父页 origin；内嵌资源直接用 data URL，也不留下父页的 blob 注册项。
    useBase64URL: true,
  })

  host.querySelectorAll('iframe, script, object, embed').forEach(element => element.remove())
  host.querySelectorAll('a[href]').forEach((link) => {
    const href = link.getAttribute('href') ?? ''
    if (SAFE_LINK.test(href)) {
      link.setAttribute('target', '_blank')
      link.setAttribute('rel', 'noopener noreferrer')
    }
    else if (!href.startsWith('#')) {
      link.removeAttribute('href')
    }
  })

  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data: blob:; base-uri 'none'; form-action 'none'">
<style>html,body{margin:0;background:white;color:#1f1f1f}section.docx{padding:24px 28px!important}img{max-width:100%;height:auto}table{max-width:100%}</style>
</head><body>${host.innerHTML}</body></html>`
}
