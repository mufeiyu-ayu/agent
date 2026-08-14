# Tasks

本目录是正式任务状态事实来源。研究资料不放在这里；已完成阶段的详细记录统一查看 `docs/tasks/completed/**`、对应 Issue / PR 和 Git 历史。

## 当前状态

```text
阶段 1-7：Completed
Phase 8：Active / Task 0 Completed / Task 1-3 Planned
Active Agent Task：无
Minimal Compaction：Gated
```

## 当前看板

| 区域 | 状态 | 文档 | 说明 |
| --- | --- | --- | --- |
| Agent 主线 | **Phase 8 Active / 无 Active Task** | [roadmap.md](../roadmap.md) | Task 0 已完成；Task 1-3 Planned，均未启动 |
| Phase 8：Grounded Retrieval / RAG Baseline | **Active / Task 0 Completed / Task 1-3 Planned** | [Phase 8 总览](./phase-08-grounded-retrieval/README.md) | 完整阶段目标、Task 编排、不变量与完成条件 |
| Phase 7：Context Engineering | **Completed** | [completed/phase-07-context-engineering.md](./completed/phase-07-context-engineering.md) | Task 0-3 Completed；merge `caf3d25b`；Minimal Compaction 继续 Gated |
| Phase 6：有界单 Agent Loop | **Completed** | [completed/phase-06-bounded-agent-loop.md](./completed/phase-06-bounded-agent-loop.md) | 有界顺序 Loop、配置治理、数据库可靠性与终态收口均已完成 |
| Admin Console Task 0-3 | **Completed** | [admin-console.md](./admin-console.md) | 真实 Run / Step API、Run Trace、Typed / Generic / Context Inspector 已建立 |
| Admin Console Task 4 | Planned | [admin-console.md](./admin-console.md) | Auth / RBAC / 脱敏；当前不启动 |
| Web Chat Scroll / UI Follow-up | **Completed** | [work-log.md](../work-log.md) | Issue #37 / PR #38；merge `415d7405` |
| Phase 5：最小 Tool Calling | **Completed** | [completed/phase-05-tool-calling.md](./completed/phase-05-tool-calling.md) | 已归档 |
| Phase 4：Agent Runtime | **Completed** | [completed/phase-04-agent-runtime.md](./completed/phase-04-agent-runtime.md) | 已归档 |
| Phase 3：Streaming | **Completed** | [completed/phase-03-streaming-closeout.md](./completed/phase-03-streaming-closeout.md) | 已归档 |
| Phase 2：Session Chat | **Completed** | [completed/phase-02-agent-chat-session.md](./completed/phase-02-agent-chat-session.md) | 已归档 |

## Phase 8 Task 看板

| Task | 状态 | 依赖 | 核心结果 | 文档 |
| --- | --- | --- | --- | --- |
| Task 0：Retrieval Boundary & Offline Evaluation Baseline | **Completed** | Phase 7 | `ArticleRetriever` Contract、Prisma lexical adapter、离线 corpus、Recall@K / MRR baseline | [Task 0](./phase-08-grounded-retrieval/task-00-retrieval-boundary-evaluation.md) |
| Task 1：Article Chunking & Embedding Index | **Planned** | Task 0 | 确定性 Chunk、stable identity、Embedding boundary、幂等 index / reindex | [Task 1](./phase-08-grounded-retrieval/task-01-article-chunking-embedding-index.md) |
| Task 2：Hybrid Retrieval & Agent Tool Integration | **Planned** | Task 1 | vector + lexical retrieval、融合排序、baseline 对比、受控 Tool 接入 | [Task 2](./phase-08-grounded-retrieval/task-02-hybrid-retrieval-tool.md) |
| Task 3：Grounded Answer & Retrieval Inspector | **Planned** | Task 2 | 结构化来源引用、Web 来源展示、安全 Retrieval Inspector 与端到端证据 | [Task 3](./phase-08-grounded-retrieval/task-03-grounded-answer-retrieval-inspector.md) |

Task 1-3 的 Planned 文档只定义阶段目标、依赖、边界和待决事项，不是最终 Issue 规格，也不构成开工授权。

## Phase 8 Task 0 收口事实

- Issue：#48 / Closed（Completed）；
- PR：#49 / Merged；
- 最终验收 head：`79c6f44b45a64f3590321fe681e2d9141a919dc8`；
- Merge commit：`4c2f795084e7bccac205509d8c31b56dbe7ccf0b`；
- GPT 技术验收：通过；
- 用户确认验收：已确认；
- 远程任务分支：已由用户删除。

Task 0 建立的是 Retrieval 工程边界与 lexical 离线评估基线，不等于已经实现 Embedding、Vector Search、Hybrid Retrieval、citation 或完整 RAG。

## 当前正式动作

当前没有 Active Agent Task。下一步应先讨论 Task 1 的数据模型、Chunk 策略、Embedding provider、索引存储和幂等重建边界；确认后再创建独立 Issue，并向 Codex 交付任务专属 Clarification Gate Prompt。

Task 2 和 Task 3 不得越过依赖提前启动。Minimal Compaction 继续保持 `Gated`，不属于 Phase 8 默认任务。

## 状态定义

| 状态 | 含义 |
| --- | --- |
| Planned | 阶段方向已记录，但尚未创建 Issue，不允许实现 |
| Next | 已确认是下一项正式任务，或 Issue 已创建但 Gate 尚未 READY |
| Active | 已创建 Issue 且 Clarification Gate 为 READY，正在实现或待验收 |
| Gated | 只有预先定义的客观触发条件满足后，才重新讨论是否启动 |
| Completed | 已实现、GPT 技术验收通过，并由用户明确确认收口 |

## 新任务规则

- 一个 Issue 只对应一个明确 Task；
- Planned 文档不能替代正式 Issue；
- Gate `READY` 前不得修改正式代码；
- Codex 实现后只能写“已实现、待验收”；
- Completed 必须同时具备 GPT 技术验收和用户确认；
- 验收、docs 收口、Draft 转 Ready、合并和分支清理是不同动作；
- 完整协作流程见 [`../development-workflow.md`](../development-workflow.md)。
