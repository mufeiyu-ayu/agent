# MCP OAuth Transaction：Discovery、Callback身份、Store Pinning与Refresh Fencing

本文研究 Codex 如何为Streamable HTTP MCP server执行OAuth登录、保存凭据、判断认证状态并在多进程环境下刷新rotating refresh token。重点不是OAuth协议入门，而是本地Agent同时面对浏览器callback、多个credential backend、并发client与不确定网络结果时，怎样避免把旧token重新写回。

源码事实基于：

- Codex：`/Users/lihaoran/Desktop/codex`，`main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`
- 当前项目：`/Users/lihaoran/Desktop/agent`，研究起点 `master@5f2ad11f2c65425e84392e81048364d55ec626ef`
- 主要入口：`codex-rs/rmcp-client/src/{perform_oauth_login,auth_status,oauth}.rs`、`rmcp-client/src/oauth/**`、`codex-rs/codex-mcp/src/mcp/auth.rs`

## 1. MCP OAuth不是一次“拿Token”，而是四段生命周期

```text
Discovery
  -> Login callback + authorization code exchange
  -> Credential store resolution and persistence
  -> Client startup / refresh / reauthorization
```

每段的authority不同：MCP/Authorization Server声明metadata，浏览器用户授权，本地callback完成correlation，Keyring/File持有耐久事实，运行中AuthorizationManager持有请求时快照。

只实现浏览器跳转而不设计store与refresh，就无法成为可恢复认证系统。

## 2. OAuth只适用于Streamable HTTP Transport

Config validation拒绝stdio MCP上的`oauth`与`oauth_resource`。Stdio server的认证应通过进程env或其他本地机制完成，不存在远程HTTP OAuth discovery语义。

Transport capability应在配置解析阶段就约束，而不是运行到登录按钮才报“不支持”。

## 3. 认证优先级先尊重显式Bearer

Auth status判断顺序：

1. 配置了`bearer_token_env_var`，视为BearerToken。
2. 合成headers已有Authorization，视为BearerToken。
3. Stored OAuth token可用，视为OAuth。
4. Token存在但不可刷新，要求Reauthentication。
5. 无token才做OAuth discovery。

这避免已有静态credential时又弹出浏览器登录。它只判断配置/存储存在性，不验证Bearer真的被server接受；真实连接的401仍是最终事实。

## 4. Discovery有5秒Deadline，错误降级为Unsupported

AuthorizationManager读取OAuth metadata；成功返回supported scopes，无authorization support返回None。Auth status层对其他discovery error只debug并投影为Unsupported。

好处是认证状态探测不阻塞整个MCP catalog；风险是网络超时、TLS错误和真正不支持在UI里看起来一样。产品应至少区分：

```text
Unsupported
DiscoveryFailed/Unknown
LoggedOut
ReauthenticationRequired
```

Codex上层的login support已有`Unknown(error)`概念，但status projection仍会丢失这层信息。

## 5. Scope来源有明确优先级

`resolve_oauth_scopes()`选择：

```text
API explicit scopes
  > MCP config scopes
  > discovered scopes_supported
  > empty
```

显式配置为空数组也会保留“明确不请求scope”的意图，不fallback discovered。若discovered scopes导致provider error，可特定重试一次without scopes；显式/配置scope失败不会偷偷降权重试。

这使scope是可解释决策，而不是多个来源简单union后越要越多。

## 6. Login默认绑定Loopback Ephemeral Callback

未配置callback时：

- 在`127.0.0.1:0`启动tiny_http server。
- 从真实listener address生成redirect URI。
- 默认callback wait 300秒。
- Guard drop时unblock server。

可配置固定port，但0被拒绝；未指定才由OS选ephemeral。固定端口利于预注册redirect URI，也更容易冲突与被本地其他进程抢占。

## 7. Custom Callback URL会改变Listener Exposure

即使设置外部`callback_url`，本地listener仍会启动：

- URL host是localhost/loopback时绑定127.0.0.1。
- URL host是其他域名时绑定`0.0.0.0`。

这显然是为了接受外部转发callback，但也把本地HTTP listener暴露给所有网卡。CSRF state仍保护授权提交，然而LAN可发送无效请求、占用处理资源或探测登录状态。

更稳做法是外部callback service通过一次性operation ID转发到loopback/IPC，而不是直接开放本地端口。

## 8. Callback Path绑定MCP Server URL

Codex会：

1. 解析server URL并去掉fragment。
2. SHA-256后取前9 bytes，base64url为12字符callback ID。
3. 追加到redirect URI path。

同一listener上的不同MCP server因此有不同callback path，错误path只返回400且继续等待。

