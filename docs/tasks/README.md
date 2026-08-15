# Tasks

本目录是正式任务状态事实来源。研究资料不放在这里；已完成阶段的详细记录统一查看 `docs/tasks/completed/**`、对应 Issue / PR 和 Git 历史。

## 当前状态

```text
阶段 1-7：Completed
Phase 8：Active / Task 0、Task 1、Task 2A、Task 2B Completed / Task 3 Next
Active Agent Task：无
Minimal Compaction：Gated
Admin Enhancement 1：Completed
```

## 当前看板

| 区域 | 状态 | 文档 | 说明 |
| --- | --- | --- | --- |
| Agent 主线 | **Phase 8 Active / 当前无 Active Task** | [roadmap.md](../roadmap.md) | Task 0、1、2A、2B Completed；Task 3 Next |
| Phase 8：Grounded Retrieval / RAG Baseline | **Active** | [Phase 8 总览](./phase-08-grounded-retrieval/README.md) | Retrieval Tool 已接入 Agent；下一步讨论 Grounded Answer / Citation / Inspector |
| Phase 7：Context Engineering | **Completed** | [completed/phase-07-context-engineering.md](./completed/phase-07-context-engineering.md) | Task 0-3 Completed；Minimal Compaction 继续 Gated |
| Phase 6：有界单 Agent Loop | **Completed** | [completed/phase-06-bounded-agent-loop.md](./completed/phase-06-bounded-agent-loop.md) | 有界顺序 Loop、配置治理、数据库可靠性与终态收口均已完成 |
| Admin Console Task 0-3 | **Completed** | [admin-console.md](./admin-console.md) | 真实 Run / Step API、Run Trace、Typed / Generic / Context Inspector 已建立 |
| Admin Console Enhancement 1 | **Completed** | [enhancement-01-run-trace-workspace.md](./admin-console/enhancement-01-run-trace-workspace.md) | Issue #51 Closed；PR #53 Merged；merge `159e964c` |
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
| Task 1：Article Chunking & Embedding Index | **Completed** | Task 0 | 确定性 Chunk、stable identity、Embedding boundary、pgvector active index 与幂等 CLI | [Task 1](./phase-08-grounded-retrieval/task-01-article-chunking-embedding-index.md) |
| Task 2A：Vector / Hybrid Retrieval & Evaluation | **Completed / #54 / #55 / merge `3abdcb8a`** | Task 1 | Gemini Provider、exact vector search、Article aggregation、RRF、quality-v2 Evaluation | [Task 2A](./phase-08-grounded-retrieval/task-02-hybrid-retrieval-tool.md) |
| Task 2B：Retrieval Tool & Agent Integration | **Completed / #56 / #57 / merge `4f3ba1c1`** | Task 2A | `retrieve_article_context@1`、受控候选 Observation、Agent Loop / Context Budget 集成 | [Task 2B](./phase-08-grounded-retrieval/task-02b-retrieval-tool-agent-integration.md) |
| Task 3：Grounded Answer & Retrieval Inspector | **Next / 未启动** | Task 2B | 结构化来源引用、Web 来源展示、安全 Retrieval Inspector 与端到端证据 | [Task 3](./phase-08-grounded-retrieval/task-03-grounded-answer-retrieval-inspector.md) |

原 Task 2 被拆成两个独立 Task：Task 2A 证明检索层；Task 2B 完成 Tool / Agent Runtime 集成。Task 3 现在是下一项正式任务。

## Phase 8 已完成任务收口事实

### Task 0

- Issue：#48 / Closed（Completed）；
- PR：#49 / Merged；
- 最终验收 head：`79c6f44b45a64f3590321fe681e2d9141a919dc8`；
- Merge commit：`4c2f795084e7bccac205509d8c31b56dbe7ccf0b`；
- GPT 技术验收与用户确认：完成。

### Task 1

- Issue：#50 / Closed（Completed）；
- PR：#52 / Merged；
- 最终验收 head：`32598c738e2f5d0174ca4654d9f3e42e8a9ffe4f`；
- Merge commit：`76d66abf7af426e2a26f9b5765d1eb7a72382007`；
- GPT 技术验收与用户确认：完成；
- 历史边界：Task 1 当时的真实 OpenAI smoke 与真实 pgvector integration / concurrency 未执行。

### Task 2A

- Issue：#54 / Closed（Completed）；
- PR：#55 / Merged；
- 最终验收 head：`32ff344349aa2116bf14414d90e48c814686531a`；
- Merge commit：`3abdcb8afd5626f0b8fda90c98095bf529d165fd`；
- GPT 技术验收与用户确认：完成；
- AC-01～AC-13：全部通过。

