# Phase 8 Task 2A：Vector / Hybrid Retrieval & Evaluation

状态：**Next / Issue #54 Open / Gate 未执行**。

本 Task 是原“Task 2：Hybrid Retrieval & Agent Tool Integration”拆分后的第一部分，只建立真实 Vector / Hybrid Retrieval 与可验证 Evaluation，不接入 Agent Tool。Task 2B 在本 Task Completed 后才能启动。

## 目标

在 Task 0 的 `ArticleRetriever` / Evaluation Boundary 与 Task 1 的 active pgvector embedding index 之上，完成真实 Query Embedding、exact vector retrieval、article-level aggregation、lexical + vector hybrid fusion，并用版本化质量数据集证明策略行为与边界。

本 Task 的完成标准不是“SQL 能返回向量结果”，而是建立一条可复现、可比较、可解释的在线检索能力，为 Task 2B 的 Tool / Agent Integration 提供稳定内部契约。

## 当前事实

- Task 0 已建立文章级 `ArticleRetriever` Contract、Prisma lexical adapter 与 `article-retrieval-baseline-v1`；
- 当前 Retrieval Result 要求 `sourceId` 唯一且 rank 连续，因此 Chunk 检索结果必须先聚合回 article-level result；
- Task 1 已建立确定性 Chunk、`text-embedding-3-small / 1536` Embedding boundary、`ArticleChunk` / `ArticleIndexState` 与 pgvector migration；
- Task 1 的真实 OpenAI smoke 与真实 pgvector integration / concurrency suite 尚未执行，不能倒写为 PASS；
- 当前默认 `docker-compose.yml` 使用普通 PostgreSQL 16 镜像，本 Task 必须先建立可运行 pgvector 的开发 / 测试环境；
- 当前 `EmbeddingProvider` 位于 article-indexing 模块；Query Retrieval 也需要复用相同 Provider contract，不能再实现第二套 Embedding client；
- 当前 Prisma lexical adapter 的稳定排序主要不是 relevance ranking，因此它继续作为 legacy baseline；Hybrid lexical candidate ranking 必须显式定义并版本化。

## 已定技术方案

### 1. pgvector 环境与 Task 1 前置验证

- PostgreSQL 大版本继续保持 16；
- 将本地 / 测试数据库切换到明确包含 pgvector extension 的 PostgreSQL 16 镜像并固定版本，不自动删除或覆盖已有 volume；
- 正式实现 Vector Retrieval 前，必须真实运行 Task 1 已存在的 migration / transaction / rollback / advisory lock / stale fencing / concurrency integration suite；
- 必须至少执行一次真实 OpenAI Embedding smoke，并记录模型、维度、请求结果和脱敏后的验证证据；
- 真实验证失败属于本 Task 阻塞 / 修复范围，但不得顺手扩展 Task 1 已验收的业务能力。

### 2. Embedding 共享边界

- 将现有 Embedding Provider / OpenAI adapter 提炼为 indexing 与 query retrieval 可共同依赖的共享模块；
- 继续使用 `text-embedding-3-small`、1536 dimensions 和现有 timeout / retry / Abort / response validation 语义；
- 不新增第二套 Query Embedding HTTP client，不静默改变 embedding profile/version。

### 3. Vector Retrieval

- 第一版使用 pgvector cosine distance；
- 第一版使用 exact nearest-neighbor search，不创建 HNSW / IVFFlat ANN index；
- Query 必须过滤 active index / embeddingVersion，并支持现有 `languageCode` 过滤；
- Vector SQL 必须通过专用 repository boundary 承载，不能散落在 Tool 或 Agent Runtime；
- 原始 embedding vector 不进入 Retrieval Result、日志或模型上下文。

### 4. Chunk -> Article 聚合

- Vector Search 首先得到 Chunk-level candidates；
- 同一 Article 在最终 article-level ranking 中只能出现一次；
- 每篇 Article 第一版只保留最佳一个 evidence chunk；
- 最终 Article Result 继续满足 Task 0 的 unique `sourceId` 与 contiguous rank 不变量；
- 内部 evidence 必须保留真实 `chunkId` / `sectionPath`，供后续 Task 2B / Task 3 使用，但不能伪造不存在的来源。

### 5. Hybrid Fusion

第一版固定采用 Reciprocal Rank Fusion（RRF），不直接混合不可比的 lexical raw score 与 cosine similarity：

```text
RRF score = 1 / (60 + lexicalRank) + 1 / (60 + vectorRank)
```

第一版固定候选规模：

```text
lexical candidates：10 articles
vector candidates：40 chunks
vector aggregation：最多 10 articles
final top-k：沿用 normalized retrieval limit，默认 5，最大 10
RRF constant：60
```

如果某 Article 只出现在一条检索通道中，则只累加存在通道的 RRF 分量。

### 6. Lexical candidate strategy

- 保留 `PrismaArticleRetriever` 作为 legacy baseline，不静默改变其既有行为；
- Hybrid 使用独立、版本化 lexical candidate strategy；
- 第一版只做最小确定性字段优先级，不引入 Elasticsearch、独立搜索服务、复杂 BM25、多语言全文分词或 `pg_trgm`；
- 最低优先级原则为：title 强匹配 > title / slug / seoTitle > seoDescription > content；具体 SQL / case expression 可由 Codex 按现有数据库能力实现，但必须有稳定排序测试。

### 7. Evaluation

