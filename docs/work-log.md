# 项目工作记录

本文件只记录当前状态与近期关键里程碑。旧阶段细节查看 `docs/tasks/completed/**`、对应 Issue / PR 和 Git 历史。

## 当前快照

| 类型 | 当前记录 | 下一步 |
| --- | --- | --- |
| Agent 主线 | 阶段 1-7 Completed；Phase 8 Active；Task 0-1 Completed；Task 2A Active / Draft #55 / 已实现、待验收；Task 2B-3 Planned | 对 Draft PR #55 进行技术验收 |
| Phase 8 | Task 2A 已建立 Gemini Vector / Hybrid Retrieval；完整配额下隔离 full indexing 2044 Chunks 成功、production quality-v2 三策略指标齐全、正负样本分布支撑 threshold = null；AC-05 / AC-09 / AC-11 按真实证据更新，任务保持已实现、待验收 | `docs/tasks/phase-08-grounded-retrieval/README.md` |
| Minimal Compaction | Gated | 只有真实 Context 压力证据满足触发条件后才讨论 |
| Admin Console | Task 0-3 与 Enhancement 1 Completed；Task 4 Planned | 不自动启动 Auth / RBAC |

## 近期关键记录

| 日期 | 事项 | 结果 |
| --- | --- | --- |
| 2026-08-15 | Phase 8 Task 2A 实现 | Issue #54 / Draft PR #55；Clarification Gate 基于 `origin/master@eee795bd` 得出 `READY`；实现 shared Gemini Embedding、独立 pgvector PostgreSQL 16 profile、exact cosine Retrieval、Chunk -> Article 聚合、独立 lexical ranking、RRF 与 quality-v2，未接 Tool / Agent；真实 Gemini smoke、Task 1 DB 7/7、Retrieval DB 5/5 通过且 0 skip；当时 full indexing 受 free-tier Embed Content 日配额（1000 < 2044 inputs）阻塞以 `embedding_rate_limit` 退出，留存 tool-call 日志与隔离库 539 个 Gemini Chunks 证明连接隔离库，PR 旧验证命令已改为显式 integration 入口；AC-05 FAILED，AC-09 / AC-11 PARTIAL，Task 保持已实现、待验收 |
| 2026-08-15 | Phase 8 Task 2A 完整配额补跑 | Gemini 项目配额足够后，经 `index:articles:integration -- --mode=full` 在同一隔离库补跑：exit 0，68/68 indexed、2044 Chunks、failed 0、fatal null、providerRequests 68、retryCount 0；隔离库审计 68/68 state 全 Gemini profile、declared/actual 一致、无 stale / 混用 / 空向量；开发库无 `ArticleChunk` / `ArticleIndexState` 表未污染；production quality-v2 跑通：lexical hit@5 0.2 / recall 0.2 / MRR 0.2，vector 与 hybrid hit@5 1.0 / recall 1.0 / MRR 1.0；三个 no-answer case 均有 false-positive（vector / hybrid 各 15 hit），no-answer accuracy 0 作为真实失败模式保留；正负样本距离分布重叠（positive 6 条 0.1335~0.2685，negative 23 条 0.1533~0.4885），threshold 保持 null 为证据驱动决策；AC-05 / AC-09 / AC-11 按真实证据更新为 PASS，任务保持已实现、待验收；Codex Review 额度恢复后请求 `@codex review` |
| 2026-08-14 | Admin Enhancement 1 最终收口 | Issue #51 / PR #53；最终验收 head `b31aa0395e`；GPT 技术验收通过，用户明确确认验收并授权转 Ready、合并和关闭 Issue；PR #53 已合入 `master`，merge `159e964cafa081df218284b53f246a0da9edd04e`；Issue #51 Closed / Completed；任务状态 Completed；远程任务分支保留，未执行清理；本任务不启动 Admin Task 4 或 Phase 8 Task 2-3 |
| 2026-08-14 | Admin Enhancement 1 实现 | Clarification Gate `READY`；基于 `master@6af71d3b` 将单 Run Detail 重构为 Compact Header、三 Lane Duration Overview、Request Boundary、Event / Content Ledger 与分类型 Inspector；实际参考只读 DeepSeek Harness `47f943859b`，未复制源码或迁移 Session / raw payload 能力；规定自动验证、RUNNING / FAILED 真实 Chromium 交互与五张安全截图通过，临时 fixture 已清理；GPT 技术验收提出的 Safe I/O、Tool sequence 区间、resolved model 三项 P2 在 `b31aa03` 修复，最新 Codex Review 未发现主要问题 |
| 2026-08-14 | Phase 8 Task 1 最终收口 | Issue #50 / PR #52；最终 head `32598c738e`；GPT 完成独立技术验收，用户明确确认验收并授权转 Ready、合并、关闭 Issue 和 docs 收口；PR #52 合入 `master`，merge `76d66abf7af426e2a26f9b5765d1eb7a72382007`；Issue #50 Closed；Task 1 Completed；真实 OpenAI smoke 与真实 pgvector integration/concurrency 未执行，作为已接受环境验证边界保留记录 |
| 2026-08-14 | Phase 8 Task 1 实现 | Clarification Gate `READY`；实现 deterministic HTML chunking、D-09 canonical source hash、OpenAI EmbeddingProvider、pgvector active index、幂等 CLI、stale fencing 与 advisory lock；Article Indexing 46/46、Retrieval 18/18、Tools 40/40、Tool Loop 52/52；68 篇 fixture 生成 2044 Chunks，最大 600 tokens |
| 2026-08-14 | Phase 8 完整任务规划补齐 | 新增阶段 README，并建立 Task 1 Chunking / Embedding、Task 2 Hybrid Retrieval / Tool、Task 3 Grounded Answer / Inspector 的 Planned 文档；同步 tasks 看板、roadmap 与 docs 入口 |
| 2026-08-14 | Phase 8 Task 0 最终收口 | Issue #48 / PR #49；最终 head `79c6f44b45`；merge `4c2f795084e7bccac205509d8c31b56dbe7ccf0b`；GPT 技术验收与用户确认完成；Issue / PR 已关闭；远程任务分支已由用户删除 |
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
Task 2A             Active / 已实现 / 待验收
Task 2B-3           Planned
Active Agent Task   Task 2A
Minimal Compaction  Gated
```

Phase 8 当前执行顺序：

```text
Task 0  Retrieval Boundary + Offline Evaluation       Completed
  ↓
Task 1  Article Chunking + Embedding Index             Completed
  ↓
Task 2A Vector / Hybrid Retrieval + Evaluation         Active / 已实现 / 待验收
  ↓
Task 2B Retrieval Tool + Agent Integration              Planned
  ↓
Task 3  Grounded Answer + Retrieval Inspector           Planned
```

Task 2A 已实现但尚未验收或 Completed。完整配额下隔离 full indexing（68/68、2044 Chunks、exit 0）、production quality-v2 三策略指标与完整正负样本距离分布已真实补跑完成，threshold 保持 null；no-answer accuracy 0 与正负分布重叠作为真实质量证据保留。Task 2B-3 仍只是阶段级规划，不得自动进入实现。

## 记录规则

- 只记录已经真实发生的事项；
- 实现、验收、Task 收口、合并与开始下一 Task 是不同动作；
- Planned 不代表 Next 或 Active；
- 当前 Active Agent Task 为 Task 2A，下一步对 Draft PR #55 进行技术验收。
