# Exec HTTP Capability、Streaming Backpressure与Remote MCP网络边界

Codex把HTTP请求抽象成Environment拥有的一项Capability，与Process和Filesystem并列。上层MCP客户端只依赖`Arc<dyn HttpClient>`：local实现直接用Reqwest发请求，remote实现则把同一份HTTP envelope通过Exec Server JSON-RPC转发到远端执行，再把response body重建为本地byte stream。

这套设计的重要价值不是“封装了reqwest”，而是让**网络请求从哪个环境发出**成为显式runtime binding。它同时带来了新的分布式系统问题：请求参数和credential跨执行边界、headers与body分成两条协议、stream需要request-local routing和全连接背压预算、transport断线不能像Process output那样恢复，重试还可能重复非幂等POST。

## 1. 证据范围

本文基于Codex fork `main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`，主要阅读：

- `codex-rs/exec-server-protocol/src/protocol.rs`
- `codex-rs/exec-server/src/client_api.rs`
- `codex-rs/exec-server/src/client/http_client.rs`
- `codex-rs/exec-server/src/client/reqwest_http_client.rs`
- `codex-rs/exec-server/src/client/rpc_http_client.rs`
- `codex-rs/exec-server/src/client/http_response_body_stream.rs`
- `codex-rs/exec-server/src/client.rs`
- `codex-rs/exec-server/src/server/handler.rs`
- `codex-rs/exec-server/src/server/registry.rs`
- `codex-rs/exec-server/src/environment.rs`
- `codex-rs/exec-server/tests/http_request.rs`
- `codex-rs/exec-server/tests/http_client.rs`
- `codex-rs/codex-mcp/src/runtime.rs`
- `codex-rs/codex-mcp/src/rmcp_client.rs`
- `codex-rs/codex-mcp/src/mcp/auth.rs`
- `codex-rs/rmcp-client/src/http_client_adapter.rs`
- `codex-rs/rmcp-client/src/oauth_http_client.rs`
- `codex-rs/rmcp-client/src/streamable_http_retry.rs`
- `codex-rs/http-client/src/custom_ca.rs`
- `codex-rs/http-client/src/chatgpt_cloudflare_cookies.rs`

## 2. 三层HTTP运行模型

```text
RMCP / OAuth adapter
        |
        v
Arc<dyn HttpClient>
   |             |
local          remote
   |             |
Reqwest       JSON-RPC http/request
                 |
                 v
           remote Reqwest
```

| 层 | 职责 | 不负责什么 |
| --- | --- | --- |
| RMCP/OAuth Adapter | MCP headers、session、SSE、OAuth response cap、retry分类 | 决定请求在哪台机器发出 |
| Environment HttpClient | local/remote transport选择、buffered/stream接口 | 理解MCP JSON-RPC语义 |
| Exec Server HTTP Runner | method/URL/header校验、Reqwest、redirect、timeout、body framing | Tool permission、域名allowlist、业务幂等 |

这延续了Environment Capability Bundle的设计：同一个remote Environment的Exec、Filesystem和HTTP都共享同一`LazyRemoteExecServerClient`。

## 3. HttpClient是环境中立接口

接口只有两个方法：

```text
http_request(params) -> buffered response
http_request_stream(params) -> response headers + body stream
```

上层不需要知道：

- 请求由orchestrator host直接发送；
- 还是通过WebSocket/Noise/Stdio Exec Server在remote发出；
- response body来自Reqwest `bytes_stream()`；
- 还是来自JSON-RPC `bodyDelta` notifications。

这种接口比让MCP代码自己判断local/remote更可维护，也为未来HTTP worker、proxy runtime或审计client提供替换点。

## 4. Transport-shaped Request Envelope

`HttpRequestParams`刻意保持HTTP transport形状，而不是MCP专用结构：

```text
method: String
url: String
headers: Vec<HttpHeader>
bodyBase64?: bytes
timeoutMs?: u64 | null
redirectPolicy: follow | stop
requestId: String
streamResponse: bool
```

它可以同时支撑：

