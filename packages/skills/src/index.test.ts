import assert from 'node:assert/strict'
import { describe, it } from 'vitest'
import { parseSkill, skillPath, validateSkillPackage } from './index.js'

const main = (body = '按任务执行。') => ({ path: 'SKILL.md', encoding: 'utf8', content: `---\nname: article-analysis\ndescription: >\n  分析文章效果，\n  输出优化建议。\n---\n${body}` })
describe('标准技能包', () => {
  it('解析 YAML 多行描述并绑定一致的内容指纹', () => {
    const pkg = validateSkillPackage([main('[方法](references/method.md)'), { path: 'references/method.md', encoding: 'utf8', content: '分析方法' }])
    assert.equal(pkg.name, 'article-analysis')
    assert.match(pkg.description, /分析文章效果/)
    assert.equal(validateSkillPackage([...pkg.files].reverse()).fingerprint, pkg.fingerprint)
    assert.notEqual(validateSkillPackage([main('改变步骤')]).fingerprint, pkg.fingerprint)
  })
  it('拒绝别名、重复 YAML 键、非法名称、缺失引用与越界路径', () => {
    for (const path of ['../SKILL.md', '/tmp/file', 'a/../b', 'a\\b', '.hidden', 'a//b', 'a/%2e%2e/b'])
      assert.throws(() => skillPath(path))
    for (const source of ['---\nname: A\ndescription: yes\n---\nbody', '---\nname: x\nname: y\ndescription: yes\n---\nbody', '---\nname: &x foo\ndescription: *x\n---\nbody'])
      assert.throws(() => parseSkill(source))
    assert.throws(() => validateSkillPackage([main('[缺失](references/missing.md)')]))
    assert.throws(() => validateSkillPackage([main(), { path: 'scripts/tool.py', encoding: 'utf8', content: '', type: 'symlink' }]))
    assert.throws(() => validateSkillPackage([main(), { path: 'a.md', encoding: 'utf8', content: '' }, { path: 'a.md/b.txt', encoding: 'utf8', content: '' }]))
  })
  it('拒绝重复路径、坏编码、孤立代理项和超限文件', () => {
    assert.throws(() => validateSkillPackage([main(), main()]))
    assert.throws(() => validateSkillPackage([{ ...main(), encoding: ['utf8'] }]))
    assert.throws(() => validateSkillPackage([main(), { path: 'assets/image.png', encoding: ['base64'], content: 'YWJj' }]))
    assert.throws(() => validateSkillPackage([main(), { path: 'assets/a.bin', encoding: 'base64', content: 'not base64' }]))
    assert.throws(() => validateSkillPackage([main('\uD800')]))
    assert.throws(() => validateSkillPackage([main('x'.repeat(524289))]))
    assert.doesNotThrow(() => validateSkillPackage([main('😀')]))
  })
})
