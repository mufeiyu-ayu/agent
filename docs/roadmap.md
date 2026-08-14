# AI SEO Agent 学习路线

本文维护阶段级路线。正式 Task 状态与执行顺序以 [`docs/tasks/README.md`](./tasks/README.md) 为准；Phase 8 的完整编排见 [`docs/tasks/phase-08-grounded-retrieval/README.md`](./tasks/phase-08-grounded-retrieval/README.md)。

## 当前状态

```text
阶段 1-7：Completed
Phase 8：Active / Task 0-1 Completed / Task 2-3 Planned
Active Agent Task：无
Minimal Compaction：Gated
Admin Observability：Task 0-3 Completed
Admin Task 4：Planned
```

## 阶段路线

| 阶段 | 状态 | 核心能力 |
| --- | --- | --- |
| 阶段 1：LLM + Chat 基础 | Completed | 基础模型问答 |
| 阶段 2：Session Chat 持久化 | Completed | Conversation / Message 持久化 |
| 阶段 3：Streaming Chat | Completed | NDJSON 流式输出、Abort 与终态一致性 |
| 阶段 4：Agent Runtime 基础 | Completed | `AgentRun` / `AgentStep` 与 Runtime Event |
| 阶段 5：最小 Tool Calling | Completed | Tool Call、Observation 与 follow-up sampling |
| [阶段 6：有界单 Agent Loop](./tasks/completed/phase-06-bounded-agent-loop.md) | **Completed** | 多轮顺序决策、执行预算、DeepSeek continuation、DB deadline 与终态可靠性 |
| [阶段 7：Context Engineering](./tasks/completed/phase-07-context-engineering.md) | **Completed** | Context Boundary、model-aware Budget、Dynamic History、Loop Context Governance、Context Inspector |
| [阶段 8：Grounded Retrieval / RAG Baseline](./tasks/phase-08-grounded-retrieval/README.md) | **Active** | Retrieval evaluation、Chunk / Embedding Index、Hybrid Retrieval、Grounded Answer 与 Retrieval Inspector |

## Phase 8：Grounded Retrieval / RAG Baseline

Phase 8 不以“接入向量数据库”为完成标准，而是建立一条可验证的 Grounded Retrieval 链路：

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

### Task 编排

| Task | 状态 | 核心目标 | 启动条件 / 收口事实 |
| --- | --- | --- | --- |
| Task 0：Retrieval Boundary & Offline Evaluation Baseline | **Completed** | 解耦 Retrieval 与 Tool，固化 Prisma lexical 行为和 Recall@K / MRR baseline | #48 / #49 / merge `4c2f7950` |
| Task 1：Article Chunking & Embedding Index | **Completed** | 确定性 Chunk、stable identity、Embedding boundary、pgvector active index 与幂等 CLI | #50 / #52 / merge `76d66abf` |
| Task 2：Hybrid Retrieval & Agent Tool Integration | **Planned** | vector + lexical retrieval、融合排序、同基线评估和 Tool 接入 | 先讨论真实索引前置验证、检索策略、评估门槛和 Tool 契约，再创建 Issue |
| Task 3：Grounded Answer & Retrieval Inspector | **Planned** | 来源引用、Web 来源展示、安全 Inspector 和端到端证据 | Task 2 Completed 后才能启动；必要时在 Issue 前拆分后端与 UI 范围 |

### Task 1 已建立的索引基线

```text
Article rich HTML
  -> Cheerio canonical structural blocks
  -> cl100k_base chunks (600 / 800 / 80)
  -> stable sourceHash / chunk IDs / versions
  -> OpenAI EmbeddingProvider (1536 dimensions)
  -> PostgreSQL pgvector active index
  -> incremental / full CLI
  -> stale fencing + advisory lock + atomic replacement
```

Task 1 的真实 OpenAI smoke 与真实 pgvector integration/concurrency 未执行。该环境验证缺口已在验收时保留记录；在 Task 2 依赖真实 Vector Retrieval 结果前，或第一次真实执行 indexing 前，应运行现有 integration suite。

### Phase 8 完成条件

Phase 8 只有在以下条件全部满足后才能标记 Completed：

1. Task 0-3 均完成 GPT 技术验收和用户确认；
2. Article 内容能够通过确定性 Chunk 与幂等索引进入 Embedding 存储；
3. Hybrid Retrieval 使用同一版本化数据集与 lexical baseline 比较；
4. Agent 消费受控 Retrieval Observation，不破坏 Tool / Context 不变量；
5. 最终回答提供可验证来源，Web 与 Admin 能安全展示检索证据；
6. 关键失败路径、自动测试、评估结果和阶段边界完成归档。

### 当前明确不做

- 文件上传、PDF / Office 解析和通用知识库；
- 多租户文档 ACL 与外部数据源连接器；
- 长期 Memory、MCP、Multi-agent；
- 复杂 Agentic Retrieval、训练模型或自动 Compaction；
- 因为进入 RAG 阶段就默认引入 LangChain / LangGraph 或独立 Vector DB。

## 已完成阶段归档

| 阶段 | 归档 | 关键 merge |
| --- | --- | --- |
| Phase 6：有界单 Agent Loop | [phase-06-bounded-agent-loop.md](./tasks/completed/phase-06-bounded-agent-loop.md) | `904b011d`、`691efbcd` 等 |
| Phase 7：Context Engineering | [phase-07-context-engineering.md](./tasks/completed/phase-07-context-engineering.md) | Task 0 `415e866a`、Task 1 `6df72f0`、Task 2 `2f06355c`、Task 3 `caf3d25b` |

Phase 7 的 Minimal Compaction 没有进入默认完成条件，当前继续保持 `Gated`。只有真实 Inspector 数据证明长期连续性、质量、成本或延迟受到可复现影响时，才另建正式 Task。

## Admin Console 支线

```text
Task 0：Admin 基础壳                 Completed
Task 1：静态 Run List / Detail       Completed
Task 2：真实 Run / Step Query API    Completed / #33 / #34 / 997d6b84
Task 3：真实 Run Trace UI            Completed / #35 / #36 / 4c689c4c
Task 4：登录 / 权限 / 脱敏           Planned
```

Phase 7 已在 Admin Observability 基线上增加 Context Inspector。Phase 8 Task 3 计划增加 Retrieval Inspector，但不会自动启动 Admin Task 4。

## 当前正式动作

当前没有 Active Agent Task。下一步只讨论 Phase 8 Task 2：

- 真实 pgvector migration / transaction / concurrency 前置验证；
- Vector distance、exact search 与是否需要 ANN；
- lexical / vector candidate 数量与 fusion strategy；
- 与 Task 0 lexical baseline 的质量、延迟和成本比较门槛；
- Retrieval Result 与 Agent Tool / Observation / Context Budget 的边界。

讨论定案后，GPT 才创建 Task 2 独立 Issue 和任务专属 Codex 开工 Prompt。Task 3 与 Minimal Compaction 均不得提前实现。
