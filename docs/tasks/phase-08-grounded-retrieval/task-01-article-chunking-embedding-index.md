# Phase 8 Task 1：Article Chunking 与 Embedding Index

状态：**Active / 已实现 / 待验收**。

正式规格以 [Issue #50](https://github.com/mufeiyu-ayu/agent/issues/50) 的正文和最新评论为准。2026-08-14 已基于远程 `master@3c45219e5cde145ae3335d51fd2fdb6a90e07d50` 完成 Clarification Gate，结论为 `READY`；该提交仍是远程最新 `master`，与 Issue 建立时基线一致。

## 已实现范围

- 使用 `cheerio` 将 Article 富 HTML 规范化为带 block kind、heading path、list / table semantics 的稳定结构块流；使用 `js-tiktoken` 的 `cl100k_base` 计数。
- 固定 `article-html-cl100k-v1`：target 600、hard max 800、overlap 不超过 80；hard max 包含 title / section prefix。
- 按 D-09 以 `title + languageCode + canonical normalized structural block stream` 生成 `sourceHash`。style、class、无关 wrapper、事件属性和图片 URL 不进入 hash；有效文本、顺序、结构语义或 heading path 变化会重建。
- 使用 SHA-256 生成 `contentHash`、`embeddingInputHash` 和 deterministic chunk ID；ordinal 固定从 0 连续递增。
- 建立项目内 `EmbeddingProvider` 与 OpenAI adapter；固定 `openai / text-embedding-3-small / 1536 / openai:text-embedding-3-small:1536:v1`，SDK 隐式重试关闭，配置仅使用 `EMBEDDING_*`。
- 新增 pgvector 正式 migration、`ArticleChunk`、`ArticleIndexState` 和专用 raw SQL repository；每篇 Article 只保留一个 active index，不创建 ANN index。
- 新增显式 incremental / full CLI；按 `sourceId ASC` keyset 逐篇处理，使用数据库 session advisory lock、commit 前 source hash fencing 和每篇原子替换。
- empty Article 写入 0 chunk state 且不调用 provider；partial response、retry exhaustion、stale、Abort、schema / extension 缺失均 fail closed。

## 固定数据流与边界

```text
Article snapshot
  -> canonical structural block stream
  -> deterministic token-aware chunks
  -> EmbeddingProvider (transaction 外)
  -> commit 前 FOR UPDATE + sourceHash fencing
  -> delete old chunks + insert full replacement + upsert state（单事务）
```

外发数据仅包含 Article title、section path 和规范化纯文本 chunk。本 Task 不修改 `ArticleRetriever`、lexical evaluation、两个 Article Tools、Agent Runtime、Context Planner、Chat / NDJSON、Web 或 Admin。

## 验收证据

| AC | 当前证据 | 状态 |
| --- | --- | --- |
| AC-01 / AC-02 | 手算结构 fixture、真实 `sourceId=44` 富 HTML、D-09、Unicode、entity、oversized、empty、token / overlap / ID snapshot | 自动测试通过 |
| AC-03 | 独立配置、SDK retries=0、batch / timeout / retry 分类、Abort、partial / order / dimension / finite validation | 自动测试通过 |
| AC-04 | Prisma generate、migration / schema review、vector preflight 测试 | migration 已实现；真实 pgvector integration 未验证 |
| AC-05 / AC-06 | incremental 幂等、state/count 修复、full 强制重建、CLI parser | 自动测试通过 |
| AC-07 | provider / validation / DB / Abort failure injection；正式 transaction integration suite 已建立 | 单元测试通过；真实 PostgreSQL transaction 未验证 |
| AC-08 | stale fencing 单元测试与真实并发更新 integration case 已建立 | 单元测试通过；真实 PostgreSQL concurrency 未验证 |
| AC-09 | provider 前 lock fail-fast 单元测试与双 repository advisory-lock integration case 已建立 | 单元测试通过；真实 PostgreSQL concurrency 未验证 |
| AC-10 | empty 0 chunk state、无 provider、重复 incremental skip；DB case 已建立 | 单元测试通过；真实 PostgreSQL integration 未验证 |
| AC-11 | summary、失败 exit 语义、retry / Abort 统计和敏感字段断言 | 自动测试通过 |
| AC-12 | retrieval、tools、tool-loop、build、API / workspace typecheck | 回归通过 |
| AC-13 | Task 1 仅记录“已实现 / 待验收”，Task 2-3 保持 Planned | diff review 通过 |

## 实际验证

```text
PASS  pnpm prisma:generate
PASS  pnpm --filter @agent/api test:article-indexing       46 tests
PASS  articles.json deterministic audit                    68 articles / 2044 chunks / max 600 tokens
NOT VERIFIED  pnpm --filter @agent/api test:article-indexing-db
              ARTICLE_INDEX_TEST_DATABASE_URL 未配置，suite 未执行任何测试；
              当前本地 PostgreSQL 端点不可连接，不能宣称 AC-04/07/08/09/10 的真实 DB 证据通过。
PASS  pnpm --filter @agent/api test:retrieval              18 tests
PASS  pnpm --filter @agent/api test:tools                  40 tests
PASS  pnpm --filter @agent/api test:tool-loop              52 tests
PASS  pnpm --filter @agent/api build
PASS  pnpm --filter @agent/api typecheck
PASS  pnpm --filter @agent/api lint
PASS  pnpm typecheck
PASS  git diff --check
```

真实 OpenAI smoke 未执行：当前未提供 `EMBEDDING_API_KEY`。确定性自动测试使用 fake provider；未发送真实 Article 内容，也未产生 OpenAI 费用。

## 非目标

- Vector Search、Hybrid Retrieval、BM25 / RRF / rerank 和 query rewrite；
- 新 Retrieval Tool、修改 `search_articles`、Tool 接入或 Citation；
- Grounded Answer、Web source card、Retrieval Inspector；
- 队列、cron、自动同步、Article 写入 hook；
- 历史 embedding version、独立 Vector DB、LangChain / LangGraph；
- Task 2 或 Task 3 的任何实现。

## GitHub 交付状态

- Issue：[mufeiyu-ayu/agent#50](https://github.com/mufeiyu-ayu/agent/issues/50)
- Gate：`READY`
- 分支：`codex/issue-50-article-embedding-index`
- PR：待创建 Draft PR

## 任务状态

```text
实施状态：已实现
验收状态：待验收
```

不得自行标记 Completed、转 Ready、合并、关闭 Issue、删除分支或启动 Task 2。
