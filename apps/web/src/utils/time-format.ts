/**
 * 消息时间：今天只显示时刻，昨天显示「昨天 14:32」，更早显示日期；跨年补年份。
 *
 * @param date - 消息时间。
 * @param locale - 界面语言。
 * @param now - 当前时间，测试时注入。
 * @returns 形如 `14:32`、`昨天 14:32`、`9月20日 14:32` 的字符串；无效时间返回空串。
 */
export function formatMessageTime(date: Date, locale: string, now = new Date()): string {
  if (Number.isNaN(date.getTime()))
    return ''

  const time = new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
  const dayDiff = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)

  if (dayDiff === 0)
    return time
  if (dayDiff === 1)
    return `${new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-1, 'day')} ${time}`

  return new Intl.DateTimeFormat(locale, {
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}
