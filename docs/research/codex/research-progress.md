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
| 8 | App Server RPC 并发、能力协商与重连原子性 | 补资源级 shared/exclusive 序列化、ConnectionRpcGate、listener command、resume/subscribe 与 idle unload 不变量 | 94% / 94% |
| 9 | Model adapter 传输与恢复 | 补 Session/Turn/attempt 三种寿命、WS 增量等价、prewarm trace、401/stream retry/HTTP fallback 与断流事实边界 | 94% / 94% |
| 10 | Rollout writer、ordinal 与 state DB 恢复 | 补 deferred materialization、pending suffix/reopen barrier、逆向 ordinal、leased backfill、DB 定点备份与 filesystem fallback | 94% / 93% |
| 11 | Hook、动态权限、Sandbox、Network 与 Guardian 组合 | 补 hook fail-open/结果过滤边界、权限交集与 scope、二次 sandbox review、网络归因 key、Guardian 隔离与拒绝熔断 | 93% / 93% |
| 12 | Typed Extension 的状态寿命与合并规则 | 补不可变 registry、Session/Thread/Turn attachment、all/first-claim/last-write 合并、失败隔离与流式 Item 延迟成本 | 93% / 93% |
| 13 | Multi-agent V2 control plane | 补 root-scoped control、身份/驻留/执行三容量、fork flush/filter、V2 reload 限制、mailbox answer boundary 与 V1/V2 差异 | 93% / 93% |
| 14 | Context normalization 与 compaction rewrite | 补 pair-aware repair、rollback/context baseline、world-state diff、tail token 估算、Total/BodyAfterPrefix、三类 compaction 与位置不变量 | 93% / 93% |
| 15 | Tool parallel admission、ordered observation 与 cancellation | 补 RwLock read/write gate、StepContext 快照、FuturesOrdered、argument preview、terminal exactly-once、cleanup wait 与 timing 分解 | 93% / 93% |
| 16 | Submission loop 与 ActiveTurn ownership | 补单消费者控制面、task=None reservation、steer/replaced、finish/abort 双屏障、100ms cleanup、identity recheck 与 idle work 竞态 | 93% / 93% |
| 17 | Legacy ThreadHistory 与 Paginated projector | 补双投影边界、implicit/explicit Turn、late event归属、snapshot upsert、ChangeSet dedupe/rollback 与 Error status保护 | 93% / 92% |
| 18 | App Server connection ownership 与 teardown | 补processor/outbound双状态、initialize提交顺序、RPC gate与资源queue正交、入站/出站request id、pending approval重放、慢连接断开和responder校验边界 | 92% / 92% |
| 19 | MCP Runtime generation、refresh 与 exposure | 补Step级不可变snapshot、catalog多来源解析、无效环境变化复用manager、新旧runtime共存、required/cache/reconnect、tool可见性、elicitation跨refresh路由 | 92% / 92% |
| 20 | Config layers、requirements composition 与 constraints | 补普通偏好/强制约束双管线、精确precedence/provenance、领域合并规则、normalize/fallback/fatal、permission重物化和refresh重建边界 | 92% / 92% |
| 21 | Environment selection、reconnect 与 capability snapshot | 补Manager/Thread/Step三层、initial失败与reconnect差异、Deferred Executor starting/wait、fail-fast inspection、handle-bound capability root和PathUri兼容风险 | 92% / 92% |

## 最近检查

- 命令：`python3 "$HOME/.local/bin/codex-weekly-usage.py"`
- 读数：已用 8%，剩余 92%
- 采样时间：`2026-07-13 11:49:42 CST`
- 判断：高于 50%；按用户明确停止条件继续做源码深挖，不能以首轮闭环或 PR 已创建为由停止。

## 下一批次

继续从模型传输、持久化修复、安全决策和扩展容量四个横切面补“失败顺序—状态所有者—恢复不变量”；每批落盘并复查额度。只有周额度剩余低于 50% 后，才进入最终校验和 PR 收尾。
