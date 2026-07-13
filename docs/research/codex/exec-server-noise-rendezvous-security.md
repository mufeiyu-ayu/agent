# Exec Server Noise Rendezvous、Registry Authority 与 Presence恢复

[Exec Server会话租约、断线重连与进程输出恢复](./exec-server-session-recovery.md) 研究了逻辑Session怎样跨物理连接存活。本文继续向下一层追问：远程环境中的新物理连接如何证明“连到正确Executor”，Executor又如何证明“这个Harness被允许使用当前环境”？

Codex没有把Rendezvous WebSocket本身当作可信application channel，而是组合了三种authority：

```text
Registry control plane
  -> 分配signed rendezvous URL、registration ID、public key和短期authorization

Rendezvous routing plane
  -> 按streamId转发protobuf frame，可见路由metadata和ciphertext

Noise end-to-end channel
  -> 双向key possession、Executor key pinning、payload加密与record完整性
```

这套设计的核心不是“WebSocket外面再套一层加密”，而是把**发现、授权、路由、密码学身份、应用会话恢复**分成不同层，并在每层使用不同generation和预算。

## 1. 证据范围

本文基于 Codex fork `main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`，主要阅读：

- `codex-rs/exec-server/src/remote.rs`
- `codex-rs/exec-server/src/environment_registry.rs`
- `codex-rs/exec-server/src/client_transport.rs`
- `codex-rs/exec-server/src/client_recovery.rs`
- `codex-rs/exec-server/src/client_api.rs`
- `codex-rs/exec-server/src/noise_channel.rs`
- `codex-rs/exec-server/src/noise_relay/mod.rs`
- `codex-rs/exec-server/src/noise_relay/harness.rs`
- `codex-rs/exec-server/src/noise_relay/executor_stream.rs`
- `codex-rs/exec-server/src/noise_relay/ordered_ciphertext.rs`
- `codex-rs/exec-server/src/noise_relay/message_framing.rs`
- `codex-rs/exec-server/src/relay.rs`
- `codex-rs/exec-server/src/proto/codex.exec_server.relay.v1.proto`
- Noise、relay、client transport与remote环境相关测试

## 2. 五个身份与三个平面

### 2.1 五个身份

| 身份 | 谁生成/返回 | 生命周期 | 作用 |
| --- | --- | --- | --- |
| environmentId | Registry / 配置 | 云端环境 | 选择目标环境 |
| executorRegistrationId | Registry | 一次Executor registration generation | 绑定presence与Noise prologue |
| Executor Noise identity | Executor进程 | 进程 | Responder静态DH+KEM key |
| Harness Noise identity | Harness进程/EnvironmentManager | 进程内环境client | Initiator静态DH+KEM key |
| streamId | Harness每次连接 | 单个virtual stream | Rendezvous路由与prologue防splice |

这五个ID共同定义一次连接，却不能互相替代。

例如：

- environmentId不证明当前Executor registration仍在线；
- registrationId不证明Harness拥有某个Noise private key；
- streamId只是untrusted routing key；
- Session ID属于Noise通道内的JSON-RPC协议，不能替代外层Harness授权。

### 2.2 三个平面

#### Control Plane

Registry处理：

- Executor register；
- Harness connect bundle；
- Executor验证Harness key authorization；
- environment online/offline等presence错误。

#### Routing Plane

Rendezvous处理：

- physical WebSocket；
- streamId multiplexing；
- Resume/Handshake/Data/Reset等protobuf frames；
- ciphertext转发；
- signed URL的连接准入。

#### End-to-End Data Plane

Noise处理：

- Executor key pinning；
- Harness static key possession；
- registry authorization作为加密handshake payload；
- JSON-RPC confidentiality/integrity；
- ordered transport nonce。

## 3. Registry的三个RPC

### 3.1 Executor Register

Executor向：

```text
POST /cloud/environment/{environmentId}/register
```

发送：

- security profile：`noise_hybrid_ik_v1`；
- Executor public key。

Registry返回：

- environmentId；
- signed Rendezvous URL；
- security profile；
- executorRegistrationId。

客户端校验returned environmentId和security profile，避免把其他环境或未知协议配置接受为当前registration。