这是namespace隔离，不是secret。Server URL通常可猜，真正防CSRF依赖OAuth state与PKCE/AuthorizationManager session。

## 9. Callback Parser做Route与参数形状校验

Server只接受预期route，并解析：

- `code` + `state`成功候选。
- `error` / `error_description` provider error。
- 其他为Invalid并返回400。

成功候选会立即给浏览器返回“Authentication complete”，随后异步`handle_callback()`才校验state并交换token。若state错误或token endpoint失败，浏览器已经看到成功文案，CLI/调用方却最终失败。

UI回执应在安全验证与耐久保存完成后再宣称成功，或先写“callback received, completing authentication”。

## 10. State/PKCE由Authorization Session持有

本地callback parser只提取code/state；真正的CSRF state验证、授权码交换及PKCE相关状态交给RMCP OAuthState/AuthorizationManager处理。

分层是合理的：HTTP listener不应重写协议逻辑。但Codex必须保证同一个`oauth_state`实例从authorization URL生成活到callback处理结束，不能在中间仅持久化URL后丢失verifier/session。

## 11. 显式Client ID与动态注册走不同路径

未配置client ID时，`OAuthState::new...start_authorization()`处理discovery/动态client注册。显式client ID时，Codex自行discover metadata、配置`OAuthClientConfig(client_id, redirect_uri, scopes)`并获取authorization URL。

显式ID适合预注册公共client；动态注册适合MCP server支持DCR的场景。两者都必须把同一redirect URI用于authorization与token exchange。

## 12. RFC 8707 Resource作为Authorization Query参数

可选`oauth_resource`经URL query API追加到authorization URL；空白忽略，URL parser失败才fallback手动encoding。

Resource是token audience约束，不应被混入scope或store key的自然语言字段。当前Stored token identity主要基于server name+URL，resource变化没有进入store key，可能复用面向旧resource的credential并依赖server拒绝后重登。

## 13. Login Handle把“URL已生成”与“登录完成”分开

无浏览器模式返回：

- authorization URL。
- oneshot completion receiver。

调用方可以先把URL投影给客户端，再异步等待callback与持久化。`wait()`只在后台flow真正完成后成功。

这是正确的两阶段协议：`login/start`不是`login/completed`。操作identity仍较弱，Handle没有公开login ID、cancel API或可查询status，进程重启后无法恢复等待中的flow。

## 14. Token只有持久化成功后Login才成功

Callback通过后：

1. 从OAuthState读取client ID和credentials。
2. 计算absolute `expires_at`。
3. 组装StoredOAuthTokens。
4. 写credential backend。
5. 才返回Ok。

浏览器授权成功但本地store失败会让整个login失败，这是正确的可恢复标准：没有耐久凭据，下一次启动仍是LoggedOut。

## 15. Stored Token绑定Server Name、完整URL与Client ID

持久对象保存：

- server name。
- server URL。
- client ID。
- access/refresh/scopes等token response。
- absolute expiry milliseconds。

Store key为`server_name | hash(type=http, url, empty headers)`。完整URL变化会生成不同key；header、scope、resource与client ID不进入key。

因此改server auth上下文但保留name+URL时可能读到旧token。加载后应校验stored client/resource/config fingerprint，而不仅是key命中。

## 16. Expiry使用Absolute Timestamp避免重启漂移

OAuth response的`expires_in`在保存时转换为epoch millis；加载时重新计算remaining duration。已过期会显式设`expires_in=0`，促使startup在首请求前refresh，而不是把missing expiry误当永不过期。

Refresh提前30秒触发，减少token在网络请求途中刚过期的概率。系统时钟回拨/跳变仍会影响判断，OAuth expiry本身只能依赖wall clock。

## 17. Store有Auto、File、Keyring三种Policy

- File：`$CODEX_HOME/.credentials.json`。
- Keyring：OS-specific keyring/Secrets backend。
- Auto：startup keyring-first，missing/unavailable时fallback File。

Local dev build会强制File以简化环境；正式配置可被managed layer固定。

“Auto”不是每次读写都随时换backend，否则rotating refresh token会在两处形成双重authority。

## 18. Client Lifecycle会Pin具体Credential Store

Startup resolve出`ResolvedOAuthCredentialStore`后，当前client的：

- reread。
- refresh persist。
- delete。

都只操作该store。中途Keyring失败会报错，不fallback旧File。

这是本专题最关键的不变量：refresh transaction必须有唯一authoritative store。动态fallback虽然提高可用性，却可能把已轮换refresh token分裂到两个backend。

## 19. Auto Fallback只在Backend Failure，不在Coordination Failure

