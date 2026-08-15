# AI SEO Agent 学习路线

本文维护阶段级路线。正式 Task 状态与执行顺序以 [`docs/tasks/README.md`](./tasks/README.md) 为准；Phase 8 的完整编排见 [`docs/tasks/phase-08-grounded-retrieval/README.md`](./tasks/phase-08-grounded-retrieval/README.md)。

## 当前状态

```text
阶段 1-7：Completed
Phase 8：Active / Task 0、Task 1、Task 2A Completed / Task 2B Next / Task 3 Planned
Active Agent Task：无
Minimal Compaction：Gated
Admin Observability：Task 0-3 Completed
Admin Enhancement 1：Completed
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
| [阶段 8：Grounded Retrieval / RAG Baseline](./tasks/phase-08-grounded-retrieval/README.md) | **Active** | Retrieval evaluation、Chunk / Embedding Index、Gemini Vector / Hybrid Retrieval、Agent Tool、Grounded Answer 与 Retrieval Inspector |

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
| Task 2A：Vector / Hybrid Retrieval & Evaluation | **Completed** | OpenAI→Gemini Provider、真实 pgvector / Gemini smoke、exact vector search、Article aggregation、RRF 与 quality-v2 Evaluation | #54 / #55 / merge `3abdcb8a` |
| Task 2B：Retrieval Tool & Agent Integration | **Next / 未启动** | 将稳定 Hybrid Retrieval 通过专用 Tool 接入 Agent，并治理 Observation / Context | 先讨论并创建独立 Issue，再执行 Clarification Gate |
| Task 3：Grounded Answer & Retrieval Inspector | **Planned** | 来源引用、Web 来源展示、安全 Inspector 和端到端证据 | Task 2B Completed 后才能启动；必要时在 Issue 前拆分后端与 UI 范围 |

原 Task 2 拆分为 2A / 2B：先把数据库环境、Embedding Provider、Vector Retrieval、Ranking 与 Evaluation做成稳定内部能力，再单独处理 Tool / Agent Runtime 集成。

### Task 0：Retrieval Boundary

Task 0 已建立：

- `ArticleRetriever` Contract；
- Prisma lexical adapter；
- deterministic corpus；
- Recall@K / MRR baseline；
- 与 Tool / LLM 解耦的 Retrieval Boundary。

### Task 1：Chunking / Index

Task 1 已建立：

```text
Article rich HTML
  -> Cheerio canonical structural blocks
  -> cl100k_base chunks (600 / 800 / 80)
  -> stable sourceHash / chunk IDs / versions
  -> EmbeddingProvider boundary
  -> PostgreSQL pgvector active index
  -> incremental / full CLI
  -> stale fencing + advisory lock + atomic replacement
```

Task 1 当时的真实 OpenAI smoke 与真实 pgvector integration / concurrency 未执行；该历史事实保持不变。

### Task 2A：Gemini Vector / Hybrid Retrieval

Task 2A 最终 active profile：

```text
Chat / Agent LLM：DeepSeek
Embedding Provider：Google
Embedding model：gemini-embedding-2
Dimensions：1536
Embedding version：google:gemini-embedding-2:1536:search-result-v1
```

最终检索链路：

```text
Gemini Query Embedding
  -> exact cosine vector search
  -> Chunk candidates
  -> Article aggregation (1 best evidence chunk / article)
  -> lexical candidates
  -> RRF(k=60, 使用加法 +)
  -> article-level top-k
  -> quality-v2 evaluation
