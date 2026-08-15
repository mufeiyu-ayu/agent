# 项目工作记录

本文件只记录当前状态与近期关键里程碑。旧阶段细节查看 `docs/tasks/completed/**`、对应 Issue / PR 和 Git 历史。

## 当前快照

| 类型 | 当前记录 | 下一步 |
| --- | --- | --- |
| Agent 主线 | 阶段 1-7 Completed；Phase 8 Active；Task 0、Task 1、Task 2A Completed；Task 2B Next；Task 3 Planned；当前无 Active Agent Task | 讨论 Task 2B 技术方案与验收边界 |
| Phase 8 | Gemini full indexing 2044 Chunks、production quality-v2 三策略指标与 threshold 决策已完成；Issue #54 Closed，PR #55 Merged | `docs/tasks/phase-08-grounded-retrieval/README.md` |
| Minimal Compaction | Gated | 只有真实 Context 压力证据满足触发条件后才讨论 |
| Admin Console | Task 0-3 与 Enhancement 1 Completed；Task 4 Planned | 不自动启动 Auth / RBAC |

## 近期关键记录

| 日期 | 事项 | 结果 |
| --- | --- | --- |
| 2026-08-15 | Phase 8 Task 2A 最终收口 | Issue #54 / PR #55；最终验收 head `32ff344349aa2116bf14414d90e48c814686531a`；GPT 技术验收通过，用户明确确认验收并授权 Draft 转 Ready、合并、关闭 Issue 和 docs 收口；PR #55 已合入 `master`，merge `3abdcb8afd5626f0b8fda90c98095bf529d165fd`；Issue #54 Closed（Completed）；AC-01～AC-13 全部通过；Task 2A Completed；Task 2B 进入 Next，但尚未创建 Issue 或启动实现 |
| 2026-08-15 | Phase 8 Task 2A 完整配额补跑 | 经 `index:articles:integration -- --mode=full` 在隔离库完成：exit 0，68 / 68 indexed、2044 Chunks、failed 0、fatal null、providerRequests 68、retryCount 0；隔离库审计 68 / 68 state 全 Gemini profile、declared / actual 一致、无 stale / 混用 / 空向量；开发库无 `ArticleChunk` / `ArticleIndexState` 表，未污染；production quality-v2：lexical Hit@5 / Recall / MRR 为 0.2 / 0.2 / 0.2，vector 与 hybrid 为 1.0 / 1.0 / 1.0；Vector / Hybrid no-answer accuracy 为 0，各 15 个 false-positive hits；正负距离分布重叠，threshold 保持 `null` 为证据驱动决策 |
| 2026-08-15 | Phase 8 Task 2A 实现 | Clarification Gate 基于 `origin/master@eee795bd` 得出 `READY`；实现 shared Gemini Embedding、独立 pgvector PostgreSQL 16 profile、exact cosine Retrieval、Chunk → Article 聚合、独立 lexical ranking、RRF 与 quality-v2，未接 Tool / Agent；真实 Gemini smoke、Task 1 DB 7 / 7、Retrieval DB 5 / 5 通过且 0 skip；初次 full indexing 受 free-tier 日配额阻塞，后续通过显式 integration 入口与完整配额完成补跑 |
| 2026-08-14 | Admin Enhancement 1 最终收口 | Issue #51 / PR #53；最终验收 head `b31aa0395e`；GPT 技术验收通过，用户明确确认验收并授权转 Ready、合并和关闭 Issue；PR #53 已合入 `master`，merge `159e964cafa081df218284b53f246a0da9edd04e`；Issue #51 Closed / Completed；任务状态 Completed；远程任务分支保留，未执行清理 |
| 2026-08-14 | Admin Enhancement 1 实现 | Clarification Gate `READY`；将单 Run Detail 重构为 Compact Header、三 Lane Duration Overview、Request Boundary、Event / Content Ledger 与分类型 Inspector；自动验证、RUNNING / FAILED 真实 Chromium 交互与安全截图通过；Safe I/O、Tool sequence 区间、resolved model 三项 P2 在 `b31aa03` 修复，最新 Codex Review 未发现主要问题 |
| 2026-08-14 | Phase 8 Task 1 最终收口 | Issue #50 / PR #52；最终 head `32598c738e`；GPT 技术验收通过，用户明确确认验收并授权转 Ready、合并、关闭 Issue 和 docs 收口；PR #52 合入 `master`，merge `76d66abf7af426e2a26f9b5765d1eb7a72382007`；Issue #50 Closed；Task 1 Completed；真实 OpenAI smoke 与真实 pgvector integration / concurrency 未执行，作为历史边界保留 |
| 2026-08-14 | Phase 8 Task 1 实现 | Clarification Gate `READY`；实现 deterministic HTML chunking、canonical source hash、OpenAI-specific EmbeddingProvider baseline、pgvector active index、幂等 CLI、stale fencing 与 advisory lock；Article Indexing 46 / 46、Retrieval 18 / 18、Tools 40 / 40、Tool Loop 52 / 52；68 篇 fixture 生成 2044 Chunks |
| 2026-08-14 | Phase 8 完整任务规划补齐 | 新增阶段 README，并建立 Task 1 Chunking / Embedding、Task 2 Hybrid Retrieval / Tool、Task 3 Grounded Answer / Inspector 的 Planned 文档；同步 tasks 看板、roadmap 与 docs 入口 |
| 2026-08-14 | Phase 8 Task 0 最终收口 | Issue #48 / PR #49；最终 head `79c6f44b45`；merge `4c2f795084e7bccac205509d8c31b56dbe7ccf0b`；GPT 技术验收与用户确认完成；Issue / PR 已关闭 |
| 2026-08-14 | PR #49 验收修复 | 统一生产 Retriever 契约、补齐 Evaluation case 绑定校验；最终 Codex Review 无主要 finding |
| 2026-08-13 | Phase 7 最终收口 | Issue #46 / PR #47；merge `caf3d25b`；Phase 7 Completed；Minimal Compaction 继续 Gated |
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
Task 2B             Next / 未启动
Task 3              Planned
Active Agent Task   无
Minimal Compaction  Gated
```

Phase 8 当前执行顺序：

```text
Task 0  Retrieval Boundary + Offline Evaluation       Completed
  ↓
Task 1  Article Chunking + Embedding Index             Completed
  ↓
Task 2A Vector / Hybrid Retrieval + Evaluation         Completed
  ↓
Task 2B Retrieval Tool + Agent Integration              Next / 未启动
  ↓
Task 3  Grounded Answer + Retrieval Inspector           Planned
```

Task 2A 已建立稳定、版本化且有真实评估证据的 Gemini Vector / Hybrid Retrieval 内部能力。已知质量边界是：Vector / Hybrid 对 answerable query 召回强，但对 no-answer query 会返回近邻候选；正负距离分布重叠，不能依赖简单 threshold 解决拒答。

Task 2B 创建 Issue 前必须明确 Tool Result 的候选语义、no-answer / failure 行为、Observation Budget、低信任 provenance 以及与现有 Article Tools 的职责边界。Task 3 不得提前启动。

## 记录规则

- 只记录已经真实发生的事项；
- 实现、验收、Task 收口、合并与开始下一 Task 是不同动作；
- Planned 不代表 Next 或 Active；
- 当前没有 Active Agent Task；下一步只讨论 Task 2B，未创建 Issue 和 Gate `READY` 前不得实现。