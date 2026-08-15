# Phase 8：Grounded Retrieval / RAG Baseline

状态：**Active / Task 0、Task 1、Task 2A、Task 2B Completed / Task 3A Next / Task 3B、3C Planned**。

本文件是 Phase 8 的阶段总览与任务编排入口。正式 Task 状态以各 Task 文档、Issue / PR 和 GitHub 实时事实为准。

## 1. 阶段目标

Phase 8 的目标不是堆叠一个“向量数据库 Demo”，而是建立一条可评估、可索引、可检索、可引用和可观察的 Grounded Retrieval 链路：

```text
Article Source
  -> deterministic Chunking
  -> Embedding / Index
  -> Lexical + Vector Retrieval
  -> Hybrid Ranking
  -> Context-safe Observation
  -> Grounded Answer + Citation
  -> Web Source UI / Retrieval Inspector
```

## 2. Task 看板

| Task | 状态 | 核心目标 | 交付 / 依赖 |
| --- | --- | --- | --- |
| Task 0：Retrieval Boundary & Offline Evaluation Baseline | **Completed** | `ArticleRetriever`、lexical baseline、Recall@K / MRR | #48 / #49 / merge `4c2f7950` |
| Task 1：Article Chunking & Embedding Index | **Completed** | deterministic Chunk、stable identity、pgvector index、CLI | #50 / #52 / merge `76d66abf` |
| Task 2A：Vector / Hybrid Retrieval & Evaluation | **Completed** | Gemini Provider、exact vector、Article aggregation、RRF、quality-v2 | #54 / #55 / merge `3abdcb8a` |
| Task 2B：Retrieval Tool & Agent Integration | **Completed** | `retrieve_article_context@1`、受控 Observation、Agent Loop 集成 | #56 / #57 / merge `4f3ba1c1` |
| Task 3A：Grounded Answer & Citation Backend Contract | **Next / 未启动** | structured finalization、Citation validation、durable Grounding、API / Stream | Issue 未创建 / Gate 未执行 |
| Task 3B：Web Chat Source UI | Planned | 来源卡片、状态、legacy 与浏览器验收 | 依赖 3A |
| Task 3C：Admin Retrieval Inspector | Planned | typed safe Inspector、candidate → citation 审计 | 依赖 3A |

Task 3 不再作为单一 Issue 实现。编排见 [Task 3 总览](./task-03-grounded-answer-retrieval-inspector.md)。

## 3. 已完成能力

### Task 0

- Retrieval 与 Tool / LLM 解耦；
- Prisma lexical adapter；
- deterministic corpus；
- Recall@K、Precision@K、MRR baseline。

### Task 1

```text
Article rich HTML
  -> Cheerio structural blocks
  -> cl100k_base chunks (600 / 800 / 80)
  -> stable sourceHash / chunk identity
  -> PostgreSQL ArticleChunk / ArticleIndexState / vector(1536)
  -> incremental / full idempotent CLI
```

Task 1 当时的真实 OpenAI smoke 与真实 pgvector integration / concurrency 未执行，该历史事实保持不变。

### Task 2A

Active embedding profile：

```text
provider: google
model: gemini-embedding-2
dimensions: 1536
embeddingVersion: google:gemini-embedding-2:1536:search-result-v1
```

最终检索链路：

```text
Gemini Query Embedding
  -> exact cosine Chunk retrieval
  -> Article aggregation
  -> lexical candidates
  -> RRF(k=60)
  -> article-level top-k + best evidence
```

真实收口证据：

- 68 / 68 Article、2044 Chunks full indexing；
- Task 1 DB integration 7 / 7；
- Retrieval DB integration 5 / 5；
- Vector / Hybrid Hit@5、Recall@5、MRR 均为 1.0；
- Vector / Hybrid no-answer accuracy 为 0，各产生 15 个 false-positive hits；
- 正负距离分布重叠，因此 threshold 保持 `null`。

### Task 2B

