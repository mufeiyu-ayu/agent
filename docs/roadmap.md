# AI SEO Agent 学习路线

本文维护阶段级路线。正式 Task 状态与执行顺序以 [`docs/tasks/README.md`](./tasks/README.md) 为准。

## 当前状态

```text
阶段 1-8：Completed
Phase 8：Completed
Active Agent Task：无
Minimal Compaction：Gated
Admin Observability：Task 0-3、Enhancement 1、Phase 8 Task 3C Completed
Admin Task 4：Planned
Phase 9：未定案
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
| [阶段 7：Context Engineering](./tasks/completed/phase-07-context-engineering.md) | Completed | ModelContext、budget、history、Observation governance、Context Inspector |
| [阶段 8：Grounded Retrieval / RAG Baseline](./tasks/completed/phase-08-grounded-retrieval.md) | **Completed** | Evaluation、Chunk / Index、Hybrid Retrieval、Agent Tool、Grounded Answer、Web Sources、Admin Inspector |

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
Task 3A Grounded Answer + Citation Backend Contract    Completed
  ↓
Task 3B Web Chat Source UI                             Completed
  ↓
Task 3C Admin Retrieval Inspector                      Completed
  ↓
Phase 8 Closeout                                       Completed
```

## Phase 8 最终能力

- deterministic Article Chunking 与 stable identity；
- Google `gemini-embedding-2` / 1536 dimensions active profile；
- PostgreSQL pgvector exact cosine retrieval；
- lexical + vector RRF；
- 68 Articles / 2044 Chunks full indexing；
- versioned quality-v2；
- `retrieve_article_context@1`；
- candidate / unverified / untrusted Observation；
- Tool / Context / deadline / terminalization 不变量；
- evidence-eligible Tool policy 与 Grounding Session；
- Run-scoped Evidence Registry 与 opaque citationKey；
- structured `submit_grounded_answer@1` finalization；
- server-side Citation identity validation；
- durable `MessageGroundingV1` 与原子终态；
- optional `done.grounding` / `ConversationMessage.grounding`；
- Web Grounding 状态、Sources disclosure 与 Source cards；
- Admin Retrieval / Finalization / Citation Inspector；
- ordinary、zero-hit、conflict、unavailable、legacy、malformed、FAILED、ABORTED 的确定性验证。

## 关键工程认知

1. RAG 不是“把向量数据库接上模型”，而是索引、检索、低信任 Context、引用校验和可观察性的完整系统。
2. Embedding profile、Chunk identity 和 active index 必须版本化。
3. nearest candidate 不等于答案存在；no-answer false positive 不能靠拍脑袋阈值掩盖。
4. Tool Observation 是低信任输入，不能进入 system policy 层。
5. Citation identity validation 只证明来源身份，不证明每个断言真实。
6. UI、model-visible history、durable Grounding 与 Admin trace 必须分层。
7. fail-closed 的价值不仅是安全，也用于阻止损坏数据被展示成“完整成功”。

## 当前学习阶段

正式开发暂停，进入 Phase 8 源码阅读阶段，按以下链路回读代码：

```text
索引入口
  -> Chunking / sourceHash / profile
  -> Gemini Embedding / pgvector
  -> lexical / vector / RRF
  -> retrieve_article_context@1
  -> Tool Observation / Context Planner
  -> Grounding Session / Evidence Registry
  -> finalization / Citation validation
  -> Stream / Messages API
  -> Web Source UI
  -> Admin Retrieval Inspector
```

该阶段属于阅读、讨论和本地实验模式，默认不创建 Issue、不修改正式状态。下一阶段学习内容暂不定义。

## Phase 9 决策原则

Phase 9 尚未定案。完成 Phase 8 源码阅读后，再基于真实产品价值和能力缺口选择方向。

候选方向包括但不限于：

- Durable Execution / Recovery；
- Human-in-the-loop / Permission；
- Agent Evaluation / Observability 增强；
- 文件知识库；
- Memory；
- MCP。

候选不等于 Next。Memory、MCP、Multi-agent 不得因为“流行”而优先于真实业务需求和工程前置。

## 当前明确后置

- 生产数据库拓扑设计；
- claim-level inline offsets；
- 在线第二模型 judge；
- PDF / Office、通用知识库、多租户 ACL；
- Agentic Retrieval、复杂 rerank / query rewrite；
- LangChain / LangGraph / 独立 Vector DB；
- OpenAI / Gemini 双 active provider；
- Admin Auth / RBAC Task 4；
- 自动 Compaction；
- 并行 Tool Call；
- Memory、MCP、Multi-agent。

## Admin Console 支线

```text
Task 0：Admin 基础壳                    Completed
Task 1：静态 Run List / Detail          Completed
Task 2：真实 Run / Step Query API       Completed
Task 3：真实 Run Trace UI               Completed
Enhancement 1：Run Trace Workspace      Completed
Phase 8 Task 3C：Retrieval Inspector    Completed
Task 4：登录 / 权限 / 脱敏              Planned
```

Phase 8 Task 3C 已完成安全 Retrieval Inspector，但不自动启动 Task 4。

## 当前正式动作

```text
Phase 8：Completed / 已归档（docs/tasks/completed/phase-08-grounded-retrieval.md）
Active Agent Task：无
当前阶段：Phase 8 源码阅读（学习阶段）
下一阶段学习内容：暂不定义
```
