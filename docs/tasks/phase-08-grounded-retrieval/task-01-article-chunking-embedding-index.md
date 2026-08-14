# Phase 8 Task 1：Article Chunking 与 Embedding Index

状态：**Planned / 未启动**。

本文件只记录阶段级规划。正式数据模型、实现范围和验收标准必须在创建独立 Issue 时结合最新 `master` 定案。

## 目标

把现有 `Article` 正文转换为可重复生成、可追踪版本、可幂等重建的 Chunk 与 Embedding Index，为后续 vector / hybrid retrieval 建立可靠数据基础。

## 前置条件

- Task 0 已建立 `ArticleRetriever` Contract 和离线 Evaluation Baseline；
- 当前 Prisma `Article` 是本阶段唯一数据源；
- 项目尚无 Chunk、Embedding、vector column 或索引生命周期。

## 学习重点

- Chunking 是数据建模问题，不是简单字符串截断；
- stable chunk identity、content hash、chunker version 与 embedding version 的关系；
- Embedding provider、索引存储和 Retrieval Contract 的分层；
- 全量重建、增量更新和失败重试的幂等语义。

## 计划范围

- 定义稳定的 Chunk identity 与 source、language、ordinal、content hash、chunker version 元数据；
- 建立确定性文本清理、切分和顺序规则；
- 建立可替换的 Embedding provider boundary；
- 建立批量 index / reindex 入口和成功、失败、跳过统计；
- 定义内容变化后的索引同步与重复执行语义；
- 推荐优先复用 PostgreSQL，并在正式 Issue 中评估 `pgvector`；
- 为 Chunking、hash、index planning 和异常路径建立自动化测试。

## Issue 创建前必须定案

1. Embedding provider、model、dimension 和版本标识；
2. Chunk 目标长度、overlap、HTML 清理和超长块处理；
3. PostgreSQL / pgvector schema、索引类型和 migration 边界；
4. 全量与增量 index 的触发方式；
5. batch size、限流、重试和部分失败语义；
6. Article 更新、语言变化和索引同步方式；
7. 是否保留历史 embedding version。

## 不做什么

- 不实现 vector search、hybrid ranking 或 rerank；
- 不修改 Agent Tool allowlist；
- 不做 citation、Grounded Answer 或 Retrieval Inspector；
- 不做文件上传、通用知识库、多数据源或长期 Memory；
- 不引入 LangChain / LangGraph。

## 预期验收方向

- 相同输入与版本重复执行得到相同 Chunk identity、顺序和文本；
- 内容未变化时不会重复生成 Embedding；
- 内容变化按已确认策略更新索引；
- 部分失败不会被记录为整批成功；
- index 命令可重复运行并输出可核对统计；
- 不改变现有 `search_articles` 外部行为和 Agent Runtime。

## 风险点

| 风险 | 当前约束 |
| --- | --- |
| Chunk 策略过早锁死 | 用真实 Article 样本验证，不追求一次得到通用算法 |
| Embedding 成本和限流 | 依赖 batching、内容 hash、跳过和明确重试边界 |
| Schema 难以演进 | 显式保存 chunker / embedding version |
| 重建产生重复数据 | 使用稳定 identity、唯一约束和幂等写入 |

## GitHub 交付状态

- Issue：未创建
- 分支：未创建
- PR：未创建
- Clarification Gate：未执行

## 任务状态

```text
规划状态：Planned
实施状态：未开始
验收状态：未验收
```

Task 1 未创建正式 Issue，不得进入实现。