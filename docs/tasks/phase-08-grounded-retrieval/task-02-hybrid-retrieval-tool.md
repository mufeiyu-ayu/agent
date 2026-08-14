# Phase 8 Task 2：Hybrid Retrieval 与 Agent Tool Integration

状态：**Planned / 未启动**。

本文件只记录阶段级规划。Task 2 必须在 Task 1 完成后创建独立 Issue，并基于真实索引、Task 0 baseline 和最新 Runtime 重新定案。

## 目标

在既有 `ArticleRetriever` Boundary 上实现 lexical + vector retrieval、融合排序和受控 Agent Tool 接入，并使用同一版本化 Evaluation Dataset 与 Task 0 lexical baseline 比较。

## 前置条件

- Task 0 的 Retrieval Contract 与 Evaluation Baseline 已完成；
- Task 1 已提供稳定 Chunk、Embedding version 和可重复索引；
- Phase 7 Context Budget 与 Observation Governance 继续作为模型输入安全边界。

## 学习重点

- vector similarity、lexical relevance 与 hybrid ranking 分别解决什么问题；
- score normalization、RRF、top-k、filter 和 threshold 的工程取舍；
- Retriever、Tool、Observation 和 Context Planner 的职责边界；
- 如何用 Recall@K、MRR、zero-hit、延迟和上下文成本比较策略；
- 为什么策略变更必须显式 version，而不能静默替换线上行为。

## 计划范围

- 建立 vector retriever，消费 Task 1 的 active embedding index；
- 建立 lexical + vector 的 hybrid fusion strategy；
- 支持 language、source 和 top-k 等受控过滤；
- 复用 Task 0 的 Evaluation Runner，输出与 lexical baseline 可比较的报告；
- 将检索结果投影为包含 source / chunk identity、摘要和 rank 的安全结果；
- 通过 Tool Boundary 接入 Agent，并继续经过 Tool validation、timeout、Abort 与 Observation Governance；
- 为 ranking、过滤、zero-hit、partial result、deadline 和策略版本建立自动化测试。

## Issue 创建前必须定案

1. vector distance 与检索 SQL / index 方案；
2. fusion 算法：RRF、加权融合或其他最小策略；
3. lexical / vector candidate 数量和最终 top-k；
4. 是否设置最低相关度阈值以及 zero-hit 语义；
5. Tool 接入方式：新增专用 Retrieval Tool，还是在保持兼容条件下演进 `search_articles`；
6. Tool Result 对模型可见的字段、字符预算和 chunk 数量上限；
7. baseline 的最低比较要求，以及质量、成本和延迟如何共同验收。

## 不做什么

- 不实现最终 citation UI 或 Admin Retrieval Inspector；
- 不做 query rewrite、复杂 rerank pipeline 或多轮 Agentic Retrieval；
- 不做通用知识库、多数据源或文档权限；
- 不让 vector score 直接成为模型可执行权限；
- 不自动替换现有 Tool 外部契约；
- 不引入独立 Vector DB，除非 Task 1 的证据证明 PostgreSQL 无法满足需求。

## 预期验收方向

- Hybrid strategy 在固定 dataset 上输出稳定、可复算结果；
- 报告明确列出 strategy / version，并能与 Task 0 lexical baseline 对比；
- language / source filter、top-k、zero-hit 和重复 chunk 均有测试；
- Retrieval Result 不包含完整正文、原始 Embedding 或未受控 payload；
- Tool Call / Result pairing、Abort、deadline 和 Context Budget 不退化；
- 是否提升质量由评估证据判断，不以“接入向量检索”本身作为通过条件。

## 风险点

| 风险 | 当前约束 |
| --- | --- |
| Hybrid 看似复杂但质量无提升 | 必须与同一 lexical baseline 比较 |
| score 不可直接比较 | 在 Issue 中选择明确 fusion 算法，不混用未经校准的原始分数 |
| 检索结果挤占 Context | 限制 top-k、字段投影和 Observation budget |
| Tool 契约被静默破坏 | 任何对外变化必须写入 Issue 并有兼容测试 |
| 评估集过拟合 | 保留固定 baseline，同时允许后续新增版本而不改写旧结果 |

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

Task 2 依赖 Task 1，当前不得启动。