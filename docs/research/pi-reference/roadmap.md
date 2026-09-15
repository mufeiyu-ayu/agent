# 云端 Agent 实现路线（以 Pi 为参照素材）

## 目的与状态

这是用户完成当前项目源码学习后的**实现顺序**。用户不读 Pi 代码；Pi 素材是 AI 在替用户写代码时自行查阅的参照。本文不是新的 Active Task，也不表示以下实现已获批准。正式 #115 → #116 → #117 继续按 `docs/tasks/README.md` 执行，遇到与本文冲突的规格先讨论。

目标产品：用户可以通过 Web 长期使用自己的云端 Agent，运行可观察、会话可继续、工具行为可控制；保留我们已有 RAG / Grounding 与 Admin 的价值。不是把 Pi TUI 逐屏翻译成 Vue。

## 零、先说清不借鉴什么

下列 Pi 内容对云端目标没有直接价值，模块文档保留索引，但**不进实现路线**：`packages/tui` 整包、native clipboard/图片、CLI 安装与自更新、Bun/Windows/termux 适配、Unix socket coordinator、Radius relay、OAuth 登录流、40 个 provider adapter 与模型目录生成、llama.cpp 扩展、export-html/session-share。模型层只看与 DeepSeek / OpenAI-compatible 相关的部分。

## 一、实现顺序：R0 → R2 → R1 → R3 → R4 → R5

先把运行和请求解耦（可以在单进程内先证明），再把事实做成可重建，再补工具 journal 与审批，最后做多端。每步写明：做什么、进入条件、证明完成、AI 动手前查的 Pi 素材。

### R0 保持当前链路可运行（已立项）

完成 #115（模型请求重试与 Loop 上限）、#116（同轮文本 + 顺序多 Tool Call）、#117（Responses adapter）。参照 Pi 的多 content block 和 request/attempt 区分，保留当前模型/工具/前端独立契约。

**证明完成**：文本→工具→工具结果→最终文本；多个工具按原顺序执行；首次响应前失败与中途断流分开；usage 不重复计数；abort/deadline 不继续重试；DeepSeek 的 reasoningContent 分支覆盖。正式验收条款以对应 Issue 最新决定为准。

**AI 查的素材**：[07 图](./diagrams/07-classic-loop.html)；[产品主链 §3](./modules/coding-agent-tui.md)、[运行内核 §2](./modules/runtime-session.md)（toolCall 续轮与文本回复两条分支、`agent_end ≠ 空闲`）；[模型边界 §2–3、§4.1、§7](./modules/model-telemetry-evals.md)（事件流、transformMessages、compat 检测、usage 归一化、两层重试、overflow 判定）。对照点在 [current-agent-mapping](./current-agent-mapping.md) 的 `runTurnStream` 行。

### R2 operation 的接纳、执行和观察分开

建立 `accept → drive → checkpoint → terminal` 的最小操作模型。先在现有 NestJS 进程内证明单 owner、取消和等待者隔离；需要独立恢复执行时再加 worker。命令端给 operation ID，观察端有 snapshot/cursor 与明确终态。沿用现有 NDJSON 事件与 `RunCancellation` 语义，加 operation ID，不另起协议。

**进入条件**：确实要求关页后继续、另一个页面观察或进程重启后接管。#115–117 已完成。

**第一步：分包（2026-09-16 定案）**。仿 Pi 的 `agent / ai / coding-agent` 三层，但只分两个纯包，不照搬 11 个包：

| 包 | 内容 | 规则 |
| --- | --- | --- |
| `packages/agent` | 循环、operation 状态、上下文投影、工具契约、取消 | 零 Nest、零 Prisma，只依赖 `contracts`；存储与模型客户端只定义接口 |
| `packages/ai` | DeepSeek / OpenAI-compatible 客户端、流事件、重试、usage | 零 Nest |
| `apps/api`（保留） | Nest 模块、Prisma 仓储、HTTP 控制器、Grounding 落库 | 实现上面两包的接口，在边缘注入 |

不先搬旧文件：R2 新写的代码从第一天放进 `packages/agent`，旧代码按被替换的节奏迁入。Grounding 要拆成“校验规则”进包、“落库”留 apps，这是分包里最费工的部分。第三个包等出现第二个宿主（如独立 worker）再拆。分包不单独占周期，算在 R2 内。

