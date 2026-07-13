# Code Mode 运行时：Fresh Isolate、Nested Tool、Cell 状态机与进程隔离

本文研究 Codex 的 Code Mode 如何让模型提交一段 JavaScript，在 V8 中组合多个已有 Tool，并通过 `exec` / `wait` 把长任务、增量输出、取消和 Tool Observation 接回普通 Agent Turn。重点不是 JavaScript 语法，而是“代码编排器”怎样复用既有 Tool 权限边界、怎样管理跨 Turn Cell，以及所谓隔离究竟保护了什么、没有保护什么。

源码事实基于：

- Codex：`/Users/lihaoran/Desktop/codex`，`main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`
- 当前项目：`/Users/lihaoran/Desktop/agent`，研究起点 `master@5f2ad11f2c65425e84392e81048364d55ec626ef`
- 主要入口：`codex-rs/code-mode/**`、`codex-rs/code-mode-host/**`、`codex-rs/code-mode-protocol/**`、`codex-rs/core/src/tools/code_mode/**`、`codex-rs/tools/src/code_mode.rs`

## 1. Code Mode 不是第二套 Tool Runtime

整体链路是：

```text
model calls exec(raw JavaScript)
  -> CodeModeExecuteHandler
  -> thread-scoped CodeModeService
  -> logical CodeModeSession
  -> CellActor
  -> fresh V8 isolate on a dedicated OS thread
  -> tools.some_tool(input)
  -> CodeModeDispatchBroker
  -> ordinary ToolCallRuntime / ToolRouter / ToolRegistry
  -> existing hook / approval / permission / sandbox / handler
  -> JSON result resolves the V8 Promise
  -> text/image/result returned as normal tool observation
```

Code Mode 只新增“编排语言”和 Cell 生命周期，没有绕开 Tool Router。真正的 shell、MCP、extension、dynamic tool 仍由原 runtime 执行。

这是最值得学习的边界：编排层可以改变调用方式，但不能获得一条更短的权限通道。

## 2. 三层生命周期不能混成一个对象

实现至少有三种寿命：

| 对象 | 寿命 | 持有内容 |
| --- | --- | --- |
| `ProcessOwnedCodeModeSessionProvider` | `ThreadManager` 级 | 一个可复用 host process connection |
| `CodeModeService / CodeModeSession` | Codex Thread 级 | Cell registry、共享 JSON stored values、dispatch broker |
| Cell | 单次 `exec` 级 | V8 isolate、输出buffer、pending tool/timer、observer、取消树 |

Provider 在多个 Codex Thread 之间共享，只表示它们可复用同一个子进程；每个 Thread 仍创建独立 logical session，不能互读 `store()` 数据。

前端类比：共享 Web Worker 进程不等于共享每个页面的 Pinia store；进程是承载容器，session 才是业务隔离边界。

## 3. 每次 Exec 都是 Fresh V8 Isolate

源码为每个 Cell：

- 新建一个 OS thread。
- `v8::Isolate::new(v8::CreateParams::default())`。
- 创建新 Context。
- 安装受控 globals。
- 把源码作为 `exec_main.mjs` async module 编译执行。

因此连续两次 `exec` 不共享：

- JavaScript global variable。
- module instance。
- closure。
- timer。
- unresolved Promise。

跨 Cell 唯一显式共享的是 JSON `store/load`。这种设计用序列化边界替代“长期活着的 REPL heap”，恢复和隔离都更清楚。

## 4. Fresh Isolate 不等于 Durable Session

`stored_values` 只在 `SessionRuntime` 内存中的 `HashMap<String, JsonValue>`。它没有写 Rollout、SQLite 或磁盘。

以下情况都会丢失：

- Codex Thread shutdown。
- 主进程使用 in-process runtime 时退出。
- standalone host crash 后重连。
- session 被重新打开。

文档把 Session 称为 durable，语义是“在同一 Codex Thread 的多个 Cell 之间持续存在”，不是 crash-durable。

对当前项目，必须继续区分：Run 内存状态、Conversation 持久事实、可重建投影，不能因为对象名叫 Session 就默认可恢复。

## 5. Stored Value 采用 Snapshot + Completion Merge

