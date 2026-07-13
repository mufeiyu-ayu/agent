# Managed Network Proxy：域名策略、Sandbox出口、MITM与凭据Broker边界

本文研究 Codex 如何把“允许命令联网”从一个布尔开关，拆成受管理代理、域名策略、Sandbox loopback出口、动态审批、HTTPS方法检查、请求归因和凭据虚拟化。重点是网络权限为什么不能只靠`HTTP_PROXY`环境变量，也不能只靠操作系统Sandbox。

源码事实基于：

- Codex：`/Users/lihaoran/Desktop/codex`，`main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`
- 当前项目：`/Users/lihaoran/Desktop/agent`，研究起点 `master@5f2ad11f2c65425e84392e81048364d55ec626ef`
- 主要入口：`codex-rs/network-proxy/src/**`、`codex-rs/core/src/config/network_proxy_spec.rs`、`codex-rs/sandboxing/src/**`、`codex-rs/exec-server/src/process_sandbox.rs`

## 1. Managed Network 是“唯一出口 + 应用策略”组合

总体链路：

```text
merged config + managed requirements + exec-policy network rules
  -> NetworkProxySpec / validated constraints
  -> local HTTP + SOCKS listeners
  -> command-scoped proxy env + CA env + attribution token
  -> OS sandbox仅允许连接代理loopback ports
  -> proxy检查enabled/mode/domain/local/MITM/policy decision
  -> direct或upstream dial
  -> structured audit + blocked buffer
```

环境变量负责让兼容客户端主动走代理；OS Sandbox负责阻止不兼容或恶意客户端绕开代理直连。缺少任一层都不能叫“强制策略”。

## 2. Proxy支持HTTP与SOCKS5两类入口

默认概念端口为HTTP 3128、SOCKS5 8081；Codex managed builder在非Windows平台预留loopback ephemeral listeners，避免固定端口冲突。Windows优先尝试managed loopback端口，占用时fallback ephemeral。

HTTP代理覆盖HTTP、HTTPS CONNECT和常见WebSocket客户端；SOCKS5覆盖更通用TCP，配置还可开启UDP。不同协议在Limited mode下能力不等价，不能把“代理已启动”当作所有流量都可精确检查。

## 3. Listener默认收缩到Loopback

即使配置请求non-loopback bind，除非显式启用危险开关，否则会clamp到`127.0.0.1:<port>`。启用Unix socket proxy时也强制listener仅loopback，避免把本机daemon桥接给远端机器。

监听地址是安全边界，不只是部署参数。一个策略正确但监听`0.0.0.0`的代理，可能变成绕过认证访问内网的open proxy。

## 4. Effective Config 来自普通层、可信Requirements与Exec Policy

`NetworkProxySpec`保留：

- base config。
- optional managed requirements。
- effective config。
- constraints。
- allowlist miss是否hard deny。

Managed requirements可以固定enabled、mode、upstream proxy、危险开关、domains、Unix sockets与local binding；Exec Policy还能编译出network allow/deny domains并upsert进配置。

这比只在启动时读取TOML多一步：最终运行配置必须重新通过constraints验证，不能让高优先级用户层覆盖企业强制边界。

## 5. Allowlist Expansion 与Denylist Expansion有独立规则

在Managed permission profile中，普通managed allowlist可允许用户扩展；`managed_allowed_domains_only`则把allowlist miss设为hard deny，不开放审批覆盖。Denylist通常允许继续加严，但不能删掉managed deny entries。

这体现约束的方向性：

```text
allow expansion = 扩权
deny expansion  = 收权
```

二者不能共用“数组覆盖/合并”一种策略。企业要求还会校验候选是否是受管domain pattern的子集或精确集合。

## 6. Domain Pattern有精确、单层与递归子域语义

配置支持：

- exact host。
- `*.example.com`：仅subdomain，不含apex。
- `**.example.com`：apex与任意深度subdomain。

