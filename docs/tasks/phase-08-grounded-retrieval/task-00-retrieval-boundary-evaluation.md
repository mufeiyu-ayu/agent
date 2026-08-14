# Phase 8 Task 0：Retrieval Boundary 与离线 Evaluation Baseline

## 目标

为现有 Article 关键词检索建立与 Tool / LLM 解耦的内部边界，并用无 LLM、无网络、无需真实数据库的版本化 fixture 固化第一份离线评估基线。

## 背景

Issue #48 启动前，`search_articles` 同时负责 Tool 契约、参数规范化、Prisma 查询、结果投影和模型可见文案。后续检索策略无法在不经过 Tool Runtime 的情况下独立测试或比较。

Clarification Gate 于 2026-08-13 判定 `READY`：Issue、`master@cbc20e61bd4f268f7d47d683569b235ea0dbc99e`、当前代码和测试没有阻塞性冲突。

## 学习重点

- Retrieval 是内部数据能力，Tool 是 Agent 调用与 Observation 适配边界，两者不应互相污染。
- 先建立固定 corpus、指标和可复现命令，再讨论任何新的检索策略。
- 建议阅读：`search_articles` → `PrismaArticleRetriever` → `ArticleRetriever`；评估路径从 baseline fixture → evaluator → report。

## 范围

- 建立可按 execution context 类型检查的 Article Retrieval query、ordered hits、total、rank 和 strategy/version 契约。
- 提取现有 Prisma lexical 查询，并保持 Tool 外部行为兼容。
- 建立版本化离线 corpus、fixture adapter、Recall@K / reciprocal rank / Mean Recall@K / MRR 评估器。
- 新增 `test:retrieval` 和 `eval:retrieval-baseline`。

## 不做什么

- 不做 Embedding、pgvector、Vector DB、Chunking、Hybrid Retrieval、BM25、RRF、query rewrite 或 rerank。
- 不新增 Agent Tool、API、contracts、Prisma schema/migration、前端或 Admin UI。
- 不做 citation、通用知识库、文件上传、Memory、Compaction、LangChain/LangGraph 或 Task 1。

## Red：先定义失败用例

- [x] query / language / limit 尚无 Tool 与 Retriever 可共同复用的单一事实来源。
- [x] Prisma lexical 行为尚未由独立 adapter contract 测试保护。
- [x] 尚无 fixture 校验、指标手算、非法 Retriever 结果与确定性输出测试。

## Green：最小实现

- [x] 创建 Article 专属 Retrieval 契约和 `PrismaArticleRetriever`。
- [x] `search_articles` 委托 Retriever，并移除内部 rank 后保持既有输出。
- [x] 创建版本化 fixture adapter、evaluation runner 与稳定 JSON CLI。

## Refactor：整理边界

- [x] query / language / limit 规范化与 excerpt 只保留一个实现。
- [x] 生产 Prisma adapter 显式实现带数据库 context 的统一 `ArticleRetriever` 契约；fixture 继续使用无数据库 context 的同一契约。
- [x] Evaluation 校验 Retriever 回传 query 与当前 normalized case 一致，且 hits 不超过 case limit。
- [x] Retrieval 层不依赖 ToolDefinition、Registry、Tool call ID、LLM role、Prompt、`modelContent` 或 ChatStreamEvent。

## Baseline 结果

```json
{
  "datasetVersion": "article-retrieval-baseline-v1",
  "strategy": "fixture_lexical/1",
  "caseCount": 8,
  "meanRecallAtK": 0.875,
  "mrr": 0.875,
  "zeroHitCount": 1
}
```

该结果只证明 Retrieval contract、评估逻辑和受控 fixture 策略行为，不是 PostgreSQL 性能测试或线上检索质量认证。

## 验证命令

```bash
pnpm --filter @agent/api eval:retrieval-baseline
pnpm --filter @agent/api test:retrieval
pnpm --filter @agent/api test:tools
pnpm --filter @agent/api test:tool-loop
pnpm --filter @agent/api build
pnpm --filter @agent/api typecheck
pnpm --filter @agent/api lint
pnpm typecheck
git diff --check
git diff --cached --check
```

## 验收标准

- [x] Retrieval 契约与 Tool Registry、LLM message、`modelContent` 解耦。
- [x] Prisma lexical 查询、排序、excerpt、Abort 和 deadline 行为保持兼容。
- [x] `search_articles` 模型可见定义、结果和文案保持兼容。
- [x] fixture 校验和 Recall@K、RR、Mean Recall@K、MRR 有手算断言。
- [x] baseline 可离线重复执行并输出稳定 JSON。
- [x] 仍只注册两个 Article Tool，Agent Loop 与外部协议不变。
- [x] 无 schema、migration、API、contracts、前端、依赖或环境变量改动。
- [x] 状态仅记录为已实现、待验收。

## 风险点

| 风险 | 应对 |
| --- | --- |
| 提取后改变 Tool 输出 | 保留既有 Tool 精确断言，并显式去除内部 rank |
| Abort / deadline 退化 | 在 transaction 前、count 后、findMany 后分别复核 signal，透传既有 database deadline |
| fixture 被误当线上认证 | 文档与 PR 明确限定为受控离线 contract baseline |

## GitHub 交付记录

- Issue：[#48](https://github.com/mufeiyu-ayu/agent/issues/48)
- 分支：`codex/issue-48-retrieval-baseline`
- PR：[Draft PR #49](https://github.com/mufeiyu-ayu/agent/pull/49)
- GPT 验收结论：需要修改；findings 已修复，待再次验收
- 用户确认：未确认

## 任务状态

- 实施状态：已实现
- 验收状态：待验收
