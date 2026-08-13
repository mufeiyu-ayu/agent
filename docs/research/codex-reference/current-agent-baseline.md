# Agent 项目当前基线

> 本文件是 `docs/research/codex-reference/**` 的快速事实入口，不替代 `docs/tasks/**`、`docs/roadmap.md` 或当前 `master`。原先记录的 Phase 6 启动前基线已失效；历史内容可通过 Git 历史查看。

## 当前事实入口

请按以下顺序判断项目现状：

1. 当前 `master` 代码、测试、Issue / PR 与 Git 历史；
2. [`../../tasks/README.md`](../../tasks/README.md)：正式 Task 状态；
3. [`../../roadmap.md`](../../roadmap.md)：阶段级路线；
4. [`../../work-log.md`](../../work-log.md)：近期真实推进与收口记录；
5. [`../../tasks/completed/phase-06-bounded-agent-loop.md`](../../tasks/completed/phase-06-bounded-agent-loop.md)：Phase 6 最终能力与可靠性归档；
6. [`../../tasks/completed/phase-07-context-engineering.md`](../../tasks/completed/phase-07-context-engineering.md)：Phase 7 Context Engineering 与 Inspector 归档。

## 当前真实基线

```text
阶段 1-7：Completed

Agent Runtime：
  bounded sequential loop
  3 sampling / 2 Tool Call 默认预算
  search_articles + get_article_detail
  DeepSeek thinking continuation
  Run deadline / Tool timeout / Abort
  PostgreSQL statement / lock timeout
  late-result ownership fencing
  atomic terminalization

Context Engineering：
  单 Run ModelContext Boundary
  model-aware input budget
  DeepSeek V4 本地 TokenEstimator
  token-budget Dynamic History Selection
  per-sampling Context Plan
  Observation tool_ceiling + context_budget 治理
  mandatory-context fail closed
  safe Context metadata

Observability：
  真实 Run / Step Query API
  Run List / Detail
  Execution Timeline
  Typed / Generic Inspector
  Context Inspector

Retrieval：
  Article Retrieval Boundary
  Prisma lexical adapter
  确定性离线 corpus 与 Evaluation Baseline

当前 Agent 主线：Phase 8 Task 0 Active / 已实现、待验收
Minimal Compaction：Gated
Task 1：未启动
```

## 当前能力边界

以下仍未进入正式实现：

- Chunking、Embedding、Vector Search、Hybrid Retrieval、rerank 与 citation；
- Permission、Approval、Human-in-the-loop 与写操作审计；
- Durable Recovery、Resume、operation receipt 与跨进程重放；
- MCP、Plugin、Skill、Hook；
- Planner / Workflow、并行 Tool Call；
- Multi-agent；
- 自动 Summary / Compaction。

这些方向必须基于真实产品需求、前置能力和最小可验收边界重新比较，不能从研究资料自动推进。

## 历史用途

若需要研究“项目从最小 Tool Calling 升级到 bounded Agent Loop，再升级到 Context Engineering 之前缺什么”，请查看本文件在 Git 历史中的旧版本，以及：

- [`../codex/`](../codex/README.md) 的旧 Codex 源码研究；
- [`../learning-roadmap/`](../learning-roadmap/README.md) 的历史学习路线；
- Phase 6 与 Phase 7 的对应 Issue、PR 和完成归档。

这些资料用于历史复盘，不得覆盖当前 `docs/tasks/**` 的正式状态。