保留 `article-retrieval-baseline-v1` 不改写，新增版本化质量数据集（建议命名 `article-retrieval-quality-v2`），至少覆盖：

- exact keyword；
- semantic paraphrase / 关键词不重合；
- multiple relevant；
- language filter；
- no-answer / irrelevant nearest-neighbor；
- duplicate chunk -> one article；
- stable ordering；
- special characters / zero result。

比较至少包含：

```text
legacy lexical baseline
vector exact cosine strategy
hybrid RRF strategy
```

报告至少输出：

- Mean Recall@K；
- MRR；
- Precision@K；
- no-answer / false-positive 结果；
- zero-hit；
- query embedding latency；
- vector SQL latency；
- end-to-end retrieval latency；
- strategy name / version 与 dataset version。

当前 evaluator 对 no-answer 使用不存在 sourceId 的方式表达，本 Task 应补齐可显式评估 no-answer 的 fixture / metric 语义。

### 8. Threshold 决策

本 Task 不预设拍脑袋的 `MIN_SIMILARITY`。

先通过 quality dataset 记录正负样本的 cosine distance / similarity 分布；只有数据支持稳定边界时，才在本 Task 内增加并版本化 threshold。若证据不足，则明确保持无 threshold，并记录限制，不虚构一个常量。

## 实现范围

- pgvector-capable PostgreSQL 16 本地 / 测试环境；
- Task 1 真实 DB integration 与真实 Embedding smoke 证据；
- 共享 Embedding module boundary；
- exact cosine vector repository / retriever；
- Chunk -> Article aggregation；
- Hybrid lexical candidate strategy；
- RRF fusion；
- quality-v2 dataset、metrics 与可重复 CLI / tests；
- strategy / version、Abort、deadline、filter、zero-hit、duplicate / stable rank 自动测试；
- 必要 docs 仅记录真实实现与评估结果。

## 明确不做

- 不新增或修改 Agent Tool；
- 不修改 Tool Registry、Agent Loop、Prompt 或 model-visible Observation；
- 不实现 Citation、Grounded Answer、Web Citation UI 或 Admin Retrieval Inspector；
- 不创建 HNSW / IVFFlat；
- 不做 Cross-encoder rerank、Query Rewrite、HyDE、Agentic Retrieval；
- 不做文件上传、通用知识库、多租户 ACL、外部数据源；
- 不引入 LangChain / LangGraph 或独立 Vector DB；
- 不因为本 Task 修改现有 `search_articles@1` 对外契约。

## 预期验收标准

| ID | 可观察行为 | 边界 / 失败行为 | 验证方式 |
| --- | --- | --- | --- |
| AC-01 | pgvector PostgreSQL 16 环境可执行 Task 1 正式 migration 与现有 DB integration suite | 不删除已有数据 volume；integration 不得被 skip 冒充 PASS | integration test + 环境证据 |
| AC-02 | 真实 OpenAI Embedding smoke 返回 1536 维合法向量 | key / vector 不进入日志；provider error 继续受控 | smoke evidence + provider tests |
| AC-03 | Query Embedding 复用共享 Provider boundary | 不出现第二套未经治理 client | unit / type tests |
| AC-04 | exact cosine Vector Retrieval 从 active embedding index 返回稳定 Chunk candidates | 过滤错误版本 / language；支持 Abort / deadline | PostgreSQL integration tests |
| AC-05 | 同一 Article 多 Chunk 最终只产生一个 article-level hit，并保留最佳 evidence chunk | unique sourceId、rank 连续 | retrieval tests |
| AC-06 | Hybrid 使用版本化 RRF strategy，固定 candidate / top-k 规则且结果确定 | 不直接相加 raw lexical / vector scores | ranking fixture tests |
| AC-07 | legacy baseline 保持可重复，quality-v2 可比较 lexical / vector / hybrid | 不改写旧 dataset 结果 | eval CLI + golden assertions |
| AC-08 | quality report 含 Recall@K、MRR、Precision@K、no-answer / false-positive 与 latency 指标 | no-answer 不再只能靠虚构 relevant source 表示 | evaluator tests |
| AC-09 | similarity threshold 只在数据证据支持时启用并版本化 | 无证据则保持无 threshold | report + strategy assertions |
| AC-10 | 本 Task 不接入 Tool / Agent，不暴露 embedding 或完整正文 | Tool Registry / Agent Loop 外部行为保持不变 | regression tests / diff review |

## 学习重点

- Embedding Index 与 Query Embedding 为什么必须使用同一 profile；
- exact vector search、cosine distance、ANN 的差异与何时需要 ANN；
- Chunk-level recall 与 Article-level result 为什么需要聚合；
- RRF 为什么比直接混合异构 raw score 更适合第一版 Hybrid；
- Offline Evaluation 如何防止“接了向量搜索就算 RAG 变好了”的错觉；
- no-answer / false-positive 为什么是语义检索必须单独评估的失败模式。

## GitHub 交付状态

- Issue：#54 / Open
- Issue 地址：https://github.com/mufeiyu-ayu/agent/issues/54
- 分支：未创建
- PR：未创建
- Clarification Gate：未执行

## 任务状态

```text
规划状态：Next
实施状态：未开始
验收状态：未验收
```

Task 2A 是当前下一项正式 Agent Task。Issue 已创建，但只有 Clarification Gate 返回 `READY` 后才能进入 `Active` / 实现。