# AI SEO Agent Docs

本目录只负责文档导航。正式 Task 状态以 [`docs/tasks/**`](./tasks/README.md) 为准，阶段路线以 [`roadmap.md`](./roadmap.md) 为准。

## 当前主线

```text
阶段 1-7：Completed
Phase 8：Active / Task 0、Task 1、Task 2A、Task 2B Completed / Task 3 Next
Active Agent Task：无
Minimal Compaction：Gated
```

Phase 8 当前已完成：

- Task 0：Retrieval Boundary 与 lexical Evaluation baseline，#48 / #49 / merge `4c2f7950`；
- Task 1：确定性 Chunking、Embedding boundary 与 pgvector active index，#50 / #52 / merge `76d66abf`；
- Task 2A：Gemini Provider、exact Vector Retrieval、Article aggregation、RRF 与 production quality-v2，#54 / #55 / merge `3abdcb8a`；
- Task 2B：`retrieve_article_context@1`、受控候选 Observation 与 Agent Runtime 集成，#56 / #57 / merge `4f3ba1c1`。

Task 2B 最终验收 head 为 `9008c7be9176d4d8f322a31b96e7f0fef753f727`。GPT 第二轮技术验收通过，AC-01～AC-16 全部 PASS；用户已确认验收并授权合并、关闭 Issue 和 docs 收口。云端 Codex Review 因 code review 额度耗尽未产生结果，该缺口没有被表述为 Review 通过。

Task 3 现在是下一项正式任务，但尚未创建 Issue 或执行 Clarification Gate。

## 文档入口

| 文档 | 用途 |
| --- | --- |
| [roadmap.md](./roadmap.md) | 阶段路线、Phase 8 Task 编排与当前正式动作 |
| [tasks/README.md](./tasks/README.md) | 正式任务看板、状态和启动规则 |
| [tasks/phase-08-grounded-retrieval/README.md](./tasks/phase-08-grounded-retrieval/README.md) | Phase 8 完整目标、Task 0 / 1 / 2A / 2B / 3、阶段不变量与完成条件 |
| [tasks/phase-08-grounded-retrieval/task-00-retrieval-boundary-evaluation.md](./tasks/phase-08-grounded-retrieval/task-00-retrieval-boundary-evaluation.md) | Completed：Retrieval Boundary 与 lexical 离线评估基线 |
| [tasks/phase-08-grounded-retrieval/task-01-article-chunking-embedding-index.md](./tasks/phase-08-grounded-retrieval/task-01-article-chunking-embedding-index.md) | Completed：确定性 Chunking、Embedding 与幂等 pgvector Index |
| [tasks/phase-08-grounded-retrieval/task-02-hybrid-retrieval-tool.md](./tasks/phase-08-grounded-retrieval/task-02-hybrid-retrieval-tool.md) | Completed：Gemini Provider、Vector / Hybrid Retrieval 与 quality-v2 Evaluation |
| [tasks/phase-08-grounded-retrieval/task-02b-retrieval-tool-agent-integration.md](./tasks/phase-08-grounded-retrieval/task-02b-retrieval-tool-agent-integration.md) | Completed：专用 Retrieval Tool、受控 Observation 与 Agent Runtime 集成 |
| [tasks/phase-08-grounded-retrieval/task-03-grounded-answer-retrieval-inspector.md](./tasks/phase-08-grounded-retrieval/task-03-grounded-answer-retrieval-inspector.md) | Next：Grounded Answer、Citation、Web 来源展示与 Retrieval Inspector，尚未启动 |
| [tasks/completed/phase-07-context-engineering.md](./tasks/completed/phase-07-context-engineering.md) | Phase 7 最终能力、验证和已接受边界 |
| [tasks/completed/phase-06-bounded-agent-loop.md](./tasks/completed/phase-06-bounded-agent-loop.md) | Phase 6 最终能力、验证和已接受边界 |
| [tasks/admin-console.md](./tasks/admin-console.md) | Admin Console 独立产品支线 |
| [development-workflow.md](./development-workflow.md) | Issue、Clarification Gate、Draft PR、验收和合并授权流程 |
| [research/README.md](./research/README.md) | Agent / Codex 架构研究资料，不代表正式任务状态 |
| [work-log.md](./work-log.md) | 已真实发生的近期推进与收口记录 |

## 当前能力链路

```text
用户问题
  -> Agent Runtime
  -> DeepSeek sampling
  -> search_articles / retrieve_article_context / get_article_detail
  -> 受控 Tool Observation
  -> Phase 7 Context Planner
  -> follow-up sampling
  -> 最终回答
```

其中 `retrieve_article_context@1` 使用 Gemini Query Embedding、PostgreSQL lexical candidates、pgvector exact search 和 `hybrid_rrf@1`，但只返回 `unverified candidates`，不表示知识库已经确认存在答案。

## 下一项讨论范围

Task 3 Issue 创建前需要定案：

- 是否拆成后端 Grounded Answer / Citation 与 Web / Admin UI 两个 Task；
- Citation contract 与真实 source / chunk 的绑定；
- 无结果、证据不足、冲突候选和 false-positive nearest candidates 的回答行为；
- durable retrieval metadata 与安全投影；
- Web 来源卡片与 Admin Retrieval Inspector 的交互和真实浏览器验收边界。

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
- 当前下一步只讨论 Task 3；没有正式 Issue 和 Gate `READY` 前不得实现。
