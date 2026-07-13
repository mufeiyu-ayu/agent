# Hook Runtime Contract：发现与信任、并发合并、命令隔离与输出资源边界

本文研究 Codex Hook如何从多层配置与Plugin中发现，如何在Session/Turn/Tool/Compaction生命周期执行，以及Hook输出怎样影响模型输入、Tool参数、批准和停止决策。重点是Hook作为“进程内扩展点”的真实权力：它不是普通回调，而是可执行host命令、读取上下文、改写Tool输入并短路安全决策的高权限插件。

源码事实基于：

- Codex：`/Users/lihaoran/Desktop/codex`，`main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`
- 当前项目：`/Users/lihaoran/Desktop/agent`，研究起点 `master@5f2ad11f2c65425e84392e81048364d55ec626ef`
- 主要入口：`codex-rs/hooks/src/{registry,engine,events,output_spill}.rs`、`codex-rs/core/src/hook_runtime.rs`、`codex-rs/core/src/tools/{approvals,router}.rs`

## 1. Hook 是独立策略扩展层，不是 Tool Handler 内联逻辑

Codex把Hook Runtime与核心Tool Registry分开：

```text
config/plugin discovery
  -> trusted ConfiguredHandler snapshot
  -> event matcher
  -> preview HookRunSummary
  -> parallel command execution
  -> typed output parsing
  -> event-specific aggregation
  -> Core records HookCompleted + applies outcome
```

这样Tool本身不需要知道每个组织的检查脚本；Hook可以在不修改Core代码的情况下增加策略、上下文和审计。

代价是Hook拥有横切权力，必须像执行第三方代码一样管理来源、版本、权限、超时和数据外流。

## 2. Hook Event 覆盖 Thread、Turn、Tool 与 Compaction

当前支持：

- `SessionStart / SubagentStart`：Thread scope。
- `UserPromptSubmit`：用户输入准入。
- `PreToolUse`：Tool执行前阻止、增加context或改写input。
- `PermissionRequest`：批准流程前Allow/Deny。
- `PostToolUse`：Tool成功输出后的feedback/context/阻止后续。
- `PreCompact / PostCompact`：压缩提交前后。
- `Stop / SubagentStop`：Agent准备结束时继续或停止。
- 旧`AfterAgent` notify hook走兼容路径。

同一“Stop”在不同位置的语义不同：PreToolUse阻止副作用，PostToolUse不能撤销已经发生的副作用，PostCompact也不能撤销已安装checkpoint。

## 3. 发现顺序保留来源，而不是只得到一个扁平命令表

Discovery先读取managed requirements，再按config layer低优先级到高优先级遍历，最后追加Plugin hooks。来源被标为System、User、Project、MDM、SessionFlags、Plugin、CloudRequirements等，并保留source path、plugin ID、display order和managed状态。

同一layer若`hooks.json`与`config.toml`同时包含hooks，两者都会加载并warning；不同来源/层的相同命令也不自动去重或覆盖。

这适合“多个独立检查都要运行”的扩展模型，但不能把layer precedence误解为后者替换前者。真正的冲突由event-specific aggregator解决。

## 4. Managed-only 是 Catalog Admission 上界

Requirements可设置`allow_managed_hooks_only`。启用后，非managed User/Project/Plugin来源在discovery阶段就不进入可执行集合。

Managed来源包括System、MDM、Enterprise/Cloud managed和legacy managed config；普通User/Project/SessionFlags/Plugin不是managed。

这比运行时才逐次拒绝更清晰：Thread创建时就固定可用Hook catalog。不过当前catalog没有显式generation/hash汇总，事件回执只保留单handler信息。

## 5. Unmanaged Hook 需要 Enabled + Trusted 双门

每个command hook都有：

- positional key：source + event + group index + handler index。
- normalized config hash。
- enabled state。
- trust status：Managed / Trusted / Modified / Untrusted。

Managed hook始终enabled/trusted；unmanaged默认enabled，但只有trusted hash匹配才进入handlers。`bypass_hook_trust`可以允许enabled的Untrusted/Modified hook执行，仍尊重显式disabled。

