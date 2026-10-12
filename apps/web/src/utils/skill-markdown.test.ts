import assert from 'node:assert/strict'
import { it } from 'vitest'
import { parse } from 'yaml'
import { readSkillMarkdown, writeSkillMarkdown } from './skill-markdown'

it('编辑正文保留引号、多行描述和其余 YAML 元数据', () => {
  const original = '---\nname: article-check\ndescription: |\n  用途: 检查标题\n  保留摘要\nlicense: MIT\ncompatibility: Node.js\nmetadata:\n  author: Ayu\n---\n\n旧正文'
  const before = readSkillMarkdown(original)
  assert.match(before.description, /用途: 检查标题\n保留摘要/)
  const written = writeSkillMarkdown(original, before.name, before.description, '新正文')
  assert.deepEqual(parse(written.split('---')[1]!), parse(original.split('---')[1]!))
  assert.equal(readSkillMarkdown(written).body, '新正文')
  const edited = writeSkillMarkdown(written, before.name, '用途: 检查标题 # 原样', '新正文')
  assert.equal(readSkillMarkdown(edited).description, '用途: 检查标题 # 原样')
})
