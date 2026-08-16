# Tasks

本目录是正式任务状态事实来源。研究资料不放在这里；已完成阶段的详细记录统一查看 `docs/tasks/completed/**`、对应 Issue / PR 和 Git 历史。

## 当前状态

```text
阶段 1-7：Completed
Phase 8：Active
Task 0、Task 1、Task 2A、Task 2B、Task 3A、Task 3B：Completed
Task 3C：Next
Active Agent Task：无
Minimal Compaction：Gated
Admin Enhancement 1：Completed
```

## 当前看板

| 区域 | 状态 | 文档 | 说明 |
| --- | --- | --- | --- |
| Agent 主线 | **Phase 8 Active / 当前无 Active Task** | [roadmap.md](../roadmap.md) | 下一项正式任务为 Task 3C |
| Phase 8：Grounded Retrieval / RAG Baseline | **Active** | [Phase 8 总览](./phase-08-grounded-retrieval/README.md) | Task 0-3B Completed；3C Next |
| Phase 7：Context Engineering | **Completed** | [completed/phase-07-context-engineering.md](./completed/phase-07-context-engineering.md) | Task 0-3 Completed；Minimal Compaction Gated |
| Phase 6：有界单 Agent Loop | **Completed** | [completed/phase-06-bounded-agent-loop.md](./completed/phase-06-bounded-agent-loop.md) | 有界顺序 Loop、deadline、终态可靠性 |
| Admin Console Task 0-3 | **Completed** | [admin-console.md](./admin-console.md) | 真实 Run / Step API、Run Trace、typed Inspector |
| Admin Console Enhancement 1 | **Completed** | [Enhancement 1](./admin-console/enhancement-01-run-trace-workspace.md) | #51 / #53 / merge `159e964c` |
| Phase 8 Task 3C | **Next** | [Task 3C](./phase-08-grounded-retrieval/task-03c-admin-retrieval-inspector.md) | Admin Retrieval Inspector；Issue 未创建 / Gate 未执行 |
| Admin Console Task 4 | Planned | [admin-console.md](./admin-console.md) | Auth / RBAC / 脱敏；当前不启动 |

## Phase 8 Task 看板

| Task | 状态 | 依赖 | 核心结果 / 目标 | 文档 |
| --- | --- | --- | --- | --- |
| Task 0：Retrieval Boundary & Offline Evaluation | **Completed** | Phase 7 | Contract、lexical adapter、evaluation baseline | [Task 0](./phase-08-grounded-retrieval/task-00-retrieval-boundary-evaluation.md) |
| Task 1：Article Chunking & Embedding Index | **Completed** | Task 0 | deterministic Chunk、Embedding boundary、pgvector index | [Task 1](./phase-08-grounded-retrieval/task-01-article-chunking-embedding-index.md) |
| Task 2A：Vector / Hybrid Retrieval & Evaluation | **Completed / #54 / #55 / `3abdcb8a`** | Task 1 | Gemini、exact vector、Article aggregation、RRF、quality-v2 | [Task 2A](./phase-08-grounded-retrieval/task-02-hybrid-retrieval-tool.md) |
| Task 2B：Retrieval Tool & Agent Integration | **Completed / #56 / #57 / `4f3ba1c1`** | Task 2A | `retrieve_article_context@1`、Observation、Agent Loop | [Task 2B](./phase-08-grounded-retrieval/task-02b-retrieval-tool-agent-integration.md) |
| Task 3A：Grounded Answer & Citation Backend Contract | **Completed / #58 / #59 / `d6df7ac1`** | Task 2B | structured finalization、Citation validation、durable Grounding、API / Stream | [Task 3A](./phase-08-grounded-retrieval/task-03a-grounded-answer-citation-contract.md) |
| Task 3B：Web Chat Source UI | **Completed / #60 / #61 / `572ad206`** | Task 3A | 来源状态、Source disclosure、fail-closed 与 Browser | [Task 3B](./phase-08-grounded-retrieval/task-03b-web-source-ui.md) |
| Task 3C：Admin Retrieval Inspector | **Next / 未启动** | Task 3A + Task 3B 顺序 | typed safe Retrieval / Grounding audit | [Task 3C](./phase-08-grounded-retrieval/task-03c-admin-retrieval-inspector.md) |

