# Codex 架构研究进度

## 当前基线

- Codex：`main@ab6a7eb87cc8a816c88b86c44cf291e251ed2136`
- Agent 起点：`master@5f2ad11f2c65425e84392e81048364d55ec626ef`
- 研究分支：`codex/issue-6-rebuild-codex-research`
- 状态含义：`Completed` 已形成可审计闭环；`Partial` 有可靠证据但仍有明确缺口；`Not Researched` 尚未取证。

## 架构覆盖矩阵

| 优先级 | 领域 | 状态 | 主要证据入口 | 正式文档 |
| --- | --- | --- | --- | --- |
| P0 | Repository 与产品入口 | Completed | `codex-rs/cli/src/main.rs`、TUI `AppServerTarget`、app-server dispatch、SDK facade 与入口测试 | [架构报告](./architecture-report.md)、[源码地图](./source-reading-map.md) |
| P0 | 协议与生命周期 | Completed | protocol v2 Thread/Turn/Item/Goal、`Op`、ThreadManager、start/resume/fork/steer/interrupt/goal tests | 同上 |
| P0 | Agent Runtime 主循环 | Completed | submission_loop、RegularTask、run_turn、Turn/StepContext、sampling/follow-up、abort/capability tests | 同上 |
| P0 | 模型适配 | Completed | `ModelClient`、turn-scoped `ModelClientSession`、`ResponseEvent`、client transport/auth/retry tests | 同上 |
| P0 | Tool Calling | Completed | ToolSpec、Router/Runtime/Registry/Handler/Orchestrator、hook rewrite、并行/取消与 malformed tests | 同上 |
| P0 | Context 与历史 | Completed | ContextManager/normalize/world state、token-budget compaction、rollback/truncation/resume tests | 同上 |
| P0 | 持久化与恢复 | Completed | rollout policy/recorder、ThreadStore、Legacy/Paginated projection、reconstruction/failure tests | 同上 |
| P0 | 权限与安全 | Completed | permission profile、exec policy、approval、Guardian、sandbox/network attempt 与拒绝测试 | 同上 |
| P1 | 并发、取消与背压 | Completed | bounded submission、single active Task、TurnInputQueue、ordered tool futures、listener/unsubscribe 边界测试 | 同上 |
| P1 | 扩展体系 | Completed | typed ExtensionRegistry、MCP/skills/plugins/hooks/apps/environments、注册顺序与集成测试 | 同上 |
| P1 | Multi-agent | Completed | 独立 child Thread、spawn graph/fork、InterAgentCommunication、execution/residency capacity 与边界测试 | 同上 |
| P1 | 可观测性与质量 | Completed | transport/sampling/tool/persistence telemetry、analytics reducer、四层测试架构 | 同上 |
| P1 | 产品层投影 | Completed | EventMsg→notification、paginated rollout→history、unsubscribe/reconnect 边界 | 同上 |

> 本矩阵在每个批次落盘后更新。当前 `Partial` 只表示旧文档路径已存在且第一轮路径复查通过，不能替代本轮完整取证。

## 批次记录

| 批次 | 研究范围 | 落盘结果 | 批次前 / 后周额度 |
| --- | --- | --- | --- |
| 0 | 启动检查、最新 main、旧文档与路径基线 | 固定完整 SHA；确认原路径无缺失；新增本进度页 | 97% / 97% |
| 1 | 产品入口、协议生命周期、Runtime 主循环、模型适配 | 更新全局拓扑、生命周期、`run_turn` 图；补稳定符号、正常/失败测试与不变量 | 97% / 97% |
| 2 | Tool、Context、持久化恢复、权限安全 | 更新 tool loop/分层、context/durable、操作语义、安全决策图；补 hook rewrite 与 paginated history 新事实 | 97% / 97% |
| 3 | P1 并发、扩展、Multi-agent、质量、产品投影 | 补 typed extensions、agent communication/residency、Event/Item/history 边界与两张专题图 | 97% / 97% |
| 4 | 学习指南、清单与兼容 phase 路径 | 重写 Core/Advanced/Optional 主线、矩阵与学习 tracker；14 个模块增加分类并核验当前快照入口 | 96% / 96% |
| 5 | 收尾、全量索引与验收校验 | 新增 closeout；55 个原路径、57 个 Markdown、17 个 Mermaid 与变更范围校验通过 | 96% / 95% |
| 6 | 完成性补审 | 补 Goal、StepContext、tool search/argument streaming；82 个 literal / 240 个全量 Codex 路径 token 校验通过 | 95% / 95% |
| 7 | PR 交付 | commit `60401fb` 推送并创建 Ready PR #7；远程 head/mergeability/范围复核通过 | 95% / 94% |

## 最近检查

- 命令：`python3 "$HOME/.local/bin/codex-weekly-usage.py"`
- 读数：已用 6%，剩余 94%
- 采样时间：`2026-07-13 11:23:18 CST`
- 判断：高于 50%；研究范围已闭环，进入 PR 交付，不再扩展新领域。

## 下一批次

提交当前研究分支，推送并创建 Ready PR；等待自动 Codex Review、GPT 验收和用户确认，不自行合并。
