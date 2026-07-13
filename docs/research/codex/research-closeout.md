# Codex 架构研究最终收口

> 本页是 Issue #6 在固定 Codex 快照上的最终研究回执。用户于 2026-07-13 明确允许在周额度剩余 65% 时提前收尾，因此本轮不再继续消耗到原定的 50% 停止阈值。

## 1. 交付基线

| 对象 | 快照 |
| --- | --- |
| Codex 只读源码 | `/Users/lihaoran/Desktop/codex`，`main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136` |
| Codex commit | `2026-07-13T10:12:41+08:00`，`Merge remote-tracking branch 'upstream/main'` |
| Agent 项目起点 | `/Users/lihaoran/Desktop/agent`，`master@5f2ad11f2c65425e84392e81048364d55ec626ef` |
| 交付分支 | `codex/issue-6-rebuild-codex-research` |
| 研究时间 | `2026-07-13 11:01 CST` 至最终收尾 |

Codex worktree 在启动与收尾时均无修改；本任务没有修改、提交、清理或重置该仓库。Issue 中 `/Users/ayu/Desktop/*` 是另一环境路径，本机等价路径为 `/Users/lihaoran/Desktop/*`。

## 2. 架构覆盖结论

| 优先级 | 领域 | 状态 | 闭环证据 |
| --- | --- | --- | --- |
| P0 | Repository 与产品入口 | Completed | CLI/TUI/Exec/App Server/SDK → ThreadManager；入口与 transport tests |
| P0 | 协议与生命周期 | Completed | Thread/Turn/Item/Event/Goal、start/resume/fork/steer/interrupt/goal；正常与失败 tests |
| P0 | Agent Runtime 主循环 | Completed | submission queue → RegularTask → run_turn → Turn/StepContext → sampling/follow-up；abort/capability tests |
| P0 | 模型适配 | Completed | ModelClient、turn-scoped ModelClientSession、ResponseEvent、SSE/WebSocket/retry/usage tests |
| P0 | Tool Calling | Completed | ToolSpec/Router/Runtime/Registry/Handler/Orchestrator、call/output、hook rewrite、并行/取消 tests |
| P0 | Context 与历史 | Completed | ContextManager、normalization、world state、token budget、compaction/rollback/truncation tests |
| P0 | 持久化与恢复 | Completed | rollout policy/recorder、ThreadStore、Legacy/Paginated projection、reconstruction/failure tests |
| P0 | 权限与安全 | Completed | permission、approval、exec policy、Guardian、sandbox/network attempt 与拒绝 tests |
| P1 | 并发、取消与背压 | Completed | bounded submission、single active Task、TurnInputQueue、ordered tools、unsubscribe boundary |
| P1 | 扩展体系 | Completed | typed ExtensionRegistry、MCP/Skills/Plugins/Hooks/Apps/Environments 与注册顺序 tests |
| P1 | Multi-agent | Completed | child Thread、spawn graph/fork、mailbox、execution/residency capacity 与边界 tests |
| P1 | 可观测性与质量 | Completed | transport/sampling/tool/persistence telemetry、analytics 与四层测试架构 |
| P1 | 产品层投影 | Completed | EventMsg → notification、paginated rollout → history、连接/canonical state 边界 |

`Completed` 只表示该研究域在固定 Codex 快照上形成“入口—调用链—状态/副作用所有者—测试—不变量”闭环，不表示当前 Agent 项目已经实现同名能力。逐批证据见 [research-progress.md](./research-progress.md)。

## 3. 十张核心架构图

[架构报告](./architecture-report.md) 集中给出以下十张与源码相连的图：

1. CLI、TUI、App Server、SDK 与共享 Runtime 的全局拓扑。
2. Thread / Turn / Item / Event 生命周期。
3. `turn/start` 进入 `run_turn` 的调用链。
4. Model → Tool → Observation → Model 序列。
5. ToolSpec / Router / Runtime / Registry / Handler / Orchestrator 分层。
6. Context、Compaction、Rollback 与持久化关系。
7. Interrupt / Steer / Resume / Fork 语义。
8. Permission / Approval / Sandbox / Guardian 决策。
9. Skills / Plugins / MCP / Hooks / Apps / Environments 扩展图。
10. Multi-agent 父子 Thread、mailbox 与容量流。

此外，Codex 总览、云端映射和学习模块保留辅助图。图后均说明控制权或设计不变量，不以文件框列表代替架构。

## 4. 最重要的架构结论