### 3.2 Harness Connect

Harness provider向：

```text
POST /cloud/environment/{environmentId}/connect
```

发送自己的Harness public key。

Registry返回一个不可拆分bundle：

- Harness signed Rendezvous URL；
- environmentId；
- security profile；
- executorRegistrationId；
- Executor public key；
- harnessKeyAuthorization。

URL、registration ID、Executor key和authorization必须来自同一次response。

### 3.3 Executor Validate

Executor从第一个Noise IK message恢复出经过密码学认证的Harness static public key，再向：

```text
POST /cloud/environment/{environmentId}/validate
```

发送：

- executorRegistrationId；
- authenticated Harness public key；
- handshake payload里的harnessKeyAuthorization。

只有Registry明确返回 `valid=true`，Executor才完成Responder handshake并创建JSON-RPC virtual stream。

## 4. 为什么要同时验证Key与Authorization

如果只有signed Rendezvous URL：

- URL泄漏者可能占用stream；
- Rendezvous是routing authority，却被迫成为application identity authority。

如果只有Harness public key：

- 证明“这是某个key owner”，但不能证明该key当前被允许访问此environment/registration。

如果只有authorization string：

- token被转移到另一个key后仍可能使用。

当前组合是：

```text
Noise first message proves Harness key possession
+ encrypted payload carries short-lived Registry authorization
+ Executor sends key + authorization + registrationId回Registry求交
```

密码学认证回答“是谁”，Registry回答“当前是否允许”。

## 5. Hybrid IK Channel

当前suite标识为：

```text
Noise_hybridIK_X25519+MLKEM768_AESGCM_SHA256
```

包含：

- X25519；
- ML-KEM-768；
- AES-GCM；
- SHA-256；
- Hybrid IK pattern。

Public key结构带suite字段，并启用 `deny_unknown_fields`。解码时同时校验：

- suite完全匹配；
- X25519 base64与长度；
- ML-KEM base64与长度。

这避免“字段长度看起来正确，就把其他协议的key误用到当前suite”。

### 5.1 Harness pin Executor

Harness在生成任何JSON-RPC data前，把Registry返回的Executor X25519和KEM public key同时设置为expected responder static key。

如果Rendezvous把连接路由到持有另一把private key的Executor，handshake失败，不会fallback到plaintext。

### 5.2 Executor先解析，再授权，再Complete

Executor收到first IK message后可以：

- 验证initiator确实持有Harness static keys；
- 提取Harness public key；
- 解密authorization payload。

但此时只得到 `PendingResponderHandshake`，还不是可用transport。

Registry validation成功后才调用complete，生成第二条handshake response并进入transport mode。

这条边界很关键：**authenticated不等于authorized**。

## 6. Prologue防止跨Registration/Stream拼接

双方在handshake前构造相同prologue：

```text
domain = codex-exec-server-relay-noise/v1
environmentId
executorRegistrationId
streamId
```

每个part前写8字节big-endian长度，避免原始字符串拼接的边界歧义。

prologue进入Noise transcript，所以：

- 捕获的handshake不能搬到另一个environment；
- 不能搬到更新后的registration；
- 不能搬到另一个streamId；
- future protocol domain不会与v1混淆。

测试明确覆盖mismatched stream prologue会被Responder拒绝。

## 7. Authorization只在加密Handshake Payload中出现

Harness先发送cleartext relay控制frame声明streamId，然后发送opaque first IK message。

harnessKeyAuthorization作为Noise handshake payload写入，在发送前已用pinned Executor key保护。

Rendezvous能看到：

- environment signed URL连接；
- streamId；
- frame kind；
- relay seq；
- ciphertext长度与时序。

Rendezvous看不到：

- JSON-RPC plaintext；
- authorization plaintext；
- private keys。

Registry会看到public keys和authorization，因为它负责授权决策。

## 8. Physical Executor WebSocket与Virtual Streams

一个远程Executor只维持一条到Rendezvous的physical WebSocket，却可承载最多128个已认证virtual streams。

