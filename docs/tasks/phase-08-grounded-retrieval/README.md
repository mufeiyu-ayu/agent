# Phase 8：Grounded Retrieval / RAG Baseline

状态：**Active / Task 0-1 Completed / Task 2A Active（#54，已实现、待验收）/ Task 2B 与 Task 3 Planned**。

本文件是 Phase 8 的阶段总览与任务编排入口。正式实现状态以各 Task 文档、对应 Issue / PR 和 GitHub 实时事实为准。

## 1. 阶段目标

Phase 8 的目标不是堆叠一个“向量数据库 Demo”，而是把现有 Article 关键词查询逐步升级为可评估、可索引、可检索、可引用和可观察的 Grounded Retrieval 能力：

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

- 检索的数据来自哪里；
- 为什么返回这些结果；
- 与 lexical baseline 相比是否有可验证提升；
- 哪些 Chunk 真正进入模型上下文；
- 最终回答引用了哪些来源；
- 检索失败、低召回或上下文裁剪发生在哪里。

## 2. 当前基线

Phase 7 已完成 Context Boundary、model-aware Budget、Dynamic History、逐轮 Context Governance 与安全 Context Inspector。

### Task 0 已完成：Retrieval Boundary & Offline Evaluation Baseline

- 与 Tool / LLM 解耦的 `ArticleRetriever` Contract；
- 保持现有行为的 Prisma lexical adapter；
- query / language / limit 的单一规范化边界；
- 确定性离线 corpus；
- Recall@K、reciprocal rank、Mean Recall@K 与 MRR；
- 可重复运行的 lexical baseline。

交付：Issue #48 / PR #49 / merge `4c2f7950`。

### Task 1 已完成：Article Chunking & Embedding Index

- Cheerio canonical structural block stream；
- `cl100k_base` 确定性 Chunking，固定 `600 / 800 / 80` profile；
- D-09 canonical `sourceHash`、stable Chunk identity 与版本化 hash；
- 当时建立了 OpenAI-specific `EmbeddingProvider` baseline，固定 `text-embedding-3-small / 1536`；
- PostgreSQL `ArticleChunk`、`ArticleIndexState` 与 pgvector `vector(1536)` migration；
- incremental / full 幂等 CLI；
- advisory lock、stale fencing、原子替换、Abort 与脱敏 summary。

交付：Issue #50 / PR #52 / merge `76d66abf`。

Task 1 的真实 OpenAI smoke 与真实 pgvector integration / concurrency 从未执行。该历史事实保持不变，不能倒写成 PASS。

### Task 2A 已更新：Gemini Embedding + Vector / Hybrid Retrieval

用户没有 OpenAI API 服务，已创建 Google AI Studio Gemini API Key。Issue #54 与 Task 2A 文档已正式将 active Embedding Provider 切换为：

```text
provider: google
model: gemini-embedding-2
dimensions: 1536
embeddingVersion: google:gemini-embedding-2:1536:search-result-v1
```

DeepSeek 继续作为 Chat / Agent LLM。Task 2A 不把 DeepSeek Key 用作 Embedding Key，也不保留 OpenAI fallback。

现有 `vector(1536)` schema 可以复用，但旧 OpenAI profile 与新 Gemini profile 属于不同向量空间，必须通过 embeddingVersion 隔离并在隔离 pgvector 环境全量重建。

## 3. Task 看板

| Task | 状态 | 核心目标 | 文档 |
| --- | --- | --- | --- |
| Task 0：Retrieval Boundary & Offline Evaluation Baseline | **Completed** | 解耦 Retrieval 与 Tool，固化 Prisma lexical 行为和离线评估基线 | [Task 0](./task-00-retrieval-boundary-evaluation.md) |
| Task 1：Article Chunking & Embedding Index | **Completed** | 建立确定性 Chunk、稳定身份、Embedding 边界与幂等索引 | [Task 1](./task-01-article-chunking-embedding-index.md) |
| Task 2A：Vector / Hybrid Retrieval & Evaluation | **Active / #54 Open / 已实现、待验收** | OpenAI→Gemini Provider 迁移、真实 pgvector / Gemini smoke、exact vector retrieval、article aggregation、RRF 与 quality-v2 Evaluation | [Task 2A](./task-02-hybrid-retrieval-tool.md) |
| Task 2B：Retrieval Tool & Agent Integration | **Planned** | 将稳定 Hybrid Retrieval 通过专用 Tool 接入 Agent，并治理 Observation / Context | [Task 2B](./task-02b-retrieval-tool-agent-integration.md) |
| Task 3：Grounded Answer & Retrieval Inspector | **Planned** | 建立结构化引用、Grounded Answer、Web 来源展示与安全 Retrieval Inspector | [Task 3](./task-03-grounded-answer-retrieval-inspector.md) |

