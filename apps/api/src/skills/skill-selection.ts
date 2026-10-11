/** 选择身份属于模型输入；用户可见 Message.content 保持原样。 */
export function withSkillSelection(content: string, ids: unknown): string {
  if (!Array.isArray(ids) || !ids.length)
    return content
  if (ids.length > 5 || ids.some(id => typeof id !== 'string' || !id.length || id.length > 128))
    throw new Error('持久化的技能选择身份无效')
  return `${content}\n\n本次用户显式选择的技能 ID（后续使用仍须检查当前授权目录）：${JSON.stringify(ids)}`
}
