# Phase 8：Grounded Retrieval / RAG Baseline

状态：**Active / Task 0、Task 1、Task 2A Completed / Task 2B Next / Task 3 Planned**。

本文件是 Phase 8 的阶段总览与任务编排入口。正式任务状态以各 Task 文档、Issue / PR 和 GitHub 实时事实为准。

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
  -> Retrieval Inspector / Evaluation
```

阶段结束后，系统应能够回答：

- 检索数据来自哪里；
- 为什么返回这些结果；
- 与 lexical baseline 相比是否有可验证提升；
- 哪些 Chunk 真正进入模型上下文；
- 最终回答引用了哪些来源；
- 检索失败、低召回或上下文裁剪发生在哪里。

## 2. 已完成基线

### Task 0：Retrieval Boundary & Offline Evaluation Baseline

已完成：

- 与 Tool / LLM 解耦的 `ArticleRetriever` Contract；
- 保持既有行为的 Prisma lexical adapter；
- query / language / limit 的规范化边界；
- 确定性离线 corpus；
- Recall@K、reciprocal rank、Mean Recall@K 与 MRR；
- 可重复运行的 lexical baseline。

交付：Issue #48 / PR #49 / merge `4c2f795084e7bccac205509d8c31b56dbe7ccf0b`。

### Task 1：Article Chunking & Embedding Index

已完成：

- Cheerio canonical structural block stream；
- `cl100k_base` 确定性 Chunking，固定 `600 / 800 / 80` profile；
- stable `sourceHash`、Chunk identity 与版本化 hash；
- PostgreSQL `ArticleChunk`、`ArticleIndexState` 与 pgvector `vector(1536)` migration；
- incremental / full 幂等 CLI；
- advisory lock、stale fencing、原子替换、Abort 与脱敏 summary。

交付：Issue #50 / PR #52 / merge `76d66abf7af426e2a26f9b5765d1eb7a72382007`。

Task 1 当时建立的是 OpenAI-specific Embedding baseline；真实 OpenAI smoke 与真实 pgvector integration / concurrency 当时未执行。该历史事实保持不变。

### Task 2A：Gemini Embedding + Vector / Hybrid Retrieval

已完成：

```text
Article Chunk
  -> Gemini document formatter
  -> shared GeminiEmbeddingProvider
  -> vector(1536) active index

User Query
  -> Gemini query formatter
  -> shared GeminiEmbeddingProvider
  -> exact cosine vector search
  -> Chunk candidates
  -> Article aggregation
  -> lexical candidates
  -> RRF fusion
  -> article-level top-k
  -> quality-v2 evaluation
```

Active Embedding profile：

```text
provider: google
model: gemini-embedding-2
dimensions: 1536
embeddingVersion: google:gemini-embedding-2:1536:search-result-v1
```

交付：Issue #54 / PR #55 / merge `3abdcb8afd5626f0b8fda90c98095bf529d165fd`。

## 3. Task 看板

| Task | 状态 | 核心目标 | 文档 |
| --- | --- | --- | --- |
| Task 0：Retrieval Boundary & Offline Evaluation Baseline | **Completed** | 解耦 Retrieval 与 Tool，固化 Prisma lexical 行为和离线评估基线 | [Task 0](./task-00-retrieval-boundary-evaluation.md) |
| Task 1：Article Chunking & Embedding Index | **Completed** | 建立确定性 Chunk、稳定身份、Embedding 边界与幂等索引 | [Task 1](./task-01-article-chunking-embedding-index.md) |
| Task 2A：Vector / Hybrid Retrieval & Evaluation | **Completed** | Gemini Provider、真实 pgvector / Gemini smoke、exact vector retrieval、Article aggregation、RRF 与 quality-v2 Evaluation | [Task 2A](./task-02-hybrid-retrieval-tool.md) |
| Task 2B：Retrieval Tool & Agent Integration | **Next / 未启动** | 将稳定 Hybrid Retrieval 通过专用 Tool 接入 Agent，并治理 Observation / Context | [Task 2B](./task-02b-retrieval-tool-agent-integration.md) |
| Task 3：Grounded Answer & Retrieval Inspector | **Planned** | 建立结构化引用、Grounded Answer、Web 来源展示与安全 Retrieval Inspector | [Task 3](./task-03-grounded-answer-retrieval-inspector.md) |

当前没有 Active Agent Task。Task 2B 是下一项正式任务，但尚未创建 Issue，也未执行 Clarification Gate。

## 4. 推荐执行顺序

```text
Task 0   Retrieval Boundary + Evaluation Baseline        Completed
  ↓
Task 1   Chunking + Embedding Index                      Completed
  ↓
Task 2A  Gemini Embedding + Vector / Hybrid Retrieval    Completed
  ↓
Task 2B  Retrieval Tool + Agent Integration              Next / 未启动
  ↓