- MCP Streamable HTTP POST/GET/DELETE；
- OAuth metadata discovery；
- OAuth token exchange；
- 未来Environment-owned HTTP probes。

协议注释明确：`timeoutMs`省略或`null`表示**完全不设超时**，不是使用默认值；数值则是精确毫秒timeout。

## 5. Headers选择Vec而不是Map

`HttpHeader`只有`name/value`，request与response都使用`Vec<HttpHeader>`，目的是保留重复header，例如：

- `set-cookie`；
- `www-authenticate`；
- 多值自定义header。

Runner构造Reqwest HeaderMap时使用`append`，不会覆盖相同名字的前一项。

但协议注释称“ordered headers”，实际经历`HeaderMap`以后，跨不同header name的原始全局顺序并没有强保证；response迭代也会丢弃不能转为UTF-8 string的header value。换句话说，当前真实contract更接近：

```text
重复值尽量保留
但不是原始HTTP header block的byte-exact replay
```

## 6. URL和Method校验

Runner在实际发请求前：

1. 用Reqwest `Method::from_bytes`解析method；
2. 用`Url::parse`解析absolute URL；
3. 只允许`http`和`https`scheme；
4. 将headers解析为Reqwest类型；
5. 注入W3C trace headers；
6. 构造并发送请求。

拒绝`file:`、`ftp:`等scheme是必要底线，但没有进一步检查：

- localhost；
- loopback IP；
- RFC1918/private range；
- link-local；
- cloud metadata address；
- DNS解析后的private IP；
- redirect后的新origin/IP。

因此它是“HTTP transport validator”，不是SSRF guard。

## 7. Redirect是调用方可选策略

协议只有：

- `Follow`：使用Reqwest默认redirect限制；
- `Stop`：`Policy::none()`，返回3xx本身。

OAuth需要Stop，以便读取Location而不是自动跳转；普通MCP POST/GET/DELETE都使用Follow。

Follow策略没有携带：

- 最大hop的业务级配置；
- allowed origin set；
- downgrade `https -> http`策略；
- redirect chain receipt；
- 每一跳DNS/SSRF重新校验。

请求中可能带Authorization、MCP Session ID与自定义headers，是否跨origin保留依赖Reqwest行为，而不是Codex显式authority contract。

## 8. Timeout语义与长连接冲突

Runner每次请求新建一个Reqwest Client，并把`timeoutMs`设置为client total timeout。

这有两个合理点：

- OAuth adapter能把上层Duration转换为毫秒；
- SSE需要`None`，否则长连接会被普通request timeout截断。

但RMCP Streamable HTTP当前POST、DELETE和GET stream全部传`None`。只有更外层的MCP initialize/transport timeout可能包住部分启动流程；已经建立的SSE自然需要长寿命，而普通POST/DELETE若peer挂住也缺少request-local deadline。

更稳健的协议应拆开：

```text
connect timeout
response headers timeout
idle body timeout
overall buffered request timeout
SSE lease/heartbeat timeout
```

## 9. Buffered Response路径

`http_request()`强制：

```text
stream_response = false
```

即使调用者误传true，也不会改变接口语义。Runner等待完整`response.bytes()`，再把body编码进JSON-RPC response。

优点：

- 上层使用简单；
- status、headers、body是一个原子响应；
- 不需要request-local notification route。

缺点：

- 没有HTTP-specific response body上限；
- body先在remote Reqwest聚合，再序列化/base64，再进入RPC frame；
- orchestrator反序列化后又持有一份bytes；
- 大响应可能在触及transport frame限制前已经造成多份内存放大。

## 10. Streaming Response协议

Streaming把response拆为：

```text
JSON-RPC result:
  status
  headers
  bodyBase64 = empty

notifications:
  requestId
  seq = 1, 2, 3...
  deltaBase64
  done
  error?
```

server保证先发送headers response，成功后才启动background body task。client则在发出RPC前先注册route，所以正常路径不会丢失最早的body delta。

## 11. Request ID有两个authority

协议允许caller传`requestId`，server要求同一连接上的active streaming ID唯一。

但remote `ExecServerClient::http_request_stream`会忽略调用者ID，生成连接本地单调ID：

