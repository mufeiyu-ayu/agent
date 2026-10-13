export async function readPluginIcon(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) {
    throw new Error('请选择 5 MB 以内的 PNG、JPEG 或 WebP 图片')
  }
  const bitmap = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 128
    const context = canvas.getContext('2d')!
    const scale = Math.min(128 / bitmap.width, 128 / bitmap.height)
    const width = bitmap.width * scale
    const height = bitmap.height * scale
    context.drawImage(bitmap, (128 - width) / 2, (128 - height) / 2, width, height)
    return canvas.toDataURL('image/png')
  }
  finally {
    bitmap.close()
  }
}
