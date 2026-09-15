# Chord、协议与多端附着

> 证据版本见 [source-snapshot](../source-snapshot.md)。这组包及 coding-agent 的接入属于新实验路径。普通 CLI 仍有另一套主链。

## 1. 分工与目录

| 目录 | 实际职责 | 适合学习什么 |
| --- | --- | --- |
| `packages/chord/src/facets/` | 同步声明服务依赖，校验完整图，按依赖激活，逆序释放，替换同形状插件 | 应用组合与资源所有权 |
| `chord/src/services/` | provider / consumer、稳定 facade、singleton / keyed instance、state replication、wire grammar | 服务契约与进程边界分离 |
| `chord/src/delta/` | JSON 状态变化、immutable apply、路径编码 | 把 mutable owner 投影为独立读端 |
| `chord/src/context/` | 显式 Context 值、派生取消、只取消等待者 | 控制信号的作用域 |
| `chord/src/node/` | 插件构建、manifest、SHA 校验、独立加载代际 | 加载与激活分开，失败候选可清理 |
| `packages/protocol/src/` | v8 envelope、strict JSON、CBOR 与长度帧 | 路由层不拥有业务 DTO |
| `packages/server/src/` | handshake、连接请求、SessionRouter、ByteConnection 与 Unix listener | 同一会话多个读端、旧 route 拒绝 |
| `packages/client/src/` | Connection 状态机、请求关联、订阅水合、显式 reconnect | UI 生命周期与 worker 生命周期分离 |
| `coding-agent/src/experimental/services/` | AgentController / Transcript / Models / Sessions / Plugins 的具体服务 | 产品定义能力，基础包只负责机制 |

Chord 不依赖其他 Pi workspace 包，不能把它称为 Agent Loop 库。它的 Context 也不是 LLM prompt context。导出入口：[api.ts](/Users/ayu/Learn/pi/packages/chord/src/api.ts:19)、[types.ts](/Users/ayu/Learn/pi/packages/chord/src/types.ts:1)。

## 2. Facet 如何从声明变成可调用服务

入口 [FacetKernel.activate](/Users/ayu/Learn/pi/packages/chord/src/facets/host.ts:388) 的原文节选：

```ts
this.#phase = "assembling";
const externalServices = await this.#resolveExternalServices(records);
this.#activationOrder = validateFacets(records, externalServices);
this.#assembleProviders();
this.#bindServices(externalServices);
```

标注：`setup()` 只允许同步声明 `provide/use/observe`，返回 Promise 会失败；先拿齐依赖再校验重复 provider、singleton/keyed 不匹配、缺依赖和环。随后等待所有 remote binding 的初始 snapshot，才按拓扑序激活。setup 时持有的 handle 尚不能调用服务。

`env.own()` 与 `onDeactivate()` 都纳入资源释放序列，启动中途失败也会清理；不是“构造了一半就留给 GC”。[FacetLifecycle](/Users/ayu/Learn/pi/packages/chord/src/facets/host.ts:59) 与 [validateFacets](/Users/ayu/Learn/pi/packages/chord/src/facets/host.ts:808) 可一起读。

`reload()` 要求原来的服务 requirements/provisions 形状不变。候选先 setup / activate / validate，再替换 singleton 路由，最后清理旧代；cutover 后失败会撤销服务访问并终止 host，不能说成任意失败都无损回滚。[reload](/Users/ayu/Learn/pi/packages/chord/src/facets/host.ts:423)。

**云端取舍**：我们先沿用 NestJS module/DI 与现有 service 边界。值得借的是显式资源所有权、候选校验和生命周期顺序；只有真要动态加载多个可替换功能时，再讨论独立插件 runtime。

## 3. 状态复制的闭环

```text
worker 的 lane.watch snapshot
→ Transcript 服务在 worker 上 reduceLaneSnapshot
→ 修改 tracked state 并 publish
→ Chord Delta batch（每次 publication 只 flush 一次）
→ 每个 subscription 独立 path codec
→ pi-protocol service_update
→ Client 先装 snapshot、再 start updates
→ replica 检查 sequence、immutable apply
→ TUI 读取完整 value
```

证据：[Transcript provider](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/services/transcript-provider.ts:20)、[MutableReplicatedStateImpl](/Users/ayu/Learn/pi/packages/chord/src/services/state.ts:6)、[state-codec](/Users/ayu/Learn/pi/packages/chord/src/services/state-codec.ts:64)、[Client.subscribeService](/Users/ayu/Learn/pi/packages/client/src/client.ts:172)。

这里有两层订阅：worker初始化FacetHost时，Transcript facet先建立一个共享的 `lane.watch()` 并持续维护state；之后各客户端通过自己的Chord endpoint订阅已有state，取得独立snapshot/updates，不再创建Lane watch。见 [worker装配](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/services/worker.ts:67) 与 [Transcript.activate](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/services/transcript-provider.ts:72)。mini的每个presentation单独watch是另一套实现。