Keyring backend不可用时Auto可读/写File；但Secrets aggregate-store lock失败时不会fallback。因为lock失败意味着另一个writer可能正在改变authority，此时读File可能看到被新Secrets token遮蔽的旧credential。

“访问失败”需要区分：

- backend unavailable，可按policyfallback。
- lock/lease unavailable，不知道是否有并发commit，必须停止。

这是所有多存储fallback系统都值得学习的分类。

## 20. Aggregate Store用Cross-process File Lock保护RMW

File与Secrets都存多个MCP server的聚合document，所以整个load-modify-write期间持store lock。Direct keyring每credential独立，不用aggregate lock。

Lock：

- 位于`$CODEX_HOME/mcp-oauth-locks`。
- 50ms轮询。
- 最长等待60秒。
- contention发专用debug event。

同步store lock使用`std::thread::sleep`，如果在async runtime worker上调用可能阻塞线程；这类I/O最好封装`spawn_blocking`或采用async lock service。

## 21. File Store写入并非Crash-safe Atomic Replace

Fallback file使用`fs::write`直接覆盖JSON，之后Unix再chmod 0600。风险：

- 崩溃留下truncated JSON，所有MCP credential都无法解析。
- 新建到chmod之间权限取决于umask，存在短暂窗口。
- 没有temp+fsync+rename。
- 聚合文件单点损坏影响全部server。

File lock解决并发writer，不解决断电durability。Credential store必须同时设计mutual exclusion与atomic persistence。

## 22. Auto写Keyring成功后Best-effort清理File

Keyring selected时先保存新token，再尝试删除fallback File entry。清理失败只warning，Keyring仍是优先authority。

这保证不会为了“清理旧副本”回滚已成功登录。但旧File credential仍是敏感残留；若未来Keyring读取失败，Auto可能fallback并复活旧token。

需要durable backend-selection marker或tombstone，防止已迁移的旧credential再次成为authority。

## 23. Refresh使用Per-credential Cross-process Lock

Refresh lock key来自server+URL store key的SHA-256，持有范围覆盖：

```text
authoritative reread
  -> provider refresh request
  -> persist
  -> install into manager
```

最长等待60秒、50ms轮询。不能在provider请求期间释放，因为rotating refresh token只允许一个进程消费。

Lock只在同一CODEX_HOME内协调；不同home但共享Direct Keyring的进程没有共同rendezvous，源码TODO明确这是缺口。

## 24. Lock后必须Reread，而不是相信Lock前Snapshot

`last_credentials`只用于快速判断是否可能过期。获得refresh lock后重新从pinned store读取：

- 已被其他进程删除：清manager并要求重新授权。
- 已被其他进程刷新且未临期：直接adopt winner，不请求provider。
- 仍过期：才继续refresh。

这就是标准double-check locking；没有第二次读取，排队等待的每个进程都会依次消费同一个旧refresh token。

## 25. Refresh Transaction独立于Caller Cancellation

一旦provider可能消费rotating token，refresh在owned Tokio task中继续，caller取消不会中断后续persist。Provider request另有45秒timeout，lock acquire也独立有界。

这是ambiguous commit系统的正确方向：用户请求超时不能随意杀掉已经可能改变外部状态的事务。

但provider timeout本身仍意味着结果未知；后续允许serialized retry，若provider已轮换token却response丢失，重试旧token可能失败并要求重新登录。

## 26. Refresh先Persist，再更新当前Manager

成功拿到new token后：

1. Provider若省略refresh token/scopes，继承previous值。
2. 写pinned credential store。
3. 再把token装入AuthorizationManager。
4. 更新`last_credentials`。

耐久事实优先意味着进程在第2步后崩溃，新进程仍能读新token。反向顺序会让当前请求成功、重启却丢失rotated token。

若persist成功但manager install失败，当前client报错且内存可能陈旧，但耐久store已可恢复；错误信息明确指出这一partial commit。

## 27. AuthorizationManager Lock覆盖Provider Refresh

Transaction安装latest token后持有manager mutex调用refresh，再安装结果。这防止其他请求看到credential staging中间态。

代价是慢token endpoint会阻塞同client所有auth操作最长45秒。更理想模型是generation swap：旧token仍可服务未过期请求，refresh完成后原子替换；过期token则请求排队在共享singleflight future上。

## 28. RMCP错误类型不足导致过度Reauthentication

当前RMCP把`invalid_grant`等确定拒绝与transient token endpoint failure都折叠进`TokenRefreshFailed(String)`。Codex为了兼容把该variant统一映射为AuthorizationRequired。

