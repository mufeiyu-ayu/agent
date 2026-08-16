# Phase 8：Grounded Retrieval / RAG Baseline

状态：**Completed / Task 0、1、2A、2B、3A、3B、3C 全部完成**。

本文件是 Phase 8 的阶段总览与最终归档入口。正式 Task 状态以各 Task 文档、Issue / PR 和 GitHub 实时事实为准。

## 1. 阶段目标

Phase 8 建立的不是“向量数据库 Demo”，而是一条可评估、可索引、可检索、可引用、可观察的 Grounded Retrieval 链路：

```text
Article Source
  -> deterministic Chunking
  -> Gemini Embedding / pgvector Index
  -> Lexical + Vector Retrieval
  -> Hybrid RRF Ranking
  -> Context-safe Observation
  -> Grounded Finalization + Citation Validation
  -> durable MessageGroundingV1
  -> Web Source UI
  -> Admin Retrieval Inspector
```

## 2. Task 看板

| Task | 状态 | 核心结果 | GitHub |
| --- | --- | --- | --- |
| Task 0：Retrieval Boundary & Offline Evaluation | **Completed** | `ArticleRetriever`、lexical baseline、Recall@K / MRR | #48 / #49 / `4c2f7950` |
| Task 1：Article Chunking & Embedding Index | **Completed** | deterministic Chunk、stable identity、pgvector index、CLI | #50 / #52 / `76d66abf` |
| Task 2A：Vector / Hybrid Retrieval & Evaluation | **Completed** | Gemini、exact vector、Article aggregation、RRF、quality-v2 | #54 / #55 / `3abdcb8a` |
| Task 2B：Retrieval Tool & Agent Integration | **Completed** | `retrieve_article_context@1`、受控 Observation、Agent Loop | #56 / #57 / `4f3ba1c1` |
| Task 3A：Grounded Answer & Citation Backend | **Completed** | structured finalization、Citation validation、durable Grounding | #58 / #59 / `d6df7ac1` |
| Task 3B：Web Chat Source UI | **Completed** | Grounding 状态、Sources disclosure、Source cards | #60 / #61 / `572ad206` |
| Task 3C：Admin Retrieval Inspector | **Completed** | typed safe audit、finalization、Citation correlation | #62 / #63 / `20f838fb` |

Task 3 拆分与共享不变量见 [Task 3 编排](./task-03-grounded-answer-retrieval-inspector.md)。

## 3. 已完成能力

### Indexing

```text
Article rich HTML
  -> Cheerio structural blocks
  -> cl100k chunks (600 / 800 / 80)
  -> stable sourceHash / chunk identity
  -> PostgreSQL ArticleChunk / ArticleIndexState / vector(1536)
  -> incremental / full idempotent CLI
```

Active profile：

```text
provider: google
model: gemini-embedding-2
dimensions: 1536
embeddingVersion: google:gemini-embedding-2:1536:search-result-v1
```

### Retrieval

```text
Gemini Query Embedding
  -> exact cosine Chunk retrieval
  -> Article aggregation
  -> lexical candidates
  -> RRF(k=60)
  -> article-level top-k + best evidence
```

真实收口证据：68 / 68 Articles、2044 Chunks full indexing；Vector / Hybrid answerable Hit@5、Recall@5、MRR 均为 1.0。

no-answer accuracy 仍为 0，正负距离分布重叠，因此没有伪造一个不可靠 threshold。

### Agent Integration

```text
用户问题
  -> DeepSeek sampling
  -> retrieve_article_context@1
  -> Gemini + lexical + pgvector + RRF
  -> candidate / unverified / untrusted Observation
  -> Phase 7 Context Planner
  -> follow-up sampling
```

已建立 Tool risk、timeout、Observation ceiling、zero-hit / Provider failure 分离、Tool pairing 与 safe `ToolStepSummary`。

### Grounded Answer

```text
evidence-eligible Tool invocation
  -> Grounding Session
  -> RunEvidenceRegistry
  -> hidden draft
  -> submit_grounded_answer@1
  -> server validates citationKey
  -> validated delta replay
  -> atomic Message + Grounding + Steps + Run
```

已建立：