这是合理的双门模型：关闭与信任是不同状态。问题是key依赖数组位置，前面插一个hook可能改变后续identity；源码TODO也要求durable hook ID。

## 6. Trust Hash 只覆盖 Config Identity，不覆盖真实执行供应链

Hash包含event、matcher、normalized command配置、timeout等；TOML/JSON等价定义可得到同一identity。

但它不覆盖：

- `$SHELL`或custom shell program/args。
- PATH解析出的实际executable。
- `-lc`加载的shell rc内容。
- command引用的脚本/二进制内容。
- Plugin root/data路径替换后的实际值；hash在`${PLUGIN_ROOT}`等env替换之前计算。
- 继承的环境变量。

所以“Trusted”只证明用户批准过这段配置，不证明今天执行的binary bytes与批准时相同。高风险Hook需要bundle/content digest和resolved executable receipt。

## 7. 当前只执行同步 Command Hook

配置层可以声明Command、Prompt、Agent与async，但当前：

- async command被warning并跳过。
- Prompt hook被warning并跳过。
- Agent hook被warning并跳过。
- 只有sync command进入ConfiguredHandler。

timeout默认600秒，最小1秒，没有代码侧最大值。一个事件内所有匹配handler会并发执行，因此总wall time接近最慢handler，而不是timeout之和。

产品协议暴露多种handler type时，必须把“可配置”与“runtime真正支持”分开，避免UI把被跳过的hook展示为已保护。

## 8. Matcher 兼容 Exact、Pipe Alternatives、Regex 与 Aliases

Matcher规则：

- 缺失、空字符串、`*`匹配全部。
- 只含ASCII字母数字/下划线/`|`时做exact alternatives。
- 含正则字符时编译Regex。
- 无效Regex在discovery时warning并跳过。
- UserPromptSubmit和Stop忽略matcher。

Tool Hook同时用canonical tool name和兼容aliases匹配，但一个handler即使命中多个alias也只执行一次；传给stdin的仍是canonical name。

“宽松匹配、稳定输入identity”这个分离很值得学习，避免兼容别名污染审计事实。

## 9. Preview 与 Completed 是两类 Lifecycle Projection

Core先调用preview得到`HookRunSummary(status=Running)`，再执行Hook，最后发布`HookCompletedEvent`。Summary包含：

- run ID。
- event/handler/execution mode/scope/source。
- display order与status message。
- start/completed/duration。
- typed output entries。

Tool Hook run ID额外拼接tool use ID，避免同一配置在一个Turn多次执行时UI identity碰撞。

不过base run ID仍由event + display order + source path组成；配置重排会改变ID，跨reload/历史重放不稳定。

## 10. 同一 Event 的 Handlers 并发执行，报告按配置顺序归位

Dispatcher把每个handler放进`FuturesUnordered`并发执行，记录completion order；全部结束后按configured order排序返回。

这同时提供两种顺序：

- UI/entries/additional contexts按配置顺序稳定。
- 需要竞争语义的PreToolUse rewrite可以按真实completion order决定。

这是比“并发后谁先poll到就影响所有结果”更清楚的模型。但所有handler必须结束后才聚合，已经出现Block也不会取消其他在途Hook。

## 11. Event-specific Aggregation 不是通用 Merge

不同事件明确选择不同规则：

- 多个PreToolUse只要任一个Block就整体Block；block reason取配置顺序第一个。
- 未Block时，多个updated input取实际最后完成者。
- additional contexts按配置顺序全部拼接。
- PermissionRequest的决策有专用聚合规则，并进入Approval resolver。
- Stop/UserPromptSubmit任一阻止即可继续/停止，reason按稳定顺序选择。
- Hook执行/解析失败通常记录Failed，但不会自动阻止核心操作。

这种“字段级merge policy”比最后一个对象覆盖更可靠；每个扩展点都应声明all/any/first/last-completion/fail-open/fail-closed。

