/** 单元格显示成文字：日期按 UTC，数字去掉浮点误差的尾巴，其余原样。 */
export function formatSheetCell(value: unknown): string {
  if (value === null || value === undefined)
    return ''
  if (value instanceof Date) {
    const hasTime = value.getUTCHours() + value.getUTCMinutes() + value.getUTCSeconds() > 0
    return hasTime
      ? value.toLocaleString(undefined, { timeZone: 'UTC' })
      : value.toLocaleDateString(undefined, { timeZone: 'UTC' })
  }
  if (typeof value === 'number')
    return String(Number.parseFloat(value.toPrecision(15)))
  return String(value)
}
