# Exec Environment解析、Capability Snapshot与Local/Remote选择边界

Codex没有把“命令跑在哪里”简化成一个全局`remote=true`开关。当前实现至少分成五层：

1. Provider在进程启动时产出可用Environment快照；
2. EnvironmentManager校验并持有具体本地/远程运行实例；
3. Thread保存有序的Environment Selection；
4. Turn或Model Step冻结当时已就绪的Environment handle；
5. Capability Root、MCP、Skill和Tool再基于这个快照做能力投影。

这套设计解决了“配置是什么”“当前连接是否可用”“本次模型到底看见什么”“Tool最终用了哪个后端”不能混成一个状态的问题。不过，源码也暴露出一个重要张力：注释把Environment ID和Capability Root当作稳定身份，而动态`upsert`允许同一个ID替换成完全不同的实例；部分消费者虽捕获了`Arc<Environment>`，后续又只拿ID回查全局Registry，导致Step Snapshot并非处处闭合。

## 1. 证据范围

本文基于Codex fork `main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`，主要阅读：

- `codex-rs/exec-server/src/environment_provider.rs`
- `codex-rs/exec-server/src/environment_toml.rs`
- `codex-rs/exec-server/src/environment.rs`
- `codex-rs/exec-server/src/client.rs`
- `codex-rs/exec-server/src/resolved_capability.rs`
- `codex-rs/protocol/src/capabilities.rs`
- `codex-rs/protocol/src/protocol.rs`
- `codex-rs/core/src/environment_selection.rs`
- `codex-rs/core/src/session/turn_context.rs`
- `codex-rs/core/src/session/step_context.rs`
- `codex-rs/core/src/session/mcp.rs`
- `codex-rs/core/src/session/mcp_runtime.rs`
- `codex-rs/core/src/session/world_state.rs`
- `codex-rs/core/src/tools/handlers/mod.rs`
- `codex-rs/core/src/tools/handlers/shell/shell_command.rs`
- `codex-rs/core/src/thread_manager.rs`
- `codex-rs/codex-mcp/src/runtime.rs`
- `codex-rs/core-plugins/src/provider.rs`
- `codex-rs/ext/skills/src/extension.rs`
- `codex-rs/ext/skills/src/provider/executor.rs`
- `codex-rs/ext/mcp/src/executor_plugin.rs`
- `codex-rs/app-server/src/request_processors/environment_processor.rs`
- `codex-rs/app-server/src/request_processors/fs_processor.rs`
- `codex-rs/app-server/src/request_processors/process_exec_processor.rs`
- `codex-rs/app-server/src/request_processors/command_exec_processor.rs`

## 2. 不要把五种“环境状态”混成一个字段

| 状态 | 核心类型 | 寿命 | 回答的问题 |
| --- | --- | --- | --- |
| Provider Snapshot | `EnvironmentProviderSnapshot` | Manager构造期 | 启动时有哪些环境，默认选哪个，是否注入local |
| Registry | `EnvironmentManager` | 进程级 | ID当前映射到哪个具体Environment实例 |
| Thread Selection | `TurnEnvironmentSelection`列表 | Thread配置级 | 用户希望本Thread按什么顺序使用哪些ID和cwd |
| Turn Snapshot | `TurnEnvironmentSnapshot` | Turn级或Step级 | 当前已解析/仍启动中的精确Environment handle |
| Capability Snapshot | `ResolvedSelectedCapabilityRoot`、`McpRuntimeSnapshot` | 单次Model Step | 本次模型可看见并可执行哪些Environment-owned能力 |

这里最值得学习的是：

```text
configured != selected != ready != advertised != executed
```

一个Environment出现在TOML里，不代表Thread选择了它；Thread选择了它，不代表连接已经ready；连接ready，不代表某个Capability Root被选中；Tool被advertise，也仍需要执行时绑定同一代Environment和权限。

## 3. Environment来源优先级

`EnvironmentManager::from_codex_home`按以下顺序选来源：

```text
完整Noise环境变量组
  > $CODEX_HOME/environments.toml（文件存在）
  > CODEX_EXEC_SERVER_URL legacy provider
```

### 3.1 Noise环境变量是全量覆盖，不是补丁

只要下列三个变量中任意一个存在，就进入Noise配置解析：

- Registry URL；
- Environment ID；
- Auth Token。

三个必须同时存在，否则整个Manager构造失败。可选ChatGPT Account ID不会改变这个完整性要求。

Noise路径最终只向Registry写入名为`remote`的Environment，并把它设为default：

```text
default = remote
include local = false
```