## 12. PreToolUse 可以 Rewrite，但 Core 会重新走最终 Handler Parse

Hook收到tool name、tool use ID、JSON input、cwd、model、permission mode、transcript path等。合法输出可以：

- Deny并给非空reason。
- Allow且给`updatedInput`。
- 增加model context。

Core拿到rewrite后重新构造Tool invocation，最终Tool handler仍按自己的schema严格parse；Hook不是直接调用runtime。

这避免Hook用任意JSON绕过Tool参数校验。但rewrite发生在批准/执行之前，审批展示和hash必须基于rewrite后的最终参数，不能只审model原始call。

## 13. PermissionRequest Hook 能短路 Guardian / User

Tool需要批准时，Core先运行PermissionRequest hooks：

- 明确Allow：直接视为Approved。
- 明确Deny：返回Hook message并拒绝。
- 无决定/失败：继续Guardian或User。

当前Wire预留`updatedInput / updatedPermissions / interrupt`，但出现这些字段会判invalid并不采纳；只支持Allow/Deny。

这是保守的forward-compat策略：看到尚未实现的高权限字段，不应静默忽略后继续Allow。需要注意普通Hook失败是fail-open，会退回其他reviewer，而不是安全拒绝。

## 14. Exit Code、JSON 与 Plain Stdout 的语义按 Event 不同

Command结果不是统一“stdout字符串”：

- exit 0：尝试typed JSON；空stdout通常无动作。
- stdout看起来像JSON但解析失败：Hook Failed。
- exit 2 + 非空stderr：PreTool/UserPrompt等兼容为Block。
- 其他非零：Failed。
- plain stdout在UserPromptSubmit等事件可成为additional context；Pre/PostCompact会忽略plain stdout。

同一脚本输出在不同event下可能是context、无动作或错误。Schema与event name const能减少误接线，但作者仍需要event-specific测试。

## 15. Universal Fields 不是每个 Event 都支持

Wire包含`continue / stopReason / suppressOutput / systemMessage`等通用字段，但parser按event限制：

- PreToolUse不支持`continue:false`、stopReason、suppressOutput。
- PermissionRequest同样拒绝这些组合。
- PostToolUse不支持suppressOutput。
- Stop/Compact/UserPrompt可以使用continue/stop语义。
- block必须带非空reason，否则Failed而非Block。

显式拒绝unsupported字段能防止配置作者以为某个安全动作已生效，实际却被静默忽略。

## 16. Hook Command 运行在 Host，而不是 Agent Sandbox

Command runner：

- default使用`$SHELL -lc <command>`；Windows用COMSPEC `/C`。
- custom shell时追加配置args和command。
- cwd设为当前Hook请求cwd。
- 继承父进程环境，再叠加handler env。
- stdin/stdout/stderr全部pipe。
- `kill_on_drop(true)`。

没有经过Tool Sandbox/Exec Policy/Approval。Hook是配置owner授予的host command authority，可以读API key、访问网络、修改workspace或启动子进程。

因此Hook信任门不是UI装饰，而是等价于批准本机代码执行。

## 17. Timeout 没有覆盖 Stdin Write

Runner先spawn，然后把完整input JSON写入child stdin，写完后才对`wait_with_output()`包timeout。

若child不读stdin且payload超过pipe容量，`write_all()`可无限等待，配置timeout完全不生效。Hook input可能包含大prompt、tool input/output或transcript path，因此这不是纯理论问题。

正确边界应对`spawn + stdin write + wait + output read + kill`整个operation使用同一个deadline。

## 18. `wait_with_output` 在完成前无 Stdout/Stderr 容量上限

Runner把child stdout/stderr全部收进内存，再转lossy UTF-8 String。没有：

- bytes cap。
- streaming backpressure。
- line cap。
- stderr独立cap。
- 总Hook event输出预算。

一个trusted但失控的脚本可在timeout前耗尽进程内存。后续2,500-token spill发生得太晚，无法保护command capture阶段。

应在pipe reader层做bounded capture：保留head/tail、持续drain丢弃超额、记录original bytes和truncated flag。