结果是临时provider故障也可能要求用户重新登录。协议adapter应保留：

- definitive invalid refresh token。
- transient 5xx/network。
- rate limit/retry-after。
- malformed provider response。

错误分类直接决定是否清状态、重试或打扰用户。

## 29. RMCP Scope-upgrade内部状态尚未原子同步

Persist后通过InMemoryCredentialStore重建AuthorizationManager credential、client ID与granted scopes；源码TODO指出无法同步RMCP私有`current_scopes`。

因此“token已刷新并持久化”不保证scope-upgrade state完全一致。依赖私有第三方状态的adapter需要上游原子adoption API，不能靠多次setter拼出事务。

## 30. `WWW-Authenticate` Scope Challenge有专用严格Parser

HTTP adapter解析Bearer `insufficient_scope`：

- 支持多个challenge与逗号/分号分隔。
- 正确处理quoted-string与backslash escaping。
- 重复/无值参数视为invalid。
- scope字符集按RFC约束。

它不会用简单`split(',')`，避免quoted value破坏解析。认证header是敌对输入，parser必须fail closed且有fuzz/边界测试。

## 31. Logout/Delete跨多个Backend仍可能Partial

Delete尝试Keyring与File；Auto/Keyring模式下Keyring删除失败会返回错误，不继续把File删掉。Secrets backend还可能同时清legacy direct keyring与Secrets。

这是保守策略：无法确认主authority删除时，不伪装“已登出”。但多backend删除不是原子操作，可能已经删掉一个副本、另一个失败。

Logout响应应返回per-store结果与可重试operation，而不是只有boolean。

## 32. Auth Status是投影，不等于Connection事实

Stored token被认为Usable的条件：

- client ID非空。
- 未临期时access token非空。
- 临期时refresh token非空。

它不联系server验证token是否吊销、audience/scope是否正确。真实MCP startup仍可能401并进入refresh/reauth flow。

UI应把它叫“stored credential available”，而不是“已成功连接”。

## 33. 对当前 AI SEO Agent 的迁移价值

当前项目若接入第三方OAuth Tool，应优先迁移这些边界：

```text
OAuthConnection          -> tenant/user/provider identity
OAuthLoginOperation      -> state + PKCE + callback deadline
CredentialGeneration     -> durable encrypted authority
RefreshLease             -> per connection singleflight/fencing
ToolCredentialSnapshot   -> AgentRun/ToolCall-bound token generation
```

尤其不要：

- 把access/refresh token交给前端或模型。
- 把callback成功等同于token已持久化。
- 多实例无锁刷新rotating token。
- refresh失败就无差别删除credential。
- 在一个明文JSON聚合文件里保存所有租户secret。

## 34. 可验证的不变量清单

未来实现OAuth Tool时可先写这些测试：

1. Callback route、state和PKCE任一不匹配都不能换token。
2. Login只有credential耐久保存后才成功。
3. 同一login operation只能完成一次。
4. Callback deadline后operation terminal，迟到callback不复活。
5. 同一credential generation同时只有一个refresh transaction。
6. Lock后reread并adopt并发winner。
7. Refresh调用可能轮换后，caller取消不终止persist。
8. Persist成功、内存adopt失败可由新实例恢复。
9. Backend authority在一个client lifecycle内不漂移。
10. Store lock失败不会fallback旧credential。
11. File/DB credential写入使用atomic replace与严格初始权限。
12. Definitive invalid_grant与transient failure采取不同状态转移。
13. Logout partial commit可查询并可幂等重试。
14. 日志与错误永远不包含code、access token、refresh token或Authorization header。

## 35. 最终结论

Codex MCP OAuth最值得学习的是对rotating credential的事务意识：登录callback只是入口，真正可靠性来自唯一store authority、cross-process lock、锁后reread、caller cancellation隔离、persist-before-adopt和明确reauth状态。

当前实现的强项是scope provenance、server-bound callback path、RMCP state校验、Keyring/File策略、lifecycle store pinning、aggregate/credential双层锁、refresh double-check、durable-first commit和严格WWW-Authenticate parser；主要风险是custom callback绑定0.0.0.0、浏览器过早显示成功、等待中的login不可跨重启恢复、store key不含resource/client/scope、File直写与chmod-after-write、跨CODEX_HOME Keyring refresh未协调、provider timeout ambiguous result、错误类型导致过度reauth、scope-upgrade state不原子和logout跨store partial commit。

对云端Agent而言，OAuth token不是普通配置值，而是会被外部provider轮换的共享状态机。谁持有当前generation、谁能刷新、刷新结果是否已耐久提交，必须比“请求头怎么加Bearer”更早设计。