即使进程拥有local runtime paths，这条路径也不会同时注入local。

### 3.2 environments.toml存在即成为事实来源

如果`$CODEX_HOME/environments.toml`存在：

- 使用`deny_unknown_fields`严格解析；
- 任何读取、语法、字段或语义错误都会使启动失败；
- 不会因为配置错误再回退到`CODEX_EXEC_SERVER_URL`。

这是一种合理的fail-closed语义：显式配置损坏不能静默切换到另一个执行地点。

### 3.3 Legacy Provider的三态

`CODEX_EXEC_SERVER_URL`归一化后有三种结果：

| 原值 | Provider Snapshot | 默认选择 |
| --- | --- | --- |
| 不存在或trim后为空 | 不提供remote，要求Manager注入local | `local` |
| `none`，大小写不敏感 | 无remote，不注入local | Disabled |
| 其他非空字符串 | 提供固定ID `remote`，不注入local | `remote` |

Legacy Provider这里只做trim与`none`判断，并不先验证`ws://`或`wss://`。非法URL会进入具体连接阶段再失败。

## 4. TOML配置模型

顶层字段只有：

```toml
default = "devbox"
include_local = true

[[environments]]
id = "devbox"
url = "wss://example.invalid/exec"
connect_timeout_sec = 10
initialize_timeout_sec = 10
```

每个remote Environment必须在两类Transport中二选一。

### 4.1 WebSocket Transport

字段：

- `url`；
- 可选`connect_timeout_sec`；
- 可选`initialize_timeout_sec`。

URL会trim，并要求`ws://`或`wss://`前缀，再交给Tungstenite的`IntoClientRequest`校验。

### 4.2 Stdio Transport

字段：

- `program`；
- 可选`args`；
- 可选`env`；
- 可选`cwd`；
- 可选`initialize_timeout_sec`。

约束：

- `program` trim后不能为空；
- `args/env/cwd`只有在设置`program`时允许；
- `connect_timeout_sec`只允许WebSocket；
- relative `cwd`相对`CODEX_HOME`解析，而不是相对启动Codex时的process cwd。

Stdio连接会启动外部进程，所以Manager构造时刻意保持lazy，不在仅列出环境时就产生副作用。

### 4.3 Environment ID规则

TOML路径的ID规则较严：

- 不得为空或有首尾空白；
- `local`与大小写不敏感的`none`保留；
- 最长64 bytes；
- 只允许ASCII字母、数字、`-`、`_`；
- 不得重复。

实现用`id.len()`检查UTF-8 bytes，但错误文字写的是“characters”。由于字符集已经限制为ASCII，当前结果等价，只是错误模型与实现定义不完全一致。

### 4.4 default与include_local是两个维度

`include_local=true`表示Registry里存在local能力；`default=none`表示新Thread不自动选择任何Environment。

因此下面配置是合法的：

```toml
default = "none"
include_local = true
```

此时local仍可被显式选择，但`default_environment_ids()`直接返回空列表，新Thread默认没有shell/filesystem Tool。

这说明：

```text
available environment != default environment
```

## 5. Provider Snapshot是一次性启动输入

`EnvironmentProviderSnapshot`包含：

```text
Vec<(environment_id, Environment)>
EnvironmentDefault
include_local
```

Provider只负责它拥有的remote Environment；local由Manager按`include_local`注入。这避免Provider伪造保留ID `local`，也让local构造统一依赖进程提供的sandbox helper runtime paths。

Manager只有在整个Snapshot完成以下校验后才启动远程连接：

- include_local时必须有local runtime paths；
- remote ID非空；
- remote不能使用保留ID `local`；
- ID不能重复；
- default ID必须确实存在。

这是一个好的“validate then activate”边界。无效Snapshot不会留下部分已启动连接。

但Snapshot只在Manager构造时读取一次；`environments.toml`没有文件监听、版本号或hot reload。运行期变更来自独立的`upsert` API，而不是重新发布Provider Snapshot。

## 6. Registry如何丢失Provider顺序

Provider用`Vec`声明“configured order”，但Manager转存为：

```text
RwLock<HashMap<String, Arc<Environment>>>
```

新Thread默认选择通过`default_environment_ids()`生成：

1. 先放default ID；
2. 再遍历HashMap中所有其他ID。

所以只保证primary/default排第一，其他Environment的顺序并不稳定。TOML Provider原本保存的配置顺序在这里丢失。

这个问题会向下游扩散，因为Selection顺序决定：

- `primary()`是哪一个Environment；
- 默认cwd来自哪里；
- shell Tool默认跑在哪里；
- primary filesystem用于加载哪些Host/Plugin/Skill相关内容；
- MCP local stdio fallback cwd如何计算。

