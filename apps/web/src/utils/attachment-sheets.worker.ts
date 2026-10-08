import type { PreviewTable } from './attachment-documents'
import readXlsxFile from 'read-excel-file/web-worker'
import { formatSheetCell, PREVIEW_COLUMN_LIMIT, PREVIEW_ROW_LIMIT } from './attachment-sheet-cells'

// 库的 browser 入口没有实际启动 worker；解压、XML 解析和单元格格式化都明确放在这个线程。
onmessage = async (event: MessageEvent<Blob>) => {
  try {
    const sheets = await readXlsxFile(event.data)
    const tables: PreviewTable[] = sheets.map(({ sheet, data }) => ({
      name: sheet,
      // 表头 + 上限行 + 多一行：超出预览范围的不格式化、不传回页面。
      rows: data.slice(0, PREVIEW_ROW_LIMIT + 2).map(row => row.slice(0, PREVIEW_COLUMN_LIMIT + 1).map(formatSheetCell)),
    }))
    postMessage({ tables })
  }
  catch {
    postMessage({ failed: true })
  }
}
