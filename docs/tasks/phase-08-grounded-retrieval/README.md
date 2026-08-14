# Phase 8：Grounded Retrieval / RAG Baseline

状态：**Active / Task 0 Completed / Task 1 Active（已实现、待验收）/ Task 2-3 Planned**。

本文件是 Phase 8 的阶段总览与任务编排入口。正式实现状态仍以各 Task 文档、对应 Issue / PR 和 GitHub 实时事实为准。

## 1. 阶段目标

Phase 8 的目标不是直接堆叠一个“向量数据库 Demo”，而是把现有 Article 关键词查询逐步升级为可评估、可索引、可检索、可引用和可观察的 Grounded Retrieval 能力：

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
- 与现有 lexical baseline 相比是否有可验证提升；
- 哪些 chunk 真正进入模型上下文；
- 最终回答引用了哪些来源；
- 检索失败、低召回或上下文裁剪发生在哪里。

## 2. 当前基线

Phase 7 已完成 Context Boundary、model-aware Budget、Dynamic History、逐轮 Context Governance 与安全 Context Inspector。

Phase 8 Task 0 已完成：

- 与 Tool / LLM 解耦的 `ArticleRetriever` Contract；
- 保持现有行为的 Prisma lexical adapter；
- query / language / limit 的单一规范化边界；
- 确定性离线 corpus；
- Recall@K、reciprocal rank、Mean Recall@K 与 MRR；
- 可重复运行的 lexical baseline。

Task 0 最终交付：Issue #48 / PR #49 / merge `4c2f7950`。

## 3. Task 看板

| Task | 状态 | 核心目标 | 文档 |
| --- | --- | --- | --- |
| Task 0：Retrieval Boundary & Offline Evaluation Baseline | **Completed** | 解耦 Retrieval 与 Tool，固化 Prisma lexical 行为和离线评估基线 | [task-00-retrieval-boundary-evaluation.md](./task-00-retrieval-boundary-evaluation.md) |
| Task 1：Article Chunking & Embedding Index | **Active / 已实现 / 待验收** | 建立确定性 Chunk、稳定身份、Embedding 边界与幂等索引 | [task-01-article-chunking-embedding-index.md](./task-01-article-chunking-embedding-index.md) |
| Task 2：Hybrid Retrieval & Agent Tool Integration | **Planned** | 在同一评估基线上实现 vector + lexical 检索、融合排序与受控 Tool 接入 | [task-02-hybrid-retrieval-tool.md](./task-02-hybrid-retrieval-tool.md) |
| Task 3：Grounded Answer & Retrieval Inspector | **Planned** | 建立结构化来源引用、Grounded Answer、前端来源展示与安全 Retrieval Inspector | [task-03-grounded-answer-retrieval-inspector.md](./task-03-grounded-answer-retrieval-inspector.md) |

Task 1 已由 Issue #50 正式定案，Clarification Gate 为 `READY`，实现已完成并等待验收。Task 2-3 仍只是阶段规划。

## 4. 推荐执行顺序

```text
Task 0  Retrieval Boundary + Evaluation Baseline       Completed
  ↓
Task 1  Chunking + Embedding Index                     Active / 已实现 / 待验收
  ↓
Task 2  Hybrid Retrieval + Tool Integration            Planned
  ↓
Task 3  Grounded Answer + Citation + Inspector         Planned
```

不能跳过 Task 1 直接做 Hybrid Retrieval，也不能在检索策略尚未稳定时先做 citation UI。每个 Task 必须独立创建 Issue，并在 Gate `READY` 后才进入实现。

## 5. 阶段不变量

- Retrieval 是内部数据能力，Tool 是 Agent 调用与 Observation 适配边界；两者不能重新耦合成一个大文件。
- Tool / Retrieval 数据始终是低信任 Context，不能升级为 system / developer policy。
- Context Window 是容量上限；检索结果仍须经过 Phase 7 的 Context Budget 与 Observation Governance。
- Chunk、Embedding 和 Index 必须具备稳定版本与幂等重建语义，不能靠一次性脚本维护未知状态。
- 新策略必须使用版本化 corpus 和明确指标与 lexical baseline 比较，不能仅凭“看起来更智能”验收。
- Citation 必须能追溯到真实 source / chunk，不能让模型自行生成不存在的来源。
- Inspector 只展示安全元数据、来源摘要和决策结果，不暴露完整 Prompt、reasoning、原始 Embedding 或敏感正文。
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

这些能力只有在真实产品需求和前置条件成立后，才进入后续独立阶段或 Task。

## 7. Phase 8 完成条件

只有以下条件全部满足，Phase 8 才能标记 Completed：

1. Task 0-3 均完成 GPT 技术验收和用户确认；
2. Article 内容可通过确定性 Chunk 与幂等索引进入 Embedding 存储；
3. Hybrid Retrieval 能在同一版本化评估集上与 lexical baseline 比较；
4. Agent 能消费受控 Retrieval Observation，而不破坏 Tool / Context 不变量；
5. 最终回答能够输出可验证来源，前端和 Admin 能安全展示检索证据；
6. 关键失败路径、回归测试、评估结果与阶段边界均已归档。

## 8. 当前正式动作

```text
Phase 8：Active
Task 0：Completed
Task 1：Active / 已实现 / 待验收 / Issue #50
Task 2-3：Planned
Active Agent Task：Task 1
Minimal Compaction：Gated
```

下一步是对 Task 1 Draft PR 做技术验收；验收、转 Ready、合并和状态收口仍需分别授权。Task 2、Task 3 与 Minimal Compaction 不得提前启动。
