import assert from 'node:assert/strict'
// eslint-disable-next-line test/no-import-node-test
import test from 'node:test'

import { alignRevealBoundary, completeStreamingMarkdown } from './streaming-markdown'

test('补齐未闭合的粗体、斜体、删除线与行内代码', () => {
  assert.equal(completeStreamingMarkdown('先说 **结论'), '先说 **结论**')
  assert.equal(completeStreamingMarkdown('先说 *重点'), '先说 *重点*')
  assert.equal(completeStreamingMarkdown('先说 ~~旧'), '先说 ~~旧~~')
  assert.equal(completeStreamingMarkdown('调用 `fetch('), '调用 `fetch(`')
  assert.equal(completeStreamingMarkdown('调用 ``a`b'), '调用 ``a`b``')
  assert.equal(completeStreamingMarkdown('***强调'), '***强调***')
})

test('嵌套标记按打开顺序反向闭合，已闭合的不重复补', () => {
  assert.equal(completeStreamingMarkdown('**粗 *斜'), '**粗 *斜***')
  assert.equal(completeStreamingMarkdown('**已闭合** 正文'), '**已闭合** 正文')
  assert.equal(completeStreamingMarkdown('1. **要点**：说明 **第二'), '1. **要点**：说明 **第二**')
})

test('刚到达、还没有正文的 opener 先隐藏', () => {
  assert.equal(completeStreamingMarkdown('先说 **'), '先说 ')
  assert.equal(completeStreamingMarkdown('先说 `'), '先说 ')
  assert.equal(completeStreamingMarkdown('先说 **结论**'), '先说 **结论**')
})

test('列表标记、词内下划线、乘号与转义不当作强调', () => {
  assert.equal(completeStreamingMarkdown('* 第一项\n* 第二'), '* 第一项\n* 第二')
  assert.equal(completeStreamingMarkdown('变量 user_name 与 a_b'), '变量 user_name 与 a_b')
  assert.equal(completeStreamingMarkdown('2 * 3 = 6'), '2 * 3 = 6')
  assert.equal(completeStreamingMarkdown('字面 \\*星号'), '字面 \\*星号')
  assert.equal(completeStreamingMarkdown('代码里 `a ** b` 之外'), '代码里 `a ** b` 之外')
})

test('列表项内的围栏后面视为代码，不补标记', () => {
  const text = '- **要点**\n  ```ts\n  const a = "**"'
  assert.equal(completeStreamingMarkdown(text), text)
})

test('未完成的图片整段隐藏，未完成的链接先按链接显示', () => {
  assert.equal(completeStreamingMarkdown('见图 ![示意'), '见图 ')
  assert.equal(completeStreamingMarkdown('见图 ![示意](https://a'), '见图 ')
  assert.equal(completeStreamingMarkdown('见 [文档](https://exa'), '见 [文档](https://exa)')
  assert.equal(completeStreamingMarkdown('见 [文档](https://example.com) 后文'), '见 [文档](https://example.com) 后文')
})

test('切点不落在代理对与标记 run 中间', () => {
  const emoji = '好😀了'
  assert.equal(alignRevealBoundary(emoji, 2), 3)
  assert.equal(alignRevealBoundary('先 **结论**', 3), 4)
  assert.equal(alignRevealBoundary('a ``b', 3), 4)
  assert.equal(alignRevealBoundary('普通', 1), 1)
  assert.equal(alignRevealBoundary('普通', 9), 2)
})

test('波浪线围栏与列表标记同行的围栏也视为代码起始', () => {
  for (const text of ['- 示例\n  ~~~ts\n  a = b', '- ```ts\n  const a', '> ```\n> **x', '1. ~~~\n   a']) {
    assert.equal(completeStreamingMarkdown(text), text)
  }
  assert.equal(completeStreamingMarkdown('删除 ~~旧'), '删除 ~~旧~~')
})