每个virtual stream最终被转换成普通 `JsonRpcConnection`，交给同一个ConnectionProcessor。因此内层Session、process/read和恢复机制不需要理解Noise细节。

```text
Physical Rendezvous WebSocket
  -> stream A -> Noise transport A -> JsonRpcConnection A
  -> stream B -> Noise transport B -> JsonRpcConnection B
  -> stream C -> Noise transport C -> JsonRpcConnection C
```

### 8.1 每个Stream有独立Noise nonce state

virtual stream各自持有NoiseTransport、outbound seq、inbound reorder state和JSON-RPC decoder。

一个stream的密码学状态不会与另一个stream复用。

### 8.2 Stream instance generation

streamId由untrusted relay peer提供，可能被复用。

Executor给每个激活stream配一个instanceId。writer迟到退出时，只有 `streamId + instanceId`仍匹配当前map项，才可删除。

这与SessionRegistry的connectionId fencing是同一种思想：用generation防止旧清理误伤新实例。

### 8.3 Validation generation

Registry validation异步执行。重复handshake可在旧validation未结束时复用streamId。

pending state保存validationId；结果回来时必须同时匹配streamId与validationId。旧validation结果不能激活新handshake。

## 9. Handshake资源治理

Executor在physical relay上设置：

- 最多128个active streams；
- 最多32个并行pending validations；
- 每次Registry validation最多10秒；
- authorization最多4096 bytes且必须UTF-8；
- 累计8次失败handshake后关闭physical relay。

### 9.1 先做cheap checks

收到handshake frame时先检查：

- streamId是否已有active stream；
- 是否已有pending handshake；
- active streams是否满；
- validation slots是否满。

通过后才支付Hybrid IK解析和Registry call成本。

### 9.2 Validation不阻塞shared read loop

Registry call放入JoinSet。一个慢validation不会阻止其他stream frames被读取。

### 9.3 失败不暴露细节

validation失败：

- warn只记录generic authorization_failed；
- debug只记录streamId，不展开error；
- client只收到generic Reset；
- 不完成Noise transport。

Registry validator对非成功response也特意不读取/拼接body，避免服务端错误体回显短期authorization后进入日志。

## 10. 失败预算的可用性权衡

8次失败handshake后关闭的是整条physical Executor relay，不只是恶意stream。

优点：

- 阻止未授权peer无限触发昂贵Hybrid handshake；
- 阻止无限Registry validation；
- 让可能已被滥用的signed URL快速失效/重连。

代价：

- 一个能向该physical relay注入frames的peer可让所有active virtual streams断开；
- failure counter没有在成功handshake后清零，是connection-lifetime累计预算；
- 合法客户端会进入上层Session recovery。

它把confidentiality/authentication保持fail closed，但可用性故障半径仍是physical connection级。

## 11. Slow Stream隔离

physical read loop不能await单个virtual stream的consumer，否则一个慢Session会阻塞所有streams。

所以Executor inbound delivery使用bounded `try_send`：

- queue有空间：交付JSON-RPC event；
- full或closed：该virtual stream返回protocol error、被remove并Reset；
- physical relay继续服务其他streams。

这是正确的per-tenant backpressure isolation方向。

### 11.1 Outbound仍共享Physical Queue

每个stream writer把encrypted frames发送到容量128的physical outgoing queue。writer可以await该queue。

physical writer或Rendezvous拥塞会同时影响所有streams，只是不会让shared inbound loop被单个consumer阻塞。

## 12. 为什么Ciphertext必须先排序再解密

Noise transport使用implicit receive nonce。第N条ciphertext必须以第N个nonce解密。

Rendezvous frame显式携带u32 seq，接收端先进入OrderedCiphertextFrames：

- 旧seq或重复seq忽略；
- future seq暂存；
- gap补齐后按连续顺序释放；
- 最大乱序距离64；
- pending ciphertext总计最多1 MiB；
- seq绝不wrap。

如果先按网络到达顺序调用Noise decrypt，合法乱序也会消耗错误nonce并永久破坏channel。

### 12.1 Duplicate保留First Ciphertext

同一seq第二份ciphertext不会覆盖第一份pending内容。

否则攻击者可在gap关闭前替换已缓存record，改变之后实际进入AEAD验证的bytes。

