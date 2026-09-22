/**
 * 流式 Markdown 的两个纯函数：
 * - `completeStreamingMarkdown`：给尾块补齐未闭合的行内标记（对照 Streamdown 的 remend）。
 *   不补则 `**加粗` 会先以字面 `**` 出现，闭合后才变成粗体，正文来回翻转。
 * - `alignRevealBoundary`：平滑放出文本时的切点不落在代理对或 `**` 这类标记中间。
 */

const MARKER_CHARS = new Set(['*', '_', '~', '`'])
/** 切在这些字符之后会先渲染出半个转义 / 半个图片标记，下一帧才消失。 */
const PENDING_PREFIX_CHARS = new Set(['\\', '!'])

function isWhitespace(char: string | undefined) {
  return char === undefined || /\s/.test(char)
}

function isWordChar(char: string | undefined) {
  return char !== undefined && /[\p{L}\p{N}]/u.test(char)
}

/** 按 CommonMark 分隔符成对拆分：`***` 是 `**` + `*`，`****` 是两个 `**`。 */
function markersOfRun(char: string, run: number): string[] {
  if (char === '~')
    return run >= 2 ? ['~~'] : []
  const markers: string[] = []
  for (let i = 0; i < Math.floor(run / 2); i++)
    markers.push(char + char)
  if (run % 2 === 1)
    markers.push(char)
  return markers
}

/** 行首只允许缩进、引用符与列表标记；`- ```ts` 这种同行写法也算围栏起始。 */
function isFenceStart(text: string, index: number, run: number) {
  if (run < 3)
    return false
  const lineStart = text.lastIndexOf('\n', index - 1) + 1
  return /^[ \t>]*(?:(?:[-*+]|\d+[.)])[ \t]*)?$/.test(text.slice(lineStart, index))
}

/** 找到嵌套围栏的关闭行，返回其行尾位置；没有关闭行返回 -1。 */
function findFenceEnd(text: string, index: number, char: string, run: number): number {
  let lineEnd = text.indexOf('\n', index)
  while (lineEnd !== -1) {
    const nextEnd = text.indexOf('\n', lineEnd + 1)
    const line = text.slice(lineEnd + 1, nextEnd === -1 ? text.length : nextEnd)
    const closing = line.match(/^[ \t>]*(`{3,}|~{3,})[ \t]*$/)?.[1]
    if (closing && closing[0] === char && closing.length >= run)
      return nextEnd === -1 ? text.length : nextEnd
    lineEnd = nextEnd
  }
  return -1
}

export function completeStreamingMarkdown(text: string): string {
  const open: string[] = []
  let codeRun = 0
  let codeStart = 0
  let index = 0
  // 尾部只能作为 opener 的标记（`**` 刚到达、正文还没来）先裁掉，等下一帧再显示。
  let cutAt = text.length

  while (index < text.length) {
    const char = text[index]

    if (char === '\\' && codeRun === 0) {
      index += 2
      continue
    }

    if (char === '`' || (codeRun === 0 && char === '~')) {
      let run = 1
      while (text[index + run] === char)
        run++
      // 列表项、引用内的围栏：已闭合就跳过整段代码，未闭合则后面全是代码，不补任何标记。
      if (codeRun === 0 && isFenceStart(text, index, run)) {
        const fenceEnd = findFenceEnd(text, index, char, run)
        if (fenceEnd === -1)
          return text
        index = fenceEnd
        continue
      }
      if (char === '`') {
        if (codeRun === 0) {
          codeRun = run
          codeStart = index
        }
        else if (run === codeRun) {
          codeRun = 0
        }
        index += run
        continue
      }
    }

    if (codeRun > 0 || !(char === '*' || char === '_' || char === '~')) {
      index++
      continue
    }

    let run = 1
    while (text[index + run] === char)
      run++
    const before = text[index - 1]
    const after = text[index + run]
    const atEnd = index + run >= text.length
    // snake_case 之类词内下划线不是强调。
    const wordInternal = char === '_' && isWordChar(before) && isWordChar(after)
    const canClose = !isWhitespace(before) && !wordInternal
    const canOpen = (atEnd || !isWhitespace(after)) && !wordInternal

    for (const marker of markersOfRun(char, run)) {
      const openIndex = canClose ? open.lastIndexOf(marker) : -1
      if (openIndex >= 0) {
        open.splice(openIndex, 1)
      }
      else if (canOpen && atEnd) {
        cutAt = Math.min(cutAt, index)
      }
      else if (canOpen) {
        open.push(marker)
      }
    }
    index += run
  }

  let result = text.slice(0, cutAt)

  if (codeRun > 0) {
    if (codeStart + codeRun >= cutAt)
      result = text.slice(0, codeStart)
    else
      result += '`'.repeat(codeRun)
  }

  // 图片没有内容前显示不了，隐藏到行尾；链接已有 href 内容时补上右括号让锚文本先按链接显示。
  result = result
    .replace(/!\[[^\]\n]*(?:\]\([^)\n]*)?$/, '')
    .replace(/(\[[^\]\n]*\]\([^)\s]+)$/, '$1)')

  // 闭合符必须紧贴正文才满足 right-flanking，先去掉尾部空白再追加。
  if (open.length > 0)
    result = result.replace(/\s+$/, '')
  for (let i = open.length - 1; i >= 0; i--)
    result += open[i]

  return result
}

export function alignRevealBoundary(text: string, index: number): number {
  let end = Math.min(Math.max(index, 0), text.length)
  const code = text.charCodeAt(end)
  if (code >= 0xDC00 && code <= 0xDFFF)
    end++
  while (end > 0 && end < text.length && (
    (MARKER_CHARS.has(text[end]) && text[end] === text[end - 1])
    || PENDING_PREFIX_CHARS.has(text[end - 1])
  )) {
    end++
  }
  return end
}
