# Codex 架构域与学习模块矩阵

这张矩阵回答“某个 Codex 架构域应该读哪个模块、理解多深、当前项目是否需要”。它不是实施排期；项目状态仍以 `docs/tasks/**` 为准。

## 深度定义

| 深度 | 达成标准 |
| --- | --- |
| Core | 能画真实调用链，指出状态/副作用所有者，解释正常与失败测试和关键不变量 |
| Advanced | 还能解释恢复、并发、安全或多产品投影取舍，并完成小型实验 |
| Optional | 知道边界、成本和触发条件；没有真实需求时不实现 |

## 架构域映射

| Codex 架构域 | 学习模块 | 架构源码文档 | 建议深度 | 当前 Agent 项目是否需要 |
| --- | --- | --- | --- | --- |
| Repository 与产品入口 | 00、13 | [报告 3、4.1](../codex/architecture-report.md)、[源码路线 1](../codex/source-reading-map.md) | Core | 需要“多入口共享 runtime”思想；不复制进程拓扑 |
| Thread / Turn / Item / Event 生命周期 | 00、03、08 | [报告 4.2-4.4、4.18](../codex/architecture-report.md) | Core | 需要分清 Conversation/Run/Step/Event；不一比一改名 |
| Thread Goal / 长期目标与预算 | 07、11 | [报告 4.2](../codex/architecture-report.md)、[源码路线 2](../codex/source-reading-map.md) | Advanced | 当前只理解；出现跨 Turn 目标/预算需求后再设计 |
| Agent Runtime 主循环 | 01、03、04 | [报告 4.3-4.5](../codex/architecture-report.md) | Core | 阶段 5 近期需要 |
| ModelClient / provider events | 01、09 | [源码路线 3](../codex/source-reading-map.md) | Core | 需要 provider-neutral 事件；不复制 Rust transport |
| ToolSpec / Router / Registry / Handler | 02、03 | [报告 4.6](../codex/architecture-report.md) | Core | 近期需要最小只读工具闭环 |
| ToolOrchestrator / timeout / error | 04 | [报告 4.6-4.7](../codex/architecture-report.md) | Core | 需要云端 timeout/cancel/error；OS sandbox 不需要 |
| Approval / Permission / Sandbox / Guardian | 05、10 | [报告 4.13](../codex/architecture-report.md) | Core→Advanced | 需要业务授权与审批；Guardian/系统 sandbox 先理解 |
| ContextManager / normalization | 03、06 | [报告 4.9](../codex/architecture-report.md) | Core | Tool loop 后需要 call/output 与预算不变量 |
| Compaction / rollback / world state | 06、08 | [报告 4.9-4.10](../codex/architecture-report.md) | Advanced | 长上下文出现真实压力时需要 |
| Rollout / ThreadStore / state DB | 07 | [报告 4.11](../codex/architecture-report.md) | Advanced | 云端使用 PostgreSQL 思想迁移，不复制 JSONL |
| Resume / Fork / Interrupt / Steer | 07、08 | [报告 4.12](../codex/architecture-report.md) | Advanced | interrupt 已有基础；resume 后置；fork/steer 可选 |
| 并发、取消与背压 | 04、08 | [报告 4.7](../codex/architecture-report.md) | Advanced | 多实例/长工具前需要；工具并行按瓶颈触发 |
| Event → notification → UI 投影 | 01、08、09 | [报告 4.8、4.18](../codex/architecture-report.md) | Core | Vue stream 必须理解；不复制 TUI Item 类型全集 |
| 可观测性、协议与状态机测试 | 00、09、13 | [报告 4.17](../codex/architecture-report.md) | Core→Advanced | 从现在起需要测试；全套 telemetry 按成熟度加入 |
| MCP / dynamic tools | 11 | [报告 4.14](../codex/architecture-report.md) | Optional | 内置工具稳定后才评估 |
| Skills / Plugins / Hooks / Apps / Environments | 11 | [源码路线 9](../codex/source-reading-map.md) | Optional | 当前只需概念区分与信任边界 |
| Multi-agent | 12 | [报告 4.15](../codex/architecture-report.md) | Optional | 当前不实现；单 Agent + tool 基线后做对照实验 |
| 云端多租户、配额与部署 | 10、13 | [云端映射](../codex/cloud-agent-mapping.md) | Advanced | 对外多用户前必须；当前不假装已具备 |

## 五条主线的最小闭环

| 主线 | 最小阅读闭环 | Teach-back 必答问题 |
| --- | --- | --- |
| Core Runtime | 00 → 01 → 03 | 为什么一次 Turn 可以包含多次 sampling，但一个 Session 同时只有一个 active Task？ |
| Tool 与安全 | 02 → 04 → 05 | 模型、hook、handler、policy 和 executor 分别拥有什么权限？ |
| Context 与持久化 | 06 → 07 → 08 | working model history 改变时，哪些 durable facts 仍必须保留？ |
| 产品化与质量 | 09 → 10 → 13 | delta、notification、analytics 与 canonical state 为什么不能混用？ |
| 扩展与协作 | 11 → 12 | 为什么 MCP/Plugin/Skill/Hook 不同？为什么 child Agent 不是并行工具？ |

## 使用规则

1. 先在 [架构学习清单](../codex/architecture-learning-checklist.md) 选择领域，再从本矩阵进入模块。
2. 只读完成可以记录 teach-back 与源码证据，不要求提交项目代码。
3. 小型实验只证明一个不变量；不要顺手引入框架、队列或插件系统。
4. 只有真实需求与前置条件成立时，才把建议转成 `docs/tasks/**` 的正式任务。
5. 任何“已学习”必须能追到当前快照中的稳定符号和至少一个失败/边界测试。