因此多Environment场景不应依赖HashMap迭代顺序。更稳妥的设计是Registry同时保存显式ordered IDs，或让Thread启动协议传入确定顺序。

## 7. 一个Environment是同源Capability Bundle

`Environment`不是只有Exec Backend。它同时绑定：

| Capability | Local实现 | Remote实现 |
| --- | --- | --- |
| Process | `LocalProcess` | `RemoteProcess` |
| Filesystem | `LocalFileSystem` | `RemoteFileSystem` |
| HTTP | `ReqwestHttpClient` | 同一个`LazyRemoteExecServerClient` |
| Info | host shell/cwd | `environment/info` RPC |

Remote Process、Filesystem和HTTP共享同一个`LazyRemoteExecServerClient`。好处是：

- readiness来自同一条连接事实；
- initial startup结果共享；
- 后续断线恢复共享；
- 不会出现“shell已经连到环境A，但filesystem还连到环境B”的隐式分裂。

`get_filesystem_without_reconnect()`是一个刻意的只读/低副作用变体：remote返回FailFast client，未ready或recovering时直接失败，不会为了catalog inspection触发等待或重连。

## 8. Initial Startup与Later Recovery不是同一状态机

`LazyRemoteExecServerClient`保存：

- `startup: OnceCell<Result<Client, Error>>`；
- 最新成功的`current_client`；
- 共享的`reconnect` attempt。

语义是：

```text
首次连接失败 -> 结果永久缓存，同一Environment实例不再重试
首次连接成功后断线 -> 后续get可建立新的逻辑client
```

因此“恢复”只适用于至少成功连接过一次的Environment。首次配置错误、地址暂不可达或stdio启动失败，需要用新的Environment实例替换，不能指望同一lazy client自动复活。

`start_connecting()`对WebSocket、Pending URL和Noise进行后台预热；对Stdio返回None，继续保持lazy。

Environment还持有`AbortOnDropHandle`。当Registry替换实例且旧Environment没有其他`Arc`引用时，未完成的后台startup task会被abort。

## 9. 动态Upsert与Pending Registration

Manager支持三条运行时写路径：

### 9.1 URL Upsert

`upsert_environment(id, url, timeout)`：

1. 校验ID；
2. 归一URL；
3. 构造新Environment；
4. 后台启动连接；
5. 用同ID替换Registry中的Arc。

它不会改变Manager的default ID。

### 9.2 Noise Upsert

每次创建新的Harness Noise Identity，再构造Rendezvous transport。源码明确禁止Noise路径fallback到普通URL transport。

### 9.3 Pending Environment

`register_pending_environment`先把一个等待oneshot URL的Environment写入Registry，并返回带`#[must_use]`的`PendingEnvironmentRegistration`。

调用者必须消费这个一次性capability：

```text
complete(Ok(stable_url))
或
complete(Err(terminal_message))
```

若registration被drop，waiter得到“registration ended before completion”；若Environment已被替换/不再等待，complete返回inactive。

这比“先异步申请URL，成功后才把ID放Registry”更适合Deferred Executor：Thread可以先持有稳定逻辑ID，Model Step只在能力真正ready后投影。

## 10. 动态路径的校验弱于TOML路径

运行期`validate_environment_id`只检查非空；`validate_remote_exec_server_url`只做trim、空值和`none`判断。

它没有复用TOML的：

- 保留ID检查；
- ASCII字符集；
- 64-byte上限；
- `ws://`/`wss://`检查；
- `IntoClientRequest`结构校验。

源码测试甚至用`http://example.com`创建Manager，让错误延迟到connection attempt。

这意味着同一个逻辑对象因入口不同存在两套合法性定义：

```text
TOML environment ID/URL contract
!=
App Server environment/add contract
```

长期应把ID、URL、Transport参数收敛为同一个typed constructor，避免配置文件安全而运行时API宽松。

## 11. Thread Environment Selection是有序意图

`TurnEnvironmentSelection`只有：

```text
environment_id
cwd: PathUri
```

TODO明确指出未来希望PathUri自身携带Environment identity。目前ID和Path是两个字段，调用者必须自行保证它们匹配。

ThreadManager对外验证会拒绝：

- 重复Environment ID；
- Registry中不存在的ID。

但`ThreadEnvironments::update_selections`内部仍采用宽容策略：

- 重复ID保留第一项；
- unknown ID写warn后跳过。

