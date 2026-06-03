/**
 * 将生成时间格式化为工作台展示所需的 24 小时时间。
 *
 * @param date - 需要格式化的时间对象。
 * @returns 形如 `14:32` 的时间字符串。
 */
export function formatGeneratedTime(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}