```text
http-1
http-2
...
```

原因是防止：

- caller重复用固定字符串；
- 旧stream late delta污染新请求；
- cancel/drop后同ID被立刻复用产生ABA。

buffered request仍保留caller提供的ID，但server不会为buffered body建立stream route。

## 12. Server侧Stream Reservation

Exec Server Handler维护`active_body_stream_ids`：

1. streaming request先reserve；
2. duplicate active ID返回`-32602`；
3. request失败、response序列化失败或response发送失败会release；
4. body task结束后release。

这解决的是ID冲突，不是资源配额。HashSet本身没有：

- 最大active stream数量；
- 每principal stream quota；
- 总下载bytes预算；
- 最大stream lifetime。

## 13. Body Delta Frame预算

单个decoded delta最大：

```text
1 MiB
```

client在Serde decode前先检查base64 string最大编码长度，再在decode后复核bytes长度。这避免恶意remote先让orchestrator decode一个超大base64 frame。

Reqwest sender收到更大的chunk时会主动按1 MiB切分，seq逐项递增。

这是一处很好的“encoded size + decoded size”双门，而不是只相信Serde结果。

## 14. 两种Backpressure预算

remote client为每个stream建立：

```text
mpsc capacity = 256 frames
```

此外整条Exec Server client connection共享：

```text
queued decoded body bytes = 16 MiB
```

每个queued delta持有Semaphore permit，消费或drop后释放。

因此防护是二维的：

| 风险 | 防护 |
| --- | --- |
| 很多极小frame耗尽队列对象 | per-stream 256 frames |
| 少量1MiB frame占满内存 | connection-global 16MiB |
| 多stream各自低于单stream阈值但总量过大 | shared byte budget |

测试覆盖了单stream byte overflow、两个stream共享预算、frame channel overflow，以及transport disconnect时queue已满的情况。

## 15. Backpressure失败不会伪装成EOF

当byte permit申请失败或`try_send`遇到Full：

1. 记录request-local failure reason；
2. 从routing table移除sender；
3. consumer先读完已经queue的chunks；
4. channel关闭时读取failure tombstone；
5. 返回显式Protocol error。

这保证调用者不会把截断body误认为成功EOF，是stream系统最重要的正确性原则之一：

```text
truncated != done
```

## 16. Sequence验证

Remote body stream从`next_seq=1`开始，逐帧要求完全相等：

```text
delta.seq == next_seq
```

gap、重复或乱序立即：

- 清理route；
- 返回Protocol error；
- 不尝试重排或补读。

如果terminal frame带非空chunk，先返回chunk并设置`pending_eof`，下一次`recv()`才返回None。这样不会丢失“最后一块数据+done”组合帧。

## 17. Unknown Late Delta的处理

若request ID不在routing table，notification被静默忽略。

这对以下场景很重要：

- request future在headers前被cancel；
- consumer拿到stream后提前drop；
- EOF后server还有迟到frame；
- old stream与new generated ID交错。

generated ID不复用加上unknown-ignore，共同隔离stale traffic。

## 18. Drop Cleanup只是本地Route Cleanup

Remote `HttpResponseBodyStream::drop`会异步从orchestrator routing table移除ID；headers前request future被cancel则由RAII registration做同样清理。

但这不是端到端cancel：

- 没有`http/request/cancel` RPC；
- remote Exec Server的Reqwest body task可能继续下载；
- 它可能继续尝试发送body deltas；
- orchestrator只会把这些late deltas忽略。

如果连接仍健康且server持续大流量，consumer drop并不会立即释放remote bandwidth/socket/CPU。需要显式cancel message或把stream与可取消request handle绑定。

## 19. Transport断线时Stream不可恢复

Exec Process有Session event log与短期resume；HTTP stream没有对应replay协议。

共享RPC transport失败时：

- 所有process session进入各自failure/recovery流程；
- 所有active HTTP body stream被立即fail；
- 新连接不会请求某个HTTP body从seq N继续；
- remote server也没有retained body log。

这是一条清晰但能力不对称的边界：