test('切点不落在转义符与图片感叹号之后', () => {
  assert.equal(alignRevealBoundary('字面 \\*星号', 4), 5)
  assert.equal(alignRevealBoundary('见图 ![示意', 4), 5)
  assert.equal(alignRevealBoundary('结尾\\', 3), 3)
})

test('闭合符紧贴正文，切在空白后也不会退化成字面标记', () => {
  assert.equal(completeStreamingMarkdown('先说 **结论 '), '先说 **结论**')
  assert.equal(completeStreamingMarkdown('**见图 ![示意'), '**见图**')
  assert.equal(completeStreamingMarkdown('a `b '), 'a `b `')
})

test('图片隐藏不跨行，链接没有 href 内容时不补右括号', () => {
  assert.equal(completeStreamingMarkdown('见图 ![示意\n后续内容'), '见图 ![示意\n后续内容')
  assert.equal(completeStreamingMarkdown('a [b]('), 'a [b](')
  assert.equal(completeStreamingMarkdown('a [b](h'), 'a [b](h)')
})

test('列表项内已闭合的围栏之后继续补齐', () => {
  assert.equal(completeStreamingMarkdown('- ```ts\n  a\n  ```\n- **要点'), '- ```ts\n  a\n  ```\n- **要点**')
  assert.equal(completeStreamingMarkdown('- ~~~\n  **x\n  ~~~\n- *y'), '- ~~~\n  **x\n  ~~~\n- *y*')
})

test('四个及以上星号按成对分隔符记账', () => {
  assert.equal(completeStreamingMarkdown('****x'), '****x****')
  assert.equal(completeStreamingMarkdown('**a** ****b'), '**a** ****b****')
})

test('补齐以行与表格单元格为边界，前面行里未闭合的字面标记不补到末尾', () => {
  for (const text of [
    '- 匹配 *.ts 文件\n- 其他',
    '- 2**10 很大\n- 其他',
    '| 模式 | 说明 |\n|---|---|\n| *.ts | TS 文件',
    '| *.ts | TS 文件 |',
    '**跨行\n下一行',
  ]) {
    assert.equal(completeStreamingMarkdown(text), text)
  }
  assert.equal(completeStreamingMarkdown('- 匹配 *.ts\n- 其他 **重'), '- 匹配 *.ts\n- 其他 **重**')
  assert.equal(completeStreamingMarkdown('| a | **粗'), '| a | **粗**')
  assert.equal(completeStreamingMarkdown('硬换行 *x\\\n继续'), '硬换行 *x\\\n继续')
})

test('裸 URL 内的下划线与后接空白的反引号不当作标记', () => {
  assert.equal(completeStreamingMarkdown('https://x.com/_foo'), 'https://x.com/_foo')
  assert.equal(completeStreamingMarkdown('见 https://x.com/_a_b 与 **粗'), '见 https://x.com/_a_b 与 **粗**')
  assert.equal(completeStreamingMarkdown('[文档](https://x.com/_a) *斜'), '[文档](https://x.com/_a) *斜*')
  assert.equal(completeStreamingMarkdown('It\'s a ` char. 后面整段'), 'It\'s a ` char. 后面整段')
  assert.equal(completeStreamingMarkdown('It\'s a ` char.\n后面整段'), 'It\'s a ` char.\n后面整段')
  assert.equal(completeStreamingMarkdown('调用 `fetch('), '调用 `fetch(`')
})