这是“API边界严格、runtime防御性降级”的合理分层，但内部调用若绕过ThreadManager validation，用户看到的配置意图可能与实际snapshot不同。

## 12. Selection解析并不只是等连接

每个Selection解析为`TurnEnvironment`时会做：

1. `wait_until_ready()`；
2. remote调用`environment/info`读取shell；
3. 将remote shell描述转为Codex Shell；
4. 建立`TurnEnvironment(environment_id, exact Arc, cwd, shell)`；
5. 并发启动Shell Snapshot构建。

remote info或shell解析失败不会让Environment resolution失败，只会把`shell=None`并记录warning。连接失败才会让该Selection进入failed状态并从Snapshot中省略。

Shell Snapshot task是shared future，但`TurnEnvironment`在Snapshot完成前就可用。命令执行处通过`peek`使用已经生成的snapshot，因此环境ready与shell snapshot ready是两条不同时间线。

## 13. Blocking Snapshot与Deferred Executor

`ThreadEnvironments`有`non_blocking_snapshots`开关，当前由`Feature::DeferredExecutor`控制。

### 13.1 Feature关闭

`snapshot()`等待所有Selection resolution：

```text
selected -> wait connection/info -> ready or failed -> Turn Snapshot
```

TurnContext冻结这份Turn级Snapshot；同一Turn后续多个Model Step继续使用它。

### 13.2 Feature开启

`snapshot()`只peek shared future：

- 已成功：放入`turn_environments`；
- 已失败：debug并省略；
- 未完成：放入`starting`。

每次`capture_step_context()`重新snapshot，所以同一个Turn可出现：

```text
Step 1: local ready, remote starting
Step 2: local ready, remote ready
```

World State会记录变化，MCP与Capability projection也按Step刷新。这就是Deferred Executor的核心：Model不必为尚未ready的remote整体阻塞Turn，而是在后续Step逐步获得能力。

## 14. Primary Environment不是“local优先”

`TurnEnvironmentSnapshot::primary()`只是ready列表的第一项。

Shell tool不传environment ID时直接使用primary；通用handler的`resolve_tool_environment`也是：

```text
explicit environment_id -> 匹配该Turn Snapshot中的ready环境
缺省 -> primary
```

所以默认选择语义是：

```text
selection order first ready environment
```

不是：

- local优先；
- remote优先；
- 最快ready者优先。

Snapshot按Selection顺序遍历，即使后面的local更早ready，ready列表仍保持输入顺序；starting项不会进入`to_selections()`。

## 15. Local/Remote fallback其实是多套规则

| 消费者 | 选择规则 |
| --- | --- |
| 新Thread默认Selection | default ID在前，其余Registry IDs跟随；default Disabled则空 |
| Shell Tool | exact Step Snapshot的primary，或显式environment ID |
| Permission request | Turn Snapshot primary，或显式environment ID |
| Thread cwd兼容字段 | primary cwd能转host absolute path则用，否则回退Session legacy cwd |
| Skills snapshot | primary Environment filesystem；无primary则None |
| MCP stdio fallback cwd | primary cwd可转host path则用，否则legacy host cwd |
| MCP configured local stdio | 必须存在local Environment |
| MCP configured local HTTP | 即使没有local Environment，也可用ambient `ReqwestHttpClient` |
| App Server `fs/*` | 固定要求Manager中存在local Environment |
| App Server `process/*`、`command/*` | 固定要求local，不跟随Thread primary remote |
| `default_or_local_environment()` | default不存在时才显式fallback local；当前主要是辅助API |

因此“remote mode”并不是一个全局模式。Thread Tool可以在remote primary执行，而App Server自身的host filesystem/process请求仍只允许local；MCP local HTTP又是一个特例，会绕过Environment对象使用ambient HTTP client。

## 16. Foreign PathUri与Host cwd兼容债

Selection的cwd是`PathUri`，理论上能表达foreign executor路径；大量旧代码仍要求`AbsolutePathBuf`。

当前常见兼容策略是：

```text
remote PathUri -> 尝试转host absolute path
失败 -> session legacy host cwd
```

Shell handler更严格：primary cwd不能转为host-native absolute path时，直接向模型返回错误。

这说明Environment抽象已经跨主机，但若干Tool参数、Sandbox policy、MCP fallback cwd与extension input仍绑定host path模型。源码中的多个TODO都指向同一迁移：让PathUri贯穿Turn、Tool和Extension边界，不再把foreign cwd悄悄解释为host cwd。

## 17. Selection复用会固定旧Environment实例

`ThreadEnvironments::update_selections`会复用已有resolution，只要：

