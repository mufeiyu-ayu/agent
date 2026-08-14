# AI SEO Agent 学习路线

本文维护阶段级路线。正式 Task 状态与执行顺序以 [`docs/tasks/README.md`](./tasks/README.md) 为准；Phase 8 的完整编排见 [`docs/tasks/phase-08-grounded-retrieval/README.md`](./tasks/phase-08-grounded-retrieval/README.md)。

## 当前状态

```text
阶段 1-7：Completed
Phase 8：Active / Task 0-1 Completed / Task 2A Active (#54，已实现、待验收) / Task 2B 与 Task 3 Planned
Active Agent Task：Task 2A
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
| Task 1：Article Chunking & Embedding Index | **Completed** | 确定性 Chunk、stable identity、Embedding boundary、pgvector active index 与幂等 CLI | #50 / #52 / merge `76d66abf`；当时 OpenAI profile 未完成真实 smoke |
| Task 2A：Vector / Hybrid Retrieval & Evaluation | **Active / 已实现、待验收** | OpenAI→Gemini Provider 迁移、真实 pgvector / Gemini smoke、Query Embedding、exact vector search、article aggregation、RRF 与 quality-v2 Evaluation | Issue #54 Open；Draft PR #55；Gate READY |
| Task 2B：Retrieval Tool & Agent Integration | **Planned** | 将稳定 Hybrid Retrieval 通过专用 Tool 接入 Agent，并治理 Observation / Context | Task 2A Completed 后再定案并创建 Issue |
| Task 3：Grounded Answer & Retrieval Inspector | **Planned** | 来源引用、Web 来源展示、安全 Inspector 和端到端证据 | Task 2B Completed 后才能启动；必要时在 Issue 前拆分后端与 UI 范围 |

原 Task 2 拆分为 2A / 2B：先把数据库环境、Embedding Provider、Vector Retrieval、Ranking 与 Evaluation做成稳定内部能力，再单独处理 Tool / Agent Runtime 集成，避免一个 Issue 跨越两个不同工程边界。

### Task 1 已建立的历史索引基线

```text
Article rich HTML
  -> Cheerio canonical structural blocks
  -> cl100k_base chunks (600 / 800 / 80)
  -> stable sourceHash / chunk IDs / versions
  -> OpenAI-specific EmbeddingProvider baseline (1536 dimensions)
  -> PostgreSQL pgvector active index
  -> incremental / full CLI
  -> stale fencing + advisory lock + atomic replacement
```

Task 1 的真实 OpenAI smoke 与真实 pgvector integration / concurrency 未执行。该历史事实保持不变，不能将未发生的验证倒写为 PASS。

### Task 2A 最新 active Embedding 基线

用户没有 OpenAI API 服务，已创建 Gemini API Key。Task 2A 正式采用：

```text
Chat / Agent LLM：DeepSeek
Embedding Provider：Google
Embedding model：gemini-embedding-2
Dimensions：1536
Embedding version：google:gemini-embedding-2:1536:search-result-v1
```

检索格式：

```text
Document:
  title: {article title} | text: {section path + normalized chunk text}

Query:
  task: search result | query: {normalized query}
```

固定工程边界：

- 只读取 `GEMINI_API_KEY`，不回退到 DeepSeek `LLM_*` 或旧 `EMBEDDING_API_KEY`；
- Gemini Embedding 2 不使用 `taskType`；
- Query / Document formatter 与 provider profile 共同版本化；
- 多个 Chunk 必须各自产生独立向量，不能聚合为一条；
- 旧 OpenAI profile 与 Gemini profile 不可比较或混查；
- 继续复用 `vector(1536)` schema，但必须在隔离 pgvector 环境真实 smoke 并 full reindex；
- Indexing 与 Query Retrieval 共用 shared Provider boundary；
- 普通 API 启动不能因缺少 Gemini Key 而失败。

### Task 2A Retrieval 基线

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

固定第一版参数：

- PostgreSQL 16 + pgvector 独立 integration 环境；
- exact search，不创建 HNSW / IVFFlat；
- lexical candidates 10 articles；
- vector candidates 40 chunks；
- vector aggregation 最多 10 articles；
- final top-k：默认 5、最大 10；
- legacy Prisma lexical baseline 保持不变；
- 不预设 similarity threshold，先看 quality-v2 正负样本分布；
- Task 2A 不接 Tool / Agent。

### Phase 8 完成条件

Phase 8 只有在以下条件全部满足后才能标记 Completed：

1. Task 0、Task 1、Task 2A、Task 2B、Task 3 均完成 GPT 技术验收和用户确认；
2. Article 内容能够通过确定性 Chunk 与 Gemini active profile 的幂等索引进入 Embedding 存储；
3. Hybrid Retrieval 使用同一版本化数据集与 lexical baseline 比较；
4. Agent 消费受控 Retrieval Observation，不破坏 Tool / Context 不变量；
5. 最终回答提供可验证来源，Web 与 Admin 能安全展示检索证据；
6. 关键失败路径、自动测试、评估结果和阶段边界完成归档。

### 当前明确不做

- 文件上传、PDF / Office 解析和通用知识库；
- 多租户文档 ACL 与外部数据源连接器；
- 长期 Memory、MCP、Multi-agent；
- 复杂 Agentic Retrieval、训练模型或自动 Compaction；
- OpenAI / Gemini 双 active provider、fallback 或在线向量迁移；
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
Enhancement 1：Run Trace Workspace   Completed / #51 / #53 / 159e964c
Task 4：登录 / 权限 / 脱敏           Planned
```

Phase 7 已在 Admin Observability 基线上增加 Context Inspector。Enhancement 1 已将单 Run Trace 重构为紧凑 Workspace，并在 `159e964c` 合入 `master`；它不改变 Agent 主线状态。Phase 8 Task 3 计划增加 Retrieval Inspector，但不会自动启动 Admin Task 4。

## 当前正式动作

当前 Active Agent Task 为 Task 2A，状态为：

```text
Task 2A：Active / Draft PR #55 / 已实现 / 待验收
Issue #54：Open
Active Provider：Gemini
Clarification Gate：READY（2026-08-15）
下一步：对 Draft PR #55 进行技术验收
```

shared Gemini Provider、隔离 pgvector、exact cosine Retrieval、article aggregation、独立 lexical strategy、RRF 与 quality-v2 已实现；真实 smoke 和 DB suites 已通过。确定性 corpus 为 2044 Chunks，当前 Gemini free-tier Embed Content 日配额为 1000，因此 full indexing 与 production quality-v2 尚未通过，不能记录为 PASS 或据此设置 threshold。Task 2B、Task 3、Admin Task 4 与 Minimal Compaction 均不得提前实现。