## 19. Timeout 主要杀 Direct Child，不保证 Process Tree 收口

`kill_on_drop(true)`在timeout future被丢弃时会请求kill child；stdin error路径也显式`child.kill()`。

但shell命令可以fork后台进程或让grandchild继承资源。当前没有独立process group/job object、tree kill和reap receipt。Timeout后Hook的外部副作用可能继续。

这与Tool cancellation相同：Task future结束不等于外部world state停止变化。

## 20. Output Spill 保护 Model Budget，不保护执行内存和隐私

对additional context、feedback、Stop continuation fragment，超过约2,500 tokens时：

1. 在OS temp的`hook_outputs/<threadId>/<uuid>.txt`写完整文本。
2. 返回head/tail截断preview。
3. footer给出完整文件绝对路径，且footer计入2,500 token预算。

优点是模型输入有限、完整输出仍可人工查看。边界：

- spill前完整字符串已在内存。
- `HookCompletedEvent.entries`在spiller处理outcome前已构造，可能仍持有全量文本。
- 文件未显式设置private mode、nofollow或atomic create。
- 没有TTL、bytes cap、startup cleanup或Thread删除联动。
- model-visible绝对路径可能暴露用户名/temp布局。

## 21. Serialization / Spawn / Parse Failure 多数 Fail-open

Hook input序列化失败会为每个matched handler生成Failed completed event，但业务outcome通常是“不Block、无rewrite、无context”。Spawn error、timeout、非零exit、invalid JSON也类似。

这保证扩展故障不轻易让Agent完全不可用，但对合规/安全Hook可能不合适。Managed Hook应能声明：

```text
failurePolicy = fail-open | fail-closed | require-manual-review
```

当前只有PermissionRequest失败后继续Guardian/User提供部分安全兜底；PreToolUse managed guard失败仍可能继续执行。

## 22. Hook Completed 是可观察投影，不是 Durable Execution Receipt

Core把preview/completed事件投影给客户端并记录telemetry：event、source、status、duration等。Hook command本身的外部副作用没有idempotency key、attempt number或durable receipt。

Thread恢复不会重建“某个PreTool hook是否已执行并完成副作用”；重试同一Tool Call可能再次执行Hook。若Hook发送通知、写外部审批表或修改文件，必须自行幂等。

## 23. SessionStart Source 是 Queue，不是只运行一次的 Boolean

Session Start Hook可由Startup、Resume、Compact等来源触发。Core把待运行source排队，在Turn开始时消费；Compaction安装后会queue `SessionStartSource::Compact`。

这样Hook能在context重建后重新注入依赖当前window的上下文。但多次source累积、crash恢复与重复执行需要稳定operation identity，否则同一逻辑初始化可能重复副作用。

## 24. Stop Hook 是 Agent Continuation Gate

Turn准备结束时：

- Root运行Stop。
- Thread-spawned child运行SubagentStop并带agent context。
- 某些legacy SubAgent来源不dispatch Stop。
- Hook可返回continuation fragments，让模型继续一轮。

Stop不是进程退出通知，而是“是否允许当前Agent声明完成”的policy gate。Continuation本身进入model history并消耗token，需有循环次数/总token上限，防止Hook永久阻止收口。

## 25. 当前最值得保留的设计

1. 来源、managed、enabled、trusted四类状态分开。
2. Config identity hash让TOML/JSON等价定义收敛。
3. Matcher alias只用于选择，stdin坚持canonical tool name。
4. Preview/Completed双阶段，Tool run ID绑定tool use ID。
5. Handler并发执行，但展示和context按配置顺序稳定。
6. Merge policy按event/字段显式定义；PreTool rewrite用last-completion。
7. Unsupported高权限字段fail-closed为Invalid，而不是静默忽略。
8. PermissionRequest Hook后仍有Guardian/User fallback。
9. Model-visible Hook output有独立spill预算。
10. SessionStart按来源在关键context边界重新触发。

## 26. 当前需要改进或避免的边界

