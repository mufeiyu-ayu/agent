# Phase 8：Grounded Retrieval / RAG Baseline

状态：**Active / Task 0-1 Completed / Task 2-3 Planned / 当前无 Active Task**。

本文件是 Phase 8 的阶段总览与任务编排入口。正式实现状态以各 Task 文档、对应 Issue / PR 和 GitHub 实时事实为准。

## 1. 阶段目标

Phase 8 的目标不是堆叠一个“向量数据库 Demo”，而是把现有 Article 关键词查询逐步升级为可评估、可索引、可检索、可引用和可观察的 Grounded Retrieval 能力：

```text
Article Source
  -> deterministic Chunking
  -> Embedding / Index
  -> Lexical + Vector Retrieval
  -> Hybrid Ranking
  -> Context-safe Observation
  -> Grounded Answer + Citation
  -> Retrieval Inspector / Evaluation
```

阶段结束后，系统应能够回答：

- 检索的数据来自哪里；
- 为什么返回这些结果；
- 与 lexical baseline 相比是否有可验证提升；
- 哪些 Chunk 真正进入模型上下文；
- 最终回答引用了哪些来源；
- 检索失败、低召回或上下文裁剪发生在哪里。

## 2. 当前基线

Phase 7 已完成 Context Boundary、model-aware Budget、Dynamic History、逐轮 Context Governance 与安全 Context Inspector。

### Task 0 已完成：Retrieval Boundary & Offline Evaluation Baseline

- 与 Tool / LLM 解耦的 `ArticleRetriever` Contract；
- 保持现有行为的 Prisma lexical adapter；
- query / language / limit 的单一规范化边界；
- 确定性离线 corpus；
- Recall@K、reciprocal rank、Mean Recall@K 与 MRR；
- 可重复运行的 lexical baseline。

交付：Issue #48 / PR #49 / merge `4c2f7950`。

### Task 1 已完成：Article Chunking & Embedding Index

- Cheerio canonical structural block stream；
- `cl100k_base` 确定性 Chunking，固定 `600 / 800 / 80` profile；
- D-09 canonical `sourceHash`、stable Chunk identity 与版本化 hash；
- 独立 OpenAI `EmbeddingProvider`，固定 `text-embedding-3-small / 1536`；
- PostgreSQL `ArticleChunk`、`ArticleIndexState` 与 pgvector `vector(1536)` migration；
- incremental / full 幂等 CLI；
- advisory lock、stale fencing、原子替换、Abort 与脱敏 summary。

交付：Issue #50 / PR #52 / merge `76d66abf`。

已接受边界：真实 OpenAI smoke 与真实 pgvector integration/concurrency 未执行；在 Task 2 依赖真实 Vector Retrieval 结果前，或第一次真实执行 indexing 前，必须补充该环境证据。

## 3. Task 看板

| Task | 状态 | 核心目标 | 文档 |
| --- | --- | --- | --- |
| Task 0：Retrieval Boundary & Offline Evaluation Baseline | **Completed** | 解耦 Retrieval 与 Tool，固化 Prisma lexical 行为和离线评估基线 | [Task 0](./task-00-retrieval-boundary-evaluation.md) |
| Task 1：Article Chunking & Embedding Index | **Completed** | 建立确定性 Chunk、稳定身份、Embedding 边界与幂等索引 | [Task 1](./task-01-article-chunking-embedding-index.md) |
| Task 2：Hybrid Retrieval & Agent Tool Integration | **Planned** | 实现 vector + lexical 检索、融合排序、同基线评估与受控 Tool 接入 | [Task 2](./task-02-hybrid-retrieval-tool.md) |
| Task 3：Grounded Answer & Retrieval Inspector | **Planned** | 建立结构化引用、Grounded Answer、Web 来源展示与安全 Retrieval Inspector | [Task 3](./task-03-grounded-answer-retrieval-inspector.md) |

当前没有 Active Agent Task。Task 2-3 只是阶段规划，不代表已经创建 Issue、通过 Clarification Gate 或授权实现。

## 4. 推荐执行顺序

```text
Task 0  Retrieval Boundary + Evaluation Baseline       Completed
  ↓
Task 1  Chunking + Embedding Index                     Completed
  ↓
Task 2  Hybrid Retrieval + Tool Integration            Planned
  ↓
Task 3  Grounded Answer + Citation + Inspector         Planned
```

不能跳过 Task 2 的检索质量与协议稳定工作直接做 Citation UI。每个 Task 必须独立创建 Issue，并在 Clarification Gate `READY` 后才进入实现。

## 5. 阶段不变量

- Retrieval 是内部数据能力，Tool 是 Agent 调用与 Observation 适配边界；两者不能重新耦合成一个大文件；
- Tool / Retrieval 数据始终是低信任 Context，不能升级为 system / developer policy；
- Context Window 是容量上限；检索结果仍须经过 Phase 7 的 Context Budget 与 Observation Governance；
- Chunk、Embedding 和 Index 必须具备稳定版本与幂等重建语义；
- 新策略必须使用版本化 corpus 和明确指标与 lexical baseline 比较；
- Citation 必须追溯到真实 source / chunk，不能由模型自行生成不存在的来源；
- Inspector 只展示安全元数据、来源摘要和决策结果，不暴露完整 Prompt、reasoning、原始 Embedding 或敏感正文；
- 不因为进入 RAG 阶段就自动引入 LangChain、LangGraph、独立 Vector DB 或通用知识库框架。

## 6. 当前明确后置的能力

Phase 8 当前不包含：

- PDF / Office 文件上传与解析；
- 通用企业知识库和多数据源连接器；
- 多租户 ACL、文档权限和跨用户隔离；
- 长期 Memory；
- Agentic query planning、多轮自动检索或复杂 rerank pipeline；
- MCP、Plugin、Skill、Multi-agent；
- 自动 Summary / Compaction；
- 训练或微调 Embedding / rerank 模型。

## 7. Phase 8 完成条件

只有以下条件全部满足，Phase 8 才能标记 Completed：

1. Task 0-3 均完成 GPT 技术验收和用户确认；
2. Article 内容可通过确定性 Chunk 与幂等索引进入 Embedding 存储；
3. Hybrid Retrieval 能在同一版本化评估集上与 lexical baseline 比较；
4. Agent 能消费受控 Retrieval Observation，而不破坏 Tool / Context 不变量；
5. 最终回答能够输出可验证来源，Web 和 Admin 能安全展示检索证据；
6. 关键失败路径、回归测试、评估结果与阶段边界均已归档。

## 8. 当前正式动作

```text
Phase 8：Active
Task 0：Completed
Task 1：Completed / Issue #50 / PR #52 / merge 76d66abf
Task 2-3：Planned
Active Agent Task：无
Minimal Compaction：Gated
```

下一步只讨论 Task 2 的真实索引前置验证、Vector Retrieval、fusion strategy、评估门槛与 Tool 契约；未创建独立 Issue 前不得进入实现。Task 3 与 Minimal Compaction 不得提前启动。