1. 多个产品入口共享的是生命周期和状态机，不必共享同一种传输。
2. 一个 Turn 可以包含多次 sampling，但一个 Session 同时只有一个 active Task。
3. 模型和 hook 都只能提出或改写候选动作；handler、policy、approval 与 sandbox 保留最终执行权。
4. Tool call/output 配对是 model history、compaction、rollback 和 recovery 的共同不变量。
5. model history、实时 notification、UI state、analytics 与 durable rollout 是不同投影。
6. `ModelClientSession` 在一个 Turn 内复用 transport/sticky state，不能跨 Turn 泄漏。
7. `ThreadStore` 与 rollout policy 使持久化格式和 Runtime 解耦；Paginated history 以完成 Item 投影，而非重放所有 delta。
8. ExtensionRegistry 用 typed contributor 限制扩展面，Plugin/Skill/MCP/Hook/App 不是同义词。
9. Multi-agent 创建独立 child Thread；它与同一 Turn 内的工具并行有不同上下文、容量、成本和恢复语义。
10. 复杂状态机的可演进性主要来自协议、模块、集成和 snapshot 四层测试，而不是抽象数量。

## 5. 推荐源码阅读路径

最短主线：

```text
app-server turn/start
  -> TurnRequestProcessor::turn_start_inner
  -> Op::UserInput
  -> session::handlers::submission_loop
  -> RegularTask::run
  -> session::turn::run_turn
  -> ModelClientSession::stream
  -> ResponseEvent
  -> ToolRouter / ToolCallRuntime / ToolRegistry
  -> ContextManager + rollout
```

随后按问题进入 [source-reading-map.md](./source-reading-map.md)：Thread 恢复、Tool 安全、Context、持久化、扩展、Multi-agent、产品投影和可观测性。第一遍应跳过平台 sandbox 系统调用、大量 snapshot 内容、生成文件和 UI 样式。

## 6. 学习指南结果

- [learning-roadmap/README.md](../learning-roadmap/README.md) 已重定位为推荐学习顺序，而非当前项目强制实施路线。
- 14 个既有 `phase-*` 路径全部保留，并标记为 Core、Advanced 或 Optional。
- [学习矩阵](../learning-roadmap/checklist-phase-matrix.md) 明确“架构域 → 模块 → 源码文档 → 建议深度 → 当前项目是否需要”。
- [学习 tracker](../learning-roadmap/progress-tracker.md) 只记录已读调用链、Teach-back、实验和未知问题，不再充当项目任务状态。
- MCP/扩展与 Multi-agent 当前只建议理解；正式功能仍以 `docs/tasks/**` 为准。

## 7. 周额度与停止判断

脚本语义已确认：读取 7 天窗口的 `used_percent`，并输出 `weeklyRemaining = 100 - weeklyUsed`。批次读数记录于 [research-progress.md](./research-progress.md)：

- 启动：剩余 97%。
- P0 两个批次后：剩余 97%。
- P1 后：剩余 97%。
- 学习指南后：剩余 96%。
- 首轮 Ready PR 远程复核后：剩余 94%。
- 持续深挖至批次 143 后：已用 35%，剩余 65%，采样时间 `2026-07-13 16:56:35 CST`。

最终读数仍高于原定 50% 停止阈值；本次停止依据不是自动额度条件，而是用户后续明确发出的“可以收尾了”指令。该指令覆盖先前的持续执行要求，Ready PR 继续作为待验收载体，不代表已合并或已通过学习验收。

## 8. 验证与兼容性

最终收尾验证覆盖：

- `git diff --check`。
- Issue 启动时 55 个已跟踪 `docs/research/**` 路径全部仍存在。
- 所有 Markdown 从 `docs/research/README.md` 可达，且相对链接有效。
- 文档引用的 Codex/Agent 本地源码路径存在。
- 新增 `research-progress.md` 与本文件进入根索引和 Codex 子索引。
- Mermaid fence 闭合且总数不少于 10。
- 旧 Codex SHA 只在明确的历史背景说明中出现。
- Git diff 只包含 `docs/research/**`，未修改 tasks、roadmap 或业务代码。

首轮一次性校验结果只作为历史记录。最终收尾重新校验当前树：研究 Markdown 共 `114` 个，Mermaid 图 `33` 个；新增批次 142、143 均进入根索引和 Codex 子索引；`git diff --check` 通过；变更范围仅包含 `docs/research/**`；Codex 只读仓库仍保持无修改。相对链接、索引可达性和最终 Git 状态以本次收尾命令结果为准，不复用首轮数字冒充最终证据。

## 9. 已知不确定项

- 未运行 Codex 全仓测试；测试结论来自固定 commit 中的测试源码和 harness 设计。
- 未逐平台验证 macOS/Linux/Windows sandbox 的低层系统调用。
- remote/private cloud backend 不在公开仓库事实范围内。
- Extension API、Multi-agent v2、Paginated history 等仍可能快速演进；后续升级必须按稳定符号重新取证。
- 当前项目差距页是研究起点快照，不替代未来代码变更后的重新审计。

## 10. 后续复查顺序

1. Codex 快照更新时先重跑路径、符号与测试索引，不做全文重写。
2. 当前项目进入 Tool loop 时，只回读模型事件、Tool 分层和 call/output 不变量。
3. 出现长任务/多实例需求时，再深入 ThreadStore、recovery、queue 与 reconnect。
4. 内置工具和安全稳定后，才评估 MCP/typed extensions。
5. 只有单 Agent baseline 无法满足任务且成本收益可测时，才启动 Multi-agent 对照实验。