[ReplicatedStateReplica.update](/Users/ayu/Learn/pi/packages/chord/src/services/state.ts:97) 原文：

```ts
if (sequence !== this.#sequence + 1) {
	this.clear();
	throw new Error("Replicated state update sequence has a gap");
}
const value = applyImmutable(this.#value, ops);
```

标注：缺包时旧 replica 被清掉，不能继续假装新鲜。这个 sequence 是状态复制序号，不是 durable Session 的 seq，也不是模型 token 序号。`subscribe()` 返回 snapshot 与 `start()` 两阶段，解决“安装快照期间更新已经到达”的竞争。

这条流提供 UI 状态重建，不保证副作用 exactly once。它也不是一套数据库日志：Transcript 可以筛掉只服务运行层的事件，具体过滤见 `toLaneWatchEvent()`。

**云端取舍**：保留单个权威 reducer 和 snapshot + cursor 的恢复方式；先用我们已有 contracts 与 NDJSON/SSE 表达，量化重复传输成本后才考虑 Delta 压缩。不要让 Vue、Admin、worker 各维护一套业务 reducer。

## 4. 三个路由 ID 解决三个不同问题

[protocol.ts](/Users/ayu/Learn/pi/packages/protocol/src/protocol.ts:40) 原文：

```ts
const SessionTargetSchema = StrictObject({
	serverId: ServerIdSchema,
	sessionId: IdSchema,
	attachmentId: IdSchema,
});
```

| 字段 | 含义 | 不能替代 |
| --- | --- | --- |
| `serverId` | 本安装/配置的逻辑 server 身份 | 用户/租户身份、进程 PID |
| `sessionId` | durable Session 身份 | 当前 socket |
| `attachmentId` | 当前 presentation 附着得到的临时能力标识 | 长期 session 主键 |

[Server.handleRequest](/Users/ayu/Learn/pi/packages/server/src/server.ts:306) 的检查顺序是：请求 ID 不得与本连接活跃请求重复 → `parseServiceCall` 结构校验 → `serverId` 不符抛 `WrongServerError` → 有 `sessionId` 的目标交给 SessionRouter，后者按连接找到 attachment，核对 session 和 attachment ID，过期路由失败（[SessionRouter.requireAttachment](/Users/ayu/Learn/pi/packages/server/src/session-router.ts:224)）。请求 ID 去重与结构校验先于身份校验。

`SessionManagement.attach()` 的业务响应不返回路由 ID；router 安装路由后通过独立 `attachment` 消息通知 client。管理操作和 transport 控制数据分开。相同连接重复 attach 同一 Session 幂等；不同连接可以附着同一 Session。

主 experimental 宿主还有一层私有身份：SessionRouter 创建 public attachmentId；WorkerManager 另生成 private attachmentId，并以 `{serverConnectionId, attachmentId}` 路由给 worker。两者由 lease 关联，不能直接互换。源码分别在 [SessionRouter:168](/Users/ayu/Learn/pi/packages/server/src/session-router.ts:168) 与 [WorkerManager:212](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/session-worker-manager.ts:212)。

## 5. 断线、取消与退出

- **RPC cancel**：按 request ID + 同一个 target 找 AbortController，传入 Context；不把所有 run 一起取消。
- **connection disconnect**：客户端拒绝 pending request、清 attachment / subscriptions；`reconnect()` 是显式连接动作，不自动重发命令。[Client](/Users/ayu/Learn/pi/packages/client/src/client.ts:345)。
- **attachment release**：先等待已准入的 service call settle，再释放 worker attachment。[releaseAttachment](/Users/ayu/Learn/pi/packages/server/src/session-router.ts:234)。
- **worker retirement**：presentation demand、执行中的 run/compaction/navigation、临时 retirement hold 都为零，才可退休。[WorkerLifecycle](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/session-worker.ts:191)。
- **server replacement**：由实验性 coordinator / worker manager 处理，本层 public protocol 不拥有 worker 生命周期。

`awaitWithContext()` 只取消当前 waiter，不会取消原 Promise；显式 `lane.requestAbort()` 才表达运行取消意图。[context/index.ts](/Users/ayu/Learn/pi/packages/chord/src/context/index.ts:97)。

**云端取舍**：浏览器关页默认应只失去订阅；是否停止运行是产品策略，必须显式区分。DB lease/fencing、鉴权和租户校验是独立问题，不能从这些内存 Map 和随机 ID 推导出分布式安全性。

## 6. 校验、安全与实现限度