```

真实收口证据：

- Gemini smoke：1 × 1536，0 retry；
- 隔离 full indexing：68 / 68 Article、2044 Chunks、exit 0、failed 0；
- Task 1 DB integration：7 / 7、0 skip；
- Retrieval DB integration：5 / 5、0 skip；
- production quality-v2 完整比较 lexical / vector / hybrid；
- Vector / Hybrid Hit@5、Recall@5、MRR 均为 1.0；
- Vector / Hybrid no-answer accuracy 为 0，各产生 15 个 false-positive hits；
- 正负距离分布重叠，因此 similarity threshold 保持 `null`；
- 未接入 Agent Tool，未启动 Task 2B。

Task 2A 交付：Issue #54 Closed / PR #55 Merged / merge `3abdcb8afd5626f0b8fda90c98095bf529d165fd`。

## Phase 8 完成条件

Phase 8 只有在以下条件全部满足后才能标记 Completed：

1. Task 0、Task 1、Task 2A、Task 2B、Task 3 均完成 GPT 技术验收和用户确认；
2. Article 内容能够通过确定性 Chunk 与 Gemini active profile 的幂等索引进入 Embedding 存储；
3. Hybrid Retrieval 使用同一版本化数据集与 lexical baseline 比较；
4. Agent 消费受控 Retrieval Observation，不破坏 Tool / Context 不变量；
5. 最终回答提供可验证来源，Web 与 Admin 能安全展示检索证据；
6. 关键失败路径、自动测试、评估结果和阶段边界完成归档。

## Task 2B 启动前必须讨论

Task 2B 不能只做“把 Retriever 包成 Tool”。Issue 创建前必须定案：

- Tool 名称、description、输入和安全 Result；
- `search_articles@1`、`get_article_detail` 与新 Retrieval Tool 的职责边界；
- “最近候选”不等于“已确认有答案”的语义；
- no-answer、provider failure、DB timeout、partial result 的 Tool-visible 行为；
- 默认 source 数、单 Chunk excerpt 和总 Observation Budget；
- Retrieval 内容作为低信任 Context 的 envelope / provenance；
- AgentStep / Event 中记录哪些安全 metadata；
- 是否允许 lexical-only / vector-only degraded result；
- 如何避免 Agent 将 false-positive 候选包装成可靠事实。

没有正式 Issue 和 Gate `READY` 前不得实现 Task 2B。

## 当前明确不做

- 文件上传、PDF / Office 解析和通用知识库；
- 多租户文档 ACL 与外部数据源连接器；
- 长期 Memory、MCP、Multi-agent；
- 复杂 Agentic Retrieval、训练模型或自动 Compaction；
- OpenAI / Gemini 双 active provider、fallback 或在线向量迁移；
- 因进入 RAG 阶段就默认引入 LangChain / LangGraph 或独立 Vector DB。

## 已完成阶段归档

| 阶段 | 归档 | 关键 merge |
| --- | --- | --- |
| Phase 6：有界单 Agent Loop | [phase-06-bounded-agent-loop.md](./tasks/completed/phase-06-bounded-agent-loop.md) | `904b011d`、`691efbcd` 等 |
| Phase 7：Context Engineering | [phase-07-context-engineering.md](./tasks/completed/phase-07-context-engineering.md) | Task 0 `415e866a`、Task 1 `6df72f0`、Task 2 `2f06355c`、Task 3 `caf3d25b` |

Phase 7 的 Minimal Compaction 没有进入默认完成条件，当前继续保持 `Gated`。

## Admin Console 支线

```text
Task 0：Admin 基础壳                 Completed
Task 1：静态 Run List / Detail       Completed
Task 2：真实 Run / Step Query API    Completed / #33 / #34 / 997d6b84
Task 3：真实 Run Trace UI            Completed / #35 / #36 / 4c689c4c
Enhancement 1：Run Trace Workspace   Completed / #51 / #53 / 159e964c
Task 4：登录 / 权限 / 脱敏           Planned
```

Phase 8 Task 3 计划增加 Retrieval Inspector，但不会自动启动 Admin Task 4。

## 当前正式动作

```text
Phase 8：Active
Task 0：Completed
Task 1：Completed
Task 2A：Completed / #54 Closed / #55 Merged / merge 3abdcb8a
Task 2B：Next / Issue 未创建 / Gate 未执行
Task 3：Planned
Active Agent Task：无
Minimal Compaction：Gated
```

下一步是讨论 Task 2B 的技术方案和验收标准。Task 2B、Task 3、Admin Task 4 与 Minimal Compaction 均不得自动进入实现。