### 12.2 Outbound Record只Encrypt一次

每个JSON-RPC message先framing，再分成60 KiB plaintext records。每个record：

1. 取一次u32 seq；
2. 调用一次Noise encrypt消耗send nonce；
3. 包成RelayData；
4. 发送。

失败后不能重新encrypt同一逻辑record并假装仍是原seq，因为Noise send nonce已经前进。

当前relay层没有实现record retransmission；连接失败交给更上层重建新Noise channel与Exec Session recovery。

## 13. 两层Framing预算

### 13.1 WebSocket Frame

Tungstenite在protobuf解析前限制：

- max frame：256 KiB；
- max message：256 KiB。

### 13.2 Noise Record

Clatter单message上限约65,535 bytes，应用选择60 KiB plaintext record，给AEAD与relay metadata留余量。

### 13.3 JSON-RPC Message

一个JSON-RPC message可达64 MiB：

- 前置4字节authenticated length；
- 分片成多个Noise records；
- receiver逐record解密；
- decoder按length重组。

decoder会在只拿到length prefix时就拒绝：

- length=0；
- length>64 MiB。

避免authenticated peer声明巨大长度后让receiver无限等待/扩容。

### 13.4 Proto中的Segment字段当前不做分片层

RelayData带 `segment_index`和`segment_count`，当前Data constructor固定0/1。真正的大消息分片发生在Noise record stream和4字节JSON length层，而不是proto segment层。

## 14. Ack/Resume字段存在，但当前不提供Transport Resume

Relay proto定义：

- ack；
- ack_bits；
- RelayAck；
- RelayResume.next_seq；
- Heartbeat。

当前实现：

- constructor把ack/ack_bits设为0；
- Harness起始发送Resume(next_seq=0)声明stream；
- Ack/Resume/Heartbeat收到后基本忽略；
- 没有ciphertext replay store；
- 没有acked record回收；
- 没有physical WebSocket重连后续传同一NoiseTransport。

因此“Resume”目前更接近stream claim/control verb，不是完整可靠传输协议。

真正的恢复发生在更上层：

```text
physical relay断开
  -> 新Registry connect bundle
  -> 新WebSocket
  -> 新streamId
  -> 新Noise handshake
  -> initialize(resumeSessionId)
  -> process/read补输出
```

## 15. Keepalive与Write Deadline

生产环境：

- 每30秒发送WebSocket Ping；
- Pong deadline 60秒；
- Ping flush成功后才开始计算Pong时间；
- write也受同一个watchdog deadline保护。

Harness发送大JSON-RPC时，每60 KiB record回到select loop一次，为keepalive与inbound control frame提供调度点。

Pong deadline到期后，Harness最多再检查32个已经排队的frames，让排在data后面的Pong有确定性机会被消费，随后才判断timeout。

这是针对“写侧持续ready饿死读侧”的细致公平性处理。

## 16. Cleartext Reset只作为Availability Signal

Reset属于Rendezvous控制frame，不受Noise认证。攻击者可伪造reason text。

实现因此：

- 不把peer reset reason写日志；
- 不把原reason传给上层diagnostics；
- 统一替换为 `Noise relay stream reset`；
- 将其视为disconnect/availability事件，不视为可信错误解释。

这体现了很好的“控制信号可用，但附带文本无authority”边界。

## 17. Executor Registration生命周期

remote Executor进程启动时：

1. 生成一次Noise identity；
2. Register并取得URL/registrationId；
3. 连接Rendezvous；
4. 在一条physical WebSocket上服务virtual streams；
5. 断线后复用同一registration response重连；
6. 只有Rendezvous握手返回任意4xx，才重新Register；
7. backoff从1秒指数增长到30秒，成功连接后重置。

测试明确验证：普通disconnect继续复用旧URL；下一次连接收到401后才发生第二次register。

### 17.1 Identity与Registration分离

重新Register仍复用同一个Executor Noise identity。Registry generation更新，但Executor key continuity保持到进程结束。

### 17.2 Registry失败会终止Remote Loop

首次register或因4xx触发的re-register使用 `?` 传播错误。

