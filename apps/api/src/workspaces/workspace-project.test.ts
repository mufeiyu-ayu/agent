import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { it, onTestFinished } from 'vitest'
import { FILE_SCRIPT } from './sandbox-scripts.js'
import { sourceZip } from './workspace-archive.js'
import { workspacePath } from './workspace-files.js'
import { artifactMime, validateArtifact } from './workspace-preview.js'

const exec = promisify(execFile)

it('真实文件采集分离 Source/dist，过滤依赖、缓存、Secret，拒绝链接与非普通文件；ZIP 原字节可解包', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'workspace-project-')))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const source = [
    { path: 'src/页面.tsx', content: Buffer.from('\uFEFFexport default 42\r\n') },
    { path: 'public/icon.svg', content: Buffer.from('<svg/>') },
    { path: 'package.json', content: Buffer.from('{}') },
    { path: 'pnpm-lock.yaml', content: Buffer.from('lockfileVersion: 9') },
  ]
  for (const file of [...source, ...['dist/index.html', 'dist/tmp/icon.svg', '.env', '.vite-cache/file', '.pnpm-store/file', 'tmp/file'].map(path => ({ path, content: Buffer.from('excluded') }))]) {
    await mkdir(join(root, file.path, '..'), { recursive: true })
    await writeFile(join(root, file.path), file.content)
  }
  await symlink(root, join(root, 'node_modules'))
  const input = join(root, '..', `${root.split('/').at(-1)}.json`)
  onTestFinished(() => rm(input, { force: true }))
  const script = `import os,pwd\npwd.getpwnam=lambda _:pwd.getpwuid(os.getuid())\n${FILE_SCRIPT.replace('ROOT=\'/workspace/project\'', `ROOT=${JSON.stringify(root)}`)}`
  const run = async (request: unknown) => {
    await writeFile(input, JSON.stringify(request))
    const { stdout } = await exec('python3', ['-I', '-S', '-c', script, input])
    return JSON.parse(stdout)
  }
  const saved = await run({ action: 'snapshot' })
  assert.deepEqual(saved.files.map((file: { path: string }) => file.path).sort(), source.map(file => file.path).sort())
  assert.deepEqual((await run({ action: 'snapshot', artifact: true })).files.map((file: { path: string }) => file.path), ['index.html', 'tmp/icon.svg'])
  await symlink(join(root, 'package.json'), join(root, 'src/link'))
  assert.match((await run({ action: 'snapshot' })).error, /symbolic|符号|Too many levels/)
  await rm(join(root, 'src/link'))
  await exec('mkfifo', [join(root, 'src/pipe')])
  assert.match((await run({ action: 'snapshot' })).error, /普通文件/)
  const archive = join(root, 'project.zip')
  await writeFile(archive, sourceZip(source))
  const { stdout } = await exec('python3', ['-c', 'import zipfile,json,base64,sys;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print(json.dumps({n:base64.b64encode(z.read(n)).decode() for n in z.namelist()}))', archive])
  assert.deepEqual(JSON.parse(stdout), Object.fromEntries(source.map(file => [file.path, file.content.toString('base64')])))
  for (const path of ['dist/x', '.env.local', 'x/private.pem', '.vite-cache/x', '%2e%2e/secret', 'x/./y', 'x//y'])
    assert.throws(() => workspacePath(path))
})

it('Source 与 Artifact 分别遵守 200 文件、2 MiB 单文件、8 MiB 总量的真实采集边界', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'workspace-limits-')))
  const input = `${root}.json`
  onTestFinished(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(input, { force: true })
  })
  const script = `import os,pwd\npwd.getpwnam=lambda _:pwd.getpwuid(os.getuid())\n${FILE_SCRIPT.replace('ROOT=\'/workspace/project\'', `ROOT=${JSON.stringify(root)}`)}`
  const run = async (artifact: boolean) => {
    await writeFile(input, JSON.stringify({ action: 'snapshot', artifact }))
    return JSON.parse((await exec('python3', ['-I', '-S', '-c', script, input], { maxBuffer: 12 * 1024 * 1024 })).stdout)
  }
  await mkdir(join(root, 'dist'))
  for (const artifact of [false, true]) {
    const directory = artifact ? join(root, 'dist') : root
    await writeFile(join(directory, 'large.bin'), Buffer.alloc(2 * 1024 * 1024 + 1))
    assert.match((await run(artifact)).error, /2 MiB/)
    await rm(join(directory, 'large.bin'))
    for (let i = 0; i < 201; i++)
      await writeFile(join(directory, `${i}.txt`), '')
    assert.match((await run(artifact)).error, /200/)
    for (let i = 0; i < 201; i++)
      await rm(join(directory, `${i}.txt`))
    for (let i = 0; i < 4; i++)
      await writeFile(join(directory, `${i}.bin`), Buffer.alloc(2 * 1024 * 1024))
    assert.equal((await run(artifact)).files.length, 4)
    await writeFile(join(directory, 'overflow.bin'), 'x')
    assert.match((await run(artifact)).error, /8 MiB/)
    for (const name of ['0.bin', '1.bin', '2.bin', '3.bin', 'overflow.bin'])
      await rm(join(directory, name))
  }
})

