# AI SEO Agent 学习路线

本文维护阶段级路线。正式 Task 状态与执行顺序以 [`docs/tasks/README.md`](./tasks/README.md) 为准；Phase 8 完整编排见 [`docs/tasks/phase-08-grounded-retrieval/README.md`](./tasks/phase-08-grounded-retrieval/README.md)。

## 当前状态

```text
阶段 1-7：Completed
Phase 8：Active
Task 0、1、2A、2B：Completed
Task 3A：Next
Task 3B、3C：Planned
Active Agent Task：无
Minimal Compaction：Gated
Admin Observability：Task 0-3 + Enhancement 1 Completed
Admin Task 4：Planned
```

## 阶段路线

| 阶段 | 状态 | 核心能力 |
| --- | --- | --- |
| 阶段 1：LLM + Chat 基础 | Completed | 基础模型问答 |
| 阶段 2：Session Chat 持久化 | Completed | Conversation / Message 持久化 |
| 阶段 3：Streaming Chat | Completed | NDJSON、Abort 与终态一致性 |
| 阶段 4：Agent Runtime 基础 | Completed | AgentRun / AgentStep 与 Runtime Event |
| 阶段 5：最小 Tool Calling | Completed | Tool Call、Observation、follow-up sampling |
| [阶段 6：有界单 Agent Loop](./tasks/completed/phase-06-bounded-agent-loop.md) | Completed | bounded loop、DeepSeek continuation、deadline、终态可靠性 |
| [阶段 7：Context Engineering](./tasks/completed/phase-07-context-engineering.md) | Completed | ModelContext、budget、history、observation governance、Context Inspector |
| [阶段 8：Grounded Retrieval / RAG Baseline](./tasks/phase-08-grounded-retrieval/README.md) | **Active** | Evaluation、Chunk / Index、Hybrid Retrieval、Agent Tool、Grounded Answer、Web Sources、Inspector |

## Phase 8 路线

```text
Task 0  Retrieval Boundary + Evaluation               Completed
  ↓
Task 1  Chunking + Embedding Index                     Completed
  ↓
Task 2A Vector / Hybrid Retrieval + Evaluation         Completed
  ↓
Task 2B Retrieval Tool + Agent Integration             Completed
  ↓
Task 3A Grounded Answer + Citation Backend Contract    Next
  ├─> Task 3B Web Chat Source UI                       Planned
  └─> Task 3C Admin Retrieval Inspector                Planned
  ↓
Phase 8 Closeout
```

## Phase 8 已完成基线

- deterministic Article Chunking 与 stable identity；
- Google `gemini-embedding-2` / 1536 dimensions active profile；
- PostgreSQL pgvector exact cosine retrieval；
- lexical + vector RRF；
- 68 Article / 2044 Chunk full indexing；
- versioned quality-v2；
- `retrieve_article_context@1`；
- candidate / unverified / untrusted Observation；
- Tool / Context / deadline / terminalization 不变量。

已知质量边界：

- Vector / Hybrid answerable query 的 Hit@5、Recall@5、MRR 为 1.0；
- no-answer accuracy 为 0，并返回 false-positive nearest candidates；
- 正负距离分布重叠，threshold 保持 `null`；
- 因此 Task 3 不能只靠距离阈值宣称 answer verified。

## Task 3 定案

研究依据：

- [`docs/research/phase-08-grounded-answer-citation-design.md`](./research/phase-08-grounded-answer-citation-design.md)

关键设计：

```text
evidence-eligible Tool invocation
  -> Grounding Session / evidence availability
  -> Run-scoped evidence registry
  -> structured grounded finalization
  -> server validates citationKey
  -> atomic Message + Grounding persistence
  -> optional grounding on done / Messages API
  -> Web Source UI / Admin Inspector
```

重要语义：

- 不解析任意 Markdown `[1]`；
- `citationIntegrity=validated` 只证明引用身份；
- v1 明确 `faithfulnessStatus=not_evaluated`；
- claim-level inline citation 延后；
- 无 Retrieval 的普通回答保持现状；
- 3B / 3C 不能在 3A 之前自行发明另一套 contract。

## Phase 8 完成条件

1. Task 0、1、2A、2B、3A、3B、3C 均完成 GPT 技术验收和用户确认；
2. 索引、Retrieval 和 Evaluation 使用一致版本化 profile；
3. Agent 安全消费 Retrieval Observation；
4. evidence-backed answer 绑定本 Run 真实 Tool evidence；
5. Web 与 Admin 消费同一 durable Grounding；
6. zero-hit、weak evidence、conflict、invalid citation、legacy、error、aborted 路径完成验证；
7. 关键失败路径、测试、评估和阶段边界完成归档。

## 当前明确不做

- 生产数据库拓扑设计；
- claim-level inline offsets；
- 在线第二模型 judge；
- PDF / Office、通用知识库、多租户 ACL；
- Memory、MCP、Multi-agent；
- Agentic Retrieval、复杂 rerank / query rewrite；
- LangChain / LangGraph / 独立 Vector DB；
- OpenAI / Gemini 双 active provider；
- Admin Auth / RBAC Task 4；
- 自动 Compaction。

## Admin Console 支线

```text
Task 0：Admin 基础壳                 Completed
Task 1：静态 Run List / Detail       Completed
Task 2：真实 Run / Step Query API    Completed
Task 3：真实 Run Trace UI            Completed
Enhancement 1：Run Trace Workspace   Completed
Task 4：登录 / 权限 / 脱敏           Planned
```

Phase 8 Task 3C 会增加安全 Retrieval Inspector，但不会自动启动 Admin Task 4。

## 当前正式动作

```text
Task 3A：Next / Issue 未创建 / Gate 未执行
Task 3B：Planned / 依赖 3A
Task 3C：Planned / 依赖 3A
Active Agent Task：无
```

下一步只创建 Task 3A Issue。Task 3B、3C、Admin Task 4 与 Minimal Compaction 均不得自动进入实现。