最终 active profile：

```text
provider: google
model: gemini-embedding-2
dimensions: 1536
embeddingVersion: google:gemini-embedding-2:1536:search-result-v1
```

真实证据：

- 隔离 full indexing：68 / 68 Article、2044 Chunks、exit 0、failed 0；
- Task 1 DB integration：7 / 7、0 skip；
- Retrieval DB integration：5 / 5、0 skip；
- production quality-v2 完整比较 lexical / vector / hybrid；
- similarity threshold 保持 `null`；
- Vector / Hybrid no-answer case 各产生 15 个 false-positive hits，作为真实基线风险保留。

### Task 2B

- Issue：#56 / Closed（Completed）；
- PR：#57 / Merged；
- 最终验收 head：`9008c7be9176d4d8f322a31b96e7f0fef753f727`；
- Merge commit：`4f3ba1c109e8b0ade2328abeed24a72c295acd6d`；
- GPT 第二轮技术验收：通过；
- 用户确认验收：已确认；
- AC-01～AC-16：全部通过；
- 云端 Codex Review：已请求，但因 code review 额度耗尽未产生 Review，未表述为 Review 通过；
- 远程任务分支：保留。

Task 2B 建立：

- `retrieve_article_context@1`；
- candidate / unverified / untrusted 结果语义；
- Gemini + pgvector Hybrid Retrieval 的 Runtime 组装；
- trusted-provider + idempotent Tool policy；
- 8,000 字符 Observation ceiling 与 Phase 7 Context Planner；
- JSON / 大小 / 深度 fail-closed 的安全 `ToolStepSummary`；
- SEO Agent 三个 Article Tool 的选择边界；
- 真实 Gemini + 隔离 pgvector Retrieval Tool smoke。

最终验证：

```text
test:seo-service    19 pass / 0 fail / 0 skip
test:tools          69 pass / 0 fail / 0 skip
test:tool-loop      54 pass / 0 fail / 0 skip
test:context        24 pass / 0 fail / 0 skip
test:retrieval      35 pass / 0 fail / 0 skip
test:retrieval-db    9 pass / 0 fail / 0 skip
test:model-stream   67 pass / 0 fail / 0 skip
typecheck / lint / build / workspace typecheck：PASS
```

## Admin Console Enhancement 1 收口事实

- Issue：#51 / Closed（Completed）；
- PR：#53 / Merged；
- 最终验收 head：`b31aa0395eac005ea41fe8d04129a683cc5747f4`；
- Merge commit：`159e964cafa081df218284b53f246a0da9edd04e`；
- GPT 技术验收与用户确认：完成。

## 当前正式动作

当前没有 Active Agent Task。

Task 3 已满足前置条件并进入 `Next`，但尚未创建正式 Issue、未执行 Clarification Gate、未启动实现。下一步只讨论：

- 是否把 Task 3 拆成后端 Grounded Answer / Citation 与 Web / Admin UI 两个 Task；
- Citation contract、旧客户端兼容和 citation marker；
- evidence 不足、zero-hit、冲突候选和 false-positive nearest candidates 的回答行为；
- durable source / chunk metadata 的存储与安全投影；
- Web 来源卡片和 Admin Retrieval Inspector 的交互、错误状态与真实浏览器验收边界。

Task 3 不得在正式 Issue 和 Gate `READY` 前实现。Minimal Compaction 继续保持 `Gated`。

## 状态定义

| 状态 | 含义 |
| --- | --- |
| Planned | 阶段方向已记录，但尚未被确定为下一项正式任务 |
| Next | 已确认是下一项正式任务，或 Issue 已创建但 Gate 尚未 READY |
| Active | 已创建 Issue 且 Clarification Gate 为 READY，正在实现或待验收 |
| Gated | 只有预先定义的客观触发条件满足后，才重新讨论是否启动 |
| Completed | 已实现、GPT 技术验收通过，并由用户明确确认收口 |

## 新任务规则

- 一个 Issue 只对应一个明确 Task；
- Planned / Next 文档不能替代正式 Issue；
- Issue 发生实质性规格变化后必须重新 Gate；
- Gate `READY` 前不得修改正式代码；
- 实现后只能先写“已实现、待验收”；
- Completed 必须同时具备 GPT 技术验收和用户确认；
- 验收、docs 收口、Draft 转 Ready、合并和分支清理是不同动作；
- 完整协作流程见 [`../development-workflow.md`](../development-workflow.md)。