启动 Cell 时，Session 会 clone 当前整张 `stored_values` 作为该 isolate 的快照。Cell 内 `store(key, value)`同时更新：

- 本 Cell 随后 `load()` 可见的本地 map。
- `stored_value_writes` 增量集。

Cell 完成时才在 Session mutex 下把增量 writes merge 回共享 map。

这很像前端 optimistic form：打开编辑器时拿快照，提交时只发 dirty fields，而不是用旧快照覆盖整条记录。

## 6. 并发 Cell 的同 Key 冲突是 Last Completion Wins

多个 Cell 可以从同一快照开始。它们写不同 key 时可安全 merge；写同一个 key 时，后完成者覆盖先完成者。

当前没有：

- version/CAS。
- conflict event。
- key lease。
- transaction retry。

因此 stored values 适合临时编排数据，不适合作为并发业务真相。若迁移到云端 Agent，应给跨 Run 状态增加版本，而不是照搬内存 map。

## 7. Script Error 仍会提交此前 Store Writes

V8 Promise rejected 或 callback 抛错时，runtime 会带上 `stored_value_writes` 发送 `Result { error_text }`；Cell completion commit 不因 `error_text` 非空而回滚。

所以：

```js
store("phase", "started");
throw new Error("boom");
```

会得到失败结果，但 `phase` 仍可能提交。

反之，显式 terminate/cancellation 会拒绝 completion commit。这说明 Code Mode 的 store 是“执行过程中已声明的写”，不是事务数据库。错误结果里必须让调用方能区分“执行失败”与“状态未变”，不能默认二者相等。

## 8. `exit()` 是成功终止，不是进程退出

`exit()`：

1. 在 RuntimeState 标记 `exit_requested`。
2. 抛出内部 sentinel string。
3. module loader 识别该 sentinel。
4. 把它转换成 `error_text: None`。

因此它类似函数的 early return，不会关闭 host process，也不会把 Cell 标成失败；此前 output 与 store writes 仍可提交。

内部 sentinel 与普通异常分离，比依赖错误文案或特殊 Error class 更不易被 user code 偶然混淆。

## 9. 受控 Globals 是 Capability Surface

新 Context 显式删除：

- `console`。
- `Atomics`。
- `SharedArrayBuffer`。
- `WebAssembly`。

然后安装：

- `tools`、`ALL_TOOLS`。
- `text`、`image`、`generatedImage`。
- `store`、`load`。
- `notify`、`yield_control`、`exit`。
- `setTimeout`、`clearTimeout`。

没有 Node 的 `process`、`require`、文件系统、网络或 package loader。静态和动态 import 都被拒绝。

这不是把 JavaScript 缩成纯 JSON 表达式；普通 ECMAScript 计算能力仍存在。安全边界的核心是“不向 Context 暴露 host capability”，不是正则过滤源码。

## 10. No Import 是 Module Loader 的硬拒绝

主源码仍作为 ES module 编译，以支持 top-level `await`。但 module resolution callback 对任何 specifier 都抛 `Unsupported import in exec`，dynamic import 也返回 rejected Promise。

好处是：

- 不读取本地模块。
- 不解析 npm dependency。
- 不给远程 URL import 留入口。
- 同一源码在 in-process/remote host 语义一致。

代价是复杂逻辑只能内联，模型可能生成大脚本。源码和 V8 heap 仍需要独立大小预算。

## 11. Tool 列表来自当前 Step 快照

每次 `exec` 前，`CodeModeExecuteHandler` 从该 Step 已规划的 nested tool specs 构建 definitions，并随 ExecuteRequest 送入 Cell。

Cell 获得的是创建时能力快照，不会在执行中随 registry 动态漂移。Deferred tool 也可以已经注册在 runtime 中，只是 prompt description 可能省略；`ALL_TOOLS`仍列出实际可调用集合。

这延续了 Codex 的重要模式：一次 Step 的 schema、handler、policy generation 应冻结，不能在 Tool Call 到达时重新拼一套可能不同的 registry。

## 12. CodeModeOnly 只改变模型可见面

`ToolMode::CodeModeOnly` 隐藏普通 nested tool 的直接模型入口，只展示 `exec` / `wait`；这些工具仍在 ToolRegistry 中供 Code Mode 调用。

另有两个配置：

