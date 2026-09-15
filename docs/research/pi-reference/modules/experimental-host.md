# 实验宿主：Server、Coordinator、Worker 与 Relay

> 固定版本见 [source-snapshot](../source-snapshot.md)。这里解释 `coding-agent/src/experimental` 主路径；`mini` 是另一套实验，末节单独比较。仅静态研究，没有启动服务、真实模型或 Radius 连接。

## 1. 先画清进程职责

```text
Presentation
  → public Unix endpoint（稳定地址）
  → Coordinator（只做连接/消息路由）
  → Server generation（Session catalog、管理、附着路由）
  → Session Worker（持有真实 Session、AgentHarness、执行环境、服务）
  → 模型 / 文件 / shell
```

Coordinator 与 worker 的控制面走私有 JSONL；公开 Client/Server 数据面走 v8 CBOR framed protocol。不要把两者的版本、大小上限或鉴权方式混用。

| 文件 | 所有权 | 真实入口 |
| --- | --- | --- |
| [server.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/server.ts:521) | server profile、自动激活、catalog、plugins、relay、server lifetime | `activateServer` / `startServer` |
| [coordinator.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/coordinator.ts:43) | 当前 server generation、peer 连接、稳定 public endpoint | `CoordinatorConnection` / `runCoordinatorProcess` |
| [session-worker-manager.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/session-worker-manager.ts:98) | 一代 server 的 worker bookkeeping、pending demand、service request / subscription 路由 | `openSession` / `discover` |
| [session-worker.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/session-worker.ts:525) | writer 锁、Session / Harness、活动操作与需求、资源关闭 | `run` / `createCodingAgentHarness` |
| [services/worker.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/services/worker.ts:45) | built-in/plugin facets、每个 attachment 的 service endpoint | `createSessionWorkerServices` |
| [client-runtime.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/client-runtime.ts:58) | server discovery/activation、服务绑定、Radius reconnect | `openClientRuntime` |
| [services/connection.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/services/connection.ts:182) | attached/attaching/degraded、binding hydration generation | `SessionServiceSourceImpl` |
| [radius-relay.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/radius-relay.ts:111) | authenticated WebSocket byte transport、复用连接、缓冲上限、重连 | `RadiusRelayHost` / `RadiusClientReconnect` |

普通发布入口不应自动进入此路径；`commands.ts` 只处理 experimental enabled 下的 `server/client`。真实源码入口及包发布边界见 [工程工具](./repository-tooling.md)。

## 2. 冷启动如何避免重复 owner

1. `activateServer()` 选择逻辑 `serverId`，获得 activation lock，再次探测已有 server，避免并发客户端同时启动。
2. 必须新启动才接受启动期 model 参数；发现已有 server 后不会偷偷改它的默认模型。
3. `startServer()` 确保 private directory，构建插件选择，创建 coordinator、worker manager、catalog 与 backend listener。
4. backend `ServerHost.openSession()` 不在 server 里打开运行 Session；它把 metadata 交给 worker manager。
5. worker manager 以 **metadata.path** 合并已打开/正在打开的 worker；worker 自己对真实 session 文件拿 `proper-lockfile` 锁，再 `repo.open()`。
6. worker 创建 model runtime、read/write/bash、AgentHarness、main lane 与 FacetHost，资源就绪后发送 worker_ready。

[worker.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/session-worker.ts:533) 原文节选：

```ts
const releaseOwnership = await lockfile.lock(metadata.path, {
  realpath: true,
  stale: 2_000,
  update: 1_000,
  retries: { retries: 320, factor: 1, minTimeout: 25, maxTimeout: 25, maxRetryTime: 8_000 },
});
```

标注：这是本机文件 owner 策略，数字是当前实现配置；它不是多主机 DB fencing。云端应保留“真实资源 owner 在 worker 获取”的思想，同时用自己的数据库/调度器建立跨进程所有权。

`createCodingAgentHarness()` 使用新 harness 的 read/write/bash 三种工具，`resources: {}`，不是普通 CLI 全部工具、skills、extensions 的自动等价集合。