```text
process output: recoverable within retention window
HTTP response stream: fail and restart at higher layer
```

## 20. 断线Synthetic Terminal存在Sequence缺口

`fail_all_http_body_streams`向每个非满queue尝试发送一个terminal delta，但其`seq`固定写为1。

若stream已经成功消费或排队了若干帧、queue尚未满，然后transport断线：

```text
expected seq = N
synthetic failure seq = 1
```

consumer会先触发“received seq 1, expected N”，而不是得到更准确的transport disconnect原因。

当前测试覆盖：

- 断线前没有delta；
- queue完全填满时走failure tombstone。

但没有覆盖“已有部分delta且queue未满后断线”。更稳妥的做法是failure不伪装成普通sequenced delta，或routing entry记录next inbound seq并生成正确terminal seq。

## 21. Failure Tombstone可能残留

`http_body_stream_failures`按request ID保存queue overflow或full-queue disconnect原因，正常由consumer在channel关闭时`take`。

若consumer在failure记录后直接drop且不再poll：

- Drop只调用`remove_http_body_stream`；
- 不会同步删除failure entry；
- generated IDs单调增长，通常不会复用触发insert时清理。

因此恶意或异常高频stream可能积累failure tombstone。需要在Drop/route removal时一并清理，或把failure与route放在同一个owned state中随Arc释放。

## 22. Drop Cleanup依赖Tokio Runtime

同步Drop通过`Handle::try_current()`spawn异步remove；如果drop发生时没有current Tokio runtime，函数不会做清理。

正常Codex async路径通常满足这个前提，但类型本身没有把runtime ownership写入contract。更稳妥的设计是：

- routing entry使用sync-safe removal；
- 或stream显式提供async close并让owner负责；
- Drop仅作为best-effort兜底。

## 23. Local与Remote Stream并非完全同构

Local stream直接包装Reqwest `bytes_stream()`：

- 没有1MiB frame重切；
- 没有256 frame queue；
- 没有16MiB orchestrator queued budget；
- consumer速度直接向Reqwest/socket传播背压。

Remote stream为了跨JSON-RPC才增加frame和queue。

上层API相同，但资源与错误语义不同：remote可能返回sequence/backpressure Protocol error，local则返回Reqwest body error。

## 24. Environment决定实际网络出口

MCP runtime解析server Environment：

- 找到指定Environment：使用其`get_http_client()`；
- local stdio但没有local Environment：拒绝；
- local Streamable HTTP但没有local Environment：允许，fallback到ambient `ReqwestHttpClient`；
- non-local unknown ID：拒绝。

因此remote MCP的：

- DNS解析；
- source IP；
- private network可达性；
- custom CA文件；
- ambient proxy环境；
- Cloudflare cookie jar所在进程；

都属于remote Exec Server，而不是orchestrator。

## 25. Credential跨Environment边界

RMCP adapter会在orchestrator组装：

- static HTTP headers；
- env-derived headers；
- bearer token；
- auth provider headers；
- MCP Session ID；
- Last-Event-ID。

若server绑定remote Environment，这些header进入`HttpRequestParams`并通过Exec Server transport发送到remote，由remote Reqwest使用。

所以“remote HTTP execution”同时意味着“remote获得请求credential”。安全性取决于Transport：

- Noise路径提供端到端加密与executor identity绑定；
- plain WebSocket路径则只有底层TLS/网络边界，不具备Noise同等级的application identity证明。

Credential broker若未来支持remote，最好传短期、audience-bound token，而不是长期host secret。

## 26. Custom CA与Cookie策略

每个Reqwest client通过`build_reqwest_client_with_custom_ca`构建，支持：

```text
CODEX_CA_CERTIFICATE > SSL_CERT_FILE
```

这保证企业代理/网关需要自定义root CA时，local和remote执行进程各自遵循其环境配置。

Client还安装process-global ChatGPT Cloudflare cookie store，但它严格：

- 只对allowed ChatGPT HTTPS hosts生效；
- 只保存硬编码Cloudflare infrastructure cookie names；
- 拒绝账号、session、auth等用户cookie。