1. Positional hook key不稳定，应使用声明ID + source namespace。
2. Trust hash不覆盖shell/PATH/rc/script bytes/Plugin实际路径。
3. Host command继承完整环境且不进Sandbox，secret/network权限过宽。
4. Timeout不覆盖stdin write。
5. stdout/stderr capture无bytes cap，spill发生太晚。
6. Direct child kill不等于process tree终止。
7. Spill文件无显式private create、retention、cleanup和Thread删除联动。
8. HookCompleted可能保留spill前全量敏感context。
9. Managed安全Hook无法选择fail-closed/require-review策略。
10. Hook副作用缺operation ID、attempt、idempotency和durable receipt。
11. Stop continuation缺明确循环/成本总预算。
12. Runtime只支持sync command，协议/配置暴露的其他类型需准确标记unsupported。

## 27. 更适合云端 Agent 的 Hook Envelope

云端不应直接执行任意host shell；应使用受限Webhook/Worker capability：

```ts
type HookInvocation = {
  invocationId: string;
  hookId: string;
  hookVersion: string;
  runId: string;
  stepId?: string;
  attempt: number;
  event: string;
  inputHash: string;
  deadlineAt: string;
  capabilityToken: string;
};

type HookReceipt = {
  invocationId: string;
  status: "completed" | "blocked" | "failed" | "timed-out";
  decision?: unknown;
  outputArtifactId?: string;
  externalOperationId?: string;
  committedAt?: string;
};
```

Worker只能拿事件所需最小字段和短寿命capability；输出先做bytes/schema/redaction验证，再进入Agent context。

## 28. 建议测试矩阵

| 维度 | 必测案例 |
| --- | --- |
| Discovery | managed-first、layer顺序、JSON+TOML并存、Plugin、managed-only |
| Identity | positional重排、config hash、script内容变化、shell/PATH变化、Plugin root变化 |
| Trust | Trusted/Modified/Untrusted/disabled/bypass、managed不可关闭语义 |
| Matcher | exact、pipe、regex、invalid、aliases多命中只执行一次、Stop忽略matcher |
| Concurrency | 多handler并发、稳定报告顺序、last-completion rewrite、任一Block |
| Parsing | empty/plain/valid JSON/invalid JSON、exit 2、unsupported字段、空reason |
| Security | env secret继承、network、workspace写、script替换、rc副作用 |
| Timeout | stdin不读、大input、慢进程、grandchild、timeout=1/600/极大值 |
| Output | 无限stdout/stderr、non-UTF8、2,500-token spill、Completed全量泄漏 |
| Spill | 权限、symlink、磁盘满、路径泄漏、TTL、Thread删除、总bytes cap |
| Failure policy | user fail-open、managed fail-closed、Guardian fallback、serialization error |
| Recovery | 同一Tool retry重复Hook、副作用幂等、SessionStart source重复、Stop循环 |

## 29. 对当前项目的学习结论

当前AI SEO Agent未来加入Hook时，建议先做typed in-process/webhook policy，不开放任意shell：

1. 每个Hook有稳定ID、版本、来源、tenant和failure policy。
2. 事件只暴露最小数据视图，不默认发送完整prompt/transcript/secret。
3. 多Hook merge规则按字段声明，阻止、rewrite、context、warning不能共用last-write。
4. Rewrite后重新做DTO/schema、租户权限和approval校验。
5. 全operation deadline覆盖发送、执行、读取和取消。
6. 输入/输出设bytes、items、tokens和artifact retention总预算。
7. 所有外部副作用绑定invocation ID和幂等receipt。
8. Computed Hook outcome、Agent采用结果与Hook外部commit分开记录。

Codex最优质的部分是discovery/trust分层、canonical matcher identity、并发后确定性merge、typed output兼容校验、preview/completed生命周期和Hook output预算。需要避免的是配置hash冒充代码供应链证明、host全权限执行、stdin超时漏洞、无界output capture、临时文件隐私生命周期不足、managed Hook不能选择失败策略，以及Hook副作用无耐久幂等回执。