若Registry暂时5xx/timeout/auth failure，`run_remote_environment`会结束，而不是在内部继续backoff。

Rendezvous普通connect失败会backoff重试，Registry register失败却没有对称的长期恢复FSM。

## 18. Harness Bundle生命周期

EnvironmentManager为一个Noise remote environment生成一次Harness Noise identity，并把Registry provider保留在ReconnectStrategy中。

每次physical连接尝试：

1. 用稳定Harness public key请求fresh connect bundle；
2. 使用bundle的signed URL打开WebSocket；
3. pin bundle里的Executor key；
4. 把bundle authorization放入first IK payload；
5. 用bundle registrationId构造prologue。

### 18.1 初次401特例

初始Noise连接若WebSocket handshake返回401：

- 丢弃旧bundle；
- 向Registry再取一次fresh bundle；
- 只重试一次初始open。

这处理signed URL在获取后到使用前已过期的常见竞态。

### 18.2 Recovery每次都取Fresh Bundle

Session recovery中的每一轮 `resume_once` 都调用provider，因此不会反复使用已经失败的URL/authorization。

Registry errors中以下被视为暂时可重试：

- connect/timeout；
- 5xx；
- 408；
- 429；
- 409 + `environment_offline`；
- WebSocket connect/timeout；
- initialize timeout；
- Session already attached。

Noise Registry重试使用500ms起步、最高5秒、带确定性jitter的指数退避，并受Session recovery总25秒deadline限制。

## 19. Presence目前是错误码推断，不是显式状态机

当Executor physical relay断开时，Registry/Rendezvous可能暂时把环境标为offline。Harness connect会得到：

```text
409 environment_offline
```

Client recovery把它当暂时错误继续重试。

源码TODO已指出这仍是coarse retry：系统没有显式的Registry/presence recovery FSM来区分：

- Executor正在重连；
- Executor已经永久停止；
- registration被撤销；
- environment被删除；
- Registry projection暂时延迟；
- signed URL分配暂不可用。

所以当前逻辑是“在25秒窗口内乐观认为offline可能恢复”，而不是基于presence generation做确定性判断。

## 20. 值得学习的实现

### 20.1 Registry与Rendezvous分权

Rendezvous负责路由，不拥有最终Harness authorization；Executor在Noise认证key后回Registry求交。

### 20.2 Endpoint双向key确认

Harness pin Executor；Executor从IK message认证Harness。两端都不只依赖WebSocket URL。

### 20.3 Bundle作为原子Value Object

URL、registration、Executor key、authorization封装为同一bundle，避免一串同类型String在call site被错配。

### 20.4 Authenticated后仍需Authorized

PendingResponderHandshake在Registry成功前不能产生application stream。

### 20.5 Prologue绑定业务generation

environment、registration和stream identity进入密码学transcript，不只是明文metadata。

### 20.6 Secret-aware Error Handling

- Connect response Debug隐藏URL和authorization；
- validation错误体不进入error；
- Reset reason不可信且不透传；
- signed Harness URL在WebSocket error中去掉query/fragment作为diagnostic URL。

### 20.7 多层预算

- WebSocket 256 KiB；
- Noise record约60 KiB；
- JSON-RPC 64 MiB；
- reorder distance 64；
- pending ciphertext 1 MiB；
- virtual streams 128；
- validations 32；
- authorization 4096 bytes；
- failed handshakes 8；
- validation 10秒。

### 20.8 Per-stream Failure Isolation

慢consumer的inbound queue满只Reset当前stream，不阻塞整个physical reader。

### 20.9 Generation Fencing重复出现

- executorRegistrationId；
- streamId；
- validationId；
- virtual stream instanceId；
- inner Session connectionId。

每层都保护不同ABA问题，没有用一个“global connection version”勉强覆盖全部状态。

## 21. 已确认的风险与限制

### 21.1 environmentId只trim，不做Path Segment编码

`normalize_environment_id`只拒绝空字符串。之后直接拼入：

```text
/cloud/environment/{environmentId}/register|connect|validate
```

没有URL path-segment encoding或字符allowlist。包含 `/`、`?`、`#`或dot segments的environmentId可能改变请求路径语义。

