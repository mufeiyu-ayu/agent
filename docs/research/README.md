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

```text
阶段 1-7：Completed
Phase 8：Active
Task 0、1、2A、2B、3A：Completed
Task 3B：Next
Task 3C：Planned
Active Agent Task：无
Minimal Compaction：Gated
```

当前项目已经建立：

- Session Chat、NDJSON Streaming、Abort；
- Conversation / Message / AgentRun / AgentStep；
- bounded sequential Agent Loop；
- DeepSeek Tool Call continuation；
- Tool / Run / DB deadline 与终态可靠性；
- ModelContext、Dynamic History、Context Planner、Observation Governance；
- deterministic Article Chunking 与 stable identity；
- Gemini Embedding + pgvector；
- lexical + vector + hybrid RRF；
- Retrieval Evaluation；
- `retrieve_article_context@1` 与 candidate / unverified / untrusted Observation；
- evidence-eligible Tool policy 与 Grounding Session；
- Run-scoped Evidence Registry 与 structured finalization；
- server-validated Citation identity 与 durable `MessageGroundingV1`；
- optional `done.grounding` / `ConversationMessage.grounding`；
- Admin Run Trace Workspace、Context Inspector 与 finalization usage 聚合。

## 当前重点研究

| 主题 | 文档 | 与正式任务的关系 |
| --- | --- | --- |
| Grounded Answer / Citation | [Phase 8 Grounded Answer / Citation 架构研究](./phase-08-grounded-answer-citation-design.md) | Task 3A / 3B / 3C 的设计依据；文内 Task 状态和“当前代码事实”是实现前研究快照，实时状态以 tasks / master 为准 |
| 当前 Agent baseline | [codex-reference/current-agent-baseline.md](./codex-reference/current-agent-baseline.md) | 用于理解历史架构；实时状态以 tasks / master 为准 |
| Core Runtime | [codex-reference/core-runtime.md](./codex-reference/core-runtime.md) | Runtime loop、Turn、Task、follow-up sampling |
| Tool Loop | [codex-reference/tool-loop.md](./codex-reference/tool-loop.md) | Tool Call、Observation、继续 sampling |
| Context / History | [codex-reference/context-history.md](./codex-reference/context-history.md) | model-visible history 与 Context 治理 |
| Durability / Recovery | [codex-reference/durability-recovery.md](./codex-reference/durability-recovery.md) | 研究资料，未排期 |
| Permission / Approval | [codex-reference/safety-permission.md](./codex-reference/safety-permission.md) | 研究资料，未排期 |
| MCP / Multi-agent | [codex-reference/extensibility-and-multi-agent.md](./codex-reference/extensibility-and-multi-agent.md) | 研究资料，未排期 |

## Grounded Answer 研究结论与落地状态

Task 3 的定案不是“给 Prompt 加一句必须引用来源”，而是：

```text
evidence-eligible Tool invocation
  -> Grounding Session / evidence availability
  -> Run-scoped evidence
  -> structured finalization
  -> server validates citation identity
  -> durable Message Grounding
  -> Web / Admin typed projection
```

关键边界：

- 不解析任意 `[1]`；
- Citation identity validation 与 semantic faithfulness 分离；
- v1 不声称 claim-level verification；
- Web 与 Admin 不解析 Tool 原始 Observation；
- 不引入 LangChain / LangGraph / LlamaIndex 运行时依赖；
- Task 3A 后端事实层已通过 #58 / #59 完成，merge `d6df7ac1`；
- Task 3B Web Source UI 为 Next；Task 3C Admin Retrieval Inspector 保持 Planned。

## Research 迁移为正式 Task 的条件

1. 当前业务出现真实问题或产品需求；
2. 当前代码具备必要前置能力；
3. 能定义最小、可测试、可验收边界；
4. 学习收益高于当前其他候选方向；
5. 规格写入 `docs/tasks/**` 并创建独立 Issue。

禁止按“成熟项目有这个能力，所以当前项目也应立即实现”的方式推进。

## 旧研究资料

旧的 [codex/](./codex/README.md) 与 [learning-roadmap/](./learning-roadmap/README.md) 保留历史研究价值，但包含旧 baseline 和曾经设想的路线，不能直接作为当前执行计划。

发生冲突时：

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
| `docs/research/` | 源码研究、架构解释、长期候选能力 | 宣称当前实现、当前状态或自动启动 |
| `docs/tasks/` | 当前可执行任务、边界、验收和状态 | 存放脱离当前阶段的长期研究路线 |
| `docs/tasks/completed/` | 已完成阶段归档事实 | 维护 Active / Next |
| `docs/roadmap.md` | 阶段顺序与当前主线 | 从研究资料自动生成任务 |
| `docs/work-log.md` | 已真实发生事项 | 提前记录未来实现或合并 |