这是一个值得保留的窄共享状态设计。注释也明确禁止未来把用户cookie塞进全局jar。

## 27. Proxy与Managed Network不是一套机制

Exec HTTP Runner使用普通Reqwest builder加custom CA，并未接入Turn级managed network proxy的domain policy、approval、attribution与credential virtualization。

它可能遵循执行进程的ambient/system proxy发现，但这不等价于Codex Managed Network Proxy：

- 没有Tool/Turn identity；
- 没有per-domain policy receipt；
- 没有dynamic approval；
- 没有统一SSRF guard；
- 没有request bytes/response bytes审计。

因此本文称它为Environment-owned HTTP Capability，不应误称为安全出站代理。

## 28. Telemetry做对了哪些最小化

HTTP span记录：

- method；
- server address；
- port；
- response status；
- error type。

发送错误日志先对Reqwest error调用`without_url()`，避免完整URL直接进入通用error字符串；RMCP POST失败日志拆出scheme、host、path和`has_query`，不记录query正文，也只记录Authorization是否存在。

这是不错的最小化：可诊断网络目标和MCP method，同时不直接记录token或query value。

但Error返回链仍可能包含remote error string、response body preview等内容，需要和Feedback日志出口一起审计。

## 29. RMCP Streamable HTTP投影

### 29.1 POST

POST设置：

- `Accept: text/event-stream, application/json`；
- `Content-Type: application/json`；
- optional bearer/session headers；
- streaming response。

根据status/content-type投影为：

- Accepted；
- JSON-RPC message；
- SSE stream；
- AuthRequired/InsufficientScope；
- Unexpected response。

### 29.2 GET Stream

GET用于SSE continuation，附带MCP Session ID与可选Last-Event-ID。返回404视为session expired，405视为server不支持SSE。

### 29.3 DELETE

DELETE关闭MCP session，405被当作server不支持删除而视为成功。

## 30. 上层Body预算不一致

OAuth adapter明确限制完整response body：

```text
1 MiB
```

非JSON错误body preview限制：

```text
8 KiB
```

但RMCP通用`collect_body()`对JSON response或错误分析会无上限地extend Vec；SSE总长度也自然无界，只受stream消费速度和底层queue约束。

这说明预算分散在consumer：

| Consumer | Total body cap |
| --- | --- |
| OAuth | 1MiB |
| non-JSON preview | 展示8KiB，但读取前仍可能collect全部 |
| MCP JSON | 无显式总cap |
| SSE | 无总cap，长连接语义 |
| Exec buffered | 无HTTP-specific cap |

应区分“可无限持续的event stream”和“必须有限的单个JSON/document response”。

## 31. Error Body Preview仍可能泄露内容

当MCP返回unexpected status或content type，adapter会收集body并把前8KiB放进错误字符串。

响应body可能包含：

- server debug trace；
- credential或session metadata；
- internal hostname；
-用户/租户数据；
- HTML gateway diagnostic。

即使有8KiB cap，也不代表适合写入日志、UI或Feedback。更合理的是结构化error：

```text
status
contentType
bodyBytes
bodyDigest
redactedPreview?
previewClassification
```

## 32. Retry范围经过有意识收敛

MCP initialize最多三次attempt，延迟：

```text
250ms, 1000ms
```

仅以下初始化method的retryable HTTP status可重试：

- `initialize`；
- `notifications/initialized`；
- `tools/list`。

status包括408、429、500、502、503、504；网络/transport类错误也可能重试。

普通业务Tool call不在这个初始化重试集合里，避免随意重复副作用。

## 33. 但初始化POST仍有Ambiguous Commit

如果remote已经收到并处理POST，response headers/body到达前Exec transport断线：

- HTTP stream不可resume；
- adapter只看到transport/request failure；
- initialize retry会重新建立transport并再次POST；
-协议没有HTTP request idempotency key或server receipt。

初始化通常设计成可重复，但`notifications/initialized`、session创建或server自定义行为仍可能产生重复副作用。

“只重试少数method”降低风险，却不能解决ambiguous commit。更完整的方案需要MCP request ID、HTTP idempotency key与server session generation共同定义重放语义。

