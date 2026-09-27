/** 登录后回跳地址只接受站内路径，挡住 `//evil.example` 这类开放跳转。 */
export function safeRedirect(value: unknown, fallback = '/workspace'): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\')
    ? value
    : fallback
}