Task 3 的拆分与共享不变量见 [Task 3 编排](./phase-08-grounded-retrieval/task-03-grounded-answer-retrieval-inspector.md)。研究依据见 [Grounded Answer / Citation 架构研究](../research/phase-08-grounded-answer-citation-design.md)。

## 已完成任务收口事实

| Task | Issue / PR | Merge | 验收 |
| --- | --- | --- | --- |
| Task 0 | #48 / #49 | `4c2f7950` | GPT 技术验收 + 用户确认 |
| Task 1 | #50 / #52 | `76d66abf` | GPT 技术验收 + 用户确认；历史 OpenAI smoke / pgvector integration 边界保留 |
| Task 2A | #54 / #55 | `3abdcb8a` | AC-01～AC-13 PASS；真实 Gemini / pgvector / quality-v2 |
| Task 2B | #56 / #57 | `4f3ba1c1` | AC-01～AC-16 PASS；最终 head `9008c7be`；Codex Review 因额度耗尽未产生结果 |
| Task 3A | #58 / #59 | `d6df7ac1` | AC-01～AC-24 PASS；最终 head `1e7f4c71`；GPT 四轮技术验收 + 用户确认 |
| Task 3B | #60 / #61 | `572ad206` | AC-01～AC-12 PASS；最终 head `516dbd3f`；GPT 两轮技术验收 + 用户确认 |

### Task 3A 最终验证

```text
test:grounding        168 pass / 0 fail
test:grounding-db       9 pass / 0 fail / 0 skip
test:admin-runs        31 pass / 0 fail
test:agent-recorder    14 pass / 0 fail
test:tool-loop         54 pass / 0 fail
test:model-stream      67 pass / 0 fail
test:tools             86 pass / 0 fail
test:seo-service       24 pass / 0 fail
test:context           24 pass / 0 fail
test:retrieval         35 pass / 0 fail
test:retrieval-db       9 pass / 0 fail / 0 skip
test:db-reliability    11 pass / 0 fail / 0 skip
test:llm-config        17 pass / 0 fail
test:seo-stream        12 pass / 0 fail
contracts / API / Web typecheck：PASS
API / Web lint + build：PASS
workspace typecheck：PASS
真实 DeepSeek + Gemini + 隔离 pgvector smoke：answered / insufficient 均 run_completed
```

已知非阻塞风险：同一 answerable live smoke 曾出现 Provider 保守判断为 `insufficient_evidence`；门禁没有放宽，也没有引入“重试直到 answered”。仅凭命中文章标题不能证明截断 excerpt 一定充分。开发数据库尚未执行 `20260815160000_add_message_grounding` migration；合并前验证只作用于隔离数据库。

### Task 3B 最终验证

```text
contracts build：PASS
workspace typecheck：PASS
Web lint / build：PASS
seo stream：12 / 12 pass
Web node tests：43 / 43 pass
Chromium：9 / 9 pass
Chromium repeat-each=3：27 / 27 pass
AC-01～AC-12：PASS
```

浏览器证据覆盖 desktop answered、320px answered 长来源、insufficient unavailable、conflicting partial、reload、legacy、malformed、error、server aborted 与 local abort。仓库根 `pnpm lint` 的既有 Markdown 报错不属于 Issue #60。

## 当前正式动作

当前没有 Active Agent Task。

下一步只允许：

1. GPT 读取当前 Admin Run Detail、typed Inspector、Task 3A / 3B contract 和 Task 3C 文档；
2. 创建 Task 3C 独立 Issue；
3. 提供 Task 3C 专属 Codex 开工 Prompt；
4. Codex 先执行 Clarification Gate；
5. Gate `READY` 后才可创建实现分支。

不得把 Admin Task 4、并行 Tool Call 或 Minimal Compaction 顺手放入 Task 3C Issue。

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