## 34. 当前HTTP Capability不经过Tool Approval

`http/request`是Exec Server内部能力，Handler只要求：

- initialize已请求；
- initialized notification已发送；
- logical session仍attached。

它不接收：

- Sandbox context；
- domain allow/deny policy；
- user approval result；
- Tool call ID；
- Agent Run/Step ID。

上层MCP配置和权限系统决定是否启动server，但单个HTTP request在Exec Server层没有独立policy求交。

如果未来把这项能力开放给模型通用HTTP Tool，必须先接Managed Network Proxy或等价policy plane，不能直接暴露当前transport envelope。

## 35. SSRF风险来自配置与Plugin供应链

MCP URL可能来自：

- user config；
- selected executor plugin manifest/MCP config；
-环境变量headers和bearer token配置。

selected plugin若不可信，可把remote Environment内的HTTP client指向：

- remote machine localhost service；
- metadata endpoint；
-内网管理API；
-依赖ambient proxy/CA可达的企业资源。

由于Environment filesystem与HTTP属于同一authority，允许executor plugin贡献MCP server本身就是强权限操作，应把URL policy与plugin trust/source provenance一起审计。

## 36. Header和Body输入缺少HTTP-specific预算

协议没有显式限制：

- header count；
- 单个header name/value bytes；
- request body bytes；
- URL length；
- request ID length；
- active streams；
- buffered response bytes；
- streamed response total bytes。

底层JSON-RPC frame或WebSocket message可能提供粗上限，但那是transport安全阀，不是HTTP资源契约。

尤其request body会先base64膨胀后跨RPC发送，应在serialize前按decoded bytes检查。

## 37. Server发送侧缺少Consumer Cancel和总下载预算

Sender将每个Reqwest chunk拆成1MiB，逐条await notification send。共享transport背压能减慢它，但没有：

- max response bytes；
- max stream duration；
- idle timeout；
- per-stream bandwidth；
- consumer-cancel signal；
- principal quota。

一个合法但无限输出的endpoint可以长期占用background task和active ID。

## 38. Streaming状态至少有七个阶段

```text
Allocated route
-> RPC request in flight
-> Headers committed
-> Body streaming
-> Terminal queued
-> Terminal consumed
-> Route/failure cleanup
```

异常路径还包括：

- request future cancelled before headers；
- body consumer dropped；
- frame oversize导致整个transport failure；
- per-stream channel full；
- shared byte budget exhausted；
- transport disconnected；
- server-side Reqwest body error；
- handler shutdown。

把这些都压成“HTTP call success/fail”会丢失恢复决策所需信息。

## 39. 值得保留的优质实现

### 39.1 Environment-owned HttpClient

网络出口与execution authority绑定，上层MCP不用复制local/remote分支。

### 39.2 Transport envelope不耦合MCP

同一HTTP能力可被OAuth discovery/token exchange复用。

### 39.3 Buffered/Streaming接口强制各自语义

公共方法覆盖caller误传的`streamResponse`，减少协议错用。

### 39.4 Client-generated connection-local stream IDs

单调ID隔离cancel/drop后的late delta，避免ABA。

### 39.5 Response先于Body Task启动

headers与parser选择先建立，再投递body；client route又在RPC前注册。

### 39.6 1MiB decoded+encoded双重Frame Guard

防止base64 decode前的内存放大。

### 39.7 256 frames + 16MiB shared bytes双预算

同时控制对象数量、单frame大小和多stream累计内存。

### 39.8 Truncation显式失败

backpressure不会被误报成clean EOF。

### 39.9 Strict Sequence

remote乱序、重复和gap不会被静默拼接成错误body。

### 39.10 OAuth独立1MiB Cap

安全敏感的短响应不与无限SSE共用无界策略。

### 39.11 Custom CA一致入口

避免企业环境下某条新HTTP路径绕过CA配置。

### 39.12 Cloudflare Cookie硬allowlist

process-global状态被限制为基础设施cookie，不扩张到账号authority。

### 39.13 Retry只覆盖初始化安全子集

