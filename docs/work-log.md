# 项目工作记录

本文件只记录当前状态与近期关键里程碑。旧阶段细节查看 `docs/tasks/completed/**`、对应 Issue / PR 和 Git 历史。

## 当前快照

| 类型 | 当前记录 | 下一步 |
| --- | --- | --- |
| Agent 主线 | 阶段 1-7 Completed；Phase 8 Active；Task 0、1、2A、2B Completed；Task 3A Next；Task 3B、3C Planned；当前无 Active Agent Task | 创建 Task 3A 独立 Issue，并执行 Clarification Gate |
| Phase 8 | Gemini full indexing 2044 Chunks、quality-v2、Hybrid Retrieval 与 Retrieval Tool 已完成；Grounded Answer / Citation 研究与拆分已定案 | `docs/tasks/phase-08-grounded-retrieval/README.md` |
| Minimal Compaction | Gated | 只有真实 Context 压力证据满足触发条件后才讨论 |
| Admin Console | Task 0-3 与 Enhancement 1 Completed；Task 4 Planned；Retrieval Inspector 为 Phase 8 Task 3C Planned | 不自动启动 Auth / RBAC |

## 近期关键记录

| 日期 | 事项 | 结果 |
| --- | --- | --- |
| 2026-08-15 | Phase 8 Task 3 研究与任务拆分定案 | 结合当前 master、Codex typed item / lifecycle event 设计、OpenAI / Anthropic / Google provider-native citation、Vercel AI SDK structured sources、LangChain structured output、LlamaIndex prompt citation、Ragas 与 OpenTelemetry / OpenInference 方案完成研究；确定不解析任意 Markdown `[1]`，采用 evidence-eligible Tool policy、Grounding Session、server-derived evidence availability、Run-scoped evidence、structured finalization、server-side citation validation 与 durable Message Grounding；v1 允许 Retrieval 和 Article Detail 产生 evidence，Search Articles 保持 discovery-only；Task 3 拆为 3A Backend Contract（Next）、3B Web Source UI（Planned）、3C Admin Retrieval Inspector（Planned）；没有创建 Issue、分支或 PR，没有启动实现 |
| 2026-08-15 | Phase 8 Task 2B 最终收口 | Issue #56 / PR #57；最终验收 head `9008c7be9176d4d8f322a31b96e7f0fef753f727`；GPT 第二轮技术验收通过，AC-01～AC-16 全部 PASS；用户确认并授权合并与 docs 收口；PR #57 merge `4f3ba1c109e8b0ade2328abeed24a72c295acd6d`；Issue #56 Closed；远程任务分支保留 |
| 2026-08-15 | Phase 8 Task 2B Review 修复与最终验证 | 收口 SEO Agent Tool 选择策略、ToolStepSummary 安全边界、Tool limit 和 trusted-provider idempotent；测试 `test:seo-service` 19、`test:tools` 69、`test:tool-loop` 54、`test:context` 24、`test:retrieval` 35、`test:retrieval-db` 9、`test:model-stream` 67，均 0 fail / 0 skip；typecheck / lint / build / workspace typecheck 通过；真实 Tool smoke 返回 3 candidates / 3 chunk evidence；Codex Review 因额度耗尽未产生结果 |
| 2026-08-15 | Phase 8 Task 2B 初始实现 | Clarification Gate READY；实现 `retrieve_article_context@1`、Hybrid Retrieval lazy runtime、trusted-provider policy、受控 Observation、Agent Tool Loop 与 safe Step summary；初始 head `d11d45b18f3e439967d1f3cc33bcca8c1bdf399e` |
| 2026-08-15 | Phase 8 Task 2A 最终收口 | Issue #54 / PR #55；最终 head `32ff344349aa2116bf14414d90e48c814686531a`；merge `3abdcb8afd5626f0b8fda90c98095bf529d165fd`；AC-01～AC-13 通过 |
| 2026-08-15 | Phase 8 Task 2A 完整配额补跑 | 隔离库 full indexing：68 / 68 Article、2044 Chunks、failed 0；production quality-v2：lexical Hit@5 / Recall / MRR 为 0.2 / 0.2 / 0.2，vector 与 hybrid 为 1.0 / 1.0 / 1.0；Vector / Hybrid no-answer accuracy 为 0，各 15 false-positive hits；threshold 保持 `null` |
| 2026-08-15 | Phase 8 Task 2A 实现 | 实现 Gemini Embedding、PostgreSQL 16 + pgvector、exact cosine、Article aggregation、lexical + vector RRF 与 quality-v2；真实 Gemini smoke、Task 1 DB 7 / 7、Retrieval DB 5 / 5 通过 |
| 2026-08-14 | Admin Enhancement 1 最终收口 | Issue #51 / PR #53；最终 head `b31aa0395e`；merge `159e964cafa081df218284b53f246a0da9edd04e`；Issue #51 Closed |
| 2026-08-14 | Admin Enhancement 1 实现 | Run Detail 重构为 Compact Header、Duration Overview、Request Boundary、Event / Content Ledger 与 typed Inspector；真实 Chromium RUNNING / FAILED 验收；Safe I/O、Tool sequence、resolved model findings 收口 |
| 2026-08-14 | Phase 8 Task 1 最终收口 | Issue #50 / PR #52；final head `32598c738e`；merge `76d66abf7af426e2a26f9b5765d1eb7a72382007`；Task 1 Completed；真实 OpenAI smoke 与 pgvector integration / concurrency 当时未执行 |
| 2026-08-14 | Phase 8 Task 1 实现 | deterministic HTML chunking、canonical source hash、EmbeddingProvider baseline、pgvector active index、幂等 CLI、stale fencing 与 advisory lock；68 fixture 生成 2044 Chunks |
| 2026-08-14 | Phase 8 完整任务规划补齐 | 新增阶段 README 与 Task 1 / 2 / 3 文档，建立 Chunking、Retrieval、Grounded Answer / Inspector 路线 |
| 2026-08-14 | Phase 8 Task 0 最终收口 | Issue #48 / PR #49；final head `79c6f44b45`；merge `4c2f795084e7bccac205509d8c31b56dbe7ccf0b`；GPT 技术验收与用户确认完成 |
| 2026-08-14 | PR #49 验收修复 | 统一生产 Retriever 契约并补齐 Evaluation case 绑定校验；最终 Codex Review 无主要 finding |
| 2026-08-13 | Phase 7 最终收口 | Issue #46 / PR #47；merge `caf3d25b`；Phase 7 Completed；Minimal Compaction Gated |
| 2026-08-13 | Phase 7 Task 2 收口 | Issue #44 / PR #45；merge `2f06355c` |
| 2026-08-12 | Phase 7 Task 1 收口 | Issue #42 / PR #43；merge `6df72f0` |
| 2026-08-10 | Phase 7 Task 0 收口 | Issue #40 / PR #41；merge `415e866a` |
| 2026-08-10 | Web Chat UI 收口 | Issue #37 / PR #38；merge `415d7405` |
| 2026-08-10 | Admin Task 3 收口 | Issue #35 / PR #36；merge `4c689c4c` |
| 2026-08-09 | Admin Task 2 收口 | Issue #33 / PR #34；merge `997d6b84` |
| 2026-08-09 | Phase 6 reliability 收口 | Issue #31 / PR #32；merge `691efbcd` |
| 2026-08-08 | Phase 6 Agent Loop 收口 | Issue #29 / PR #30；merge `904b011d` |

