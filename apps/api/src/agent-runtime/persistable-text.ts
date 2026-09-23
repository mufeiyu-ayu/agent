/**
 * PostgreSQL 的 text 与 jsonb 都存不了 U+0000，jsonb 还拒收孤立代理项（text 列里的孤立代理项会被 pg 驱动静默换掉）：
 * 原样写入会让收口失败，失败收口再写同一段内容也会失败，Run 停在 RUNNING。写进 `Message.content` 与 Step JSON 的
 * 文本都先把它们换成 U+FFFD，推给前端的 delta 用同一个替换后的串。按分片调用时，跨分片的代理对会各自被换掉；
 * 上游按码点解码后才切分片，实际不会出现。
 */
export function toPersistableText(text: string): string {
  return text
    .replaceAll('\0', '\uFFFD')
    .replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD')
}