普通Tool call不被基础设施层自动重复。

## 40. 当前实现的主要缺口

### 40.1 没有SSRF/DNS/Rebinding防护

只校验http/https scheme，任何可解析host均可访问。

### 40.2 Redirect无origin policy与chain receipt

Follow行为依赖Reqwest默认值，没有每跳authority审计。

### 40.3 Request/Buffered Response缺bytes预算

JSON-RPC粗上限不能替代业务资源约束。

### 40.4 Streaming总量与寿命无界

只限制queued bytes，不限制累计下载、持续时间或带宽。

### 40.5 Active Stream数量无cap

server HashSet与client routing map都可随并发stream增长。

### 40.6 Consumer Drop不取消Remote HTTP

只清理orchestrator route，remote网络请求可能继续。

### 40.7 HTTP Stream无法断点恢复

transport恢复后只能由上层重做完整请求。

### 40.8 Synthetic Disconnect Seq固定为1

部分body后断线可能误报sequence gap，掩盖真实transport原因。

### 40.9 Failure Tombstone存在残留路径

failure后consumer直接drop可能不清理map entry。

### 40.10 Drop cleanup依赖current Tokio runtime

类型contract未保证异步清理一定能spawn。

### 40.11 Header“ordered”与HeaderMap实际语义不完全一致

非UTF-8 response header还会被静默丢弃。

### 40.12 Timeout只有单个total值或None

不能分别治理connect、headers、idle body和overall。

### 40.13 MCP collect_body无统一cap

错误preview虽8KiB，但可能先把完整大body读入内存。

### 40.14 Error Preview可能进入日志/Feedback

response body未经过统一classification/redaction。

### 40.15 Credential直接发送到Remote Executor

缺少短期audience-bound credential或broker receipt。

### 40.16 HTTP request缺Tool/Run attribution

Exec Server层没有call ID、Run ID、policy revision或approval receipt。

### 40.17 MCP Runtime按Environment ID回查

同ID replacement时，本次Step readiness与实际HTTP client generation可能漂移。

### 40.18 Local HTTP fallback绕过Environment

没有local Environment时仍用ambient Reqwest，使统一authority模型出现例外。

### 40.19 Retry仍有Ambiguous POST Commit

没有idempotency key和server-side dedupe receipt。

## 41. 更稳健的HTTP Runtime Contract

```ts
type HttpRuntimeRequest = {
  operationId: string
  attemptId: string
  environment: {
    id: string
    generation: number
  }
  method: string
  url: string
  headers: Array<{ name: string; value: string; secretRef?: string }>
  bodyBytes?: Uint8Array
  limits: {
    connectMs: number
    headersMs: number
    idleBodyMs: number
    maxRequestBytes: number
    maxResponseBytes: number
    maxRedirects: number
  }
  networkPolicyRevision: number
  idempotencyKey?: string
}

type HttpRuntimeReceipt = {
  operationId: string
  attemptId: string
  environmentGeneration: number
  resolvedOrigin: string
  redirectChain: string[]
  status?: number
  requestBytes: number
  responseBytes: number
  terminal: 'completed' | 'cancelled' | 'timed_out' | 'truncated' | 'disconnected'
  retrySafe: boolean
}
```

核心原则：

1. URL和每次redirect都做DNS/IP policy；
2. credential以secret reference在执行环境解引用；
3. buffered与streamed都必须有bytes budget；
4. stream有显式cancel；
5. sequence error与transport error分开；
6. retry依据operation identity和commit receipt，而不是error string；
7. Runtime binding包含Environment generation。

## 42. 对当前NestJS Agent项目的翻译

当前项目未来实现SEO HTTP Tool时，不应直接让模型提交任意URL给Axios/fetch。

### 42.1 Tool与Fetcher分层

```text
SEO Tool Handler
-> URL/tenant/business validation
-> Network Policy
-> Http Runtime
-> bounded response parser
-> model observation
```

### 42.2 默认只允许目标站点和已批准资源

至少拒绝：

- loopback/private/link-local/metadata IP；
- 非http/https；
- redirect跳出allowlist；
- DNS rebinding后的private address；
- userinfo URL。

