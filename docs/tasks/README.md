# Tasks

本目录是正式任务状态事实来源。研究资料不放在这里；已完成阶段的详细记录查看对应 Task 文档、`docs/tasks/completed/**`、Issue / PR 和 Git 历史。

## 当前状态

```text
阶段 1-8：Completed
Phase 8：Completed
Task 0、1、2A、2B、3A、3B、3C：Completed
Active Agent Task：DeepSeek 思考强度与 Usage（#94，已实现 / 待验收）
Run 配置解析边界（#92）：Completed
Minimal Compaction：Gated
Admin Task 4：Planned
Phase 9：未定案
```

## 当前看板

| 区域 | 状态 | 文档 | 说明 |
| --- | --- | --- | --- |
| Agent 主线 | **阶段 1-8 Completed** | [roadmap.md](../roadmap.md) | 当前为 Phase 8 源码阅读阶段 |
| DeepSeek 思考强度与 Usage（#94） | **Active / 已实现 / 待验收** | [deepseek-reasoning-usage.md](./deepseek-reasoning-usage.md) | Web 单次选择、Run resolved config、Provider wire、Usage / Admin 闭环 |
| Run 配置解析边界（#92） | **Completed / #93 / `f32cd48`** | [agent-run-configuration.md](./agent-run-configuration.md) | 横向 refactor：单次 Run 配置解析入口 + 配置地图 |
| Phase 8：Grounded Retrieval / RAG Baseline | **Completed** | [completed/phase-08-grounded-retrieval.md](./completed/phase-08-grounded-retrieval.md) | Task 0-3C 全部完成，已归档 |
| Phase 7：Context Engineering | **Completed** | [completed/phase-07-context-engineering.md](./completed/phase-07-context-engineering.md) | Task 0-3 Completed；Minimal Compaction Gated |
| Phase 6：有界单 Agent Loop | **Completed** | [completed/phase-06-bounded-agent-loop.md](./completed/phase-06-bounded-agent-loop.md) | bounded loop、deadline、终态可靠性 |
| Admin Console Task 0-3 + Enhancement 1 | **Completed** | [admin-console.md](./admin-console.md) | Run / Step API、Run Trace、typed Inspector |
| Phase 8 Task 3C | **Completed** | [Phase 8 归档](./completed/phase-08-grounded-retrieval.md) | #62 Closed / #63 Merged / `20f838fb` |
| Admin Console Task 4 | Planned | [admin-console.md](./admin-console.md) | Auth / RBAC；当前不启动 |

## Phase 8 Task 看板

Phase 8 全部 Task 文档已合并归档到 [completed/phase-08-grounded-retrieval.md](./completed/phase-08-grounded-retrieval.md)。

| Task | 状态 | 核心结果 |
| --- | --- | --- |
| Task 0：Retrieval Boundary & Offline Evaluation | **Completed / #48 / #49 / `4c2f7950`** | Contract、lexical adapter、evaluation baseline |
| Task 1：Article Chunking & Embedding Index | **Completed / #50 / #52 / `76d66abf`** | deterministic Chunk、Embedding boundary、pgvector index |
| Task 2A：Vector / Hybrid Retrieval & Evaluation | **Completed / #54 / #55 / `3abdcb8a`** | Gemini、exact vector、Article aggregation、RRF、quality-v2 |
| Task 2B：Retrieval Tool & Agent Integration | **Completed / #56 / #57 / `4f3ba1c1`** | `retrieve_article_context@1`、Observation、Agent Loop |
| Task 3A：Grounded Answer & Citation Backend | **Completed / #58 / #59 / `d6df7ac1`** | finalization、Citation validation、durable Grounding |
| Task 3B：Web Chat Source UI | **Completed / #60 / #61 / `572ad206`** | 状态、Sources disclosure、Source cards、Browser |
| Task 3C：Admin Retrieval Inspector | **Completed / #62 / #63 / `20f838fb`** | typed Retrieval / Finalization / Citation audit |

收口事实（final head、merge、验收与最终验证数据）见 [Phase 8 归档](./completed/phase-08-grounded-retrieval.md)。

## 当前正式动作

当前 Active Agent Task 为 DeepSeek 思考强度与 Usage 可观测闭环（#94）：已实现、待验收，Draft PR 待创建。Run 配置解析边界（#92）已于 2026-08-22 验收合并（PR #93 / `f32cd48`）。

Phase 8 源码阅读仍是当前学习阶段；#94 是独立横向正式任务，不定义或启动 Phase 9。下一阶段学习内容暂不定义。

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
