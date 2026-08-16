# Tasks

本目录是正式任务状态事实来源。研究资料不放在这里；已完成阶段的详细记录查看对应 Task 文档、`docs/tasks/completed/**`、Issue / PR 和 Git 历史。

## 当前状态

```text
阶段 1-8：Completed
Phase 8：Completed
Task 0、1、2A、2B、3A、3B、3C：Completed
Active Agent Task：无
Minimal Compaction：Gated
Admin Task 4：Planned
Phase 9：未定案
```

## 当前看板

| 区域 | 状态 | 文档 | 说明 |
| --- | --- | --- | --- |
| Agent 主线 | **阶段 1-8 Completed / 当前无 Active Task** | [roadmap.md](../roadmap.md) | 下一步为 Phase 8 代码阅读与学习复盘 |
| Phase 8：Grounded Retrieval / RAG Baseline | **Completed** | [Phase 8 总览](./phase-08-grounded-retrieval/README.md) | Task 0-3C 全部完成 |
| Phase 7：Context Engineering | **Completed** | [completed/phase-07-context-engineering.md](./completed/phase-07-context-engineering.md) | Task 0-3 Completed；Minimal Compaction Gated |
| Phase 6：有界单 Agent Loop | **Completed** | [completed/phase-06-bounded-agent-loop.md](./completed/phase-06-bounded-agent-loop.md) | bounded loop、deadline、终态可靠性 |
| Admin Console Task 0-3 + Enhancement 1 | **Completed** | [admin-console.md](./admin-console.md) | Run / Step API、Run Trace、typed Inspector |
| Phase 8 Task 3C | **Completed** | [Task 3C](./phase-08-grounded-retrieval/task-03c-admin-retrieval-inspector.md) | #62 Closed / #63 Merged / `20f838fb` |
| Admin Console Task 4 | Planned | [admin-console.md](./admin-console.md) | Auth / RBAC；当前不启动 |

## Phase 8 Task 看板

| Task | 状态 | 核心结果 | 文档 |
| --- | --- | --- | --- |
| Task 0：Retrieval Boundary & Offline Evaluation | **Completed / #48 / #49 / `4c2f7950`** | Contract、lexical adapter、evaluation baseline | [Task 0](./phase-08-grounded-retrieval/task-00-retrieval-boundary-evaluation.md) |
| Task 1：Article Chunking & Embedding Index | **Completed / #50 / #52 / `76d66abf`** | deterministic Chunk、Embedding boundary、pgvector index | [Task 1](./phase-08-grounded-retrieval/task-01-article-chunking-embedding-index.md) |
| Task 2A：Vector / Hybrid Retrieval & Evaluation | **Completed / #54 / #55 / `3abdcb8a`** | Gemini、exact vector、Article aggregation、RRF、quality-v2 | [Task 2A](./phase-08-grounded-retrieval/task-02-hybrid-retrieval-tool.md) |
| Task 2B：Retrieval Tool & Agent Integration | **Completed / #56 / #57 / `4f3ba1c1`** | `retrieve_article_context@1`、Observation、Agent Loop | [Task 2B](./phase-08-grounded-retrieval/task-02b-retrieval-tool-agent-integration.md) |
| Task 3A：Grounded Answer & Citation Backend | **Completed / #58 / #59 / `d6df7ac1`** | finalization、Citation validation、durable Grounding | [Task 3A](./phase-08-grounded-retrieval/task-03a-grounded-answer-citation-contract.md) |
| Task 3B：Web Chat Source UI | **Completed / #60 / #61 / `572ad206`** | 状态、Sources disclosure、Source cards、Browser | [Task 3B](./phase-08-grounded-retrieval/task-03b-web-source-ui.md) |
| Task 3C：Admin Retrieval Inspector | **Completed / #62 / #63 / `20f838fb`** | typed Retrieval / Finalization / Citation audit | [Task 3C](./phase-08-grounded-retrieval/task-03c-admin-retrieval-inspector.md) |

Task 3 的拆分与共享不变量见 [Task 3 编排](./phase-08-grounded-retrieval/task-03-grounded-answer-retrieval-inspector.md)。

## Phase 8 收口事实

| Task | Final Head | Merge | 验收 |
| --- | --- | --- | --- |
| Task 0 | `79c6f44b` | `4c2f7950` | GPT 技术验收 + 用户确认 |
| Task 1 | `32598c73` | `76d66abf` | GPT 技术验收 + 用户确认 |
| Task 2A | `32ff3443` | `3abdcb8a` | AC-01～AC-13 PASS |
| Task 2B | `9008c7be` | `4f3ba1c1` | AC-01～AC-16 PASS |
| Task 3A | `1e7f4c71` | `d6df7ac1` | AC-01～AC-24 PASS；GPT 四轮验收 |
| Task 3B | `516dbd3f` | `572ad206` | AC-01～AC-12 PASS；Chromium 9 / repeat 27 |
| Task 3C | `aadcadf5` | `20f838fb` | AC-01～AC-12 PASS；Admin 136 / DB 17 / Chromium 12 / repeat 36 |

## Task 3C 最终验证

```text
frozen lockfile install                              PASS
contracts build                                      PASS
test:admin-runs       136 pass / 0 fail / 0 skip
test:grounding        168 pass / 0 fail / 0 skip
test:grounding-db      17 pass / 0 fail / 0 skip
Admin tests                                          PASS
Admin Chromium        12 pass
Chromium repeat-each=3 36 pass
Admin / API typecheck, lint, build                   PASS
workspace typecheck                                  PASS
diff checks                                          PASS
```

根 `pnpm lint` 的 113 个既有 Markdown baseline 错误不属于 Task 3C；本 Task 源码和 Task 文档 scoped lint 通过。

## 当前正式动作

当前没有 Active Agent Task，也没有自动启动的下一正式 Issue。

下一步：

1. 回读 Phase 8 代码与数据链路；
2. 完成 Chunking、Embedding、Hybrid Retrieval、Tool、Grounding、Web Source UI 和 Admin Inspector 的学习复盘；
3. 将关键架构与作品集材料沉淀到 `docs/research/**`；
4. 学习闭环后再讨论 Phase 9。

Admin Task 4、并行 Tool Call、Minimal Compaction、Memory、MCP、Multi-agent 和 Durable Recovery 均不得自动进入实现。

## 状态定义

| 状态 | 含义 |
| --- | --- |
| Planned | 已记录方向，但依赖或规格尚未满足启动条件 |
| Next | 已确认是下一项正式任务，或 Issue 已创建但 Gate 尚未 READY |
| Active | 已创建 Issue 且 Gate READY，正在实现或待验收 |
| Gated | 只有客观触发条件满足后才重新讨论 |
| Completed | 已实现、GPT 技术验收通过，并由用户明确确认 |

## 新任务规则

- 一个 Issue 只对应一个明确 Task；
- Planned / Next 文档不能替代正式 Issue；
- Issue 实质性变化后必须重新 Gate；
- Gate READY 前不得修改正式代码；
- 实现后只能写“已实现、待验收”；
- Completed 必须同时具备 GPT 技术验收和用户确认；
- docs 收口、Draft 转 Ready、合并、分支清理是不同动作；
- 完整流程见 [`../development-workflow.md`](../development-workflow.md)。