- `excluded_tool_namespaces`：既不进入 Code Mode，也不被其描述增强。
- `direct_only_tool_namespaces`：只允许模型直接调用，不放进 Code Mode。

这说明“注册”“模型可见”“代码可调用”是三个不同维度。当前项目未来做敏感 SEO 工具时，也应允许“只能经人工 UI 调用”或“只能经受控 workflow 调用”，而不是单个 `enabled` boolean。

## 13. Tool 名称需要经过两次映射

Namespaced tool 先变成 Code Mode name，例如：

```text
namespace=mcp__foo, name=read
  -> mcp__foo__read
  -> JavaScript-safe global identifier
```

非 ASCII 字母数字、`_`、`$`会归一化为 `_`。

Definitions 目前按归一化前的 `name` 排序去重，安装 globals 时才做 identifier normalization。由此可以推断：`a-b` 与 `a_b` 之类不同 raw name 可能映射到同一个 property，后安装者覆盖前者，而 `ALL_TOOLS`仍可能列出两个同名 global。

更稳健的 tool compiler 应在规划阶段检测“最终可执行名”冲突并 fail closed，而不是让对象赋值顺序决定 authority。

## 14. Nested Tool 输入先过 JavaScript→JSON 边界

Function tool：

- 无参数转成 `{}`。
- 有参数必须是 JSON object。

Freeform tool：

- 必须是 string。

V8 callback 先用 `JSON.stringify` 转成 `serde_json::Value`。循环引用、BigInt 等不可 JSON 序列化值会在进入 Tool Router 前失败。

这里做的是 wire-shape 校验，不是完整 JSON Schema validation；真正的 DTO/schema/policy 校验仍应由目标 Tool handler 负责。

## 15. Nested Tool 继续走普通治理链

`call_nested_tool()`把 invocation 转成普通 `ToolCall`，并使用：

```text
ToolCallSource::CodeMode {
  cell_id,
  runtime_tool_call_id
}
```

调用 `ToolCallRuntime::handle_tool_call_with_source()`。

因此 nested Tool 仍保留：

- Router/Registry ownership。
- Pre/Post Hook。
- Approval/Guardian。
- Permission与Sandbox。
- Tool telemetry与provenance。
- cancellation token。

只有 `exec` 明确禁止递归调用自己，`wait`也不作为 nested tool 暴露，避免形成无界 Cell 树。

## 16. Tool Promise 与 Cell Cancellation 形成严格父子树

Session shutdown token是根；Cell token是child；每个 notification/tool callback再拿child token。

取消方向固定为：

```text
Session shutdown
  -> Cell cancellation
    -> nested tool / notification cancellation
```

Cell terminate还会同时：

- 发 runtime `Terminate` command。
- 唤醒 paused control channel。
- 调 V8 `IsolateHandle::terminate_execution()`。

最后一项使 `while (true) {}` 这种不 await 的 CPU loop 也能被打断，而不只依赖 cooperative cancellation。

## 17. Exec 的“Yield”不是 Cell Completion

初次 `exec`默认等待10秒。若脚本仍运行，返回：

```text
Script running with cell ID N
```

后续必须调用 `wait(cell_id)`。每次 Yield 只取走从上次观察之后新增的 content items；Cell、isolate、pending tool仍继续存在。

这把“Tool Call HTTP response结束”和“底层工作结束”拆开，类似前端收到 `202 Accepted + jobId`，而不是让一个请求无限占用连接。

## 18. Pending Frontier 是远程握手的另一种观察模式

内部还有 `PendingFrontier`：当 V8 已执行到需要外部 Tool/timeout command 的暂停点时，返回当前 output和pending tool call IDs。

standalone host用它把“Cell已创建且不会在客户端claim前偷偷跑远”建模出来。客户端收到 `ExecutionStarted`、登记Cell ownership并claim request后，才继续完整dispatch。

这解决了典型竞态：远程执行已经产生 nested Tool 副作用，但客户端还没拿到可终止/追踪它的 Cell ID。

## 19. 单 Cell 同时只允许一个 Observer

CellState/CellActor拒绝第二个并发 observer，返回 `BusyObserver`。Terminate也只能由一个调用者claim，重复终止返回 `AlreadyTerminating`。

状态机核心包括：