`parseClientMessage()` 同时检查 TypeBox envelope 与 strict JSON；业务 payload 的语义在 Chord/application adapter 再校验。[codec.ts](/Users/ayu/Learn/pi/packages/protocol/src/codec.ts:20)。CBOR 帧默认 16 MiB，4 字节 big-endian 长度，支持 fragmentation/coalescing；decoder 错误后进入 failed，EOF 残帧失败。[framing.ts](/Users/ayu/Learn/pi/packages/protocol/src/framing.ts:44)。

Chord 的 service token TypeScript 类型检查、service/member allowlist、世代检查不等同于用户权限。基础 experimental transport 没有实现 peer authentication / authenticated service Context；源码 server 中仍使用 `TODO_CONTEXT`。[protocol README](/Users/ayu/Learn/pi/packages/protocol/README.md)、[server handshake](/Users/ayu/Learn/pi/packages/server/src/server.ts:259)。

插件 loader 的 SHA-256 校验保证加载内容与 manifest 一致，`compileFunction()` 和限制 external imports 并不是 OS sandbox。当前 host 同进程执行插件，云端不能以此安全运行不可信租户代码。[bundle-loader.ts](/Users/ayu/Learn/pi/packages/chord/src/node/bundle-loader.ts:170)。

## 6.5 传输插槽、服务端缓冲与控制面认证

这三处是云端接浏览器时最直接要复刻的部分，正文前几节没有单独点名。

**传输插槽**：客户端只依赖 [ByteTransport / ByteTransportFactory](/Users/ayu/Learn/pi/packages/client/src/transport.ts:1)（`send(chunk)` 有序、`close()` 幂等，回调 `onData/onClose/onError` 恰好一个终态），服务端对应 `ByteConnection / ServerListener`（`packages/server/src/connection.ts`、`listener.ts`）。Unix socket 与 Radius WebSocket 都是这个接口的实现；浏览器 WebSocket 接入应实现同一接口，而不是改 Client/Server。

**服务端订阅缓冲**：[server.ts:334-344](/Users/ayu/Learn/pi/packages/server/src/server.ts:334) 在 `subscribe` 响应发出前把该订阅到达的 update 放进 `pendingUpdates`，响应发出后再按序补发；客户端一侧对应 `queuedWireUpdates`（[client.ts:184](/Users/ayu/Learn/pi/packages/client/src/client.ts:184)）与 `start()` 放行。两侧合起来才构成"先装快照、再有序更新"的保证；只做客户端一半会在快照与首个 update 之间丢包。

**控制面认证**：主 experimental 的 server→worker 私有通道有最小认证：[WorkerManager 启动 worker 时](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/session-worker-manager.ts:457) 生成随机 `token` 并把 `sessionKey`（会话文件路径）经环境变量注入，worker 的每条 `service_update` 都回带 `token + sessionKey`（[session-worker.ts:529](/Users/ayu/Learn/pi/packages/coding-agent/src/experimental/session-worker.ts:529)）。这与公开 protocol 层的 `TODO_CONTEXT`（无 principal）形成对比：进程间控制面有"谁在说话"，客户端数据面没有"谁在请求"。云端两层都要有，并且要落到租户身份。

**wire 控制调用**：Chord 在业务服务之外只有三个控制成员——`$chord.service.catalogue / subscribe(subscriptionId, serviceId, mode) / unsubscribe(subscriptionId)`（[wire.ts:39](/Users/ayu/Learn/pi/packages/chord/src/services/wire.ts:39)），快照与更新的 wire 形状是 `{ instances[].members[] }` 与 `state/unavailable/replaced/spawned/closed` 五种 update。这是浏览器客户端真正要说的"API"，业务方法都通过 `ServiceCall { serviceId, member, args, instance? }` 泛化传递。

## 7. 接着读哪些测试

以下是源码行为证据，是否执行以 [verification](../verification.md) 为准。优先用进程内基建复现场景，不连真实 socket：`packages/server/src/testing/`（`createTestServer / TestServerHost / ProtocolTestClient`）与 [chord loopback](/Users/ayu/Learn/pi/packages/chord/src/services/loopback.ts) 提供无网络的 provider/consumer 对接。

- `packages/chord/test/facets.test.ts`：缺依赖、环、激活与逆序 disposal。
- `packages/chord/test/services.test.ts`：singleton/keyed、snapshot、sequence、替换与失效。
- `packages/chord/test/service-wire.test.ts`、`delta.test.ts`：wire grammar 与状态操作边界。
- `packages/server/test/server.test.ts`、`conformance.test.ts`：附着隔离、关闭与路由。
- `packages/client/test/client.test.ts`：请求关联、订阅水合、断开与重连。
- `packages/protocol/test/protocol.test.ts`、`framing.test.ts`、`cbor/cbor.test.ts`：非法输入、帧截断和尺寸限制。

实现多端时先选“同一会话两个 presentation，其中一个断开”，沿 `Client → Server → SessionRouter → Worker → AgentController/Transcript` 走完，再研究 Chord 内部的 Proxy 实现。
