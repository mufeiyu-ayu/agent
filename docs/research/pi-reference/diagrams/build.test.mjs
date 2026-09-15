import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 只改临时副本，验证真实构建器的删除、重命名与文件保护行为。
const fixture = mkdtempSync(join(tmpdir(), 'pi-diagram-regression-'));
try {
  cpSync(dirname(fileURLToPath(import.meta.url)), fixture, { recursive: true });
  const run = (...args) => spawnSync(process.execPath, ['build.mjs', ...args], { cwd: fixture, encoding: 'utf8' });
  const succeeds = result => assert.equal(result.status, 0, result.stderr || result.stdout);
  const rejectsStale = result => {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /存在无对应JSON的HTML/);
  };

  rmSync(join(fixture, 'specs/06-cloud-direction.json'));
  rejectsStale(run('--check'));
  assert.ok(existsSync(join(fixture, '06-cloud-direction.html')), '--check 必须保持只读');
  succeeds(run());
  assert.ok(!existsSync(join(fixture, '06-cloud-direction.html')));
  assert.ok(!readFileSync(join(fixture, 'index.html'), 'utf8').includes('06-cloud-direction.html'));
  succeeds(run('--check'));

  const renamed = join(fixture, 'specs/07-context-projections.json');
  renameSync(join(fixture, 'specs/05-context-projections.json'), renamed);
  const spec = JSON.parse(readFileSync(renamed, 'utf8'));
  spec.meta.output = '07-context-projections.html';
  writeFileSync(renamed, JSON.stringify(spec));
  rejectsStale(run('--check'));
  succeeds(run());
  assert.ok(!existsSync(join(fixture, '05-context-projections.html')));
  assert.ok(existsSync(join(fixture, '07-context-projections.html')));
  assert.ok(readFileSync(join(fixture, 'index.html'), 'utf8').includes('07-context-projections.html'));
  succeeds(run('--check'));

  writeFileSync(join(fixture, 'notes.html'), '<p>保留的手写页面</p>');
  rejectsStale(run('--check'));
  const rejected = run();
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /存在非生成HTML/);
  assert.equal(readFileSync(join(fixture, 'notes.html'), 'utf8'), '<p>保留的手写页面</p>');
  console.log('PASS: deleted/renamed specs, read-only checks, and non-generated HTML protection');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
