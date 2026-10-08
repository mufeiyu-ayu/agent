/** 一个附件给模型的文字部分：文档带抽出的正文，图片没有正文（图片本身另作图片块发出）。 */
export interface UserAttachmentText {
  name: string
  text?: string
}

/**
 * 用户消息发给模型的正文：附件在前、用户打的字在后。格式照抄 Pi `coding-agent/src/cli/file-processor.ts`（ce950d78）：
 * 文档是 `<file name="…">\n正文\n</file>\n`，图片只留一个空标签让模型知道文件名。
 * Pi 标签里写的是本地绝对路径，我们写文件名；文件名里会打乱标签的字符换成下划线。
 * 三家都不解析 PDF / Word / Excel（靠模型用工具读本地文件），正文由宿主在上传时抽好、落库，这里只负责拼。
 */
export function userMessageContent(text: string, attachments: UserAttachmentText[]): string {
  return attachments.map(({ name, text: body }) => {
    // eslint-disable-next-line no-control-regex
    const safeName = name.replace(/["<>\u0000-\u001F]/g, '_')
    return body === undefined
      ? `<file name="${safeName}"></file>\n`
      : `<file name="${safeName}">\n${body}\n</file>\n`
  }).join('') + text
}