## 当前阶段边界

```text
阶段 1-7            Completed
Phase 8             Active
Task 0              Completed
Task 1              Completed
Task 2A             Completed
Task 2B             Completed
Task 3A：Next       未启动
Task 3B：Planned    依赖 3A
Task 3C：Planned    依赖 3A
Active Agent Task   无
Minimal Compaction  Gated
```

当前执行顺序：

```text
Task 3A Grounded Answer + Citation Backend Contract
  ├─> Task 3B Web Chat Source UI
  └─> Task 3C Admin Retrieval Inspector
```

Task 3 研究已完成以下定案：

- Citation 是服务端验证的结构化事实，不是任意 Markdown `[1]`；
- Evidence-backed answer 通过 structured finalization 选择 Run-scoped opaque citationKey；
- `citationIntegrity=validated` 与 `faithfulnessStatus=not_evaluated` 分开；
- Message content、Grounding 与 Run terminalization 原子提交；
- `done` 只增加 optional Grounding，不新增 stream event type；
- v1 使用 message-level source cards，claim-level offsets 延后；
- Web / Admin 使用独立 Task，不在 3A 中顺手实现。

## 记录规则

- 只记录已经真实发生的事项；
- 研究定案、Issue 创建、实现、验收、Task 收口和合并是不同动作；
- Planned 不代表 Next 或 Active；
- 当前没有 Active Agent Task；Task 3A 未创建 Issue、未执行 Gate，因此不得实现。