- 新旧`environment_id + cwd`完全相同；
- 旧resolution没有已经失败。

它不会检查Registry中同ID的Arc是否已被`upsert`替换。

结果是：

```text
Registry: executor-a -> new Arc
Existing Thread selection executor-a + same cwd -> still old Arc
New Thread or changed cwd -> may resolve new Arc
```

源码测试明确验证：相同ID和cwd会复用resolution；修改cwd才建立新resolution。继承自parent的ready Environment也会优先复用，即使Manager已有同ID replacement。

这可以保护进行中的Thread免受Registry热替换影响，但它也意味着“environment/add replacement”不是live Thread retarget。系统没有显式暴露generation、old/new endpoint、受影响Thread或切换receipt。

## 18. Capability Root只有逻辑位置

`SelectedCapabilityRoot`协议包含：

```text
id: String
location:
  type = environment
  environmentId
  path: PathUri
```

它描述“某个稳定选择根位于哪个Environment的哪个路径”，不保存具体connection handle。

Selected roots会进入Thread extension init和rollout/history，使fork/resume能恢复选择意图。真正用于单个Step时，才解析成：

```text
ResolvedSelectedCapabilityRoot {
  selected_root,
  Arc<Environment>
}
```

这个Resolved值明确是process-local，不可持久化。

## 19. Passive Inspect与Active Resolve不同

### 19.1 Passive Inspect

`inspect_selected_capability_roots()`：

- 不启动Environment；
- 不等待连接；
- missing ID返回warning；
- terminal failure返回warning；
- starting/recovering静默省略；
- 相同Environment ID只检查一次readiness；
- ready roots保持用户输入顺序。

这适合catalog UI：读取状态不应为了展示而启动stdio process。

### 19.2 Step Resolve

`resolve_selected_capability_roots()`接收Turn/Step已经捕获的：

```text
HashMap<environment_id, Option<Arc<Environment>>>
```

其中：

- `Some(Some(exact_arc))`表示本Step已经ready；
- `Some(None)`表示本Step捕获时仍starting，直接省略；
- map中没有该ID时，才从Manager当前Registry取Arc。

对后者：

- startup已经结束则await结果；
- startup未结束则触发`start_connecting_for_use`，本Step仍返回false；
- missing、starting、failed都从结果中静默省略。

这是一种刻意的“下一Step生效”语义，尤其适用于未在Thread Environment Selection里但被Capability Root引用的lazy stdio Environment。

## 20. Step Context试图冻结所有动态能力

一次Model sampling前，`capture_step_context()`冻结：

- Turn引用；
- Environment Snapshot；
- Resolved Selected Capability Roots；
- MCP Runtime Snapshot；
- 本次固定的MCP tool list；
- canonical AGENTS.md snapshot。

注释明确要求同一次sampling的：

```text
context
advertised tools
tool calls
```

共享同一个request view。

当Deferred Executor关闭，Environment来自TurnContext冻结值；开启后每个Step重新读取ThreadEnvironments，并刷新AGENTS.md、Capability Roots和MCP projection。

`mcp_tool_snapshot`还用`OnceCell`保证同一Step第一次列出的MCP Tool列表不会在后续调用中变化。

## 21. Capability readiness如何驱动MCP Runtime

Resolved Capability Roots先提取为去重且保序的`available_environment_ids`。

MCP contributor用这些ID决定selected executor plugin是否可投影。Runtime复用逻辑的key主要是：

- available Environment ID列表；
- projected MCP servers；
- connector snapshot。

如果Environment availability变化但实际MCP server/connector集合不变，Runtime只更新input key，不重启live manager。

如果变化影响enabled MCP server，则创建新的`McpRuntimeSnapshot`，旧snapshot持有旧Manager和cancel token，直到最后一个in-flight Step handle drop才取消。

这是很好的代际管理：MCP进程重建不会直接杀掉仍在执行旧Step的runtime。

## 22. 但“exact environment bindings”并未完全闭合

`McpRuntimeSnapshot`注释称自己保存“exact environment bindings”，实际`McpRuntimeContext`持有的是：

```text
Arc<EnvironmentManager>
local_stdio_fallback_cwd
```

MCP server真正解析时按`config.environment_id`回查Manager当前Registry，而不是保存Step解析出的`Arc<Environment>` map。

同样的重新查找也存在于：

- `ExecutorPluginProvider`；
- `ExecutorSkillProvider`；
- executor skill resource read；
- selected plugin MCP metadata初次读取。

Step Context虽然持有`ResolvedSelectedCapabilityRoot`的exact Arc，World State contributor只把raw `SelectedCapabilityRoot`传给Skills Extension；Extension再按Environment ID查询Manager。