```text
Running
  -> Completed(buffered)
  -> CompletionClaimed
  -> Tombstone

Running
  -> Terminating
  -> Tombstone
```

Terminal outcome由同一个 mutex线性化；completion state commit与terminal event发布不能分别由两个竞态路径成功。

## 20. Completion 可以先于 Observer 被缓存

脚本可能在初次 observer切换、yield response receiver drop或下一次wait之前完成。CellState把 terminal event暂存在 `Completed`，直到某个 observer成功claim。

如果 response receiver已关闭，事件不会直接丢弃，而是恢复buffer。只有成功delivery后才cancel token并清Cell。

这类似服务端 outbox：producer完成不等于consumer已经确认接收，二者需要独立状态。

## 21. `yield_control()` 只是请求交出当前输出

helper发送 `YieldRequested` event，不会在 JavaScript 调用点自动 `await`，也不冻结同步代码。

CellActor收到后可立即把当前 content items交给 Yield observer；脚本随后仍可继续运行并产生下一批 output。模型若想等待外部世界，仍需显式 await Promise/tool/timer。

API名字若只叫 `yield` 容易让开发者误以为它是协程调度点；文档明确“yield accumulated output”非常重要。

## 22. Output 是显式数据，不依赖 Console Capture

`console`被删除，输出必须通过：

- `text(value)`。
- `image(...)`。
- `generatedImage(...)`。
- `notify(value)`。

`text`对primitive转字符串，对object尽量 `JSON.stringify`。这比捕获stdout更结构化，也让每个输出项可带image detail。

图片拒绝HTTP(S) URL，只接受data URL或MCP image block转换出的base64 data URL，避免模型响应在未来再次触发不受控远程抓取。

## 23. `notify()` 是 Turn 注入，不是普通结果项

`notify`发送异步 notification，由 Core调用`session.inject_if_running()`注入额外 `custom_tool_call_output`。它不返回 Promise，也不会让脚本等待delivery。

Cell正常完成时会drain notification tasks；notification失败会被task supervision记录，但不自动让脚本主结果失败。

如果当时没有 active Turn，注入会失败。因此 notify 是“尽快把进度推入当前推理”的best-effort control plane，不应作为唯一业务回执。

## 24. `wait` 故意绕过普通 Pre/Post Tool Hook

`wait`只是对已有 runtime Cell的控制，不是新的用户业务动作。因此其 handler显式不生成 PreToolUse/PostToolUse payload。

但 Cell 内真正发起的 nested Tool仍走完整 hook。

这个细节避免审批系统把“等10秒取输出”误判成新的风险操作，也避免 Post Hook重写 runtime control response导致状态机失真。

## 25. Output Token Budget 是事后投影预算

`max_output_tokens`最终在 Core的`handle_runtime_response()`里截断模型可见 content items。它不会限制：

- V8生成多少字符串。
- CellActor在内存中累计多少output。
- nested Tool返回多大JSON。
- standalone IPC传输多少bytes。
- store value占多少内存。

而且用户可以提供任意safe-integer token值，当前未见业务上限。

这再次证明“模型上下文预算”不等于“运行时资源预算”。云端系统至少需要 source bytes、output bytes、tool result bytes、heap、CPU和wall-clock六种独立限制。

## 26. Yield Time 也没有合理上限或总 Deadline

Exec pragma校验非负JS safe integer；Wait参数是`u64`。但两者没有产品级最大值，Cell也没有自动总wall-clock deadline。

结果是：

- `while(true)`可长期占一个V8 thread，直到显式terminate/session shutdown。
- await永不resolve的Promise可长期占active Cell。
- 极长yield time会让调用者长时间等待。

“可取消”不等于“自动有界”。生产任务需要 deadline owner，而不是期待用户最终点击停止。

## 27. `setTimeout` 每个 Timer Spawn 一个 OS Thread

当前 timer实现非常直接：每次`setTimeout`都`std::thread::spawn + sleep`，到点后向runtime command channel发送消息。

`clearTimeout`只从V8 pending map删除callback，不会终止已sleep的thread。Cell提前结束时，timer thread仍会睡到deadline再发送到已关闭channel。

