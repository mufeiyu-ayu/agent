# Phase 8 Task 1：Article Chunking 与 Embedding Index

状态：**Completed / 已归档**。

完成日期：2026-08-14（Asia/Shanghai）。

本文件是 Phase 8 Task 1 的最终归档事实来源。正式需求与澄清以 [Issue #50](https://github.com/mufeiyu-ayu/agent/issues/50) 为准，最终实现与变更以 [PR #52](https://github.com/mufeiyu-ayu/agent/pull/52)、最终代码和 Git 历史为准。

## 1. 任务目标

将现有 `Article` 富 HTML 转换为可重复生成、可追踪版本、可幂等重建的 Chunk 与 Embedding Index，为后续 Vector / Hybrid Retrieval 建立可靠数据基础，而不提前修改 Agent Tool、Runtime 或外部 Chat 协议。

最终数据流：

```text
Article snapshot
  -> canonical structural block stream
  -> deterministic token-aware chunks
  -> EmbeddingProvider（数据库事务外）
  -> commit 前 FOR UPDATE + sourceHash fencing
  -> delete old chunks + insert full replacement + upsert state（单事务）
```

## 2. 最终交付

### Deterministic Chunking

- 使用 `cheerio` 将 Article 富 HTML 规范化为带 block kind、heading path、list / table semantics 的稳定结构块流；
- 使用 `js-tiktoken` 的 `cl100k_base` 进行 token 计数；
- 固定 Chunk profile：

```text
chunkerVersion: article-html-cl100k-v1
targetTokens: 600
hardMaxTokens: 800
overlapTokens: 80
```

- hard max 包含 title / section prefix；
- 超长结构块先按句子边界切分，再使用 Unicode-safe tokenizer fallback；
- 相邻 Chunk overlap 不超过 80 tokens，且不会生成纯 overlap Chunk；
- 空正文生成 0 Chunk，不调用 Embedding Provider。

### Canonical identity 与版本

- 按 D-09 使用 `title + languageCode + canonical normalized structural block stream` 生成 `sourceHash`；
- style、class、无关 wrapper、事件属性和图片 URL 不进入 hash；
- 有效文本、顺序、block semantics、list / table 结构或 heading path 变化会触发重建；
- 使用 SHA-256 生成 `contentHash`、`embeddingInputHash` 和 deterministic Chunk ID；
- Chunk ID 至少绑定 `articleId`、`chunkerVersion`、`embeddingVersion`、`ordinal` 与 `embeddingInputHash`；
- ordinal 固定从 0 连续递增。

### Embedding Provider

- 建立项目内 `EmbeddingProvider` Contract，业务 Indexer 不依赖 OpenAI SDK 类型；
- 固定 active profile：

```text
provider: openai
model: text-embedding-3-small
dimensions: 1536
embeddingVersion: openai:text-embedding-3-small:1536:v1
```

- 独立使用 `EMBEDDING_*` 配置，不读取或回退到 `LLM_*`；
- 普通 API 启动不解析、不要求 Embedding 配置；
- SDK 隐式重试关闭，由项目显式治理 timeout、retry 与 Abort；
- 严格验证 response model、数量、index、顺序、维度与有限数值；partial response 不作为成功；
- 外发数据仅包含 Article title、section path 和规范化纯文本 Chunk。

### PostgreSQL / pgvector Index

- 正式 migration 启用 `vector` extension；
- 新增 `ArticleChunk` 与 `ArticleIndexState`；
- `ArticleChunk.embedding` 使用 `vector(1536)`；
- Vector raw SQL 收敛在专用 Repository；
- 每篇 Article 只保留一个 active index，不保留历史 embedding version；
- Task 1 不创建 HNSW / IVFFlat，不引入独立 Vector DB。

### Indexing CLI 与可靠性

新增显式命令：

```bash
pnpm --filter @agent/api index:articles -- --mode=incremental
pnpm --filter @agent/api index:articles -- --mode=full
pnpm --filter @agent/api index:articles -- --mode=incremental --source-id=24
```

最终行为：

- 非法参数在创建数据库连接或 Provider 前失败；
- 按 `sourceId ASC` keyset 分批读取，Article 级并发固定为 1；
- incremental 对未变化且状态一致的索引安全跳过；
- full 显式强制重建；
- 使用 PostgreSQL session advisory lock 阻止两个 indexing command 并发执行；
- 外部 Embedding 调用不处于数据库事务内；
- 提交前重新读取 Article 并复算 `sourceHash`，变化时记录 stale 且不写入过期结果；
- 每篇 Article 的删除旧 Chunk、写入完整新 Chunk、upsert state 原子提交；
- Provider、协议、数据库、Abort 或重试耗尽均 fail closed；
- CLI 输出脱敏 JSON summary，并用非零 exit code 表达 failed、stale、fatal 或 aborted。

## 3. 验收证据

最终 PR head：`32598c738e2f5d0174ca4654d9f3e42e8a9ffe4f`。

Merge commit：`76d66abf7af426e2a26f9b5765d1eb7a72382007`。

```text
Article Indexing       46 / 46
Retrieval              18 / 18
Tools                  40 / 40
Tool Loop              52 / 52

API build              PASS
API typecheck          PASS
API scoped lint        PASS
Workspace typecheck    PASS
Prisma generate        PASS
Prisma validate        PASS
git diff checks        PASS
```

真实 fixture 确定性审计：

```text
68 Articles
2044 Chunks
max token count: 600
连续运行 digest 一致
```

GPT 已结合 Issue #50、D-09、PR #52 最新 head、核心代码、测试内容和验证记录完成技术验收；用户已明确确认验收并授权转 Ready、合并与任务收口。

## 4. 已接受的验证边界

以下未被记录为 PASS：

- 真实 OpenAI Embedding smoke 未执行；
- `ARTICLE_INDEX_TEST_DATABASE_URL` 未配置，因此真实 pgvector migration、raw vector、transaction rollback、stale concurrency 与 advisory-lock integration suite 实际执行 0 tests。

该缺口在 Task 1 验收时被明确接受为**环境验证边界**，不是已发现的代码缺陷。Task 2 在依赖真实 Vector Retrieval 结果前，或第一次真实执行 Article indexing 前，应在 pgvector-capable PostgreSQL 上运行现有 integration suite，并如实记录结果。

## 5. 非目标

Task 1 未实现：

- Vector Search、Hybrid Retrieval、BM25 / RRF / rerank 与 query rewrite；
- 新 Retrieval Tool、修改 `search_articles`、Agent Tool 接入或 Observation；
- Citation、Grounded Answer、Web source card 或 Retrieval Inspector；
- 队列、cron、自动同步或 Article 写入 hook；
- 历史 embedding version、独立 Vector DB、LangChain / LangGraph；
- Task 2 或 Task 3 的任何实现。

## 6. GitHub 收口

- Issue：[#50](https://github.com/mufeiyu-ayu/agent/issues/50) / Closed（Completed）；
- PR：[#52](https://github.com/mufeiyu-ayu/agent/pull/52) / Merged；
- 最终 head：`32598c738e2f5d0174ca4654d9f3e42e8a9ffe4f`；
- Merge commit：`76d66abf7af426e2a26f9b5765d1eb7a72382007`；
- GPT 技术验收：通过；
- 用户确认验收：已确认；
- 远程任务分支：保留，未执行清理。

## 7. 最终状态

```text
实施状态：已实现
验收状态：已通过
任务状态：Completed
```
