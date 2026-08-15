# AI SEO Agent Docs

本目录只负责文档导航。正式 Task 状态以 [`docs/tasks/**`](./tasks/README.md) 为准，阶段路线以 [`roadmap.md`](./roadmap.md) 为准。

## 当前主线

```text
阶段 1-7：Completed
Phase 8：Active / Task 0、Task 1、Task 2A Completed / Task 2B Next / Task 3 Planned
Active Agent Task：无
Minimal Compaction：Gated
```

Phase 8 Task 0 已通过 Issue #48 / PR #49 完成验收并合入 `master`，merge commit 为 `4c2f795084e7bccac205509d8c31b56dbe7ccf0b`。

Phase 8 Task 1 已通过 Issue #50 / PR #52 完成验收并合入 `master`，merge commit 为 `76d66abf7af426e2a26f9b5765d1eb7a72382007`。Task 1 当时建立的是 OpenAI-specific Embedding baseline；真实 OpenAI smoke 与真实 pgvector integration / concurrency 当时未执行。

Phase 8 Task 2A 已通过 Issue #54 / PR #55 完成 Gemini Provider 迁移、exact Vector Retrieval、Article aggregation、RRF 与 production quality-v2。最终验收 head 为 `32ff344349aa2116bf14414d90e48c814686531a`，merge commit 为 `3abdcb8afd5626f0b8fda90c98095bf529d165fd`。Task 2B 现在是下一项正式任务，但尚未创建 Issue 或启动实现。

## 文档入口

| 文档 | 用途 |
| --- | --- |
| [roadmap.md](./roadmap.md) | 阶段路线、Phase 8 Task 编排与当前正式动作 |
| [tasks/README.md](./tasks/README.md) | 正式任务看板、状态和启动规则 |
| [tasks/phase-08-grounded-retrieval/README.md](./tasks/phase-08-grounded-retrieval/README.md) | Phase 8 完整目标、Task 0 / 1 / 2A / 2B / 3、阶段不变量与完成条件 |
| [tasks/phase-08-grounded-retrieval/task-00-retrieval-boundary-evaluation.md](./tasks/phase-08-grounded-retrieval/task-00-retrieval-boundary-evaluation.md) | Completed：Retrieval Boundary 与 lexical 离线评估基线 |
| [tasks/phase-08-grounded-retrieval/task-01-article-chunking-embedding-index.md](./tasks/phase-08-grounded-retrieval/task-01-article-chunking-embedding-index.md) | Completed：确定性 Chunking、Embedding 与幂等 pgvector Index |
| [tasks/phase-08-grounded-retrieval/task-02-hybrid-retrieval-tool.md](./tasks/phase-08-grounded-retrieval/task-02-hybrid-retrieval-tool.md) | Completed：Gemini Provider、Vector / Hybrid Retrieval 与 quality-v2 Evaluation |
| [tasks/phase-08-grounded-retrieval/task-02b-retrieval-tool-agent-integration.md](./tasks/phase-08-grounded-retrieval/task-02b-retrieval-tool-agent-integration.md) | Next：专用 Retrieval Tool 与 Agent Integration，尚未启动 |
| [tasks/phase-08-grounded-retrieval/task-03-grounded-answer-retrieval-inspector.md](./tasks/phase-08-grounded-retrieval/task-03-grounded-answer-retrieval-inspector.md) | Planned：来源引用、Web 展示与 Retrieval Inspector |
| [tasks/completed/phase-07-context-engineering.md](./tasks/completed/phase-07-context-engineering.md) | Phase 7 最终能力、验证和已接受边界 |
| [tasks/completed/phase-06-bounded-agent-loop.md](./tasks/completed/phase-06-bounded-agent-loop.md) | Phase 6 最终能力、验证和已接受边界 |
| [tasks/admin-console.md](./tasks/admin-console.md) | Admin Console 独立产品支线 |
| [development-workflow.md](./development-workflow.md) | Issue、Clarification Gate、Draft PR、验收和合并授权流程 |
| [research/README.md](./research/README.md) | Agent / Codex 架构研究资料，不代表正式任务状态 |
| [work-log.md](./work-log.md) | 已真实发生的近期推进与收口记录 |

## 事实来源

发生冲突时按以下顺序判断：

1. GitHub 当前代码、Issue、PR、Review、commit 与真实验证结果；
2. `docs/tasks/**` 的正式 Task 状态；
3. `docs/development-workflow.md` 的协作规则；
4. `docs/roadmap.md` 的阶段路线；
5. `docs/work-log.md` 的已发生事实；
6. `docs/research/**` 的研究资料。

## 维护原则

- `docs/README.md` 只做入口，不维护第二套任务看板；
- 阶段总览放在对应 `docs/tasks/phase-*/README.md`；
- 每个 Task 使用独立文档，一个正式 Issue 只对应一个 Task；
- Planned 不代表 Next 或 Active；
- `Next` 表示下一项正式任务，或 Issue 已创建但 Gate 尚未 READY；
- `Active` 只能在正式 Issue 已启动且 Gate 为 READY 后使用；
- `Completed` 必须具备 GPT 技术验收和用户明确确认；
- 已完成阶段统一归档到 `docs/tasks/completed/**`；Phase 8 仍 Active，因此其已完成 Task 继续保留在阶段目录；
- `docs/work-log.md` 只记录真实发生的事项；
- 当前下一步是讨论 Task 2B 的 Tool 契约、no-answer / candidate 语义、Observation Budget 和 Agent 接入边界；没有正式 Issue 和 Gate `READY` 前不得实现。