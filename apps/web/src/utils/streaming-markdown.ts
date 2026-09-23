/**
 * 流式 Markdown 的两个纯函数：
 * - `completeStreamingMarkdown`：给尾块补齐未闭合的行内标记（对照 Streamdown 的 remend）。
 *   不补则 `**加粗` 会先以字面 `**` 出现，闭合后才变成粗体，正文来回翻转。
 *   补齐以行、列表项、表格单元格为边界：前面行里没闭合的 `*.ts`、`2**10` 多半是字面字符，补到末尾反而多出标记。
 * - `alignRevealBoundary`：平滑放出文本时的切点不落在代理对或 `**` 这类标记中间。
 */

const MARKER_CHARS = new Set(['*', '_', '~', '`'])
/** 裸 URL 里的 `_`、`~`、`*` 不是强调；止于空白、括号与引号，Markdown 链接的 `)` 之后照常扫描。 */
const BARE_URL = /https?:\/\/[^\s<>()[\]"'`]*/y
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

const TABLE_ROW = /[ \t>]*\|/y
/** 列表项、表格行、空行（或文末）：markdown-it 不会跨过它们配对标记。 */
const NEW_INLINE_CONTEXT = /[ \t>]*(?:(?:[-*+]|\d{1,9}[.)])(?=[ \t\n]|$)|\||\n|$)/y

/** 行首是 `|` 的行按表格行处理，`|` 分隔单元格（GFM 先切单元格再解析行内）。 */
function isTableRow(text: string, lineStart: number) {
  TABLE_ROW.lastIndex = lineStart
  return TABLE_ROW.test(text)
}

function startsNewInlineContext(text: string, lineStart: number) {
  NEW_INLINE_CONTEXT.lastIndex = lineStart
  return NEW_INLINE_CONTEXT.test(text)
}

/** 移除最近一个同类标记，返回是否找到。 */
function removeLast(markers: string[], marker: string) {
  const index = markers.lastIndexOf(marker)
  if (index >= 0)
    markers.splice(index, 1)
  return index >= 0
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
  /** 当前行（单元格）里未闭合、到文末要补齐的强调标记。 */
  let open: string[] = []
  /** 同一段落前面行里未闭合的：不再补，但后面的闭合符仍与之配对（markdown-it 跨软换行配对），不能当成新起点。 */
  let stale: string[] = []
  let codeRun = 0
  let codeStart = 0
  /** 不补齐的反引号串（后接空白，或跨过了软换行）：等长的反引号串到来时作为它的闭合消费掉。 */
  let pendingCodeRun = 0
  /** 不补齐的代码段起点之后推入 open / stale 的标记：代码段闭合时它们其实在代码里，一并作废。 */
  let pendingOpenFrom = 0
  let pendingStaleFrom = Infinity
  /** 文本停在裸 URL 末尾时补的 `_`、`~` 会被 linkify 并进链接。 */
  let endsInUrl = false
  let index = 0
  let inTableRow = isTableRow(text, 0)
  // 尾部只能作为 opener 的标记（`**` 刚到达、正文还没来）先裁掉，等下一帧再显示。
  let cutAt = text.length

  while (index < text.length) {
    const char = text[index]

    if (char === '\n' || (char === '|' && inTableRow)) {
      const separate = char === '|' || startsNewInlineContext(text, index + 1)
      // 代码段跨软换行：本行代码段里的标记随 open 并入 stale，记下它们在 stale 里的起点。
      if (separate)
        pendingStaleFrom = Infinity
      else if (codeRun > 0)
        pendingStaleFrom = stale.length + open.length
      else if (pendingCodeRun > 0)
        pendingStaleFrom = Math.min(pendingStaleFrom, stale.length + pendingOpenFrom)
      stale = separate ? [] : [...stale, ...open]
      pendingCodeRun = separate ? 0 : (codeRun || pendingCodeRun)
      pendingOpenFrom = 0
      open = []
      codeRun = 0
      if (char === '\n')
        inTableRow = isTableRow(text, index + 1)
      index++
      continue
    }

    if (char === '\\' && codeRun === 0) {
      // 行尾反斜杠是硬换行，换行符本身仍要作为边界处理。
      index += text[index + 1] === '\n' ? 1 : 2
      continue
    }

    if (char === 'h' && codeRun === 0) {
      BARE_URL.lastIndex = index
      // linkify 不把末尾的星号算进链接，它们照常作为强调标记扫描。
      const url = BARE_URL.exec(text)?.[0].replace(/\*+$/, '')
      if (url) {
        index += url.length
        endsInUrl = index === text.length
        continue
      }
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
        if (codeRun === 0 && run === pendingCodeRun) {
          // 闭合了不补齐的那段代码：其间推入的强调标记其实在代码里。
          pendingCodeRun = 0
          open.splice(pendingOpenFrom)
          stale.splice(pendingStaleFrom)
        }
        else if (codeRun === 0 && index + run < text.length && isWhitespace(text[index + run])) {
          // 后面紧跟空白的反引号多半是字面字符（It's a ` char.），不当作代码起点补齐。
          pendingCodeRun = run
          pendingOpenFrom = open.length
          pendingStaleFrom = Infinity
        }
        else if (codeRun === 0) {
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
      if (canClose && (removeLast(open, marker) || removeLast(stale, marker)))
        continue
      if (canOpen && atEnd)
        cutAt = Math.min(cutAt, index)
      else if (canOpen)
        open.push(marker)
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

  if (endsInUrl)
    open = open.filter(marker => marker[0] === '*')

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