it('声明式图片候选、poster、track 与图片按钮统一校验，不把 data URL 逗号拆成路径', () => {
  const valid = '<picture><source srcset="./assets/small.webp 400w, ./assets/large.webp 800w"><img srcset="data:image/png;base64,AAAA 1x, ./assets/large.webp?v=2 2x"></picture><video poster="./assets/small.webp"><track src="./captions.txt"></video><input type="image" src=" ./assets/small.webp ">'
  const files = ['assets/small.webp', 'assets/large.webp', 'captions.txt'].map(path => ({ path, content: Buffer.from('fixture') }))
  const validate = (html: string) => validateArtifact([{ path: 'index.html', content: Buffer.from(html) }, ...files])
  validate(valid)
  validate('<img srcset="./assets/small.webp, ./assets/large.webp">')
  validate('<img srcset="data:image/png;base64,AAAA,">')
  validate('<img srcset="data:image/png;base64,AAAA foo((x), ./assets/large.webp 2x">')
  for (const html of [
    '<img srcset="./missing.webp 1x">',
    '<source srcset="./assets/small.webp 1x, ./missing.webp 2x">',
    '<img srcset="data:image/png;base64,AAAA foo((x), ./missing.webp 2x">',
    '<img srcset="./assets/small.webp, ./missing.webp">',
    '<video poster="./missing.webp"></video>',
    '<track src="./missing.txt">',
    '<input type="image" src="./missing.webp">',
  ]) assert.throws(() => validate(html), /缺少引用资源/)
  for (const html of [
    '<img srcset="https://evil.test/assets/small.webp 1x">',
    '<img srcset="data:image/png;base64,AAAA foo((x), https://evil.test/missing.webp 2x">',
    '<source srcset="./assets/small.webp 1x, //evil.test/large.webp 2x">',
    '<video poster=" https://evil.test/assets/small.webp "></video>',
    '<img srcset="https:&#10;//evil.test/assets/small.webp 1x">',
  ]) assert.throws(() => validate(html), /相对路径/)
})

it('Artifact 根外普通/编码点段拒绝；非加载 link 不误拒绝，内联 CSS 与独立 CSS 同一校验', () => {
  const validate = (html: string, resources: Array<{ path: string, content: Buffer }> = []) => validateArtifact([{ path: 'index.html', content: Buffer.from(html) }, ...resources])
  const icon = { path: 'icon.svg', content: Buffer.from('<svg/>') }
  for (const path of ['../icon.svg', '%2e%2e/icon.svg', './assets/../../icon.svg'])
    assert.throws(() => validate(`<img src="${path}">`, [icon]), /构建目录/)
  validate('<link rel="canonical" href="./article"><link rel="canonical" href="https://example.test/article"><link rel="alternate" href="https://example.test/feed">')
  validate('<style>body{background:url(./icon.svg)}</style><i style="mask:url(./icon.svg#mask)">x</i>', [icon])
  for (const html of ['<style>body{background:url(./missing.svg)}</style>', '<i style="background:url(./missing.svg)">x</i>', '<link rel="stylesheet" href="./missing.css">', '<link rel="ALTERNATE STYLESHEET" href="./missing.css">', '<link rel="shortcut ICON" href="./missing.svg">'])
    assert.throws(() => validate(html), /缺少引用资源/)
  for (const html of ['<style>@import "https://evil.test/a.css";</style>', '<i style="background:url(//evil.test/icon.svg)">x</i>', '<link rel="stylesheet" href="https://evil.test/a.css">'])
    assert.throws(() => validate(html), /相对路径/)
  validateArtifact([{ path: 'index.html', content: Buffer.from('<html/>') }, { path: 'pages/inner.html', content: Buffer.from('<style>body{background:url(../icon.svg)}</style>') }, icon])
})

it('完整 dist 允许相对模块/CSS/图片、查询参数及 MIME；缺失、外网或不支持资源拒绝发布', () => {
  const files = [
    ['index.html', '<html><head><script type="module" src="./assets/main.js?v=1"></script><link rel="stylesheet" href="./assets/main.css"></head><body><img src="./icon.svg#icon"></body></html>'],
    ['assets/main.js', 'import { n } from "./chunk.js?q=2";document.title=String(n)'],
    ['assets/chunk.js', 'const message="from \'../missing.js\'";export const n=42'],
    ['assets/escaped.js', 'import { n } from "./\\u0063hunk.js";export {n}'],
    ['assets/main.css', 'body{background:url(../icon.svg)}.note::after{content:"url(./missing.svg)"}/* url(./also-missing.svg) */'],
    ['icon.svg', '<svg/>'],
    ['tmp/icon.svg', '<svg/>'],
    ['assets/runtime.js', 'const image=new Image();image.src="../tmp/icon.svg"'],
  ].map(([path, content]) => ({ path: path!, content: Buffer.from(content!) }))
  validateArtifact(files)
  assert.equal(artifactMime('assets/main.js'), 'text/javascript')
  assert.equal(artifactMime('icon.svg'), 'image/svg+xml')
  assert.throws(() => validateArtifact(files.filter(file => file.path !== 'icon.svg')), /缺少引用资源/)
  assert.throws(() => validateArtifact([{ path: 'index.html', content: Buffer.from('<script src="https://evil.test/a.js"></script>') }]), /相对路径/)
  assert.throws(() => validateArtifact([...files, { path: 'server.exe', content: Buffer.alloc(0) }]), /资源类型/)
  assert.throws(() => validateArtifact([...files, { path: 'node_modules/fake.js', content: Buffer.alloc(0) }]), /禁止/)
  assert.throws(() => validateArtifact([...files, { path: '.env', content: Buffer.from('SECRET') }]), /禁止/)
})