当前 Active Agent Task 为 Task 2A。Clarification Gate 已于 2026-08-15 基于最新 Issue、docs 与 `origin/master@eee795bd` 得出 `READY`；实现与自动验证已完成，真实 full indexing / production quality-v2 因当前 Gemini free-tier Embed Content 日配额不足仍未通过，等待技术验收。

## 4. 推荐执行顺序

```text
Task 0   Retrieval Boundary + Evaluation Baseline        Completed
  ↓
Task 1   Chunking + Embedding Index                      Completed
  ↓
Task 2A  Gemini Embedding + Vector / Hybrid Retrieval    Active / 已实现 / 待验收
  ↓
Task 2B  Retrieval Tool + Agent Integration              Planned
  ↓
Task 3   Grounded Answer + Citation + Inspector          Planned
```

原 Task 2 被拆分，是为了避免一个 Issue 同时跨越数据库环境 / Provider / Vector SQL / Ranking / Evaluation 与 Tool / Agent Runtime 两个工程边界。Task 2A 先证明检索能力稳定，再由 Task 2B 接入 Agent。

## 5. Task 2A 已定边界

### Provider 与输入格式

- DeepSeek 保持 Chat / Agent LLM；
- Embedding 使用 `GEMINI_API_KEY`，不回退到 `LLM_*` 或旧 `EMBEDDING_API_KEY`；
- active model 为 `gemini-embedding-2`，输出 1536 维；
- Query formatter：`task: search result | query: {normalized query}`；
- Document formatter：`title: {article title} | text: {section path + normalized chunk text}`；
- 不使用 `taskType`；
- 多个 Chunk 必须各自得到独立向量，不能聚合成一条；
- Query / Document formatter 与 provider profile 共同版本化；
- 旧 OpenAI profile 与 Gemini profile 不混查，真实 smoke 后在隔离 DB full reindex。

### Retrieval 与 Evaluation

- PostgreSQL 大版本保持 16，integration 环境必须具备 pgvector extension并与旧开发 volume 隔离；
- Task 1 的真实 DB integration / concurrency 必须先补证据；
- Query Embedding 与 Article Indexing 共用 shared Provider boundary；
- Vector 第一版使用 cosine + exact search，不创建 HNSW / IVFFlat；
- Chunk candidates 聚合为 unique Article hits，每篇只保留最佳一个 evidence chunk；
- Hybrid 使用 RRF，常数 60，正式公式使用加法 `+`；
- lexical candidates 10 articles，vector candidates 40 chunks，vector aggregation 最多 10 articles，最终 top-k 沿用现有 limit（默认 5、最大 10）；
- 保留 legacy Prisma lexical baseline；Hybrid lexical candidate strategy 独立版本化；
- 保留 `article-retrieval-baseline-v1`，新增 quality-v2；
- 不预设 similarity threshold，先观察正负样本分布；
- Task 2A 不新增 / 修改 Agent Tool，不改 Agent Loop。

完整规格见 [Task 2A](./task-02-hybrid-retrieval-tool.md) 与 Issue #54。

## 6. 阶段不变量

- Retrieval 是内部数据能力，Tool 是 Agent 调用与 Observation 适配边界；两者不能重新耦合成一个大文件；
- Chat LLM 与 Embedding Provider 可以来自不同厂商，但 Indexing 与 Query Embedding 必须使用完全一致的 provider / model / dimensions / input format / version；
- Tool / Retrieval 数据始终是低信任 Context，不能升级为 system / developer policy；
- Context Window 是容量上限；检索结果仍须经过 Phase 7 的 Context Budget 与 Observation Governance；
- Chunk、Embedding 和 Index 必须具备稳定版本与幂等重建语义；
- 新策略必须使用版本化 corpus 和明确指标与 lexical baseline 比较；
- Citation 必须追溯到真实 source / chunk，不能由模型自行生成不存在的来源；
- Inspector 只展示安全元数据、来源摘要和决策结果，不暴露完整 Prompt、reasoning、原始 Embedding 或敏感正文；
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
Task 2A：Active / Issue #54 Open / 已实现 / 待验收
Task 2B：Planned
Task 3：Planned
Active Agent Task：Task 2A
Minimal Compaction：Gated
```

下一步为创建 Draft PR 并进行技术验收。Task 2A 当前不能标记 Completed：真实 full indexing 与 production quality-v2 尚受 Gemini free-tier Embed Content 日配额阻塞。Task 2B、Task 3 与 Minimal Compaction 均不得提前启动。