于是存在竞态：

```text
T1 Step解析root -> old Arc ready
T2 environment/add用同ID替换Registry -> new Arc
T3 Skill/MCP provider按ID回查 -> new Arc
```

本次Step的readiness证据来自old Arc，实际文件读取或HTTP/stdio启动却可能来自new Arc。

## 23. ID稳定性是约定，不是强制不变量

`ResolvedSelectedCapabilityRoot`注释写着：

> Environment IDs have stable identity and contents.

Skills和selected plugin metadata也因此按root永久cache到Thread结束，不做filesystem watcher或content invalidation。

但动态`upsert_environment`允许：

- 相同ID换URL；
- 相同ID换Noise identity/provider；
- 相同ID从pending换成新的pending；
- 替换时不比较endpoint、content digest或generation。

所以“stable identity and contents”目前是调用方契约，不是Manager强制的事实。

风险包括：

- 已缓存Skill catalog来自旧内容，后续resource read却落到新Environment；
- selected plugin MCP metadata永久保留旧manifest，但server runtime按同ID使用新Environment；
- `available_environment_ids`只比较字符串，相同ID换实例不会触发MCP refresh；
- 一个Thread复用旧Arc，另一个consumer按Manager拿新Arc，形成同ID双代并存。

这不是说`Arc`捕获设计错误，而是Registry replacement API缺少与缓存语义匹配的generation contract。

## 24. Readiness的可见性不统一

| 路径 | missing | starting/recovering | terminal failure |
| --- | --- | --- | --- |
| ThreadManager validate | 同步拒绝 | 不检查 | 不检查 |
| Thread Selection resolve | warn后跳过 | blocking等待或non-blocking starting | warn/debug后跳过 |
| Capability inspect | warning | 静默省略 | warning |
| Capability step resolve | 静默省略 | 启动但本Step省略 | 静默省略 |
| Shell Tool | Step无primary时模型收到unavailable | 不会被advertise为ready环境 | 模型只看到unavailable |
| MCP projection | ID不在available集合 | 不投影 | 不投影 |

系统选择了availability-based projection，避免把尚不可用Tool展示给模型；代价是“没有这个能力”与“能力正在启动/已失败”在模型视角常常不可区分。

若产品要向用户解释Deferred Executor，应增加结构化状态：

```text
environmentId
generation
phase: configured | starting | ready | recovering | failed | replaced
retryable
lastErrorCode
observedAt
```

## 25. Error与Secret边界

TOML URL校验错误直接把完整URL插进错误消息；WebSocket connect timeout/error类型也保存URL。

如果URL含signed query或userinfo，这些错误可能进入：

- tracing logs；
- App Server JSON-RPC error；
- feedback artifact；
- UI diagnostics。

运行时`environment/add`同样把`err.to_string()`映射为invalid request。

因此Environment URL应在进入错误模型前拆成：

- safe origin/host；
- credential presence bool；
- opaque endpoint ID；
- redacted query。

不要让Transport配置的完整secret-bearing字符串成为可Display错误的一部分。

## 26. Pending与Failed Environment缺少生命周期操作

当前Manager公开add/replace和get，没有对应的：

- remove Environment；
- list generation/readiness；
- retry initial startup；
- cancel pending registration；
- compare-and-swap replace；
- drain old generation；
- 查询哪些Thread仍持有旧Arc。

Pending complete失败、registration drop或首次连接失败后，terminal Environment仍留在Registry。调用者只能再次upsert同ID覆盖。

这使Registry更像一个“last writer wins handle map”，还不是完整的Environment control plane。

## 27. App Server Environment API不是Thread Selection API

`environment/add`只修改进程级Manager Registry；它不会：

- 更新已有Thread的Selection；
- 改变default Environment ID；
- 强制已有Thread放弃复用的old Arc；
- 发出Thread config changed；
- 让相同available ID触发MCP runtime refresh。

`environment/info`则直接按ID读Manager当前Arc。

因此控制平面上至少有两种写操作：

```text
Registry mutation: environment/add
Thread intent mutation: thread settings environments
```

两者必须分别审计，不能把“已注册remote”误报成“当前Thread已切换到remote”。

## 28. 值得保留的优质设计

### 28.1 Provider不拥有local注入权

local保留ID和runtime paths由Manager统一控制，减少Provider伪造host能力的空间。

### 28.2 Validate完整Snapshot后才Activate

不会在发现duplicate/default错误前就留下半启动连接。

### 28.3 Capability Bundle共享同一Remote Client

