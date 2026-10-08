import type { PreviewTable } from './attachment-documents'
import readXlsxFile from 'read-excel-file/web-worker'
import { formatSheetCell } from './attachment-sheet-cells'

// 库的 browser 入口没有实际启动 worker；解压、XML 解析和单元格格式化都明确放在这个线程。
onmessage = async (event: MessageEvent<Blob>) => {
  try {
    const sheets = await readXlsxFile(event.data)
    const tables: PreviewTable[] = sheets.map(({ sheet, data }) => ({
      name: sheet,
      rows: data.map(row => row.map(formatSheetCell)),
    }))
    postMessage({ tables })
  }
  catch {
    postMessage({ failed: true })
  }
}
