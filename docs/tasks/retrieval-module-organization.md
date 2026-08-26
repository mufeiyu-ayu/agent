# Retrieval 目录边界重组

状态：**已实现、待验收 / Issue #104 / Gate READY**。

## 目标

将 Retrieval 按公共 Contract / Runtime Composition、Retriever 策略、PostgreSQL Persistence 与 Evaluation 分域；只移动实现、测试、CLI 并更新 import，所有 ordered result、SQL、deadline、Abort、strategy 与质量 fixture 保持不变。

## 背景

原 `retrieval/` 根目录平铺 Contract、Runtime、五类 Retriever、PostgreSQL Repository、baseline、evaluation 与测试。生产代码职责稳定，但目录无法表达策略、持久化和评估边界。

本任务是 Backend 模块组织系列第 4 项，也是本轮目录治理最后一项。

## 学习重点

- Contract、Runtime Composition、策略、Persistence 与 Evaluation 的依赖方向。
- 为什么目录重组不能改变 ordered retrieval result。
- 为什么不为旧 import 路径保留转发层。

## 范围

- 根目录保留 `article-retrieval.ts` 与 `hybrid-article-retrieval.runtime.ts`。
- 新建 `retrievers/`，移动 lexical、Prisma、vector、hybrid 与相关测试。
- 新建 `persistence/`，移动 Postgres repository、单测和 DB 集成测试。
- 将 baseline、通用 evaluation、quality-v2 与 CLI 收敛到 `evaluation/`。
- 更新 Tools、Grounding、Smoke、package scripts 与跨模块 import。
- 增加 Retrieval 模块导航。

## 不做什么

- 不修改 normalization、lexical、vector、RRF、候选限制、排序或阈值。
- 不修改 SQL、pgvector、Embedding、deadline、Abort 或连接释放。
- 不修改 strategy name/version、Tool Observation、Evidence、Grounding 或质量 fixture。
- 不新增依赖、兼容转发文件、barrel 或万能 utils。

## Red：锁定失败与回归用例

- [x] Retrieval：重构前 42 / 42 通过。
- [x] Tools 与 Grounding：重构前通过。
- [x] Article Indexing：最近基线 62 / 62 通过。
- [x] DB 集成基线确认受环境阻塞：`127.0.0.1:5433` 未启动。

## Green：最小实现

- [x] 建立 `retrievers/` 与 `persistence/`，移动实现和测试。
- [x] baseline / evaluation / CLI 归入 `evaluation/`。
- [x] 更新 Runtime、Tools、Grounding、Smoke 与 package scripts import。
- [x] 保留 Contract / Runtime Composition 根入口。

## Refactor：整理边界

- [x] 删除旧路径，不保留转发文件或 barrel。
- [x] 测试与被测实现保持同目录。
- [x] 复核 Runtime / Evaluation -> Retrievers -> Contract / Persistence 单向依赖。

## 验证命令

```bash
pnpm --filter @agent/api test:retrieval
pnpm --filter @agent/api test:retrieval-db
pnpm --filter @agent/api test:tools
pnpm --filter @agent/api test:article-indexing
pnpm --filter @agent/api test:grounding
pnpm --filter @agent/api typecheck
pnpm --filter @agent/api lint
pnpm --filter @agent/api build
pnpm typecheck
git diff --check
```

## 验收标准

- [x] AC-01：Contract / Runtime、Retrievers、Persistence、Evaluation 边界清晰。
- [x] AC-02：相同输入的 ordered result 不变。
- [x] AC-03：Postgres SQL、deadline / Abort 与连接释放实现不变。
- [x] AC-04：quality-v2、baseline、CLI 和 Tool 集成路径无回归。
- [x] AC-05：无旧 import、转发文件、循环依赖或行为变化。

## 验证结果

- Retrieval：重构前后均 42 / 42 通过。
- Tools：86 / 86 通过。
- Article Indexing：62 / 62 通过。
- Grounding：171 / 171 通过。
- Retrieval baseline CLI：8 cases，Mean Recall@K / MRR 均为 0.875，zero-hit 1，结果不变。
- API lint、API build、API typecheck、workspace typecheck、`git diff --check`：通过。
- Retrieval DB：重构前后均因本机 `127.0.0.1:5433` 未启动而在 suite hook `ECONNREFUSED`；测试已正确加载新路径，未把环境失败写成代码通过。
- 旧源码、package script 与 import 路径：无残留。

## 风险点

| 风险 | 应对 |
| --- | --- |
| import 更新遗漏跨模块消费者 | API typecheck / build、Tools、Grounding 与全仓旧路径检查 |
| 移动中改变策略或 SQL | 文件原样 `git mv`，只修改 import；42 条 unit tests 锁定 ordered result / SQL |
| DB 集成未实跑 | 明确记录重构前后同一环境阻塞，不伪造通过；repository unit tests 继续锁定 SQL、Abort、deadline 与连接归属 |

## GitHub 交付记录

- Issue：[Issue #104](https://github.com/mufeiyu-ayu/agent/issues/104)
- 分支：`codex/issue-104-retrieval-layout`
- PR：[PR #108](https://github.com/mufeiyu-ayu/agent/pull/108)（Draft）
- GPT 验收结论：未提供
- 用户确认：未确认

## 任务状态

- 实施状态：已实现
- 验收状态：待验收