即使正常部署只传服务端生成UUID，边界层也应把该不变量写成类型或校验。

### 21.2 Base URL只做字符串trim

base URL没有在构造时解析成URL、限制scheme或剥离userinfo/query。endpoint通过字符串format拼接。

错误会在后续reqwest阶段暴露；包含credential的base URL也可能通过Debug进入日志，因为EnvironmentRegistryClient和RemoteEnvironmentConfig会显示base_url。

### 21.3 Register没有显式HTTP Timeout

connect_environment设置10秒request timeout；Harness validate由外层10秒timeout包裹。

register_environment没有 `.timeout`，Reqwest client也未设置global timeout。初始register或re-register可能长期等待。

### 21.4 Executor Rendezvous Connect没有显式Timeout

Executor侧 `connect_rendezvous`直接await `connect_async_with_config`。Harness侧open有connect timeout，Executor侧没有对称预算。

DNS/TCP/TLS/WebSocket握手卡住时，1-30秒backoff尚未开始。

### 21.5 Register失败结束整个服务循环

短暂Registry故障可能让remote environment task直接退出，需要更外层supervisor重启。当前函数内没有register retry/backoff、circuit state或readiness receipt。

### 21.6 Executor backoff没有Jitter

Rendezvous断线后所有Executor按1、2、4、8、16、30秒节奏重连，集群故障恢复时可能同步惊群。

Harness recovery的Registry路径已经有jitter，Executor侧尚不一致。

### 21.7 任意4xx都会触发Re-register

Rendezvous WebSocket handshake只要是client_error就丢弃旧registration并重新Register。

这不区分：

- signed URL过期；
- auth撤销；
- bad request；
- forbidden；
- rate limit 429。

其中一些应刷新registration，另一些应backoff或永久失败。当前分类较粗。

### 21.8 Register/Auth错误仍可能带Body Preview

普通Registry register/connect的401/403会从body提取message；其他HTTP error也保留最多“4096字符”的preview。

常量名写bytes，但实现按Unicode chars截取，实际UTF-8 bytes可更大。若Registry错误体回显敏感请求信息，仍可能进入error chain。

Harness key validate路径已主动抑制body，两类RPC的secret hygiene不一致。

### 21.9 Registration Response的Debug未隐藏URL

ConnectResponse自定义Debug会隐藏signed URL和authorization；RegistrationResponse直接derive Debug，其中包含URL。

当前主路径没有直接debug整个response，但类型级默认仍容易被未来日志误用。

### 21.10 Physical Relay是共享故障域

累计8个失败handshake、Pong timeout、physical writer/read错误都会断开所有virtual streams。

Session recovery能缓解短断线，但高输出进程仍受30秒Session和1 MiB retained output窗口限制。

### 21.11 ACK/Resume是Protocol占位，不是已实现可靠性

看到proto字段不能推断支持ciphertext retransmission或physical stream resume。当前应用恢复依赖新Noise channel和上层process replay。

### 21.12 64 MiB单Message仍然很大

decoder有硬上限，但authenticated peer仍可让每个stream分配接近64 MiB；128 streams理论并发会形成明显内存压力。

没有physical relay级总reassembly memory budget。

### 21.13 Harness身份只在进程内

NoiseChannelIdentity随机生成，没有持久化。Harness进程重启后会使用新public key和新authorization，原身份不会延续。

这适合ephemeral client，但不能作为跨进程用户设备identity。

### 21.14 Presence无Generation Receipt

Harness只得到environment_offline等错误，不知道：

- Registry观察到的registration generation；
- last seen time；
- Executor是否正在backoff；
- 预计是否可恢复；
- environment是否永久终止。

因此恢复只能在固定deadline内试探。

## 22. 对当前 AI SEO Agent 的迁移建议

当前项目暂时不需要Noise relay，但远程Tool Runner、浏览器执行器或客户私有网络Connector会遇到同类问题。

### 22.1 分离四类Authority

```text
Tenant Auth
  -> 谁可以请求远程执行

Runner Registry
  -> 哪个Runner generation服务哪个tenant/environment

Relay
  -> 只负责连接和路由

End-to-End Session
  -> 保护tool input/output并绑定Runner identity
```