Task 3   Grounded Answer + Citation + Inspector          Planned
```

原 Task 2 被拆分，是为了避免一个 Issue 同时跨越数据库环境 / Provider / Vector SQL / Ranking / Evaluation 与 Tool / Agent Runtime 两个工程边界。Task 2A 先证明检索能力；Task 2B 才负责 Agent 接入。

## 5. Task 2A 最终基线

### Provider 与索引

- DeepSeek 继续作为 Chat / Agent LLM；
- Embedding 只读取 `GEMINI_API_KEY`，不回退到 `LLM_*` 或旧 `EMBEDDING_API_KEY`；
- Query formatter：`task: search result | query: {normalized query}`；
- Document formatter：`title: {article title} | text: {section path + normalized chunk text}`；
- 不使用 `taskType`；每个 Query / Chunk 分别获得一条独立向量；
- 普通 `index:articles` 只读取 `DATABASE_URL`；
- 隔离 `index:articles:integration` 只读取 `ARTICLE_INDEX_TEST_DATABASE_URL`，缺失、回退或与开发 URL 相同时 fail closed；
- 旧 OpenAI 与 Gemini 向量空间不混查；
- 隔离 full indexing：68 / 68 Article、2044 Chunks、exit 0、failed 0；
- 最终 active index 全部为当前 Gemini profile，开发库未污染。

### Retrieval 与 Evaluation

- PostgreSQL 16 + pgvector 独立 integration 环境；
- cosine + exact search，不创建 HNSW / IVFFlat；
- lexical candidates 10 Articles；
- vector candidates 40 Chunks；
- vector aggregation 最多 10 Articles；
- 每篇 Article 只保留最佳一个 evidence Chunk；
- RRF 常数 60，正式公式使用加法 `+`；
- 保留 legacy Prisma lexical baseline；
- quality-v2 完整比较 lexical / vector / hybrid；
- 正负距离分布重叠，因此 similarity threshold 保持 `null`；
- Task 2A 未接 Tool / Agent。

production quality-v2：

| Strategy | Hit@5 | Recall@5 | Precision@5 | MRR | No-answer Acc | FP query / hit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| legacy lexical | 0.2 | 0.2 | 0.04 | 0.2 | 1.0 | 0 / 0 |
| Gemini vector exact cosine | 1.0 | 1.0 | 0.24 | 1.0 | 0 | 3 / 15 |
| hybrid RRF | 1.0 | 1.0 | 0.24 | 1.0 | 0 | 3 / 15 |

已知边界：Vector / Hybrid 对 answerable query 的语义召回明显增强，但会为 no-answer query 返回近邻候选。正负距离分布重叠，不能依赖一个简单 similarity threshold 稳定解决拒答。

## 6. 阶段不变量

- Retrieval 是内部数据能力，Tool 是 Agent 调用与 Observation 适配边界；
- Chat LLM 与 Embedding Provider 可以来自不同厂商，但 Indexing 与 Query Embedding 必须使用一致的 provider / model / dimensions / input format / version；
- Tool / Retrieval 数据始终是低信任 Context，不能升级为 system / developer policy；
- 检索结果仍须经过 Phase 7 Context Budget 与 Observation Governance；
- Chunk、Embedding 和 Index 必须具备稳定版本与幂等重建语义；
- 新策略必须使用版本化 corpus 和明确指标与 lexical baseline 比较；
- Citation 必须追溯到真实 source / chunk，不能由模型生成不存在的来源；
- Inspector 不暴露完整 Prompt、reasoning、raw Embedding 或敏感正文；
- 不因为进入 RAG 阶段就自动引入 LangChain、LangGraph、独立 Vector DB 或通用知识库框架。

## 7. 当前明确后置的能力

Phase 8 当前不包含：

- PDF / Office 文件上传与解析；
- 通用企业知识库和多数据源连接器；
- 多租户 ACL、文档权限和跨用户隔离；
- 长期 Memory；
- Agentic query planning、多轮自动检索或复杂 rerank pipeline；
- MCP、Plugin、Skill、Multi-agent；
- 自动 Summary / Compaction；
- 训练或微调 Embedding / rerank 模型；
- OpenAI / Gemini 双 active provider、fallback 或在线向量迁移。

## 8. Phase 8 完成条件

只有以下条件全部满足，Phase 8 才能标记 Completed：

1. Task 0、Task 1、Task 2A、Task 2B、Task 3 均完成 GPT 技术验收和用户确认；
2. Article 内容可通过确定性 Chunk 与 Gemini active profile 的幂等索引进入 Embedding 存储；
3. Hybrid Retrieval 能在同一版本化评估集上与 lexical baseline 比较；
4. Agent 能消费受控 Retrieval Observation，而不破坏 Tool / Context 不变量；
5. 最终回答能够输出可验证来源，Web 和 Admin 能安全展示检索证据；
6. 关键失败路径、回归测试、评估结果与阶段边界均已归档。

## 9. 当前正式动作

```text
Phase 8：Active
Task 0：Completed
Task 1：Completed / Issue #50 / PR #52 / merge 76d66abf
Task 2A：Completed / Issue #54 Closed / PR #55 Merged / merge 3abdcb8a
Task 2B：Next / Issue 未创建 / Gate 未执行
Task 3：Planned
Active Agent Task：无
Minimal Compaction：Gated
```

下一步是讨论 Task 2B 的 Tool 契约、no-answer / candidate 语义、Observation 预算和 Agent 接入边界。没有正式 Issue 和 Gate `READY` 前不得实现 Task 2B。