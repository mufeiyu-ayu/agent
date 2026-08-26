# Article Chunking Facade 与内部模块组织

状态：**Completed / Issue #103 / PR #107**。

## 目标

保留 `article-chunking.ts` 的公共导出路径，把 HTML 结构提取、确定性 Chunk 组装和 cl100k Token 计算拆入单向依赖的内部模块；Chunk、hash、ordinal、overlap、token 与 indexing 行为保持不变。

## 背景

原 `article-chunking.ts` 约 1405 行，同时承担 HTML canonicalization、结构块遍历、Chunk unit 切分、overlap、稳定 ID、Token 缓存和长 BPE piece 处理。算法阶段已经稳定，但目录无法表达职责。

本任务是 Backend 模块组织系列第 3 项；#104 等待本任务收口，不并行启动。

## 学习重点

- Facade 如何稳定外部 import，同时隐藏领域内部实现。
- 如何用 characterization tests 保护确定性算法的纯移动重构。
- 结构提取、Chunk 组装和 Token 计数之间的单向依赖。

## 范围

- 保留 `article-chunking.ts` 作为稳定 Facade。
- 新建 `article-indexing/chunking/`。
- 提取 `structural-blocks.ts`、`deterministic-chunker.ts` 和 `token-counter.ts`。
- 保留现有端到端 Chunking 与 Indexer 测试入口。
- 增加 Article Indexing 模块导航。

## 不做什么

- 不修改 Chunk profile、tokenizer、target / hard max / overlap。
- 不修改 `sourceHash`、`contentHash`、`embeddingInputHash`、Chunk ID 或 ordinal。
- 不修改 ArticleIndexer、数据库、Embedding Provider、CLI、Retrieval 或 fixture。
- 不新增依赖，不替换算法，不增加内部 barrel。

## Red：锁定失败与回归用例

- [x] 重构前 `test:article-indexing` 62 / 62 通过。
- [x] canonical source、Chunk、hash、ID、ordinal、overlap 和 token fixture 已覆盖。
- [x] full / incremental / no-op / stale / partial / abort indexing 行为已覆盖。

## Green：最小实现

- [x] Facade 保留全部已有公共导出。
- [x] HTML canonicalization 与结构遍历移入 `structural-blocks.ts`。
- [x] Chunk unit、overlap、hash 与稳定 ID 移入 `deterministic-chunker.ts`。
- [x] cl100k 计数、缓存与长 BPE piece 移入 `token-counter.ts`。

## Refactor：整理边界

- [x] 保持 Facade -> deterministic -> structural / token 单向依赖。
- [x] 领域外代码不直接 import `chunking/` 内部模块。
- [x] 保留端到端测试从 Facade 验证真实公共契约。

## 验证命令

```bash
pnpm --filter @agent/api test:article-indexing
pnpm --filter @agent/api test:retrieval
pnpm --filter @agent/api typecheck
pnpm --filter @agent/api lint
pnpm --filter @agent/api build
pnpm typecheck
git diff --check
```

## 验收标准

- [x] AC-01：Facade 导出与现有调用方兼容。
- [x] AC-02：相同输入生成完全相同的 canonical source、Chunk、hash、ordinal 和 token 数。
- [x] AC-03：结构提取、Chunk 组装和 Token 计算为单向依赖，无循环 import。
- [x] AC-04：full / incremental indexing 测试无回归。
- [x] AC-05：无 Profile、数据库、Provider、CLI 或 Retrieval 行为变化。

## 验证结果

- Article Indexing：62 / 62 通过（重构前、后结果一致）。
- Retrieval：42 / 42 通过。
- API typecheck、API build、workspace typecheck：通过。
- API lint：通过。
- `git diff --check`：通过。
- 公开导出：原 11 项名称与稳定 import 路径保持不变。
- 依赖方向：Facade -> deterministic -> structural / token，无反向 import。

## 风险点

| 风险 | 应对 |
| --- | --- |
| 纯移动遗漏隐式 helper | TypeScript + 62 条 Article Indexing 回归锁定 |
| 内部模块反向依赖 Facade | 类型与 profile 定义放在拥有它们的内部模块，由 Facade re-export |
| 调用方绕过 Facade | 全仓 import 检查 + 模块 README 约束 |

## GitHub 交付记录

- Issue：[Issue #103](https://github.com/mufeiyu-ayu/agent/issues/103)
- 分支：`codex/issue-103-article-chunking-layout`
- PR：[PR #107](https://github.com/mufeiyu-ayu/agent/pull/107)（验收通过，已授权转 Ready、合并与分支清理）
- GPT 验收结论：通过（基于 head `0db2129e6f`、完整 AC 映射、验证结果与提交前 Codex Review）
- 用户确认：已确认验收并授权 Ready、合并、分支清理和启动 #104

## 任务状态

- 实施状态：已实现
- 验收状态：已通过
