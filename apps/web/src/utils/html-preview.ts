/** 这里只判断预览入口：片段与其他语言留在代码卡片，执行隔离另由 iframe / CSP 保证。 */
export function isPreviewableHtml(code: string, language?: string): boolean {
  return language?.trim().toLowerCase() === 'html'
    && /^\s*(?:<!--[\s\S]*?-->\s*)*(?:<!doctype\s+html\b[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<html(?:\s|>)/i.test(code)
    && /<\/html>\s*(?:<!--[\s\S]*?-->\s*)*$/i.test(code)
}
