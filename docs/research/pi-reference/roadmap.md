# 学习与云端重构 Roadmap

## 目的与状态

这是用户完成当前源码学习后的**研究路线与候选重构顺序**，不是新的 Active Task，不表示已经批准以下实现。主要参照为 Pi。当前正式 #115 → #116 → #117 继续按 `docs/tasks/README.md` 执行，遇到与研究建议冲突的规格先讨论。

目标产品：用户可以通过 Web 长期使用自己的云端 Agent，运行可观察、会话可继续、工具行为可控制；保留我们已有 RAG / Grounding 与 Admin 的价值。不是把 Pi TUI 逐屏翻译成 Vue。

## 一、学习顺序：每一站产出一个能讲清的问题

| 站 | 阅读场景与源码 | 学完的产物 | 暂不展开 |
| --- | --- | --- | --- |
| L0 当前基线 | [current-agent-mapping](./current-agent-mapping.md)；自己的一次 Run，从 Controller 到 terminalization | 标出目前内存、数据库、模型、UI 四种状态；核对 #115–117 缺口 | 不开新重构 |
| L1 普通 Pi 主链 | [产品哲学](./architecture-and-style.md) → [coding-agent-tui](./modules/coding-agent-tui.md)：CLI→SDK→AgentSession→Agent→Models | 解释为何默认能力小、扩展怎样避免fork核心；再画一次回答/工具续轮调用图，核对CLI与SDK默认依赖 | 不先读TUI renderer，不把SDK默认当作已隔离 |
| L2 模型与工具契约 | [model-telemetry-evals](./modules/model-telemetry-evals.md)、runtime 的旧 loop | 同轮 text+tools、partial→final、重试边界、provider 变换表 | 不同时支持全部 providers |
| L3 Session 事实层 | [runtime-session](./modules/runtime-session.md)：Session/branch/storage/transaction/restore | 手写一个“分支→模型上下文”的小例子；区分 seq、parent、tip、operation | 不自动重放副作用 |
| L4 执行恢复 | accept→drive→checkpoint→generation→tool journal→terminal | “模型断流 / 工具未知 / 提交未知”三张恢复决策表 | 不以 replay 代替所有恢复 |
| L5 取消、后台等待与审批缺口 | effect Gate、provider deferred、poll permit、observer cancellation | 先区分取消/模型后台查询与用户授权，再画我们的审批链 | Gate/poll permit 不是用户审批；Pi 未提供完整多租户授权 |
| L6 多端与生命周期 | [Chord/server/client](./modules/chord-server-client.md)、[experimental-host](./modules/experimental-host.md) | 两个浏览器附着、一个断线、worker继续的时序；旧代数据拒绝规则 | 不先引入 Unix coordinator |
| L7 上下文与扩展 | compaction / tree navigation / resources / extension hooks / Chord facets | 压缩后可解释的模型输入；扩展点列表及每项真实需求 | 不先做 marketplace 或多 Agent |
| L8 质量与成本 | faux provider、backend conformance、telemetry、evals | 可重放故障样例集；token/cost/latency 的可对比记录 | 不以 benchmark 平均值替代正确性 |

学习节奏由用户控制；每站先走一条小链，再读失败分支。推荐从 L0 → L1 开始，完成 L4 后再决定第一项新的 durability 任务。

## 二、重构方向：按依赖和失败风险递进

### R0 保持当前链路可运行

完成已立项的 #115（模型请求重试与 Loop 上限）、#116（同轮文本 + 顺序多 Tool Call）、#117（Responses adapter）。参照 Pi 的多 content block 和 request/attempt 区分，保留当前模型/工具/前端独立契约。

验收重点：文本→工具→工具结果→最终文本；多个工具按原顺序执行；首次响应前失败与中途断流分开；usage 不重复计数；abort/deadline 不继续重试。这里列的是研究提醒，正式验收条款以对应 Issue 最新决定为准。

### R1 明确可重建的 Session 事实

先讨论数据库契约：会话条目、分支 parent/tip、操作身份、有效模型输入或其不可变引用。保留现有 UI Message 与 AgentStep 投影，避免一次替换全部历史表。

**进入条件**：用户需要刷新/重启后解释上次模型究竟看到了什么，或开始 session replay 任务。

