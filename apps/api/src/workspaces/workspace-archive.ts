import { Buffer } from 'node:buffer'
import { crc32 } from 'node:zlib'
import { storedWorkspacePath } from './workspace-files.js'

/** 有界 Source 清单用 ZIP STORE：无需压缩库，原字节和 UTF-8 相对路径保持不变。 */
export function sourceZip(files: Array<{ path: string, content: Buffer }>): Buffer {
  const local: Buffer[] = []
  const central: Buffer[] = []
  let offset = 0
  let centralBytes = 0
  for (const file of files) {
    const name = Buffer.from(storedWorkspacePath(file.path))
    const checksum = crc32(file.content)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034B50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0x800, 6)
    header.writeUInt16LE(33, 12) // 1980-01-01，归档可复现。
    header.writeUInt32LE(checksum, 14)
    header.writeUInt32LE(file.content.length, 18)
    header.writeUInt32LE(file.content.length, 22)
    header.writeUInt16LE(name.length, 26)
    local.push(header, name, file.content)
    const entry = Buffer.alloc(46)
    entry.writeUInt32LE(0x02014B50, 0)
    entry.writeUInt16LE(20, 4)
    entry.writeUInt16LE(20, 6)
    entry.writeUInt16LE(0x800, 8)
    entry.writeUInt16LE(33, 14)
    entry.writeUInt32LE(checksum, 16)
    entry.writeUInt32LE(file.content.length, 20)
    entry.writeUInt32LE(file.content.length, 24)
    entry.writeUInt16LE(name.length, 28)
    entry.writeUInt32LE(offset, 42)
    central.push(entry, name)
    offset += header.length + name.length + file.content.length
    centralBytes += entry.length + name.length
  }
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054B50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralBytes, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, ...central, end])
}
