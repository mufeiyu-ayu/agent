import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const archify = join(homedir(), '.agents/skills/archify/bin/archify.mjs');
const check = process.argv.includes('--check');
const temporary = check ? mkdtempSync(join(tmpdir(), 'pi-diagrams-')) : undefined;
const labels = { architecture: '架构图', workflow: '流程图', sequence: '时序图', dataflow: '数据流图' };
const escape = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

try {
  const diagrams = readdirSync(join(directory, 'specs')).filter(name => name.endsWith('.json')).sort().map(name => {
    assert.match(name, /^\d{2}-[a-z0-9-]+\.json$/, '图表文件名必须带序号且只含小写字母、数字和连字符');
    const spec = JSON.parse(readFileSync(join(directory, 'specs', name), 'utf8'));
    const output = name.replace(/\.json$/, '.html');
    assert.equal(spec.meta.output, output, `${name} 的 meta.output 必须对应同名HTML`);
    assert.ok(Object.hasOwn(labels, spec.diagram_type), `${name} 的图类型不受支持`);
    return { name, output, spec };
  });
  assert.ok(diagrams.length > 0, 'specs/ 至少需要一张图');
  const expectedHtml = new Set(['index.html', ...diagrams.map(({ output }) => output)]);
  const staleHtml = readdirSync(directory).filter(name => name.endsWith('.html') && !expectedHtml.has(name));
  if (check) assert.deepEqual(staleHtml, [], `存在无对应JSON的HTML：${staleHtml.join(', ')}`);
  else assert.ok(staleHtml.every(name => /^\d{2}-[a-z0-9-]+\.html$/.test(name)), `存在非生成HTML，需手动处理：${staleHtml.join(', ')}`);

  for (const { name, output, spec } of diagrams) {
    const source = join(directory, 'specs', name);
    const evidence = spec.meta.repository ? ['--repo-root', join(homedir(), 'Learn/pi')] : [];
    const run = args => JSON.parse(execFileSync(process.execPath, [archify, ...args, '--quality', 'showcase', '--json', ...evidence], { cwd: directory, encoding: 'utf8' }));
    assert.equal(run(['validate', spec.diagram_type, source]).ok, true);
    assert.equal(run(['deliver', spec.diagram_type, source, join(temporary ?? directory, output)]).ok, true);
    if (check) assert.deepEqual(readFileSync(join(directory, output)), readFileSync(join(temporary, output)), `${output} 未与JSON同步`);
  }

  const first = diagrams[0];
  const menu = diagrams.map(({ name, output, spec }, index) => `        <a href="${output}" target="diagram" data-title="${escape(spec.meta.title)}" data-number="${index + 1}"${index === 0 ? ' aria-current="page"' : ''}>
          <span class="number">${String(index + 1).padStart(2, '0')}</span>
          <span><span class="label">${escape(spec.meta.title)}</span><span class="kind">${labels[spec.diagram_type]}</span></span>
          <span class="arrow" aria-hidden="true">›</span>
        </a>`).join('\n');

  const html = `<!doctype html>
<!-- 由 build.mjs 根据 specs/*.json 生成；修改页面布局请编辑 build.mjs。 -->
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Pi 架构图集</title>
  <style>
    * { box-sizing: border-box; }
    :root { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #193849; background: #edf4f7; }
    body { margin: 0; display: grid; grid-template-columns: 252px minmax(0, 1fr); height: 100vh; height: 100dvh; }
    a { color: inherit; }
    a:focus-visible, summary:focus-visible { outline: 3px solid #57cde0; outline-offset: 4px; }
    .skip { position: fixed; top: -80px; left: 16px; z-index: 2; padding: 12px; background: white; color: #163342; }
    .skip:focus { top: 12px; }
    aside { display: flex; flex-direction: column; min-height: 0; padding: 30px 16px 18px; color: #e0edf2; background: #102a39; border-right: 1px solid #294554; }
    .brand { margin: 0 12px 26px; }
    .eyebrow { margin: 0 0 10px; font: 11px ui-monospace, SFMono-Regular, monospace; letter-spacing: .16em; color: #84b2c4; }
    h1 { margin: 0; font-size: 22px; font-weight: 650; letter-spacing: .02em; }
    .intro { margin: 10px 0 0; color: #a4bdc9; font-size: 12px; line-height: 1.7; }
    details { min-height: 0; overflow-y: auto; }
    summary { display: none; }
    nav { display: grid; gap: 6px; }
    nav a { display: grid; grid-template-columns: 24px minmax(0, 1fr) 14px; align-items: center; gap: 10px; padding: 14px 11px; border: 1px solid transparent; border-radius: 8px; text-decoration: none; }
    nav a:hover { background: #1a394b; }
    nav a[aria-current="page"] { color: #f0feff; background: #20495a; border-color: #3a7185; box-shadow: inset 3px 0 #73d5e3; }
    .number { color: #89b7c7; font: 12px ui-monospace, SFMono-Regular, monospace; }
    .label { display: block; font-size: 13px; font-weight: 550; line-height: 1.55; overflow-wrap: anywhere; }
    .kind { display: block; margin-top: 4px; color: #93b0bf; font-size: 11px; }
    .arrow { color: #7eacbd; font-size: 15px; }
    .footer { margin-top: auto; padding: 24px 12px 0; color: #8cabb9; font-size: 11px; line-height: 1.8; }
    main { display: grid; grid-template-rows: 52px minmax(0, 1fr); min-width: 0; min-height: 0; }
    header { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 0 24px; border-bottom: 1px solid #cfdee5; background: #f8fbfc; }
    .current { display: flex; align-items: baseline; gap: 12px; min-width: 0; }
    #position { flex-shrink: 0; color: #638394; font: 11px ui-monospace, SFMono-Regular, monospace; }
    #heading { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #open { flex-shrink: 0; padding: 6px 10px; color: #315e72; border: 1px solid #cedde4; border-radius: 5px; font-size: 12px; text-decoration: none; }
    #open:hover { background: #eaf2f6; }
    iframe { width: 100%; height: 100%; border: 0; background: #edf4f7; }
    @media (prefers-color-scheme: dark) {
      :root { color: #cce0e9; background: #081e2a; }
      header { background: #102a39; border-color: #294554; }
      #open { color: #aed8e7; border-color: #375563; }
      #open:hover { background: #20495a; }
      iframe { background: #081e2a; }
    }
    @media (max-width: 760px) {
      body { grid-template-columns: minmax(0, 1fr); grid-template-rows: auto minmax(0, 1fr); }
      aside { padding: 12px; max-height: 55dvh; border-right: 0; border-bottom: 1px solid #294554; }
      .brand { margin: 0 4px 10px; display: flex; align-items: baseline; gap: 12px; }
      .eyebrow { margin: 0; font-size: 10px; }
      h1 { font-size: 17px; }
      .intro, .footer { display: none; }
      summary { display: list-item; padding: 7px 4px; font-size: 12px; cursor: pointer; color: #b9d6e2; }
      nav { grid-template-columns: repeat(2, minmax(0, 1fr)); margin-top: 7px; }
      nav a { gap: 7px; padding: 9px 8px; }
      .label { font-size: 12px; }
      header { padding: 0 12px; gap: 8px; }
      .current { gap: 8px; }
    }
  </style>
</head>
<body>
  <a class="skip" href="#viewer">跳到图表</a>
  <aside>
    <div class="brand">
      <p class="eyebrow">PI / SOURCE NOTES</p>
      <h1>架构图集</h1>
      <p class="intro">从整体架构，到运行细节。<br>选择一张图，沿调用链阅读。</p>
    </div>
    <details open>
      <summary>切换图表 · ${diagrams.length} 张</summary>
      <nav aria-label="图表菜单">
${menu}
      </nav>
    </details>
    <div class="footer">Pi 源码研究<br>${diagrams.length} 张图 · 架构 / 流程 / 数据</div>
  </aside>
  <main id="viewer" tabindex="-1">
    <header>
      <div class="current" aria-live="polite"><span id="position">01 / ${String(diagrams.length).padStart(2, '0')}</span><span id="heading">${escape(first.spec.meta.title)}</span></div>
      <a id="open" href="${first.output}" target="_blank" rel="noopener">单独打开 ↗</a>
    </header>
    <iframe name="diagram" title="${escape(first.spec.meta.title)}" src="${first.output}" allowfullscreen></iframe>
  </main>
  <script>
    const links = [...document.querySelectorAll('nav a')];
    const frame = document.querySelector('iframe');
    const narrow = matchMedia('(max-width: 760px)');
    narrow.addEventListener('change', () => {
      if (!narrow.matches) document.querySelector('details').open = true;
    });
    for (const link of links) {
      link.addEventListener('click', event => {
        if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
        for (const item of links) item.removeAttribute('aria-current');
        link.setAttribute('aria-current', 'page');
        document.querySelector('#heading').textContent = link.dataset.title;
        document.querySelector('#position').textContent = link.dataset.number.padStart(2, '0') + ' / ' + String(links.length).padStart(2, '0');
        document.querySelector('#open').href = link.href;
        frame.title = link.dataset.title;
        if (narrow.matches) document.querySelector('details').open = false;
      });
    }
  </script>
</body>
</html>
`;
  const index = join(directory, 'index.html');
  if (check) assert.equal(readFileSync(index, 'utf8'), html, 'index.html 未与JSON或页面模板同步');
  else {
    writeFileSync(index, html);
    for (const name of staleHtml) rmSync(join(directory, name));
  }
  console.log(`${check ? 'Checked' : 'Built'} ${diagrams.length} diagrams and index.html`);
} finally {
  if (temporary) rmSync(temporary, { recursive: true, force: true });
}
