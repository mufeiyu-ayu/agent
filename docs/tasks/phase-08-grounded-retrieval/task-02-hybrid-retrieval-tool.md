# Phase 8 Task 2A：Vector / Hybrid Retrieval & Evaluation

状态：**Next / Issue #54 Open / 规格已更新 / Gate 待重新执行**。

本 Task 是原“Task 2：Hybrid Retrieval & Agent Tool Integration”拆分后的第一部分，只建立真实 Embedding Provider、Vector / Hybrid Retrieval 与可验证 Evaluation，不接入 Agent Tool。Task 2B 在本 Task Completed 后才能启动。

正式实现规格以 [Issue #54](https://github.com/mufeiyu-ayu/agent/issues/54) 最新正文和澄清与决策记录为准。

## 目标

在 Task 0 的 `ArticleRetriever` / Evaluation Boundary 与 Task 1 的 pgvector index 基础上，将 active Embedding Provider 从未真实执行过的 OpenAI baseline 切换为 Google Gemini，并完成：

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

本 Task 的完成标准不是“SQL 能返回向量结果”，而是建立一条可复现、可比较、可解释的在线检索能力，为 Task 2B 的 Tool / Agent Integration 提供稳定内部契约。

## 当前事实

- Task 0 已建立文章级 `ArticleRetriever` Contract、Prisma lexical adapter 与 `article-retrieval-baseline-v1`；
- 当前 Retrieval Result 要求 `sourceId` 唯一且 rank 连续，因此 Chunk 检索结果必须聚合回 article-level result；
- Task 1 已建立确定性 Chunk、Embedding Provider boundary、`ArticleChunk` / `ArticleIndexState` 与 pgvector migration；
- Task 1 当时固定了 `openai:text-embedding-3-small:1536:v1`，但真实 OpenAI smoke 与真实 pgvector integration / concurrency 均未执行；
- 用户没有 OpenAI API 服务，已创建 Google AI Studio Gemini API Key；
- active profile 已决定切换为 `google:gemini-embedding-2:1536:search-result-v1`，DeepSeek 继续负责 Chat / Agent LLM；
- PostgreSQL 字段仍为 `vector(1536)`，不需要因 provider 切换改变维度 schema；
- 当前默认 `docker-compose.yml` 使用普通 PostgreSQL 16 镜像，本 Task 必须建立隔离的 pgvector-capable integration 环境；
- 当前 `EmbeddingProvider` 和 `.env.example` 仍是 OpenAI-specific，需要在本 Task 正式迁移；
- 当前 Prisma lexical adapter 的稳定排序主要不是 relevance ranking，因此继续作为 legacy baseline；Hybrid lexical candidate ranking 独立定义并版本化。

## 已定技术方案

### 1. pgvector 环境与 Task 1 前置验证

- PostgreSQL 大版本保持 16；
- integration 环境使用明确包含 pgvector 的 PostgreSQL 16 镜像，第一版建议 `pgvector/pgvector:0.8.6-pg16-bookworm`；
- 使用独立 container、端口、database 与全新 named volume；
- `ARTICLE_INDEX_TEST_DATABASE_URL` 不得指向现有开发库；
- 不删除、reset、覆盖或挂载现有 `postgres-data`；
- 本 Task 不迁移原 Alpine 开发数据库；
- 正式实现 Vector Retrieval 前，必须真实运行 Task 1 已存在的 migration / transaction / rollback / advisory lock / stale fencing / concurrency integration suite；
- integration 被 skip、0 tests、加载失败或环境不可用均不能记录为 PASS。

### 2. Active Gemini Embedding Profile

```text
provider: google
model: gemini-embedding-2
dimensions: 1536
embeddingVersion: google:gemini-embedding-2:1536:search-result-v1
```

配置边界：

- 只读取 `GEMINI_API_KEY`；
- 不读取或回退到 `LLM_API_KEY`、`LLM_*` 或旧 `EMBEDDING_API_KEY`；
- 普通 API 启动不得因为缺少 Gemini Key 而失败；
- 只有显式 Embedding smoke、indexing 或真实 retrieval runtime 才解析 Key；
- `.env.example` 改为 Gemini 配置，移除 OpenAI-specific 文案；
- Key、raw embedding、原始 provider payload 和敏感输入不得进入日志、Issue、PR 或测试输出。

### 3. Gemini Query / Document Formatter

`gemini-embedding-2` 的文本检索任务使用官方推荐的 asymmetric prompt format，不使用 `taskType` 参数。

Query：

```text
task: search result | query: {normalized query}
```

Document：

```text
title: {article title} | text: {section path + normalized chunk text}
```

约束：

- Query / Document formatter 集中维护；
- formatter 是 embedding version 的组成部分，任何变化必须升级 version；
- document input 继续包含 Article title、section path 与规范化 Chunk 文本；
- 多个 Chunk 必须得到多条独立向量，不能作为多个 parts 聚合成一条 embedding；
- batch 必须验证返回数量、顺序、维度、有限数值与非零向量；
- `outputDimensionality` 固定 1536；Gemini Embedding 2 会自动归一化该截断维度，运行时不做无依据二次变换，但 smoke / tests 可记录 norm 标量验证。

### 4. 共享 Embedding Boundary 与 Adapter

- Indexing 与 Query Retrieval 共用同一 Provider contract、active profile、formatter 与 Gemini adapter；
- 不新增第二套 Query client；
- 优先使用官方 `@google/genai`，禁止 legacy `@google/generative-ai`；
- 如官方 SDK 无法满足真实 Abort、timeout 或 batch cardinality 契约，可使用官方 Gemini REST API + `fetch`，但必须在 PR 中说明；
- 保留显式 timeout、retry、Abort、response validation、错误分类和脱敏语义；
- SDK 隐式重试不得与项目显式重试叠加；
- Gemini 迁移后若 `openai` dependency 无剩余调用方，应删除；否则说明保留原因；
- provider tests 调整为 provider-neutral contract tests + Gemini adapter tests。

### 5. Provider 迁移与全量重建

- OpenAI 与 Gemini 向量空间不兼容，即使同为 1536 维也不能比较或混查；
- 旧 `openai:text-embedding-3-small:1536:v1` 索引不得被 Gemini Query Retrieval 视为 compatible；
- 通过 `ArticleIndexState.embeddingVersion` 与 `ArticleChunk.embeddingVersion` 显式隔离；
- 真实 Gemini smoke 通过后，在隔离 pgvector 环境执行一次 full indexing；
- full indexing 使用 Gemini document formatter，并输出脱敏 summary；
- 不做 OpenAI / Gemini 双读、fallback、在线迁移或双 active provider。

### 6. Vector Retrieval

- 第一版使用 pgvector cosine distance；
- 第一版使用 exact nearest-neighbor search，不创建 HNSW / IVFFlat；
- query 必须过滤 active index / embeddingVersion，并支持 `languageCode`；
- Vector SQL 只存在于 Retrieval repository boundary；
- raw vector 不进入 Retrieval Result、日志或模型上下文；
- deadline / Abort 必须通过真实 PostgreSQL integration test 证明 query 实际终止、连接释放且 pool 后续仍可用。

### 7. Chunk -> Article 聚合

- Vector Search 最多取 40 个 Chunk candidates；
- 按稳定顺序聚合为最多 10 个 Article candidates；
- 最终每个 `sourceId` 只出现一次；
- 每篇 Article 只保留最佳一个 evidence chunk；
- evidence 保留真实 `chunkId` / `sectionPath`；
- 最终重新生成从 1 连续的 rank。

### 8. Hybrid Fusion

第一版固定采用 Reciprocal Rank Fusion：

```text
RRF score = 1 / (60 + lexicalRank) + 1 / (60 + vectorRank)
```

固定候选规模：

```text
lexical candidates：10 articles
vector candidates：40 chunks
vector aggregation：最多 10 articles
final top-k：normalized retrieval limit，默认 5、最大 10
RRF constant：60
```

- 单通道 Article 只累加存在通道的分量；
- 必须定义 deterministic tie-break；
- 不直接混合 lexical raw score 与 cosine similarity；
- 正式运算符始终为加法 `+`。

### 9. Lexical Candidate Strategy

- 保留 `PrismaArticleRetriever` 作为 legacy baseline，不改既有行为；
- Hybrid 使用独立版本化 lexical candidate strategy；
- 最小优先级：title exact > title / slug / seoTitle contains > seoDescription > content；
- 同级稳定 tie-break；
- `%`、`_`、`\` 按 literal query 处理并有测试；
- 不引入 Elasticsearch、`pg_trgm`、复杂 BM25 或多语言全文搜索系统。

### 10. Evaluation

- 保留 `article-retrieval-baseline-v1`，不得改写旧结果；
- 新增 `article-retrieval-quality-v2`；
- 至少覆盖 exact keyword、semantic paraphrase、multiple relevant、language filter、no-answer、irrelevant nearest-neighbor、duplicate chunk、stable ordering、special characters 与 zero result；
- 至少比较 legacy lexical、Gemini vector exact cosine、hybrid RRF；
- 报告包含 Mean Recall@K、MRR、Precision@K、no-answer / false-positive、zero-hit、query embedding latency、vector SQL latency、end-to-end latency、strategy/version 和 dataset version；
- no-answer 使用显式语义，不继续只依赖虚构 relevant sourceId；
- latency 是运行证据，不作为跨环境 golden correctness 常量。

### 11. Similarity Threshold

- 不预设 `MIN_SIMILARITY`；
- 先观察 quality-v2 正负样本 cosine distance / similarity 分布；
- 只有证据支持稳定边界时才启用并版本化 threshold；
- 证据不足则保持无 threshold 并记录限制。

## 实现范围

- 独立 pgvector PostgreSQL 16 integration 环境；
- Task 1 真实 DB integration / concurrency；
- OpenAI-specific profile 迁移为 Gemini active profile；
- `GEMINI_API_KEY`、Gemini runtime config 与 `.env.example`；
- shared Embedding module、formatter 与 Gemini adapter；
- 真实 Gemini smoke；
- Gemini profile full Article indexing；
- exact cosine vector repository / retriever；
- Chunk -> Article aggregation；
- Hybrid lexical strategy、RRF 与 deterministic ranking；
- quality-v2 dataset、metrics、CLI / tests；
- provider、ranking、filter、zero-hit、no-answer、duplicate、deadline、Abort、strategy/version 自动测试。

## 明确不做

- 不新增或修改 Agent Tool、Tool Registry、Agent Loop、Prompt 或 model-visible Observation；
- 不修改 `search_articles@1` 外部契约；
- 不实现 Citation、Grounded Answer、Web Citation UI 或 Admin Retrieval Inspector；
- 不创建 HNSW / IVFFlat；
- 不做 rerank、Query Rewrite、HyDE 或 Agentic Retrieval；
- 不做文件上传、通用知识库、多租户 ACL、外部数据源；
- 不引入 LangChain / LangGraph 或独立 Vector DB；
- 不切换 DeepSeek Chat / Agent LLM；
- 不实现 OpenAI fallback、双 active provider或旧向量在线迁移；
- 不启动 Task 2B 或 Task 3。

## 预期验收标准

| ID | 可观察行为 | 边界 / 失败行为 | 验证方式 |
| --- | --- | --- | --- |
| AC-01 | 独立 pgvector PostgreSQL 16 环境真实运行 Task 1 DB suite | 不删除旧 volume；skip / 0 tests 不算 PASS | integration evidence |
| AC-02 | `gemini-embedding-2` smoke 返回 1 条合法 1536 维向量 | 不打印 Key、输入、raw vector 或 payload | smoke + adapter tests |
| AC-03 | active profile 为 `google:gemini-embedding-2:1536:search-result-v1`，Indexing 与 Query 共用 Provider | 不回退 `LLM_*` / 旧 Key；普通 API 启动不要求 Gemini Key | config / unit / type tests |
| AC-04 | Query / Document formatter 使用版本化 asymmetric format | 不用 `taskType`；多输入不聚合成一条向量 | formatter / cardinality tests |
| AC-05 | Gemini profile 在隔离 DB 完成 full indexing，旧 OpenAI version 不兼容 | 不混用向量空间；summary 脱敏 | indexing integration |
| AC-06 | exact cosine Retrieval 返回稳定 active Gemini Chunk candidates | version / language / deadline / Abort / connection release 正确 | PostgreSQL integration |
| AC-07 | 多 Chunk 聚合后 sourceId 唯一并保留最佳 evidence | rank 连续、identity 可追溯 | retrieval tests |
| AC-08 | Hybrid 使用版本化 RRF 与确定性 tie-break | 公式使用 `+`，不混合 raw score | ranking tests |
| AC-09 | legacy baseline 保持可重复，quality-v2 比较 lexical / Gemini vector / hybrid | 不改写旧 dataset | eval CLI + assertions |
| AC-10 | quality-v2 包含 Recall@K、MRR、Precision@K、no-answer / false-positive、zero-hit 与 latency | no-answer 显式表达 | evaluator tests |
| AC-11 | threshold 只在证据支持时启用并版本化 | 无证据则保持无 threshold | report + strategy assertions |
| AC-12 | Task 2A 不接 Tool / Agent，外部行为不退化 | `search_articles@1` 兼容；不泄露 embedding | Tool / Loop regression |
| AC-13 | build、typecheck、lint 与受影响测试通过 | 真实失败不得由文档覆盖 | 真实命令结果 |

## GitHub 交付状态

- Issue：[#54](https://github.com/mufeiyu-ayu/agent/issues/54) / Open
- 分支：未创建
- PR：未创建
- Clarification Gate：上一轮 `BLOCKED` 已因 Provider 规格变化失效，需基于 Issue 最新正文重新执行

## 任务状态

```text
规划状态：Next
实施状态：未开始
验收状态：未验收
Clarification Gate：待重新执行
```

Task 2A 是当前下一项正式 Agent Task。只有 Codex 重新读取最新 Issue / docs 并返回 `READY` 后，才进入 `Active` / 实现。