不要让一个signed WebSocket URL同时承担用户授权、Runner发现和应用会话身份。

### 22.2 Bundle必须是Typed Object

```ts
interface RunnerConnectBundle {
  environmentId: string
  registrationId: string
  relayUrl: string
  runnerPublicKey: string
  clientAuthorization: string
  expiresAt: string
  bundleId: string
}
```

所有字段应来自同一Registry response，且bundle只使用一次。

### 22.3 Presence需要显式状态机

```ts
type RunnerPresence =
  | { state: 'registering'; generation: string; since: string }
  | { state: 'online'; generation: string; lastHeartbeatAt: string }
  | { state: 'reconnecting'; generation: string; retryAfterMs: number }
  | { state: 'offline'; generation: string; recoverable: boolean; reason: string }
  | { state: 'revoked'; generation: string; reason: string }
```

Client recovery必须比较generation，不能把所有offline都当暂时冲突。

### 22.4 Tool副作用仍需应用层幂等

加密通道只能保证传输机密性与完整性，不能解决：

- 请求已执行但response丢失；
- Runner重连后的重复Tool Call；
- 外部API是否重复提交。

仍需operationId、durable receipt和Tool-specific compensation。

### 22.5 Relay Metadata也属于敏感信息

即使payload端到端加密，Relay仍能观察：

- 哪个environment何时在线；
- stream fan-out；
- message size/timing；
- disconnect frequency。

多租户系统应限制metadata retention与访问审计，不能把“看不到plaintext”理解为“Relay没有隐私数据”。

## 23. 建议的验证矩阵

### Identity与Authorization

- [ ] Harness拒绝错误Executor static key。
- [ ] Executor拒绝Registry未授权Harness key。
- [ ] token转移到另一Harness key后验证失败。
- [ ] registrationId变化后旧handshake失败。
- [ ] streamId变化后捕获handshake不能重放。
- [ ] unknown suite/field/key length全部fail closed。

### Secret Hygiene

- [ ] signed URL query不会进入Debug/Error/telemetry。
- [ ] authorization不会进入validation error body。
- [ ] Registry 401/500回显secret时被redact。
- [ ] unauthenticated Reset reason不会进入用户错误或日志。
- [ ] base URL credential在构造阶段拒绝。

### Resource Governance

- [ ] 第129个active stream被独立Reset。
- [ ] 第33个pending validation不触发Registry call。
- [ ] authorization第4097 byte被拒绝。
- [ ] 第8个失败handshake关闭physical relay。
- [ ] future seq超过64或pending超过1 MiB关闭stream。
- [ ] 单stream inbound queue满不阻塞其他stream。
- [ ] 64 MiB JSON与physical总内存预算协同生效。

### Recovery

- [ ] 首次signed URL 401会取fresh bundle一次。
- [ ] 每个Session recovery attempt使用新bundle。
- [ ] environment_offline只在matching generation且recoverable时重试。
- [ ] Executor register 5xx会backoff，不退出supervisor。
- [ ] reconnect含jitter且遵守server retry hint。
- [ ] 新Noise channel恢复后process/read补齐断线输出。

## 24. 结论

Noise Rendezvous最值得学习的是分权与代际边界：

```text
Registry授权
+ Rendezvous路由
+ Hybrid IK双向key确认
+ prologue绑定environment/registration/stream
+ per-stream generation fencing
+ application-level Session replay
```

它明确做到：Rendezvous可以提供可用性，但不能解密JSON-RPC；Noise可以证明key possession，但最终访问权仍由Registry决定；physical transport可以重建，但进程事实由更上层Session机制恢复。

当前主要缺口不在密码学primitive，而在运维状态机：Registry register没有稳定重试预算，Executor connect无显式timeout/jitter，presence只通过粗粒度error code推断，proto中的ACK/Resume也尚未成为真正可靠传输。

这提醒云端Agent：安全通道只是底座。真正可维护的远程执行还需要明确的presence generation、typed connect bundle、资源预算、应用副作用幂等和可验证恢复receipt。