因此大量/长时间timer会造成host线程资源放大。更成熟实现应使用单个Tokio timer wheel、每Cell timer数量上限和shutdown cancellation，而不是一timer一thread。

## 28. 默认使用 Standalone Host Process

`CodeModeHost` feature标为Stable且默认开启。ThreadManager共享一个`ProcessOwnedCodeModeSessionProvider`，按需spawn同目录下`codex-code-mode-host`。

进程使用：

- stdin/stdout私有framed JSON IPC。
- 独立process group（Unix）。
- `kill_on_drop`与supervisor reap。
- stderr只进入debug tracing。

Code Mode本身仍是UnderDevelopment且默认关闭；host feature默认开只决定启用Code Mode后优先在哪执行。

## 29. Host Process 是 Fault Containment，不是完整 OS Sandbox

把V8放到子进程可隔离：

- V8 crash/panic。
- 某些heap破坏。
- isolate线程失控。
- 主Codex进程的直接内存故障域。

但spawn没有展示：

- seccomp/sandbox profile。
- cgroup/Job Object。
- CPU quota。
- address-space/heap limit。
- process wall-clock watchdog。

V8使用default CreateParams，JIT默认开启。一个Cell仍可能耗尽host CPU/内存，并连带杀死同host中的所有logical sessions。

所以“子进程隔离”应准确命名为fault containment，不应宣传为资源sandbox。

## 30. Host Missing 会静默回退 In-Process

只有spawn错误是`NotFound`时，Provider永久切成`InProcess`并继续创建Session。若host存在但握手失败、权限错误或异常退出，则返回错误，不回退。

这个策略提高开发版/打包缺文件时的可用性，却可能悄悄降低隔离强度。安全能力发生降级时更稳健的做法是：

- emit明确warning/event。
- 在managed环境允许配置fail closed。
- telemetry记录selected runtime backend。

当前项目未来若有不可信代码执行，绝不能把“找不到sandbox worker”视为可静默降级到Nest主进程。

## 31. Host 有并发 Admission，但没有单 Cell 资源配额

standalone host限制：

- 最多256个in-flight protocol requests。
- 最多128个active Cells。
- request/session recent ID集合各保留4096条防短期复用。

超过上限立即返回typed error，不排无限队列。这是好的admission control。

但128是并发数量上限，不是公平调度：一个Cell仍可无限CPU，多个Cell也没有per-session配额。共享host还需要tenant/thread级配额，避免一个Thread吃满全局128 slots。

## 32. IPC 协议严格但单 Frame 上限很大

协议用4-byte little-endian length prefix + JSON：

- 单frame最大64MiB。
- serde多数message启用`deny_unknown_fields`。
- 首包必须ClientHello。
- 当前只协商Protocol V1。
- capability集合当前为空。
- handshake deadline 10秒。

严格schema/version是优点；64MiB只防无限分配，不代表适合常态业务。一次大source、tool result、base64 image或stored value仍可能制造明显内存峰值。

## 33. Remote Host 重连会丢 State，但 Cell Generation 能 Fence 旧 ID

Connection死亡后，下次操作可spawn新host、打开新remote session。新的Session generation被编码进public cell ID：

```text
generation 1: 3
generation 2: g2:3
```

旧generation Cell ID传给新host会明确报stale，不会错误命中新host重新从1编号的Cell。

这是优秀的ABA防护；但新session的`stored_values`为空。Generation解决“别操作错对象”，不解决“恢复旧状态”。

## 34. Host Crash 的 Blast Radius 是全部共享 Session

Host process由ThreadManager级Provider共享。一个runtime thread panic可通过task failure handler让HostPeer fail，连接supervisor随后终止process。

驱动会：

- 失败pending requests。
- 通知各delegate关闭live Cells。
- 完成session cleanup。
- 后续按新generation重建。

共享进程降低资源成本，但扩大故障半径。若执行真正不可信或高耗代码，per-tenant/per-cell worker比全局共享V8 host更稳妥。

## 35. Caller Drop 会转成 Protocol Cancellation

Remote connection给open/execute/wait调用创建`CallerCancellation` guard。future在完成前被drop，guard会cancel token，driver再发`operation/cancel`。

Host只允许取消Execute/Wait，Open/Terminate/Shutdown不当作普通可取消请求。Execute已创建Cell但客户端尚未claim时，driver会主动terminate abandoned Cell。