**分包验收**：`packages/agent` 与 `packages/ai` 的测试不启动 Nest、不连数据库即可运行；`apps/api` 不再直接持有循环与 operation 状态。

**证明完成**：两个订阅者之一断开不影响另一个；显式 Abort 只命中目标 operation；旧 owner 不能覆盖新 owner；数据库提交结果不确定时停止猜测。若跨进程争用，使用 DB 所有权/fencing 机制，不能复制 Pi 进程内 Map 或文件锁就宣布完成。

**AI 动手前先做**：把我们自己的一次 Run 从 Controller 到 terminalization 走一遍，列出内存、数据库、模型输入、UI 四种状态各由谁写、请求结束后剩什么；据此回答关页后运行在不在、重启能不能续跑、记录能不能还原模型输入。这三个答案决定 R2/R1 的最小范围。

**AI 查的素材**：[02 图](./diagrams/02-durable-runtime.html)、[03 图](./diagrams/03-operation.html)；[运行内核 §3–§6](./modules/runtime-session.md)（Session/Branch/Lane/Harness、accept→drive→checkpoint→generation→terminal、宿主 API 与 Result 错误契约、取消与 reconcile）。三种 backend 只读契约，不看实现细节。

### R1 明确可重建的 Session 事实

先讨论数据库契约：会话条目、分支 parent/tip、操作身份、有效模型输入或其不可变引用。保留现有 UI Message 与 AgentStep 投影，避免一次替换全部历史表。

**进入条件**：用户需要刷新/重启后解释上次模型究竟看到了什么，或开始 session replay 任务。

**证明完成**：同一持久化快照重建相同选中分支与请求配置；升级 prompt/tool schema 后旧记录仍能解释；compact 不破坏 Tool Call / Result 配对；数据库提交失败不能产生"内存成功、事实缺失"的继续运行。

**AI 查的素材**：[05 图](./diagrams/05-context-projections.html)；[运行内核 §3、§7–8](./modules/runtime-session.md)（分支→模型上下文的投影、fork-policy、effect_pending 恢复决策）。

### R3 工具结果未知时的恢复与审批

将"工具尚未调用""外部动作可能已发生""结果已知未发布""已发布"分开。为外部写工具定义 idempotency key / receipt / 查询结果或人工处理方式；审批决定必须绑定 operation、工具、参数摘要与权限版本。恢复时重新核对当前权限。同时补上 api 的身份与租户边界（当前零 Guard）。

**进入条件**：第一个有外部副作用的云工具，或现有工具需要跨进程恢复。

**证明完成**：逐个注入执行前、执行后提交前、提交结果未知的崩溃；safe 工具符合重放策略；unsafe 工具不会重复写；审批等待可跨重启；取消审批不执行工具；租户 A 不能引用 B 的 receipt/approval/workspace。

**AI 查的素材**：[运行内核 §5–§6](./modules/runtime-session.md)（tool journal planned→effect_pending→outcome_ready→completed、replay safe/never、effect gate）。Pi 的 journal 是副作用恢复参照；effect Gate 控制取消/关闭时的 effect admission，deferred 是模型 provider 后台响应，poll permit 是每次 Drive 的查询预算。这三者均不等同于持久化用户审批。授权主体、审批决定、租户和云执行隔离需要我们独立设计。不要把"工具有 safe 标志"当作外部系统幂等性的证明。

### R4 Web 产品表达与多端恢复

围绕长期会话做 model/thinking 选择、可见运行状态、停止/继续、分支查看、可解释的压缩点；Admin 继续负责 Trace/Context/Grounding。多端复用后端投影，区分正在同步、缺包需要快照、等待审批、已失败等状态。服务端要有"订阅响应发出前的更新缓冲"，客户端要有"先装快照再放行更新"，两侧缺一不可。

**证明完成**：浏览器刷新能恢复当前 view；旧 attachment 的晚到事件不污染新会话；UI 不自己还原模型私有请求；引用卡片仍只展示服务端验证的 durable Grounding。

**AI 查的素材**：[04 图](./diagrams/04-attachment.html)；[Chord/server/client §3–§6.5](./modules/chord-server-client.md)（三个 ID 各归谁、`pendingUpdates` 缓冲、sequence gap → clear）、[实验宿主 §2–§5](./modules/experimental-host.md)（两个页面附着、一个断线、worker 继续的时序、`Lane.watch` 共享）。Chord facets 内部、Delta/CBOR 算法、Radius、mini 不看。