Process、Filesystem、HTTP不会各自漂移到不同连接代际。

### 28.4 首次Startup Singleflight

所有调用者共享一个OnceCell结果，避免并发Selection启动多个exec-server。

### 28.5 Initial Failure与Reconnect明确分层

错误不会被模糊的无限retry掩盖，成功后的断线恢复又有独立通道。

### 28.6 Stdio在Inspection时保持lazy

列出Capability不应启动外部进程，是非常重要的副作用边界。

### 28.7 Selection保序、ID去重

primary语义可以从用户意图推导，不由ready竞速决定。

### 28.8 Non-blocking Step Snapshot

Deferred Executor让能力渐进出现，而不是让整个Turn卡在remote provisioning。

### 28.9 Exact Arc用于进行中Step

`ResolvedSelectedCapabilityRoot`已经建立了正确方向：逻辑ID用于持久化，process-local handle用于一次执行。

### 28.10 MCP Runtime用Arc代际保护in-flight Step

新的projection可以发布，旧Manager直到最后一个使用者结束才取消。

## 29. 当前实现的主要缺口

### 29.1 Provider有序、Manager无序

默认之后的Environment顺序取决于HashMap，可能改变primary之后的投影顺序和多环境UX。

### 29.2 热替换缺generation

同ID replacement没有`expectedGeneration`、endpoint digest、old generation receipt或drain状态。

### 29.3 Thread复用与Registry替换语义不透明

相同ID+cwd会继续旧Arc，既没有明确“sticky thread binding”协议，也没有显式“retarget existing threads”操作。

### 29.4 Step Snapshot发生ID回查泄漏

Skill、Plugin和MCP多处没有消费已解析的exact Arc，而是回查当前Registry。

### 29.5 MCP Snapshot key不含Environment generation

available ID不变时，实例 replacement可能完全不触发runtime rebuild。

### 29.6 Capability内容稳定只靠假设

Thread lifetime cache与可替换Registry存在根本不一致。

### 29.7 动态API校验较弱

TOML与`environment/add`不是同一typed contract，非法scheme和宽松ID会延迟失败。

### 29.8 Provider配置没有reload/reconcile

TOML只读一次；运行时Registry写入又不会持久化回配置，重启后可能丢失。

### 29.9 Readiness省略缺结构原因

Model和部分UI无法区分starting、recovering、failed、missing。

### 29.10 Foreign cwd仍回落host语义

PathUri抽象没有完全贯穿Tool、Sandbox、MCP和Extension。

### 29.11 Error可能携带完整URL

signed query、userinfo或临时凭据存在日志外泄风险。

### 29.12 Pending/Failed缺清理与重试API

terminal实例留在map，只能last-writer-wins覆盖。

### 29.13 selected root本身缺少版本证据

协议没有environment generation、root content digest、manifest revision或lease。

### 29.14 Local HTTP fallback绕过统一Environment对象

MCP local HTTP即使local Environment不存在仍使用ambient Reqwest，和“所有能力归属Environment”的模型不完全一致。

## 30. 更稳健的Environment契约

可把逻辑身份与实例代际显式拆开：

```ts
type EnvironmentBinding = {
  environmentId: string
  generation: number
  transportKind: 'local' | 'websocket' | 'stdio' | 'noise'
  endpointFingerprint?: string
}

type EnvironmentReadiness = {
  binding: EnvironmentBinding
  phase: 'starting' | 'ready' | 'recovering' | 'failed' | 'draining'
  retryable: boolean
  observedAt: string
  errorCode?: string
}

type ResolvedCapabilityRoot = {
  rootId: string
  binding: EnvironmentBinding
  path: string
  contentRevision?: string
}
```

关键约束：

1. Registry写入返回新generation；
2. Thread Selection明确选择“跟随latest”还是“pin generation”；
3. Step Snapshot保存`environmentId + generation + exact handle`；
4. Skill/MCP/Plugin消费者只能用Step提供的binding，不得只按ID回查；
5. Cache key至少包含root ID、Environment generation和content revision；
6. MCP Runtime key包含实际Environment binding，而不是只有available IDs；
7. replacement支持CAS与old generation drain receipt。

## 31. 对当前NestJS Agent项目的翻译

当前项目不需要立刻实现远程exec-server，但可以先学习其状态边界。

### 31.1 不要把Tool Registry与Tool Runtime混为一体

```ts
interface ToolRuntimeBinding {
  runtimeId: string
  generation: number
  kind: 'in-process' | 'http-worker'
}
```

Tool定义可以稳定，具体执行runtime要按Agent Run或Step冻结。