```text
用户问题
  -> DeepSeek sampling
  -> retrieve_article_context@1
  -> Gemini + lexical + pgvector + RRF
  -> candidate / unverified / untrusted Observation
  -> Phase 7 Context Planner
  -> follow-up sampling
```

已建立：

- 默认 3、最大 5 个来源；
- excerpt 最大 500 字符；
- Observation ceiling 8,000 字符；
- zero-hit 与 Provider / DB failure 分离；
- trusted-provider + low-risk + idempotent Tool policy；
- Tool Call / Result pairing；
- JSON / 大小 / 深度 fail-closed ToolStepSummary；
- 真实 Gemini + 隔离 pgvector Tool smoke。

## 4. Task 3 研究结论

研究与方案定案见：

- [Grounded Answer / Citation 架构研究](../../research/phase-08-grounded-answer-citation-design.md)

核心结论：

- 不解析模型任意 `[1]`；
- evidence-eligible Tool 使用安全 projection；v1 包含 Retrieval 与 Article Detail，Search Articles 保持 discovery-only；
- eligible Tool invocation 建立 Grounding Session；zero-hit、partial failure 与 unavailable 使用服务端派生 availability；
- 通过 finalization structured output 选择本 Run 服务端分配的 opaque citationKey；
- 服务端校验引用身份并原子持久化 Message Grounding；
- `citationIntegrity=validated` 与 `faithfulnessStatus=not_evaluated` 分开；
- v1 使用 message-level citation cards，claim-level offsets 延后；
- `done` 只增加 optional Grounding，不新增 event type；
- Web 和 Admin 分成独立 Task。

## 5. 阶段不变量

- Retrieval 是内部数据能力，Tool 是 Agent 调用与 Observation 边界；
- Indexing 与 Query Embedding 必须使用一致的 provider / model / dimensions / formatter / version；
- Tool / Retrieval 内容始终是低信任 Context；
- candidate 不等于 answer found；
- Citation 必须追溯到本次 Run 的真实 source / optional chunk；
- Citation identity validation 不得冒充 semantic faithfulness；
- UI transcript、model-visible context、durable Grounding、Admin trace 分层；
- Inspector 不暴露完整 Prompt、reasoning、raw embedding 或敏感正文；
- 不因为进入 RAG 阶段自动引入 LangChain、LangGraph、独立 Vector DB 或通用知识库框架。

## 6. 当前明确后置

- claim-level inline citation spans；
- 在线第二模型 judge；
- PDF / Office 文件上传与通用知识库；
- 多租户 ACL、外部连接器；
- Memory、MCP、Multi-agent；
- Agentic query planning、复杂 rerank / query rewrite；
- 自动 Compaction；
- OpenAI / Gemini 双 active provider 或在线向量迁移；
- Admin Auth / RBAC Task 4。

## 7. Phase 8 完成条件

1. Task 0、1、2A、2B、3A、3B、3C 均完成 GPT 技术验收和用户确认；
2. Article 可通过 deterministic Chunk 与 Gemini profile 幂等进入索引；
3. Hybrid Retrieval 在版本化评估集上与 lexical baseline 比较；
4. Agent 消费受控 Retrieval Observation，不破坏 Tool / Context 不变量；
5. evidence-backed answer 使用服务端验证的 durable Citation contract；
6. Web 与 Admin 安全展示同一份 Grounding / Retrieval 事实；
7. zero-hit、weak evidence、conflict、invalid citation、legacy、error、aborted 路径完成测试与归档。

## 8. 当前正式动作

```text
Phase 8：Active
Task 0：Completed
Task 1：Completed
Task 2A：Completed
Task 2B：Completed
Task 3A：Next / Issue 未创建 / Gate 未执行
Task 3B：Planned / 依赖 3A
Task 3C：Planned / 依赖 3A
Active Agent Task：无
Minimal Compaction：Gated
```

下一步只创建并启动 Task 3A。Task 3B、3C、Admin Task 4 与 Minimal Compaction 均不得自动进入实现。