### R5 按真实瓶颈补能力

| 候选 | 何时值得加入 | 最小证据 | AI 查的素材 |
| --- | --- | --- | --- |
| Compaction / branch summary | 长对话实际超预算，且 R1 可重建输入 | 压缩前后 paired tools 完整、来源可解释、失败不丢历史 | [运行内核 §7](./modules/runtime-session.md) |
| 扩展 hooks / plugin | 出现第二种独立能力组合，静态 NestJS 注册已明显不够用 | 明确扩展点、权限、失效与版本；不直接执行不可信租户 JS | [08 图](./diagrams/08-lifecycle-hooks.html)、[运行内核 §9](./modules/runtime-session.md)、[产品主链 §6.4](./modules/coding-agent-tui.md) |
| Skill（按需注入的 markdown 与资源） | R2 之后即可；出现按用户/租户定制 system prompt 或工作流的需求 | 存为数据不是代码；插入点为请求前上下文变换；只影响 prompt，不扩大工具权限；来源、版本、启停可查 | [产品主链 §6](./modules/coding-agent-tui.md)（resource-loader、skills 发现与注入） |
| MCP 工具服务器 | R3 之后；出现第三方工具接入需求 | 外部工具与内置工具走同一条注册→审批→journal→租户隔离路径；服务器凭据按租户存；断连与超时有终态 | Pi 本版本无内置 MCP（`docs/usage.md` 明确留给扩展）；工具注册与拦截参照 [产品主链 §6.4](./modules/coding-agent-tui.md)（`registerTool`、`emitToolCall`）；审批与 receipt 复用 R3 |
| 长期 Memory | 用户持续需要跨会话召回，且可控制写入/删除 | 记忆与检索正文的来源、权限、过期、删除可验证 | Pi 无直接参照 |
| 定时任务 | 出现具体周期任务 | 稳定 operation identity、去重、错过执行策略、取消/重试规则 | Pi 无直接参照 |
| Delta/更紧凑协议 | 测得完整 snapshot 流量或复制 CPU 成为瓶颈 | 带宽/CPU 对比及 gap/rebase 正确性 | [wire/delta](./modules/wire-delta-coverage.md) |
| 独立 worker / sandbox | 需要不可信工具隔离或长任务资源隔离 | 资源/网络/凭据边界、owner失效与关闭语义 | [实验宿主 §2](./modules/experimental-host.md) |
| 并行工具 | 顺序执行延迟显著且工具独立 | 顺序发布、并发上限、取消、共享资源隔离 | [运行内核 §5](./modules/runtime-session.md) |
| 测试方法 | 任一步需要可重放故障样例 | faux provider、GatingStorage 思路 | [模型/评估 §9](./modules/model-telemetry-evals.md)、[工程工具](./modules/repository-tooling.md) |

这些候选没有日历承诺，不自动立项。Skill 与 MCP 都是“数据不是代码”，云端可放；执行不可信租户 JS 仍不做。多 Agent、MCP marketplace、完整 Chord 移植仍不属于这条最小主线。

## 二、规模参照（估算，不是承诺）

以 2026-09-15 基线看，按产品目标加权完成度约 25%～30%。剩余主线工作量，一人配合 AI 全职：

| 工作 | Pi 对应 | 估计 |
| --- | --- | --- |
| R0 #115–117 | 已立项 | 1～2 周 |
| R2 运行解耦（含分包） | `harness/runtime` 的 lane/drive/checkpoint；包结构参照 `agent / ai / coding-agent` | 3～4 周 |
| R1 durable 事实 | `harness/session` + `drive/recovery` | 3 周 |
| R3 工具 journal 与审批、鉴权租户 | `drive/tools` + `execution/tools`；审批与租户 Pi 无参照 | 4～5 周 |
| R4 多端订阅与 Web 改造 | `Lane.watch` + Transcript + 服务端缓冲 | 4 周 |

合计 15～18 周，不含 R5。前提：PostgreSQL 事务边界要重新设计（Pi 的 MutationLine 是进程内），Grounding 迁到新 operation 模型下而不重写。

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

本目录完成的是研究准备。进入上述任一步前，先在当前会话把最小任务聊清楚，再按仓库流程立 Issue、实现与验收。向用户汇报时只说结论、影响和选择，不讲 Pi 机制细节。