test('同一段落跨软换行的强调与代码仍能闭合，不被当成新起点', () => {
  for (const text of ['**标题\n内容**', '**标题\n内容**。', '` foo`', '_见 https://x.com/a_', '~~删除 https://x.com~~', '_见 https://x.com/a']) {
    assert.equal(completeStreamingMarkdown(text), text)
  }
  // URL 里的下划线闭合不了前面的斜体；只有文本停在 URL 末尾时才不补（补的 `_` 会被并进链接）。
  assert.equal(completeStreamingMarkdown('_斜体 见 https://x.com/foo_bar 继续'), '_斜体 见 https://x.com/foo_bar 继续_')
  assert.equal(completeStreamingMarkdown('**见 https://x.com/a'), '**见 https://x.com/a**')
  assert.equal(completeStreamingMarkdown('见 https://x.com/**/a *斜'), '见 https://x.com/**/a *斜*')
  assert.equal(completeStreamingMarkdown('**见 https://x.com/a** 后 *斜'), '**见 https://x.com/a** 后 *斜*')
  // 代码段跨行闭合后，上一行代码里的 ** 不再参与配对（opener 前是汉字；两侧都是 ASCII 字母数字的 w**q 按字面不补）。
  assert.equal(completeStreamingMarkdown('` x **y\nz` 其**q'), '` x **y\nz` 其**q**')
  assert.equal(completeStreamingMarkdown('`a\nb` **c'), '`a\nb` **c**')
  // 空白开头的代码闭合后，其间的星号在代码里，不补。
  assert.equal(completeStreamingMarkdown('` a **b` c'), '` a **b` c')
  // 新列表项另起上下文：前一项的字面星号不参与配对。
  assert.equal(completeStreamingMarkdown('- 匹配 *.ts\n- 其他*重点'), '- 匹配 *.ts\n- 其他*重点*')
})

test('#169 AC-02 当前行里多半是字面字符的 opener 不补：2*3、2**10、*.ts、行内公式里的 x*y', () => {
  for (const text of ['计算 2*3 = 6，然后', '- 匹配 *.ts 文件', '- 2**10 很大', '$x*y$ 继续', '注释 /* 这里'])
    assert.equal(completeStreamingMarkdown(text), text)
  // 真正的强调照常补齐，包括粗体代码、粗体链接、括号与引号开头的强调，以及同一行里有美元价格时。
  for (const [text, completed] of [
    ['**加粗', '**加粗**'],
    ['先说 *斜体', '先说 *斜体*'],
    ['**`useState`', '**`useState`**'],
    ['**[文档](https://x.com)', '**[文档](https://x.com)**'],
    ['*(可选)', '*(可选)*'],
    ['**"quoted', '**"quoted**'],
    ['价格 $5，**重点', '价格 $5，**重点**'],
    ['修改 **.env', '修改 **.env**'],
    ['见 **/api/chat', '见 **/api/chat**'],
  ])
    assert.equal(completeStreamingMarkdown(text), completed)
  // 紧贴在词里的 ** 后接斜杠（glob）仍按字面不补。
  for (const text of ['匹配 src/**/', '匹配 src/**/*.ts'])
    assert.equal(completeStreamingMarkdown(text), text)
})

test('#169 AC-03 表格：解析器认定的表格每行按单元格切分，代码段里的 \\| 不是边界', () => {
  assert.equal(completeStreamingMarkdown('a | b\n--|--\n*x | y', { table: true }), 'a | b\n--|--\n*x | y')
  assert.equal(completeStreamingMarkdown('| a | `x\\|y **z` 后'), '| a | `x\\|y **z` 后')
  // 与 markdown-it 一样只看前一个字符：`\\|` 也算转义竖线，后面仍在同一个单元格。
  assert.equal(completeStreamingMarkdown('| a | C:\\\\| **粗'), '| a | C:\\\\| **粗**')
  // 单元格内的强调照常补齐。
  assert.equal(completeStreamingMarkdown('| a | **粗', { table: true }), '| a | **粗**')
})

test('#169 AC-04 尾块末尾只有 ATX 标题标记时先不显示', () => {
  for (const tail of ['#', '##', '## ', '> ###', '- ##', '1. #'])
    assert.equal(completeStreamingMarkdown(`先查一下。\n\n${tail}`), '先查一下。\n\n')
  assert.equal(completeStreamingMarkdown('## 标'), '## 标')
  assert.equal(completeStreamingMarkdown('#话题'), '#话题')
})