普通约束拒绝global `*`，避免一条看似方便的规则清空整个allowlist边界。同pattern重复时权限排序`None < Allow < Deny`，所以Deny胜出。

Pattern语义必须通过专用parser/globset实现；字符串suffix很容易把`notexample.com`误判成`example.com`子域。

## 7. Host Policy执行顺序固定为Deny→Local→Allow

`host_blocked()`明确按以下顺序：

1. 显式deny命中立即拒绝。
2. 若local binding关闭，检查loopback/private/link-local。
3. 最后要求存在allowlist且host命中。

没有任何allow entry时默认拒绝。Deny不能被Allow覆盖，local/private限制也不是普通allowlist miss。

这使最严规则单调生效；策略引擎不应依赖配置文件中条目出现顺序。

## 8. Local/Private保护不只看Hostname字符串

当`allow_local_binding=false`：

- loopback或private IP literal必须被精确allowlist才可能访问。
- hostname即使allowlisted，只要best-effort DNS解析到non-public IP仍拒绝。
- DNS lookup有2秒timeout；解析失败按NotAllowedLocal拒绝。
- scoped IPv6保留scope做精确policy匹配。

这是SSRF防护的重要层，但README也承认没有把解析出的IP一直pin到transport，仍存在DNS rebinding窗口。高威胁场景要在connector/firewall层绑定实际dial IP。

## 9. Policy Decider只能覆盖普通Allowlist Miss

Baseline结果为`NotAllowed`时，proxy才调用`NetworkPolicyDecider`，让Core把exec approval映射为Allow/Ask/Deny。以下结果不能被decider覆盖：

- explicit Deny。
- NotAllowedLocal。
- mode guard。
- proxy disabled。

因此用户对某条命令的临时批准不能突破企业deny或访问本机metadata service。这是approval与hard policy的正确优先级。

## 10. Hard Managed Allowlist Miss直接Deny，不发动态审批

当requirements声明`managed_allowed_domains_only`，Spec不会安装能覆盖allowlist miss的decider。普通Managed Sandbox如果启用审批flow但没有自定义decider，可fallback为Ask。

产品层应区分：

- 可请求例外的policy miss。
- 永不允许例外的managed deny。

否则UI会展示一个“允许”按钮，用户点了却永远失败，或更糟地错误突破强制边界。

## 11. Policy Request携带执行归因，而不只是一条Host

决策输入可包含：

- protocol、host、port、method。
- environment ID。
- client address。
- command与exec-policy hint。
- execution ID。

这让同一域名请求可以结合“哪条命令、哪个remote environment、哪个execution”判断，并把结果关联到Tool Call。

但HTTP/SOCKS客户端连接通常只自然带host；command归因需要可信桥接，不应让子进程自己通过普通header伪造。

## 12. Attribution Token使用专用二进制Preface

Linux可信bridge可在代理连接开头写：

```text
magic \0CDXPXY1
u16 token length
UTF-8 token
```

Token最大128 bytes、读取timeout 3秒。Proxy用进程内map把token换成environment ID与execution ID；未知token、环境不匹配、非法长度或非法UTF-8都拒绝。

这种out-of-band preface比可被目标server看到的HTTP header更适合传本地authority metadata。

## 13. Execution Scope用RAII注销Attribution

`for_execution()`注册token并返回execution-scoped proxy clone；`ExecutionScope::drop`自动unregister。已scoped proxy不能再次scope，且应用到不同environment会拒绝。

RAII避免正常生命周期结束后token无限有效。但异常进程与长连接仍有边界：注销后已建立连接不会被主动撤销，token也没有显式expiry/use count。高安全场景需connection registry与revocation。

## 14. Command Environment由同一Snapshot生成Proxy变量和Sandbox Context

`prepare_for_optional_environment()`一次返回：

- 已覆盖proxy变量的完整env。
- sandbox允许访问的loopback ports与local binding flag。

