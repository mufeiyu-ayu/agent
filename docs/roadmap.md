# AI SEO Agent 学习路线

本文维护阶段级路线。正式 Task 状态与执行顺序以 [`docs/tasks/README.md`](./tasks/README.md) 为准；Phase 8 完整编排见 [`docs/tasks/phase-08-grounded-retrieval/README.md`](./tasks/phase-08-grounded-retrieval/README.md)。

## 当前状态

```text
阶段 1-7：Completed
Phase 8：Active
Task 0、1、2A、2B、3A、3B：Completed
Task 3C：Next
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
Task 3A Grounded Answer + Citation Backend Contract    Completed
  ↓
Task 3B Web Chat Source UI                             Completed
  ↓
Task 3C Admin Retrieval Inspector                      Next
  ↓
Phase 8 Closeout
```

Task 3A 提供 durable Grounding 事实层，Task 3B 已完成用户侧 Web Source UI。当前只推进 Task 3C Admin Retrieval Inspector。

## Phase 8 已完成基线

- deterministic Article Chunking 与 stable identity；
- Google `gemini-embedding-2` / 1536 dimensions active profile；
- PostgreSQL pgvector exact cosine retrieval；
- lexical + vector RRF；
- 68 Article / 2044 Chunk full indexing；
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
- Web strict normalization、completed-only Grounding projection；
- answered / insufficient / conflict / availability 状态表达；
- accessible Sources disclosure 与 non-interactive Source cards；
- malformed Grounding、Abort、deadline、Provider failure 与 usage 审计边界。

已知质量边界：

- Vector / Hybrid answerable query 的 Hit@5、Recall@5、MRR 为 1.0；
- no-answer accuracy 为 0，并返回 false-positive nearest candidates；
- 正负距离分布重叠，threshold 保持 `null`；
- `citationIntegrity=validated` 只证明引用身份，不证明每个断言的 semantic faithfulness；
- answerable live smoke 曾出现 Provider 保守判断为 insufficient 的波动，不通过强制回答或重试掩盖。

## Task 3A 收口事实

```text
evidence-eligible Tool invocation
  -> Grounding Session / evidence availability
  -> Run-scoped Evidence Registry
  -> hidden final draft
  -> structured grounded finalization
  -> server validates citationKey
  -> validated delta replay
  -> atomic Message + Grounding + Step + Run persistence
  -> optional grounding on done / Messages API
```

- Issue #58 Closed；
- PR #59 Merged；
- final head `1e7f4c7182219d3e9c0892211ecc810c1bbda904`；
- merge `d6df7ac1f24137a304748d21f4bca42dcb0a6ddc`；
- AC-01～AC-24 全部 PASS；
- GPT 四轮技术验收完成；
- 用户确认验收并授权合并与 docs 收口；
- 远程任务分支保留，未获删除授权。

## Task 3B 收口事实

```text
validated done.grounding / historical Grounding
  -> shared strict parser
  -> state / cache
  -> completed-only turn projection
  -> status + disclosure + source cards
  -> deterministic Chromium verification
```

- Issue #60 Closed；
- PR #61 Merged；
- final head `516dbd3ffd22a0d3adc83ce3166c4f5a8225b13d`；
- merge `572ad206271c0089eccc83e2a307bdb7909beeb1`；
- AC-01～AC-12 全部 PASS；
- GPT 首轮发现 2 个阻塞项，修复后第二轮技术验收通过；
- 用户确认验收并授权 Draft 转 Ready、合并与 docs 收口；
- Chromium 9 / 9，repeat-each=3 为 27 / 27；
- 远程任务分支保留，未获删除授权。

## Task 3C 当前目标

Task 3C 在现有 Admin Run Trace Workspace 中增加 typed、bounded、fail-closed 的 Retrieval / Grounding Inspector：

```text
Run / Step / Message Grounding
  -> typed safe projector
  -> Retrieval calls
  -> Grounded finalization
  -> Citation correlation
  -> Admin Inspector
```

重点学习与实现：

- candidate、evidence 与 cited source 的区分与关联；
- finalization outcome、attempt、validation 与 usage 审计；
- malformed / legacy / partial 数据 fail closed；
- 不暴露 Prompt、reasoning、embedding、distance、SQL、Provider payload 或完整正文；
- 现有 Context Inspector、Generic Inspector 与 Safe Raw Data 回归；
- 真实 Chromium RUNNING / FAILED / COMPLETED 与窄屏验收。

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
- 自动 Compaction；
- 并行 Tool Call 支持。

## Admin Console 支线

```text
Task 0：Admin 基础壳                 Completed
Task 1：静态 Run List / Detail       Completed
Task 2：真实 Run / Step Query API    Completed
Task 3：真实 Run Trace UI            Completed
Enhancement 1：Run Trace Workspace   Completed
Phase 8 Task 3C：Retrieval Inspector Next
Task 4：登录 / 权限 / 脱敏           Planned
```

Phase 8 Task 3C 增加安全 Retrieval Inspector，但不会自动启动 Admin Task 4。

## 当前正式动作

```text
Task 3A：Completed / #58 Closed / #59 Merged / `d6df7ac1`
Task 3B：Completed / #60 Closed / #61 Merged / `572ad206`
Task 3C：Next / Issue 未创建 / Gate 未执行
Active Agent Task：无
```

下一步只创建 Task 3C Issue，并提供任务专属 Codex 开工 Prompt。Admin Task 4、并行 Tool Call 与 Minimal Compaction 均不得自动进入实现。