### 42.3 Fetch receipt写入AgentStep

持久化：

- normalized URL；
- final origin；
- status；
- bytes；
- redirect count；
- policy revision；
- timeout/truncation；
-内容digest。

不要把完整HTML和credential写入Step metadata。

### 42.4 Streaming不是默认选择

SEO抓取普通HTML应使用有限buffered response；只有SSE或真正长流式API才建立stream，并配置idle timeout、max bytes和cancel。

### 42.5 Retry按HTTP method与业务operation决定

GET通常可重试；POST必须有idempotency key或明确未提交证据。不要因为`ECONNRESET`就盲目重复。

## 43. 建议验证矩阵

| 场景 | 应验证的事实 |
| --- | --- |
| 非http/https URL | admission前拒绝 |
| localhost/private/metadata | DNS解析后拒绝 |
| public URL redirect到private | 每跳重新拒绝 |
| redirect跨origin携带Authorization | credential不泄漏且有receipt |
| buffered超大response | 达到cap即cancel，不先完整聚合 |
| request body超cap | serialize/base64前拒绝 |
| streamed单frame超1MiB | transport fail或stream fail语义明确 |
| per-stream 256 frame满 | 返回truncated error，不返回EOF |
| 多stream超过16MiB | 只失败超预算stream，其他stream可继续 |
| 部分delta后transport断线 | 返回disconnect，不误报seq=1 gap |
| consumer drop | remote Reqwest立即cancel |
| failure后consumer drop | failure state无tombstone残留 |
| Tokio runtime外drop | route仍能可靠释放 |
| SSE idle | idle timeout生效但普通持续事件不受overall timeout误杀 |
| OAuth body超过1MiB | 失败并取消下载 |
| MCP JSON body超过cap | 不无界collect |
| remote Environment replacement | Step仍使用已冻结generation |
| retryable initialize断线 | operation ID去重或返回ambiguous receipt |

## 44. Teach-back

### 44.1 为什么HTTP要成为Environment Capability？

因为网络可达性、DNS、source IP、CA、proxy和secret authority都取决于请求从哪里发出。仅把remote shell远程化、HTTP仍在host发，会让MCP看到错误的网络世界。

### 44.2 为什么256 frames还需要16MiB预算？

frame数量限制不了每帧大小。256个1MiB frame可占256MiB；多个stream还会叠加。共享byte semaphore控制实际内存。

### 44.3 为什么consumer drop不等于HTTP cancel？

Drop只移除了orchestrator的notification receiver，没有向remote server发送取消请求。remote Reqwest task仍不知道上层不再需要body。

### 44.4 为什么HTTP stream不能复用Process resume？

Process有服务端retained output log、seq和read API；HTTP body没有retention、range/resume token或请求幂等定义，断线后无法证明从哪里继续。

### 44.5 当前最值得学习与最危险的点分别是什么？

最值得学习的是Environment-owned client、headers-first streaming、generated ID、strict seq和双重backpressure预算；最危险的是无SSRF policy、无总body/stream预算、drop不端到端cancel，以及remote credential与retry ambiguous commit缺少结构化authority/receipt。

## 45. 结论

Codex的Exec HTTP Capability把Local/Remote MCP网络执行统一到同一个接口，并建立了一条相当完整的分布式body stream：

```text
headers response
-> request-local generated ID
-> ordered body delta
-> per-stream frame cap
-> connection-wide byte budget
-> explicit terminal/error
```

它证明了一个重要架构原则：远程Tool不只有进程执行，Filesystem和HTTP也必须跟随同一Environment authority。

但当前实现仍主要是可信内部transport，而不是可以直接开放给模型的通用安全HTTP Tool。它缺少SSRF/DNS/rebinding防护、redirect authority、HTTP-specific总预算、remote cancel、stream resume、generation binding和credential broker；disconnect synthetic seq与failure tombstone还有细节缺口。

对云端Agent的迁移结论是：**先做network policy与operation identity，再做HTTP transport；先定义bytes/deadline/cancel/receipt，再谈streaming与retry。**