两者来自同一个address/runtime snapshot，避免env指向新端口而Sandbox仍放行旧端口。

这是一个可迁移模式：任何“应用级配置 + OS级能力”都应由同一prepared object产生，不能分别读取live config。

## 15. Proxy Env覆盖多个生态，而不是只写两个变量

Codex重写：

- upper/lowercase HTTP(S)_PROXY。
- WS/WSS_PROXY。
- ALL_PROXY、FTP_PROXY。
- npm/Yarn/Bundler/Pip/Docker专用变量。
- `NODE_USE_ENV_PROXY=1`。
- Electron代理开关。
- macOS上的Git SSH SOCKS fallback。

HTTP(S)变量始终指向HTTP proxy；仅ALL/FTP在SOCKS开启时使用`socks5h://`。这是兼容性经验：把SOCKS URL塞进HTTPS_PROXY会让很多客户端直接坏掉。

## 16. `NO_PROXY`保留Local/Private直连，但最终仍受Sandbox约束

环境会把localhost和常见private IP ranges写入NO_PROXY，让本地IPC/LAN客户端不经代理。若managed network enforcement开启，OS Sandbox只放行代理ports或明确local binding能力，直连仍不能任意逃逸。

这再次说明环境变量不是安全机制：NO_PROXY本身是在请求绕过proxy；真正阻断来自外层Sandbox。

若命令不在可强制Sandbox的平台/模式运行，NO_PROXY可能扩大绕过面，必须明确降级能力。

## 17. Sandbox只放行Prepared Loopback Proxy Ports

macOS Seatbelt在managed network时生成restricted network policy：

- 允许连接prepared localhost ports。
- 按需允许local bind/inbound与DNS。
- 允许受控Unix sockets。
- 其他网络默认无规则即拒绝。

Linux sandbox在`enforce_managed_network=true`时启用供proxy bridge使用的受限网络路径。若requirements存在却没有可用proxy endpoint，策略fail closed为空网络权限。

## 18. “Network Enabled”与“Managed Proxy Enforced”不是一回事

普通permission profile允许全网时，可以使用传统network policy；只要managed requirements存在，即使基础network flag不同，Sandbox仍需为了强制proxy而启动。

因此准入判断包含`has_managed_network_requirements`。否则“文件系统无需Sandbox”可能意外让命令裸网络运行，绕过代理。

## 19. Limited Mode用HTTP Method近似Read-only网络

Limited只允许：

- GET。
- HEAD。
- OPTIONS。

普通HTTP可直接检查method。HTTPS CONNECT只有先MITM解密内层请求，才能知道真实method；因此Limited下HTTPS必须MITM，否则fail closed。SOCKS5 TCP只有443被视为可尝试HTTPS MITM，非443拒绝；UDP全部拒绝。

“Read-only HTTP method”不是业务只读保证：GET仍可能触发副作用，GraphQL也可能把mutation藏在GET参数中。它只是降低风险的传输层heuristic。

## 20. MITM Requirement按原因分级

Host可能无需MITM、仅TLS检测后MITM，或必须MITM：

- Limited mode强制解密HTTPS method。
- 命中MITM hook需要检查/改写请求。
- Credential broker需要在目标host注入真实header。

若策略需要MITM而当前没有MitmState，连接明确拒绝并记录`mitm_required`，不会悄悄改为透明tunnel。

## 21. Managed CA只把Public Trust Bundle暴露给Child

MITM CA私钥留在proxy内存；子进程只通过常见CA环境变量读取固定public bundle路径。Sandbox另外把该bundle加入可读scope。

这比把私钥文件写到workspace安全。当前源码TODO指出child已有自定义CA变量时存在兼容取舍：startup值可能被默认bundle替换，command-scoped override又可能被保留，从而导致TLS失败。信任链合并尚非完美。

## 22. Credential Broker让Child只看到Dummy Secret

启用broker后：

