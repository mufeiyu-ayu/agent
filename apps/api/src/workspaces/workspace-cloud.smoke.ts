import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import OSS from 'ali-oss'
import { Sandbox } from 'e2b'
import { fetch, ProxyAgent } from 'undici'
import { BASH_SCRIPT, FILE_SCRIPT } from './sandbox-scripts.js'
import { WorkspaceCloudService } from './workspace-cloud.service.js'
import { fileHash } from './workspace-files.js'
import 'reflect-metadata'

/** 手动开发环境验收；不读写业务数据库，只操作本轮实例与 _checks/<runId>/ 对象。 */
async function main() {
  const cloud = new WorkspaceCloudService()
  assert.ok(cloud.configured, '请先确认开发环境并配置云端连接')
  const signal = AbortSignal.timeout(180_000)
  const runId = `smoke-${randomUUID()}`
  const sandboxIds = new Set<string>()
  let creationUnknown = false
  let objectKey: string | undefined
  const connection = {
    apiKey: process.env.E2B_API_KEY!.trim(),
    apiUrl: process.env.E2B_API_URL!.trim(),
    domain: process.env.E2B_DOMAIN!.trim(),
    validateApiKey: false,
    ...(process.env.OUTBOUND_PROXY_URL ? { proxy: process.env.OUTBOUND_PROXY_URL } : {}),
    requestTimeoutMs: 15_000,
  }
  // 删除权限仅供这个手动测试清理专用前缀；业务服务不提供任何删除 OSS 对象的入口。
  const storageOptions = { bucket: process.env.OSS_BUCKET!.trim(), region: process.env.OSS_REGION!.trim(), accessKeyId: process.env.OSS_ACCESS_KEY_ID!.trim(), accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!.trim(), secure: true, authorizationV4: true, enableProxy: false, timeout: 15_000 }
  const storage = new OSS(storageOptions)
  const dispatcher = process.env.OUTBOUND_PROXY_URL ? new ProxyAgent(process.env.OUTBOUND_PROXY_URL) : undefined
  console.log(`测试资源标识：${runId}`)

  async function create() {
    creationUnknown = true
    const sandbox = await cloud.create(runId, 180_000)
    creationUnknown = false
    sandboxIds.add(sandbox.sandboxId)
    console.log(`已分配测试实例：${sandbox.sandboxId}`)
    return sandbox
  }
  async function command(sandbox: Sandbox, command: string, timeout = 5) {
    return await cloud.request(sandbox, BASH_SCRIPT, { command, timeout }, signal, timeout * 1000 + 5_000) as { exitCode: number, stdout: string, stderr: string, truncated: boolean, timedOut: boolean }
  }
  async function listed() {
    const pager = Sandbox.list({ ...connection, query: { metadata: { app: 'kuro', runId } }, limit: 100 })
    const ids: string[] = []
    while (pager.hasNext) {
      for (const item of await pager.nextItems()) {
        if (item.metadata.runId === runId)
          ids.push(item.sandboxId)
      }
    }
    return ids
  }

  try {
    const first = await create()
    await cloud.request(first, FILE_SCRIPT, { action: 'restore', files: [] }, signal)
    await cloud.request(first, FILE_SCRIPT, { action: 'write', path: 'check.js', content: 'console.log(20 + )\n' }, signal)
    const invalid = await command(first, 'node --check check.js')
    assert.notEqual(invalid.exitCode, 0)
    assert.match(invalid.stderr, /SyntaxError/)
    const read = await cloud.request(first, FILE_SCRIPT, { action: 'read', path: 'check.js' }, signal) as { content: string }
    assert.match(read.content, /20 \+ \)/)
    await cloud.request(first, FILE_SCRIPT, { action: 'edit', path: 'check.js', edits: [{ oldText: '20 + )', newText: '20 + 22)' }] }, signal)
    const fixed = await command(first, 'node --check check.js && node check.js')
    assert.equal(fixed.exitCode, 0)
    assert.equal(fixed.stdout.trim(), '42')
    console.log('真实语法错误 → read → edit → 再次运行：通过')

    const redirectedAt = Date.now()
    assert.equal((await command(first, 'exec >/dev/null 2>&1; sleep 1')).exitCode, 0)
    assert.ok(Date.now() - redirectedAt >= 800)
    const output = await command(first, `python3 -c "import sys;print('x'*100000);sys.stderr.write('y'*100000+'END_ERROR')"`)
    assert.ok(output.stdout.length <= 32768 && output.stderr.length <= 32768)
    assert.ok(output.stderr.endsWith('END_ERROR'))
    assert.equal(output.truncated, true)
    assert.equal((await command(first, 'sleep 10', 1)).timedOut, true)
    console.log('输出关闭、头尾截断及命令超时：通过')

    assert.notEqual((await command(first, 'sudo -n true')).exitCode, 0)
    await first.files.write('/root/kuro-control-marker', 'control-plane-bypass', { user: 'root' })
    const control = await command(first, 'curl -fsS --max-time 3 \'http://127.0.0.1:49983/files?path=/root/kuro-control-marker&username=root\'')
    assert.notEqual(control.exitCode, 0)
    assert.equal(control.stdout.includes('control-plane-bypass'), false)
    const offline = await command(first, `python3 - <<'PY'
import asyncio,os,socket
assert os.getuid()!=0
assert not [k for k in os.environ if any(part in k.upper() for part in ('SECRET','TOKEN','API_KEY','ACCESS_KEY'))]
for family in (socket.AF_INET,socket.AF_INET6):
    try: socket.socket(family)
    except PermissionError: pass
    else: raise AssertionError('network socket allowed')
asyncio.run(asyncio.sleep(0.01))
print('OFFLINE_IPC_OK')
PY`)
    assert.equal(offline.exitCode, 0)
    assert.match(offline.stdout, /OFFLINE_IPC_OK/)
    console.log('非特权执行、凭据环境隔离、本机 envd 与 IPv4/IPv6 阻断、Unix IPC：通过')

    await command(first, `printf 'import os\nopen("/root/kuro-module-injection","w").write(str(os.getuid()))\nraise RuntimeError("module-shadow-probe")\n' > /home/user/base64.py
printf 'echo profile-injection > /root/kuro-profile-injection\n' > /home/user/.bash_profile`)
    await cloud.request(first, FILE_SCRIPT, { action: 'read', path: 'check.js' }, signal)
    assert.equal(await first.files.exists('/root/kuro-module-injection', { user: 'root' }), false)
    assert.equal(await first.files.exists('/root/kuro-profile-injection', { user: 'root' }), false)
    await first.files.remove('/home/user/base64.py', { user: 'root' })
    await first.files.remove('/home/user/.bash_profile', { user: 'root' })
    console.log('用户 Python 模块和 shell 配置不能以 root 执行：通过')

    // 由可信 SDK 起一个仅含测试文本的服务，只验证公网令牌门禁；不是模型可用的常驻服务能力。
    await first.commands.run('mkdir -p /tmp/kuro-inbound-check; echo harmless >/tmp/kuro-inbound-check/index.html', { user: 'user' })
    await first.commands.run('python3 -m http.server 8090 --bind 0.0.0.0 --directory /tmp/kuro-inbound-check', { user: 'user', background: true, timeoutMs: 0 })
    const response = await fetch(`https://${first.getHost(8090)}`, { ...(dispatcher ? { dispatcher } : {}), signal: AbortSignal.timeout(15_000) })
    await response.body?.cancel()
    assert.equal(response.status, 403)
    console.log('未带令牌的公网入站被拒绝：通过')

    await command(first, 'setsid sleep 30 >/tmp/kuro-background-check.log 2>&1 & echo started')
    assert.equal((await command(first, 'pgrep -f \'^sleep 30$\' || true')).stdout.trim(), '')
    const forked = await command(first, `python3 - fork-race-marker <<'PY'
import os,time
if os.fork()==0:
    os.setsid()
    for index in range(50):
        if os.fork()==0:
            time.sleep(10)
            os._exit(0)
        time.sleep(0.00001)
    time.sleep(10)
else:
    print('FORK_STARTED')
PY`, 10)
    assert.equal(forked.exitCode, 0)
    assert.match(forked.stdout, /FORK_STARTED/)
    assert.equal((await command(first, 'pgrep -f \'^python3 - fork-race-marker$\' || true')).stdout.trim(), '')
    console.log('setsid 与持续 fork 的后台子孙清理：通过')

    await command(first, 'ln -s /root shortcut')
    await assert.rejects(cloud.request(first, FILE_SCRIPT, { action: 'read', path: 'shortcut/kuro-control-marker' }, signal))
    await assert.rejects(cloud.request(first, FILE_SCRIPT, { action: 'write', path: 'shortcut/escape', content: 'x' }, signal))
    await assert.rejects(cloud.request(first, FILE_SCRIPT, { action: 'snapshot' }, signal))
    await command(first, 'rm shortcut')
    await cloud.request(first, FILE_SCRIPT, { action: 'write', path: 'bom.txt', content: '\uFEFFone\r\ntwo\r\n' }, signal)
    await cloud.request(first, FILE_SCRIPT, { action: 'edit', path: 'bom.txt', edits: [{ oldText: 'one\ntwo', newText: 'one\nthree' }] }, signal)
    const before = await cloud.request(first, FILE_SCRIPT, { action: 'snapshot' }, signal) as { files: Array<{ path: string, content: string }> }
    assert.equal(Buffer.from(before.files.find(file => file.path === 'bom.txt')!.content, 'base64').toString(), '\uFEFFone\r\nthree\r\n')
    await command(first, 'rm bom.txt')
    console.log('符号链接拒绝与 BOM / CRLF 精确编辑：通过')

    const snapshot = await cloud.request(first, FILE_SCRIPT, { action: 'snapshot' }, signal) as { files: Array<{ path: string, content: string }> }
    assert.equal(snapshot.files.length, 1)
    const content = Buffer.from(snapshot.files[0]!.content, 'base64')
    const sha256 = fileHash(content)
    objectKey = `_checks/${runId}/objects/${sha256}`
    console.log(`测试 OSS 对象：${objectKey}`)
    const file = { path: 'check.js', bytes: content.length, sha256, key: objectKey }
    await cloud.putFile(file, content, signal)
    await cloud.putFile(file, content, signal)
    assert.equal(await first.kill(), true)
    const saved = await cloud.readFile(file, signal)
    const second = await create()
    await cloud.request(second, FILE_SCRIPT, { action: 'restore', files: [{ path: file.path, content: saved.toString('base64') }] }, signal)
    assert.equal((await command(second, 'node check.js')).stdout.trim(), '42')
    console.log('OSS 不可变上传重试 → 原沙箱释放 → 哈希校验 → 新沙箱恢复：通过')
  }
  finally {
    const cleanup = await Promise.allSettled([
      (async () => {
        // 先释放已知实例，列表查询失败也不能阻止这些清理请求。
        await Promise.all([...sandboxIds].map(id => Sandbox.kill(id, connection)))
        for (const id of await listed())
          await Sandbox.kill(id, connection)
        assert.deepEqual(await listed(), [])
        assert.equal(creationUnknown, false, '创建结果未知，无法排除迟到实例')
        console.log('本轮全部测试实例已核对不在云端列表')
      })(),
      (async () => {
        if (!objectKey)
          return
        await storage.delete(objectKey)
        await assert.rejects(storage.head(objectKey), (error: unknown) => !!error && typeof error === 'object' && 'code' in error && error.code === 'NoSuchKey')
        console.log('本轮测试对象已删除，并通过 HeadObject 确认不存在')
      })(),
    ])
    await dispatcher?.close()
    if (cleanup.some(result => result.status === 'rejected')) {
      console.error(`测试资源清理未确认，请按上述 ${runId} 与对象 key 核查，不能视为已清理`)
      process.exitCode = 1
    }
  }
}

main().catch((error: unknown) => {
  // SDK 错误对象可能携带请求头，禁止完整打印。
  console.error('真实云验收失败：', error instanceof Error ? error.name : 'UnknownError')
  process.exitCode = 1
})