**证明完成**：同一持久化快照重建相同选中分支与请求配置；升级 prompt/tool schema 后旧记录仍能解释；compact 不破坏 Tool Call / Result 配对；数据库提交失败不能产生“内存成功、事实缺失”的继续运行。

### R2 operation 的接纳、执行和观察分开

建立 `accept → drive → checkpoint → terminal` 的最小操作模型。先在现有 NestJS 进程内证明单 owner、取消和等待者隔离；需要独立恢复执行时再加 worker。命令端给 operation ID，观察端有 snapshot/cursor 与明确终态。

**进入条件**：确实要求关页后继续、另一个页面观察或进程重启后接管。

**证明完成**：两个订阅者之一断开不影响另一个；显式 Abort 只命中目标 operation；旧 owner 不能覆盖新 owner；数据库提交结果不确定时停止猜测。若跨进程争用，使用 DB 所有权/fencing 机制，不能复制 Pi 进程内 Map 或文件锁就宣布完成。

### R3 工具结果未知时的恢复与审批

将“工具尚未调用”“外部动作可能已发生”“结果已知未发布”“已发布”分开。为外部写工具定义 idempotency key / receipt / 查询结果或人工处理方式；审批决定必须绑定 operation、工具、参数摘要与权限版本。恢复时重新核对当前权限。

**进入条件**：第一个有外部副作用的云工具，或现有工具需要跨进程恢复。

**证明完成**：逐个注入执行前、执行后提交前、提交结果未知的崩溃；safe 工具符合重放策略；unsafe 工具不会重复写；审批等待可跨重启；取消审批不执行工具；租户 A 不能引用 B 的 receipt/approval/workspace。

Pi 的 journal 是副作用恢复参照；effect Gate 控制取消/关闭时的 effect admission，deferred 是模型 provider 后台响应，poll permit 是每次 Drive 的查询预算。这三者均不等同于持久化用户审批。授权主体、审批决定、租户和云执行隔离需要我们独立设计。不要把“工具有 safe 标志”当作外部系统幂等性的证明。

### R4 Web 产品表达与多端恢复

围绕长期会话做 model/thinking 选择、可见运行状态、停止/继续、分支查看、可解释的压缩点；Admin 继续负责 Trace/Context/Grounding。多端复用后端投影，区分正在同步、缺包需要快照、等待审批、已失败等状态。

**证明完成**：浏览器刷新能恢复当前 view；旧 attachment 的晚到事件不污染新会话；UI 不自己还原模型私有请求；引用卡片仍只展示服务端验证的 durable Grounding。

### R5 按真实瓶颈补能力

| 候选 | 何时值得加入 | 最小证据 |
| --- | --- | --- |
| Compaction / branch summary | 长对话实际超预算，且 R1 可重建输入 | 压缩前后 paired tools 完整、来源可解释、失败不丢历史 |
| 扩展 hooks / plugin | 出现第二种独立能力组合，静态 NestJS 注册已明显不够用 | 明确扩展点、权限、失效与版本；不直接执行不可信租户 JS |
| 长期 Memory | 用户持续需要跨会话召回，且可控制写入/删除 | 记忆与检索正文的来源、权限、过期、删除可验证 |
| 定时任务 | 出现具体周期任务 | 稳定 operation identity、去重、错过执行策略、取消/重试规则 |
| Delta/更紧凑协议 | 测得完整 snapshot 流量或复制 CPU 成为瓶颈 | 带宽/CPU 对比及 gap/rebase 正确性 |
| 独立 worker / sandbox | 需要不可信工具隔离或长任务资源隔离 | 资源/网络/凭据边界、owner失效与关闭语义 |
| 并行工具 | 顺序执行延迟显著且工具独立 | 顺序发布、并发上限、取消、共享资源隔离 |

这些候选没有日历承诺，不自动立项。多 Agent、MCP marketplace、完整 Chord 移植仍不属于这条最小主线。

## 三、每个正式改动的交付模板

```text
真实问题 / 当前代码证据
Pi 参照路径与固定 revision
保留的不变量 / 明确不做的范围
输入、输出、持久化事实、执行 owner
成功、失败、取消、重启、提交未知五类场景
实现与检查证据
人工验收 / 合并 / 发布各自的实际状态
```

本目录完成的是研究准备。进入上述任一重构前，应在当前会话把最小任务聊清楚，再按仓库流程立 Issue、实现与验收。