1. 识别GitHub/OpenAI等受支持credential env。
2. 把真实值保存在proxy内存。
3. 给child写入形状相似的随机dummy。
4. 记录dummy与允许host binding。
5. MITM看到目标host与唯一dummy header后，替换为真实credential。

这样命令能使用SDK/CLI，却不能简单`env`打印出真实token。Credential与host绑定也降低把GitHub token发给任意域名的风险。

## 23. Broker只在唯一匹配时注入，歧义时拒绝猜测

`select_credential()`要求header中的dummy恰好匹配一个候选credential；0个或多个匹配都不注入。Provider还负责构造合法request header。

这是好原则：凭据选择存在歧义时fail closed，而不是按注册顺序拿第一个secret。

但proxy进程仍持有明文secret；调试dump、core dump、恶意MITM hook和内存漏洞仍属于高敏感面。

## 24. Credential Broker开关不能Hot Reload

Policy config可reload，但`credential_broker` enablement变化会被拒绝，要求proxy重启。原因是broker内部持有从child env虚拟化得到的真实credential state，单纯换ConfigState无法安全建立/销毁这条链。

这是“配置可热更”的重要边界：涉及secret material与已有child环境的功能不能假装动态切换。

## 25. Config Reload失败保留上一代有效State

State在敏感操作前按需`maybe_reload`；新配置通过解析、constraints与broker compatibility后才整体替换RwLock内state。失败warning并保留旧配置。

Blocked ring与累计count在reload时迁移到新state，不会因配置变更清零。

优点是invalid edit不会让代理突然开放；缺口是调用方得到reload error时本次请求通常fail closed，但产品缺少统一“运行中仍是generation N，最新配置N+1加载失败”的health snapshot。

## 26. 动态Policy更新与Listener Runtime不是完全同寿命

Domains、mode等可替换ConfigState；listener addresses、MITM runtime settings和credential broker等在Proxy build时形成，不能都靠state reload改变。

所以配置字段实际分为：

```text
request-time live policy
listener-generation settings
child-env preparation settings
secret-runtime settings
```

如果UI把所有字段都显示成“保存后立即生效”，会制造错误安全预期。需要逐字段声明restart requirement。

## 27. Upstream Proxy可复用企业出口，但受显式开关控制

`allow_upstream_proxy=true`时，proxy读取HTTP(S)/ALL_PROXY环境并让direct HTTP或CONNECT继续走上游HTTP proxy；关闭时直接dial目标。

托管proxy链要防循环：child env被改写为Codex本地proxy，而Codex proxy读取的是自身startup process env。生命周期和env snapshot需分开，否则本地proxy可能把流量再次发给自己。

源码支持HTTP(S) upstream，不把任意SOCKS upstream当通用能力。

## 28. Unix Socket Proxy是高风险本地能力

macOS可通过`x-unix-socket`header请求代理到absolute Unix socket；默认按path allowlist检查，其他平台拒绝。危险开关可以绕过allowlist，但仍要求absolute path并把listeners clamp loopback。

Unix socket往往连接Docker、数据库、SSH agent或系统daemon，权限可能远大于普通Internet。它不应被归类为“network enabled”的附属小功能，而应是单独capability与审计域。

## 29. Audit避免记录Full URL，但Metadata仍可能敏感

每次domain/non-domain decision发结构化event，包括：

- decision、source、reason、override。
- protocol、host、port、method。
- client address与execution ID。
- conversation/account/email/model等可选metadata。

不记录URL path/query是正确的数据最小化；但host、email、account、conversation组合仍可识别用户。日志保留、访问控制与redaction仍必须按敏感telemetry治理。

## 30. Blocked Buffer有界，但Observer在请求路径内Await

State保留最近200条blocked requests并累计`blocked_total`；超出FIFO淘汰。每条还输出结构化violation debug line，并可调用异步observer。

