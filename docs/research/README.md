# Agent 架构研究资料

本目录是 AI SEO Agent 的长期架构研究区，不直接充当当前任务看板或阶段路线。

正式状态必须按以下顺序判断：

```text
当前 master 代码与测试
  -> docs/tasks/**
  -> docs/roadmap.md
  -> docs/work-log.md
  -> docs/research/**
```

研究资料可以讨论 Context、RAG、Recovery、HITL、MCP、Multi-agent 等候选能力，但不能据此宣称当前项目已经实现、必须立即实现或已经确定执行顺序。

## 当前项目结论

项目已经完成阶段 1-7，包括：

- Session Chat、消息持久化、NDJSON Streaming 与停止生成；
- `Conversation` / `Message` / `AgentRun` / `AgentStep` 持久化边界；
- provider-neutral `ModelStreamEvent` 与外部 `ChatStreamEvent` 分层；
- Tool Definition / Registry / Invocation / Result；
- `search_articles` 与 `get_article_detail` 两个只读 Article Tool；
- policy 驱动 bounded sequential Agent Loop；
- 默认 3 次 sampling / 2 次 Tool Call / 600s Run deadline；
- DeepSeek thinking Tool Call continuation；
- Tool / Run timeout、Abort、Observation 预算与 Trace；
- Run remaining-budget 数据库边界、PostgreSQL statement / lock timeout；
- late acquisition / late result ownership fencing；
- Message / AgentStep / AgentRun 的原子终态收口与 COMMIT outcome unknown 语义；
- 单 Run `ModelContext`、model-aware input budget 与 DeepSeek V4 本地 TokenEstimator；
- token-budget Dynamic History Selection、逐轮 Context Plan 与 Observation Governance；
- 安全 Admin Context Inspector 与真实 Run / Step Observability Baseline。

阶段归档：

- Phase 6：[`../tasks/completed/phase-06-bounded-agent-loop.md`](../tasks/completed/phase-06-bounded-agent-loop.md)；
- Phase 7：[`../tasks/completed/phase-07-context-engineering.md`](../tasks/completed/phase-07-context-engineering.md)。

当前状态：

```text
阶段 1-7：Completed
Phase 8 Task 0：Active / 已实现、待验收
Minimal Compaction：Gated
Task 1：未启动
```

后续方向必须基于最新代码、真实产品需求和学习收益重新讨论，不能从研究路线自动推进。

## 研究资料如何迁移为正式 Task

研究资料只在以下情况下迁移为正式 Task：

1. 当前业务出现真实问题或产品需求；
2. 当前代码具备必要前置能力；
3. 能定义一个最小、可测试、可验收的边界；
4. GPT 与用户确认其学习收益高于当前其他候选方向；
5. 正式规格写入 `docs/tasks/**` 并创建独立 Issue。

禁止按“成熟项目有这个能力，所以当前项目也应立即实现”的方式推进。

## 优先阅读入口

### 当前 Runtime 与 Context 基线

| 入口 | 用途 |
| --- | --- |
| [codex-reference/current-agent-baseline.md](./codex-reference/current-agent-baseline.md) | 当前 Phase 1-7 能力、状态与归档指针 |
| [codex-reference/core-runtime.md](./codex-reference/core-runtime.md) | Runtime loop、Turn、Task、follow-up sampling |
| [codex-reference/tool-loop.md](./codex-reference/tool-loop.md) | Tool Call、Observation、继续 sampling 与终止条件 |
| [codex-reference/context-history.md](./codex-reference/context-history.md) | model-visible history、Context 治理与 Compaction 研究 |
| [codex-reference/how-to-use.md](./codex-reference/how-to-use.md) | 如何选择性迁移 Codex 设计 |

### 按真实问题查阅

| 问题 | 参考资料 | 当前状态 |
| --- | --- | --- |
| Tool Call / Result 如何配对 | [codex-reference/tool-loop.md](./codex-reference/tool-loop.md) | Phase 6 已实现，资料用于复盘与后续扩展 |
| Context Budget、History 与 Observation 如何治理 | [codex-reference/context-history.md](./codex-reference/context-history.md) | Phase 7 已建立 Baseline；Minimal Compaction 继续 Gated |
| RAG / Retrieval 如何进入低信任 Context | [codex-reference/context-history.md](./codex-reference/context-history.md)、[codex-reference/how-to-use.md](./codex-reference/how-to-use.md) | Phase 8 Task 0 已建立 Retrieval Boundary 与离线 Evaluation Baseline；后续能力未启动 |
| 崩溃后如何恢复 | [codex-reference/durability-recovery.md](./codex-reference/durability-recovery.md) | 研究资料，未排期 |
| 写操作如何审批 | [codex-reference/safety-permission.md](./codex-reference/safety-permission.md) | 研究资料，未排期 |
| MCP / Multi-agent 何时引入 | [codex-reference/extensibility-and-multi-agent.md](./codex-reference/extensibility-and-multi-agent.md) | 研究资料，未排期 |

## 旧研究资料

旧的 [codex/](./codex/README.md) 与 [learning-roadmap/](./learning-roadmap/README.md) 保留历史研究价值，但它们包含曾经设想的完整阶段顺序和旧项目基线，不能直接作为当前执行计划。

若旧研究资料与当前代码或正式任务冲突，优先级为：

```text
当前代码事实
  > docs/tasks/**
  > docs/roadmap.md
  > codex-reference/**
  > 旧 research 文档
  > PR 描述或历史自述
```

## Research 与 Tasks 的边界

| 目录 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| `docs/research/` | 源码研究、架构解释、长期候选能力 | 宣称当前实现、当前状态或固定执行顺序 |
| `docs/tasks/` | 当前可执行任务、TDD 步骤和验收状态 | 存放脱离当前阶段的长期研究路线 |
| `docs/tasks/completed/` | 已完成阶段的最终归档事实 | 继续维护 Active / Next 状态 |
| `docs/roadmap.md` | 已完成阶段与当前主线状态 | 从研究资料自动生成下一阶段 |
| `docs/work-log.md` | 已真实发生的路线决策、实现、验收和合并 | 记录尚未发生的未来事实 |