### 31.2 Run开始时保存有效能力快照

不要在Tool执行中反复读取可变全局配置：

```ts
interface AgentStepCapabilitySnapshot {
  stepId: string
  runtimeBindings: ToolRuntimeBinding[]
  advertisedToolNames: string[]
  permissionRevision: number
}
```

### 31.3 配置、就绪和展示分开

未来若有异步HTTP Tool worker：

```text
configured
-> provisioning
-> ready
-> advertised to model
-> invoked
-> receipt committed
```

前端应能展示provisioning/failed，而不是简单把Tool从列表消失。

### 31.4 用generation保护热更新

NestJS provider或remote Tool endpoint更新时，进行中的Agent Run继续旧generation，新Run采用新generation；不要让同一个Run前半段调用旧服务、后半段无提示切到新服务。

### 31.5 Fallback必须是显式产品策略

远程Tool失败时是否回退本地实现，取决于数据authority与副作用，不应由代码“有哪个就用哪个”。至少记录：

- requested runtime；
- selected runtime；
- fallback reason；
- permission差异；
- actual execution receipt。

## 32. 建议验证矩阵

| 场景 | 应验证的事实 |
| --- | --- |
| TOML存在但非法 | 启动失败，不回退legacy URL |
| `default=none, include_local=true` | Registry有local，新Thread默认Selection为空 |
| 多remote且default固定 | default第一，其余顺序应有明确契约 |
| Stdio仅被inspect | 不启动子进程 |
| Stdio被Capability Root首次引用 | 本Step省略并启动，后续Step才ready |
| Deferred remote启动 | Step 1 starting，Step 2 ready，World State更新 |
| 同ID upsert新URL | 记录generation；旧Thread与新Thread绑定可解释 |
| 同ID同cwd更新Selection | 明确复用旧Arc还是retarget，不靠隐藏实现 |
| Step resolve后立刻upsert | Skill/MCP实际读取仍来自该Step exact binding |
| MCP available IDs不变但generation变 | Runtime要么pin旧代，要么明确刷新 |
| Pending registration drop | 状态变failed且可remove/retry |
| signed URL连接失败 | 日志与JSON-RPC错误不含credential/query |
| foreign PathUri cwd | 不静默回退host cwd执行敏感操作 |
| local Environment disabled | App Server host FS/process拒绝，MCP HTTP例外需显式审计 |

## 33. Teach-back

### 33.1 为什么Environment ID不能同时代表配置与实例？

因为同一个逻辑ID在运行期可能replacement、reconnect或重新provision。持久化需要稳定ID，单次执行一致性需要具体generation和handle。

### 33.2 为什么Deferred Executor必须按Step捕获？

远程环境可能在Turn开始后才ready。按Turn冻结会整Turn看不见新能力；每次Tool调用实时查全局状态又会让advertised和executed不一致。Step是合适的一致性窗口。

### 33.3 为什么只比较available Environment IDs不够？

相同ID可能已经换了实例、endpoint或内容。Tool catalog、MCP server和实际filesystem都可能变化，ID集合却完全相同。

### 33.4 为什么local fallback不能是默认“容错”？

remote和local可能拥有不同文件、secret、权限和副作用域。静默fallback可能在错误机器执行命令，属于authority错误，不是普通可用性优化。

### 33.5 Codex当前最值得保留、最该修正的各是什么？

最值得保留的是Provider/Registry/Selection/Turn/Step分层、exact Arc与Deferred projection；最该修正的是ID稳定性只靠约定、动态upsert缺generation，以及已解析exact handle在Skill/MCP链路中又退化为ID回查。

## 34. 结论

Codex的Exec Environment实现已经不是简单remote shell开关，而是一个逐层收敛的能力系统：

```text
Provider startup snapshot
-> Environment registry
-> ordered Thread selections
-> ready/starting Turn snapshot
-> exact Step capability projection
-> Tool/MCP execution
```

它最成熟的部分是把可配置性、连接生命周期、Thread意图和Model可见性拆开，并让Deferred Executor在Step边界渐进发布能力。

当前最大的架构缺口则集中在“稳定身份”上：Provider顺序转入HashMap后丢失；运行时API可用相同ID替换任意实例；Thread resolution、Capability Arc、Skill cache和MCP runtime对“同ID内容稳定”的理解并不一致；部分消费者又绕过Step捕获的exact Arc按ID查最新Registry。

对云端Agent最重要的迁移结论是：**持久化逻辑runtime ID，执行时冻结generation与exact binding；fallback必须显式；advertise和execute必须共享同一能力快照。**
