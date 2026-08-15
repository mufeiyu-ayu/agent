# Phase 8 Task 2A：Vector / Hybrid Retrieval & Evaluation

状态：**Completed**。

本 Task 是原“Task 2：Hybrid Retrieval & Agent Tool Integration”拆分后的第一部分。它只负责 Embedding Provider 迁移、Vector / Hybrid Retrieval 与可验证 Evaluation，不接入 Agent Tool；Tool / Agent Runtime 集成留给 Task 2B。

## GitHub 交付事实

- Issue：[#54](https://github.com/mufeiyu-ayu/agent/issues/54) / Closed（Completed）
- PR：[#55](https://github.com/mufeiyu-ayu/agent/pull/55) / Merged
- 最终验收 head：`32ff344349aa2116bf14414d90e48c814686531a`
- Merge commit：`3abdcb8afd5626f0b8fda90c98095bf529d165fd`
- Clarification Gate：`READY`（2026-08-15）
- GPT 技术验收：通过
- 用户确认验收：已确认
- 合并授权：已授权并执行

## 最终目标与链路

```text
Article Chunk
  -> Gemini document formatter
  -> shared GeminiEmbeddingProvider
  -> PostgreSQL + pgvector active index

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

最终 active Embedding profile：

```text
provider: google
model: gemini-embedding-2
dimensions: 1536
embeddingVersion: google:gemini-embedding-2:1536:search-result-v1
```

DeepSeek 继续负责 Chat / Agent LLM。Embedding 只读取 `GEMINI_API_KEY`，不回退到 `LLM_*` 或旧 `EMBEDDING_API_KEY`。

## 最终实现

### 1. Shared Gemini Embedding Boundary

- Indexing 与 Query Retrieval 共用同一 `EmbeddingProvider`、active profile、formatter 和 Gemini adapter；
- Query formatter：`task: search result | query: {normalized query}`；
- Document formatter：`title: {article title} | text: {section path + normalized chunk text}`；
- 不使用 `taskType`；每个 Query / Chunk 各自产生一条独立向量；
- 固定 `outputDimensionality = 1536`；
- 校验 cardinality、顺序、维度、有限数值和非零向量；
- 显式治理 timeout、retry、Abort、错误分类和脱敏；
- 真实 smoke 不输出 Key、输入、raw embedding 或 Provider payload。

### 2. 隔离 pgvector 环境与索引

- PostgreSQL 16 + `pgvector/pgvector:0.8.6-pg16-bookworm`；
- 独立 container、端口 `127.0.0.1:5433`、database 和 named volume；
- 普通 `index:articles` 只读取 `DATABASE_URL`；
- 隔离入口 `index:articles:integration` 只读取 `ARTICLE_INDEX_TEST_DATABASE_URL`；
- Integration URL 缺失、回退或与开发 URL 相同时 fail closed；
- 不删除、reset、覆盖或挂载现有 `postgres-data`；
- 旧 OpenAI profile 与 Gemini profile 通过 `embeddingVersion` 显式隔离，不做双读、fallback 或在线迁移。

### 3. Vector / Hybrid Retrieval

- pgvector cosine distance + exact nearest-neighbor search；
- 不创建 HNSW / IVFFlat；
- Vector SQL 只存在于 Retrieval repository boundary；
- 过滤 active profile、chunker / embedding version、language、stale timestamp 和 Chunk count 一致性；
- 固定最多 40 个 Chunk candidates；
- 聚合为最多 10 个唯一 Article，每篇保留最佳一个 evidence chunk；
- evidence 保留真实 `chunkId`、`sectionPath` 与 cosine distance；
- rank 连续且稳定；
- 独立 lexical strategy：title exact > title / slug / seoTitle contains > seoDescription > content；
- `%`、`_`、`\` 按 literal query 处理；
- Hybrid 使用 RRF：`1 / (60 + lexicalRank) + 1 / (60 + vectorRank)`；
- 单通道只累加存在分量，同分按 `sourceId` 稳定排序；
- DB deadline / Abort 通过真实 PostgreSQL integration test 证明 query 终止、连接释放和 pool 后续可复用。

### 4. quality-v2 Evaluation

新增 `article-retrieval-quality-v2`，覆盖：

- exact keyword；
- semantic paraphrase；
- multiple relevant；
- language filter；
- explicit no-answer；
- irrelevant nearest-neighbor；
- duplicate chunks → one Article；
- stable ordering；
- special characters / zero result。

报告包含 Recall@5、Precision@5、MRR、no-answer accuracy、false-positive、zero-hit、Query Embedding / Vector SQL / end-to-end latency、Provider 请求 / 重试计数及正负样本距离分布。

## 真实运行证据

### Gemini smoke

```text
provider: google
model: gemini-embedding-2
vectorCount: 1
dimensions: 1536
norm: 0.9999998165464739
providerRequests: 1
retryCount: 0
elapsedMs: 955
```

### 隔离 Full Indexing

```text
command: index:articles:integration -- --mode=full
exit code: 0
scanned: 68
indexed: 68
skippedUnchanged: 0
skippedEmpty: 0
stale: 0
failed: 0
chunksWritten: 2044
providerRequests: 68
retryCount: 0
aborted: false
fatal: null
errors: []
```

最终只读审计：

- `ArticleIndexState`：68 / 68，全部为当前 Gemini profile；
- `ArticleChunk`：2044，全部为 `google / gemini-embedding-2 / 1536 / search-result-v1`；
- declared / actual Chunk count 不一致：0；
- 无 stale、无 OpenAI 混入、无空 / 零维向量、无 ordinal 断档；
- 开发库不存在 `ArticleChunk` / `ArticleIndexState` 表，未被本次隔离索引污染。

### production quality-v2

| Strategy | Hit@5 | Mean Recall@5 | Mean Precision@5 | MRR | No-answer Acc | FP query / hit | Zero-hit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| legacy lexical | 0.2 | 0.2 | 0.04 | 0.2 | 1.0 | 0 / 0 | 7 |
| Gemini vector exact cosine | 1.0 | 1.0 | 0.24 | 1.0 | 0 | 3 / 15 | 0 |
| hybrid RRF | 1.0 | 1.0 | 0.24 | 1.0 | 0 | 3 / 15 | 0 |

关键 case-level 事实：

- exact keyword：三策略均 rank 1 命中 #46；
- semantic paraphrase：只有 vector / hybrid 命中 #25；
- multiple relevant：#49 / #52 均进入 top 5；
- language filter：只返回目标 `zh-cn` #41；
- duplicate chunks：聚合为一个 Article，并保留最佳 evidence；
- 三个 no-answer case 中，legacy lexical 均返回空；vector / hybrid 每个 case 均返回 5 个近邻候选，各产生 15 个 false-positive hits。

### Similarity Threshold 决策

```text
Positive cosine distance：
count 6
min 0.1335
median 0.1556
max 0.2685

Negative cosine distance：
count 23
min 0.1533
median 0.3866
max 0.4885
```

正负分布明显重叠：negative min distance 小于 positive max distance。单一 threshold 无法同时保留正样本召回并拒绝全部负样本，因此最终保持：

```text
similarity threshold = null
```

这是证据驱动的决定，不是遗漏。本 Task 不提交拍脑袋阈值。

## 验收结果

| AC | 结果 | 证据摘要 |
| --- | --- | --- |
| AC-01 | PASS | 独立 pgvector PostgreSQL 16；Task 1 DB 7/7、0 skip |
| AC-02 | PASS | 真实 Gemini smoke：1 × 1536，安全输出 |
| AC-03 | PASS | Shared Provider、active profile、lazy Key config |
| AC-04 | PASS | 版本化 asymmetric formatter 与 cardinality 校验 |
| AC-05 | PASS | 隔离 full indexing：68 / 68、2044 Chunks、exit 0 |
| AC-06 | PASS | exact cosine、filter、Abort / deadline、连接释放；DB 5/5 |
| AC-07 | PASS | unique Article 聚合、最佳 evidence、连续 rank |
| AC-08 | PASS | RRF 加法、`k=60`、单通道与确定性 tie-break |
| AC-09 | PASS | legacy baseline 可重复；三策略 production quality-v2 完整比较 |
| AC-10 | PASS | 指标、no-answer、false-positive、zero-hit 与 latency 完整输出 |
| AC-11 | PASS | 正负分布重叠，证据支持 threshold 保持 `null` |
| AC-12 | PASS | 未接 Tool / Agent；Tools 40/40、Tool Loop 52/52 |
| AC-13 | PASS | build、typecheck、lint、Prisma validate 与受影响测试通过 |

## 已知边界

- Vector / Hybrid 对 answerable query 的语义召回明显高于 lexical baseline；
- Vector / Hybrid 目前会把“最近候选”返回给 no-answer query，不能等价为“已确认存在答案”；
- 正负距离分布重叠，不能靠一个简单 similarity threshold 稳定解决拒答；
- Task 2B 在设计 Retrieval Tool 时必须保留 evidence 为未验证候选的语义，并决定 Agent 如何表达“资料不足”；
- 本 Task 不包含 Tool、Agent Loop、Citation、Grounded Answer、Web / Admin Retrieval Inspector、rerank、Query Rewrite、HyDE 或 Agentic Retrieval。

## 最终任务状态

```text
规划状态：Completed
实施状态：已实现
验收状态：已通过
Issue：#54 Closed
PR：#55 Merged
Merge commit：3abdcb8afd5626f0b8fda90c98095bf529d165fd
```

Task 2A 已完成。Task 2B 进入 `Next`，但尚未创建正式 Issue，也未启动实现。