这补上了RPC常见漏洞：客户端超时不代表服务端工作自动停止，必须把future drop显式翻译成远端取消。

## 36. Dispatch Gate 防止 Tool 副作用早于 Cell Ownership

V8可能很快调用nested Tool。Core的`CodeModeDispatchBroker`先为Cell建立false gate；`CodeModeExecuteHandler`拿到StartedCell、建立trace后才`mark_cell_ready_for_dispatch(true)`。

Tool/notification消息在gate前等待，取消则移除gate。这样不会出现：

```text
nested shell already mutated filesystem
but exec handler never obtained/published the Cell ID
```

它是“先登记ownership，再允许副作用”的通用模式，适合迁移到Agent Run/Step创建和异步worker dispatch。

## 37. Trace 同时记录 Raw Runtime Boundary 与 Model Projection

Execute先创建CodeCell trace，记录：

- source code。
- runtime cell ID。
- original tool call ID。
- raw initial RuntimeResponse。
- terminal response。

之后`handle_runtime_response`才做image detail sanitize、token truncation、status header并生成模型可见output。

这延续了四视图分离：runtime fact、model projection、telemetry、durable reducer不能共用一个被截断字符串。

## 38. 优质设计总结

最值得当前 AI SEO Agent 学习的实现包括：

1. 编排器复用普通Tool治理链，不创建特权旁路。
2. Process、Session、Cell三层生命周期分离。
3. 每Cell fresh isolate，跨Cell只允许JSON状态。
4. completion commit与terminal delivery单点线性化。
5. Yield/Wait把长运行时与单次模型Tool response解耦。
6. cancellation从Session到Cell到nested Tool单向传播。
7. V8 terminate可打断非协作CPU loop。
8. dispatch gate保证ownership先于副作用。
9. remote generation防host重启后的Cell ID ABA。
10. strict framed protocol、握手版本和有界admission。
11. runtime raw response与model-visible截断投影分离。
12. standalone host crash不会直接拖垮主Agent进程。

## 39. 当前实现的主要风险边界

需要保持批判性的部分包括：

1. 无per-cell CPU、heap、source、output、tool-result与总wall-clock配额。
2. V8 default heap/JIT，host没有明显OS resource sandbox。
3. host缺失时静默回退in-process，隔离强度降级不可见。
4. 一timer一OS thread，clear不取消sleep thread。
5. `max_output_tokens`只是事后模型投影截断。
6. stored values全量clone，且无总bytes/key/value上限。
7. script error仍提交store writes，事务语义容易被误解。
8. 并发Cell同key last-completion-wins，无版本冲突。
9. identifier normalization collision未在规划阶段显式拒绝。
10. shared host的128 Cell无per-session公平配额。
11. host crash会丢全部session内存状态并扩大故障半径。
12. 64MiB frame仍允许较大的瞬时内存放大。
13. notify依赖active Turn且不是durable receipt。
14. wait/yield可设置极长时间，无全局deadline owner。

## 40. 对当前 NestJS + Vue 项目的迁移结论

当前阶段不应实现“让模型任意写JavaScript”。Phase 5的重点仍是最小、可审计的Tool Calling。可先迁移Code Mode背后的结构思想：

```text
AgentRun
  -> immutable ToolRegistry snapshot
  -> AgentStep(tool call fact)
  -> normal ToolRuntime(policy + validation + timeout)
  -> AgentStep(observation fact)
  -> next model sample
```

如果未来确有批量SEO数据编排需求，优先做声明式workflow或受限expression，而不是主Nest进程里的`vm`/`eval`。

若最终需要代码执行，最低边界应是：

- 独立worker process/container，缺失时fail closed。
- per-run CPU、memory、wall-clock、source/output/tool count预算。
- capability-based Tool API，不暴露Node/fs/network。
- tenant/session/cell三层配额。
- Cell ID包含generation。
- Run/Step先持久化ownership再允许副作用。
- nested Tool继续走同一权限、审批、幂等和审计链。
- durable state使用版本化数据库，不用worker内存map冒充事实。
- output按raw fact、UI stream、model projection分别限额。

真正值得复制的不是V8，而是它周围那套状态机、能力边界和失败语义。