Observer在`record_blocked()`内await；若产品observer卡住，拒绝响应的收口可能被拖慢。观测链应有timeout/bounded queue/drop metric，不能让telemetry成为策略执行的可用性依赖。

## 31. 审批结果的寿命需要与Execution绑定

Decider可以利用command、exec-policy hint、environment与execution ID做决定。若批准缓存只按host或command字符串存，后续不同cwd、不同binary或不同execution可能复用过宽。

推荐approval key至少包含：

```text
policy generation
environment identity
execution/call identity or approved command fingerprint
host + port + protocol + method class
permission profile
```

网络连接发生在Tool handler之后，approval与实际dial之间仍需generation recheck。

## 32. 当前边界仍无法防所有Bypass

主要限制：

- 不能保证所有程序都尊重proxy env，必须依赖平台Sandbox。
- DNS检查没有transport pinning。
- Limited method不等于业务只读。
- 已建立长连接在policy reload/revoke后不会自动断开。
- TLS pinning客户端可能拒绝MITM。
- QUIC/自定义UDP在受限模式不可透明支持。
- 不同平台Sandbox强度与remote environment实现不完全一致。
- Child可看到dummy secret的形状和credential存在性。

安全声明必须按平台/协议/客户端能力分级，不能只写“网络已沙箱化”。

## 33. 对当前 AI SEO Agent 的迁移价值

当前服务端SEO Agent暂不需要复制本地HTTP/SOCKS/MITM代理，但应直接学习policy分层：

```text
Tool request
  -> tenant hard deny
  -> destination allowlist
  -> SSRF local/private IP guard
  -> user/role approval
  -> credential broker/server-side secret injection
  -> outbound connector
  -> audit receipt
```

尤其值得立即采用：

1. API key永远不交给模型或前端。
2. URL在redirect每一跳重新校验host与resolved IP。
3. Deny与local/private guard不能被HITL批准覆盖。
4. Tool Observation记录destination与decision source，但不记录query secret。
5. 外部HTTP调用使用统一connector，而不是每个Tool自行`fetch`。

## 34. 可验证的不变量清单

未来实现网络Tool时可先写这些测试：

1. 无allow entry时默认拒绝。
2. Deny始终覆盖Allow与用户批准。
3. Allowlisted hostname解析到private IP仍拒绝。
4. DNS失败/timeout按安全策略fail closed。
5. 用户批准不能覆盖managed-only allowlist miss。
6. Prepared proxy env与Sandbox ports来自同一generation。
7. 无有效proxy endpoint时managed network不降级为全网。
8. Limited模式无法通过HTTPS CONNECT隐藏写方法。
9. Credential只注入绑定host且唯一dummy匹配的请求。
10. Child永远读不到真实server credential。
11. Attribution token不能跨environment复用。
12. Policy reload失败保留旧有效state并暴露degraded状态。
13. Policy revoke对新连接立即生效，长连接策略有明确说明。
14. Audit不包含Authorization、URL query与response body。

## 35. 最终结论

Codex Managed Network最值得学习的是：网络权限不是`sandbox.network=true`，而是一条从可信配置、强制约束、命令环境、OS出口、域名/本地地址策略、动态审批、MITM、凭据代理到审计的完整链。

当前实现的强项是allowlist-first、Deny优先、private DNS防护、decider只能覆盖软miss、env与sandbox同snapshot、Limited HTTPS fail closed、execution attribution、credential dummy virtualization与有界blocked buffer；主要风险是DNS未pin到dial、Limited不等于业务只读、部分runtime配置不可热更、长连接不随revoke中止、observer可拖慢拒绝路径、CA兼容取舍、平台强度差异，以及proxy进程本身成为高价值secret与流量集中点。

对云端Agent而言，不一定需要本地代理进程，但一定需要同样的唯一出站端口：所有Tool联网都穿过统一policy-aware connector。只有这样，审批、SSRF防护、凭据注入、审计和撤销才不会散落在每个业务Tool里。