## 3. 替换 Server 为什么可以保留 Worker

Coordinator 收到新的 `register_server` 时换掉当前指针、关闭旧 public connections、通知 peers 旧代断开与新代连接，并告知旧 server 被替换。[registerServer](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/coordinator.ts:372)。

旧 server 调用 `workers.detach()`，只丢弃本代 bookkeeping，不关闭已存活 worker。新 server `discover()` 广播发现请求，存活 worker 回报 metadata/身份与插件路径；随后新 presentation 重新附着。worker 对新请求检查 `serverConnectionId` 与 attachment demand，旧代请求不得借用新代 owner。

**这不等于透明恢复所有请求**：旧连接 pending promise 被拒绝，旧订阅释放；新连接安装新快照。不会因为发现 worker 就重放所有旧 prompt。若 worker 本身已死，则下一次 attach 新建 worker、打开 durable Session；open operation 是否继续仍由 Lane/host 的恢复策略决定。

## 4. 生命周期不是“有连接就运行”

[WorkerLifecycle.#reconcile](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/session-worker.ts:302) 原文：

```ts
if (
  this.#retiring ||
  !this.#demandInitialized ||
  this.#retirementHolds !== 0 ||
  this.#activeOperations.size !== 0 ||
  this.#demands.size !== 0
) {
  return;
}
```

标注：startup grace、在途请求 hold、实际 operation activity、presentation demand 都影响退休。UI 断开不自动说明工作已无价值。worker 从 Harness 的 run/compaction/navigation start/end/suspend 事件维护 activity；因此这些事件在这个宿主中会影响进程存活，不能统称为纯观测。

server generation 自己另有 `ServerLifetime`：operator keepAlive、startup grace、连接数和 worker 数。两层计数不能相互替代。

关闭顺序是 services → harness/session → repo → executionEnv → release writer ownership；每步失败都继续执行下一步，单个错误原样抛出，多个才汇总为 AggregateError。资源关闭失败不被包装成正常成功。[closeResources](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/session-worker.ts:480)。

## 5. 业务服务与 transport 分开

`services/agent-controller-provider.ts` 把 AgentLane 转成 presentation-safe DTO；`prompt/steer/followUp/nextRun/requestAbort/resume/compact/navigate` 不暴露真实 Session 对象。`Transcript` 在 worker 上使用 `reduceLaneSnapshot`，发布完整 replicated state 给视图。`packages/server` 通用层只解析 Chord envelope 和路由；coding-agent 实验宿主另通过 `services/server.ts` 提供 SessionDirectory、SessionManagement、PresentationPlugins，拥有这些业务类型。

`services/worker.ts` 为 `{serverConnectionId, attachmentId}` 建独立 endpoint，subscription 生命周期也按这个 scope 清理。`services/connection.ts` 用 attachment revision 拒绝旧 hydration 的晚到完成；`degraded` 表示附着存在但服务水合失败。

这里的私有 attachmentId 由 WorkerManager 再生成，与 SessionRouter 给 public client 的 attachmentId 不同。public route 经 `RoutedSessionAttachment` lease 映射到私有 `{serverConnectionId, attachmentId}`；客户端不能拿 public ID 直接访问 worker。[manager.ts:212](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/session-worker-manager.ts:212)。

插件的 `src/session.ts` 与 `src/tui.ts` 分开构建和加载；选择按逻辑 serverId + Session 文件路径保存独立 profile，未按 Branch 保存。[plugins/package.ts:160](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/plugins/package.ts:160)。`/reload` 先准备候选，再 FacetHost cutover，最后释放旧 bundle generation。这里只是可信本机代码的热加载，不是租户隔离方案。

## 6. Radius：有传输鉴权，不等于云产品安全边界完整

`RadiusRelayAuthResolver` 每次连接重新解析显式 token/token file 或存储的 OAuth；`PI_OFFLINE` 禁止连接。host 可无凭据保持 local-only，client Radius 路径必须拿到凭据。[radius-auth.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/radius-auth.ts:16)。

`RadiusRelayHost` 建带 Bearer header 和明确 subprotocol 的 WebSocket，将 connection_id 分成独立 Server ByteConnection。数据帧包含 version/type + 16-byte UUID，host 控制帧另走 JSON。`OrderedWebSocketWriter` 按调用顺序发送，限制 pending bytes，观察 bufferedAmount，避免无限写入浏览器式 WebSocket 缓冲。

**重连范围**：基础 `pi-client` 只提供显式 reconnect；`RadiusClientReconnect` 这个产品 adapter 额外实现指数退避重连并重新 attach 最后选中的 Session。它仍不重发旧业务 prompt。[RadiusClientReconnect](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/radius-relay.ts:343)。

本仓包含的是 relay host/client 接入代码，不能据此推断外部 gateway 的授权实现。通用 protocol 服务 Context 中也没有完整的 authenticated tenant/workspace principal。因此我们必须单独定义云端授权；“已有 Radius token”不能证明每个 Session/工具/插件都经过租户校验。

## 7. mini 是另一个实验

`mini/shared/rpc.ts` 与 Chord services 不是同一套协议；mini 用 service name/method 转发、小型 peer 与显式 lane watch/start/unwatch，TUI 复用核心 reducer。

mini 的宿主在 services 就绪后显式遍历 `AgentHarness.create()` 返回的 `open`，为每个 operation 调 `restoredLane.resume()`；这是宿主选择的自动恢复策略，仍不表示 create 自己执行了副作用。[mini/worker/run.ts:95](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/mini/worker/run.ts:95)。主 experimental worker 的创建路径没有这段遍历，不能把两者的启动策略互换。

mini RPC 直接对解析后的 Frame 作类型断言，JSONL transport 没有主 protocol 的 strict envelope、帧长上限和有界写缓冲；转发函数也没有继续传递入站 AbortSignal。`socketTransport.listen()` 直接移除指定 socket 路径，不具备正式 Unix listener 的 inode 所有权保护。它适合学习少量代码怎样表达双向服务调用，不能作为公网/共享工作区的安全实现模板。[mini/shared/rpc.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/mini/shared/rpc.ts:92)、[mini/shared/transport.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/mini/shared/transport.ts:93)。

代码 [mini/server/run.ts](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/mini/server/run.ts:85) 对有 `to` 的 worker event 只发送给该 presentation，没 `to` 才广播。最后一个 presentation 断开时直接 `route.stop()`，不像上面 WorkerLifecycle 检查 active operation。README 中旧的广播 N²、`{rebase:true}` 描述不能覆盖当前代码；reducer 的实际重建信号是字符串 `"rebase"`。

**阅读价值**：mini 适合看懂跨进程“服务由 owner 提供”的最小表达；主 experimental 适合看生命周期与恢复复杂度。两者都不应整套作为我们云端生产底座直接采用。

## 8. 失败场景的现有测试入口

下列已核对实现和相关断言/场景，未执行整个测试文件：

| 文件 | 重点 |
| --- | --- |
| `test/experimental-remote-runtime.test.ts` | 冷启动竞争、两个 framed clients、generation 水合、worker 死亡/发现/退休 |
| `test/experimental-session-worker-lifecycle.test.ts` | demand + activity + hold 三者、orphan grace |
| `test/experimental-session-worker-manager.test.ts` | worker 私有路由、scope 与异常 |
| `test/experimental-radius-relay.test.ts` | multiplexed host connections、异常关闭、reconnect/reattach |
| `test/experimental-agent-controller.test.ts` | presentation-safe DTO 与 Lane 操作映射 |
| `test/experimental-internal-process.test.ts` | 当前 runtime 的进程入口、启动失败后等待终止 |

后续云端实验优先借这些**场景**，在自己的 fake model/fake tool/PostgreSQL 条件下复现；不为运行研究资料而直接连接真实 Radius 或启动本机 Agent。