- Retrieval / Article Detail evidence policy；
- opaque Run-scoped citationKey；
- structured finalization 最多 2 attempts；
- server-derived evidence availability；
- durable public citationId；
- `citationIntegrity=validated` 与 `faithfulnessStatus=not_evaluated` 分层；
- Abort、deadline、sampling failure、replay 与事务失败审计。

### Web Source UI

实时与历史 Grounding 共用严格 parser；只有 COMPLETED assistant Message 投影 Grounding。answered、insufficient、conflict、partial、none、unavailable 使用不同产品语义，Source Card 不解析模型引用、不自行拼 URL。

### Admin Retrieval Inspector

```text
Run / Step / MessageGrounding
  -> typed bounded projector
  -> Retrieval Overview / Calls
  -> Grounded Finalization
  -> Citation Ledger / correlation
  -> Event / Retrieval Inspector
```

已完成 ordinary、zero-hit、Tool failure、unclassifiable、legacy、malformed、FAILED、ABORTED 与窄屏验证。

## 4. 最终验证摘要

| Task | 关键证据 |
| --- | --- |
| Task 2A | 68 Articles / 2044 Chunks；Vector / Hybrid Hit@5、Recall@5、MRR = 1.0 |
| Task 2B | Tool / Loop / Context / DB suites 全通过；真实 Retrieval Tool smoke |
| Task 3A | Grounding 168；DB 9；真实 DeepSeek + Gemini answered / insufficient smoke |
| Task 3B | Web node 43；Chromium 9；repeat 27 |
| Task 3C | Admin 136；Grounding 168；DB 17；Chromium 12；repeat 36 |

根 `pnpm lint` 保留既有 Markdown baseline；各 Task 的源码 scoped lint / typecheck / build 均通过。

## 5. 阶段不变量

- Retrieval 是内部数据能力，Tool 是 Agent 调用和 Observation 边界。
- Indexing 与 Query Embedding 使用一致 provider / model / dimensions / formatter / version。
- candidate 不等于 answer found。
- Tool / Retrieval 内容始终是低信任 Context。
- Citation 必须追溯到本 Run 的真实 source / optional chunk。
- Citation identity validation 不冒充 semantic faithfulness。
- UI transcript、model-visible context、durable Grounding、Admin trace 分层。
- Inspector 不暴露 Prompt、reasoning、embedding、SQL、Provider payload、完整正文或 secret。
- 不因为进入 RAG 阶段自动引入 LangChain、LangGraph、独立 Vector DB 或通用知识库框架。

## 6. 已知边界与后置项

- no-answer nearest-neighbor false positives；
- claim-level inline citation spans；
- 在线第二模型 judge；
- PDF / Office 与通用知识库；
- 多租户 ACL、外部连接器；
- Agentic query planning、复杂 rerank / query rewrite；
- Admin Auth / RBAC；
- Durable Recovery；
- Memory、MCP、Multi-agent；
- 自动 Compaction；
- 并行 Tool Call。

这些方向不得因为 Phase 8 完成而自动启动。

## 7. 完成条件核对

1. Task 0、1、2A、2B、3A、3B、3C 均完成 GPT 技术验收和用户确认：**满足**。
2. deterministic Chunk 与 Gemini profile 幂等索引：**满足**。
3. Hybrid Retrieval 有版本化评估：**满足**。
4. Agent 消费受控 Observation 且不破坏 Tool / Context 不变量：**满足**。
5. evidence-backed answer 使用服务端验证的 durable Citation：**满足**。
6. Web 与 Admin 消费同一 Grounding / Retrieval 事实：**满足**。
7. zero-hit、conflict、invalid citation、legacy、error、aborted 路径完成归档：**满足**。

## 8. 当前正式动作

```text
阶段 1-8：Completed
Phase 8：Completed
Active Agent Task：无
Minimal Compaction：Gated
Admin Task 4：Planned
Phase 9：未定案
```

下一步进入不创建 Issue 的 Phase 8 代码阅读、学习复盘与作品集材料整理。完成学习闭环后，再基于真实需求讨论 Phase 9；不得自动推进 Memory、MCP、Multi-agent、Admin Auth / RBAC 或 Durable Recovery。
