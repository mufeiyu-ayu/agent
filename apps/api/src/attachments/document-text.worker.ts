import { Buffer } from 'node:buffer'
import { parentPort, workerData } from 'node:worker_threads'
import mammoth from 'mammoth'
import readXlsxFile from 'read-excel-file/node'
import { extractText } from 'unpdf'

/**
 * 附件的文字抽取：PDF / Word / Excel → 纯文本，在 worker 线程里跑。上传的文件是不可信输入，
 * 三个解析库都是同步计算为主，构造的文件能跑很久或吃很多内存；放进 worker，超时或超出堆上限时由
 * `document-text.ts` 直接终止，API 的事件循环不受影响。
 * 只 import npm 包、不 import 本地模块：测试里 Node 按类型剥离直接运行这个 .ts 文件，本地 `.js` 路径解析不到。
 */
const { extension, content } = workerData as { extension: string, content: Uint8Array }

// 抽取抛错时不接：未处理的拒绝会让 worker 以 error 结束，调用方按失败处理。
void extractDocumentText(extension, content).then(documentText => parentPort?.postMessage({ documentText }))

async function extractDocumentText(extension: string, content: Uint8Array): Promise<string> {
  switch (extension) {
    case 'pdf':
      // 扫描件没有文字层，得到的是空串，由调用方写明「没有可提取的文字」。
      return (await extractText(new Uint8Array(content), { mergePages: true })).text
    case 'docx':
      return (await mammoth.extractRawText({ buffer: Buffer.from(content) })).value
    case 'xlsx':
      return (await readXlsxFile(Buffer.from(content)))
        .map(({ sheet, data }) => `# ${sheet}\n${data.map(row => row.map(csvCell).join(',')).join('\n')}`)
        .join('\n\n')
    default:
      throw new Error(`unsupported document type: ${extension}`)
  }
}

/** 每个工作表写成 CSV：日期按 ISO（没有时刻的只写日期），含逗号、引号或换行的单元格加引号。 */
function csvCell(value: unknown): string {
  if (value === null || value === undefined)
    return ''
  const text = value instanceof Date
    ? value.toISOString().replace(/T00:00:00\.000Z$/, '').replace(/\.000Z$/, 'Z')
    : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}
