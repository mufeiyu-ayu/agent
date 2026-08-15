# Phase 8 Grounded Answer / Citation 架构研究与定案

> 本文是 Phase 8 Task 3 的研究与设计依据，不代表功能已经实现。正式执行状态以 `docs/tasks/**`、Issue、PR 和 GitHub 实时事实为准。

## 1. 结论

Phase 8 Task 3 不采用“让模型在 Markdown 正文中自由生成 `[1]`，前端再解析”的方案，而采用：

```text
服务端分配本轮 evidence identity
  -> 模型通过受约束的终态结构选择 evidence
  -> 服务端校验引用属于本次 Run
  -> 原子持久化 Message content + Grounding metadata
  -> NDJSON done 事件与历史消息返回同一份安全投影
  -> Web / Admin 消费结构化 contract
```

核心判断：

1. **Citation 是服务端验证后的结构化事实，不是模型生成的装饰文本。**
2. **检索候选、模型选择的引用、最终回答的事实忠实度必须分开表达。**
3. **Task 3 第一版验证“引用身份完整性”和“证据不足行为”，不虚构已经完成逐断言事实核验。**
4. **现有 DeepSeek + Tool Loop + NDJSON Streaming 可以保留，不需要引入 LangChain、LangGraph、LlamaIndex 或更换模型 Provider。**
5. **Task 3 拆为三个独立正式任务：3A 后端契约、3B Web 来源 UI、3C Admin Retrieval Inspector。**

## 2. 当前项目事实

当前系统已经完成：

```text
Article
  -> deterministic Chunking
  -> Gemini Embedding / pgvector index
  -> lexical + vector + hybrid RRF
  -> retrieve_article_context@1
  -> candidate / unverified / untrusted Observation
  -> Phase 7 Context Planner
  -> DeepSeek follow-up sampling
```

但现状仍然是：

- `retrieve_article_context@1` 返回 `candidates_returned | no_candidates`；
- `answerStatus` 恒为 `unverified`；
- `retrieve_article_context@1` candidate 可以具有 `sourceId`、可选 `chunkId`、`sectionPath` 和 bounded excerpt；
- `get_article_detail@1` 可以返回单篇完整 Article，但当前没有独立 Citation / Evidence projector；
- `search_articles@1` 是 discovery / keyword list，不是回答证据片段；
- Vector / Hybrid 对 answerable query 的召回较强，但 no-answer query 仍会返回语义近邻；
- 正负样本距离分布重叠，不能用一个拍脑袋 similarity threshold 可靠区分“有答案 / 无答案”；
- 外部 `ChatStreamEvent` 只有 `start / delta / done / error / aborted`；
- `ConversationMessage` 只有字符串 `content` 和生命周期字段；
- Admin 已有 typed projector 与 fail-closed Generic fallback，但没有 Retrieval / Citation 专用 Read Model。

因此，当前系统只能证明“模型见过这些候选”，不能证明：

```text
最终回答引用了哪些候选
引用是否属于本轮真实检索结果
模型是否伪造了 source / chunk
证据不足时是否可靠拒答
页面和后台能否在重载后重建同一份来源事实
```

## 3. 主流方案对比

| 方案 | 典型做法 | 优点 | 关键问题 | 本项目结论 |
| --- | --- | --- | --- | --- |
| Prompt-only 编号 | 把来源写成 `Source 1`，要求模型输出 `[1]` | 最容易接入 | 模型可漏引、错引、伪造编号；前端解析脆弱 | 只作为提示层，不作为事实来源 |
| Provider-native citation | Provider 返回 citation annotations / grounding supports，并绑定 source location | 引用与输出结构化，流式协议可携带 citation delta | DeepSeek 当前路径没有可直接复用的 provider-native citation contract | 作为目标形态参考，不直接依赖 |
| UI structured parts | Message 由 text、source URL、source document 等 typed parts 组成 | UI 状态与模型消息分层，来源不是 Markdown 副作用 | 当前项目 Message 还是字符串，需要渐进迁移 | 采用其“结构化消息元数据”思想 |
| Structured output / tool strategy | 模型通过 JSON Schema 或 function/tool schema 返回受约束对象 | 可校验、可重试、Provider-neutral | 仍不能单靠结构证明语义事实 | 作为 3A 的终态输出机制 |
| Claim-level supports | answer span / claim 与 source chunk 建立多对多支持关系 | 审计粒度最高 | 涉及 offsets、Markdown、Unicode、编辑与流式稳定性，MVP 成本高 | 延后到 v2，v1 先做 message-level citations |
| LLM-as-judge | 独立模型判断 faithfulness | 可扩展离线评估 | 非确定、增加成本和延迟，不能单独作为硬验收 | 只做非阻塞评估，不作为在线真值 |

### 3.1 Codex 可迁移的部分

Codex 的价值不在于提供一套现成 Citation 方案，而在于它把：

- Thread / Turn 生命周期；
- `ThreadItem` 的判别联合类型；
- item started / updated / completed；
- Agent message、Tool、Web Search、MCP、Reasoning 等语义对象；

从纯文本中拆成结构化事件和结构化 item。

对本项目的迁移结论是：

```text
回答正文仍是 Message.content
Citation / Grounding 是 Message 的结构化伴随事实
Tool Observation 仍是内部 model-visible context
Web / Admin 不解析 Tool 原始文本来推断来源
```

### 3.2 社区方案的共同收敛点

OpenAI、Anthropic、Google、Vercel AI SDK、LangChain 等方案虽然 API 不同，但共同方向是：

- citation/source 作为结构化 metadata 或 content part；
- source identity 由系统或 Provider 管理，而不是任意 Markdown 文本；
- streaming 可以分开发送 text 与 citation metadata；
- UI transcript、model-visible message、trace/audit 数据不是同一个对象；
- 观测数据必须有脱敏和有界投影。

## 4. Task 拆分定案

```text
Task 3A  Grounded Answer + Citation Backend Contract   Next
  ↓
Task 3B  Web Source UI                                 Planned
Task 3C  Admin Retrieval Inspector                     Planned
```

3B 与 3C 都依赖 3A 的 durable contract，但两者互不依赖，可以在 3A 完成后分别启动。

拆分原因：

- 3A 涉及 Agent Runtime、公共 API、数据库和终态事务，是后端事实层；
- 3B 涉及 Web Chat 的消息状态、来源卡片与可访问性；
- 3C 涉及 Admin safe projector、审计语义和浏览器验收；
- 三者属于不同风险域和不同验收证据，不应塞入同一个 Issue。

## 5. 核心领域模型

### 5.1 模型终态输出

Evidence-backed answer 使用一个只在最终收口阶段暴露的结构化输出 contract：

```ts
interface SubmitGroundedAnswerInputV1 {
  answer: string
  outcome:
    | 'answered'
    | 'insufficient_evidence'
    | 'conflicting_evidence'
  citationKeys: string[]
}
```

建议内部名称：

```text
submit_grounded_answer@1
```

选择 function/tool-shaped schema 而不是只启用宽松 JSON mode，原因是当前 Provider adapter 已经具备 Tool Call 分片拼装与 call identity；JSON mode 即使返回 JSON 字符串，仍可能出现空内容、长度截断或业务字段无效，最终仍需要同样的 schema 与引用校验。

它不是普通业务 Tool：

- 不执行外部副作用；
- 不进入 `ToolInvocationService`；
- 不创建伪造的 Tool Result；
- 不消耗正常 Tool Call budget；
- 只作为 finalization sampling 的 typed output channel；
- finalization sampling 仍计入总模型调用、token usage、trace 和 Run remaining budget；
- 它使用独立的 `grounded finalization attempt budget`，不挤占现有 bounded action-loop sampling / Tool budget；
- v1 最多 2 次 finalization attempt（首次 + 1 次 correction）。

### 5.2 Grounding Session

Runtime 在首次调用 evidence-eligible Tool 时建立 Run-scoped Grounding Session，即使该次结果是 zero-hit、not found 或安全 Tool failure。ToolDefinition 使用服务端拥有的 evidence policy 标记能力，模型 arguments 不能改变。

服务端派生：

```ts
type EvidenceAvailability
  = | 'available'    // 至少一个成功 evidence ref，且没有 eligible Tool failure
    | 'partial'      // 至少一个成功 evidence ref，同时存在 eligible Tool failure
    | 'none'         // eligible Tool 成功，但 zero-hit / not found，没有 ref
    | 'unavailable'  // 没有 ref，且 eligible Tool 失败
```

`evidenceAvailability` 不是模型字段；它由 Runtime 根据 Tool execution 事实计算。这样 zero-hit 与 Provider / DB / timeout 不会被混成同一种状态。

### 5.3 Run-scoped Evidence Registry

每个 evidence-eligible Tool 通过工具自有的安全 projector 向本 Run Evidence Registry 提交结构化 ref。v1 明确：

- `retrieve_article_context@1`：eligible，按候选 source / optional chunk 投影；
- `get_article_detail@1`：found 时 eligible，按 article-level source 投影，并与同 source 的 chunk evidence 合并；
- `search_articles@1`：discovery-only，不进入 Evidence Registry。

Runtime 不按 Tool 名称解析任意 `data / modelContent` 文本；ToolResult 使用受类型和大小约束的 optional evidence projection。

Registry item：

```ts
interface RunEvidenceRef {
  citationKey: string       // 服务端生成、仅本 Run 有效、对模型不透明
  sourceId: number
  chunkId: string | null
  granularity: 'article' | 'chunk'
  title: string
  slug: string
  languageCode: string
  sectionPath: string | null
  excerpt: string | null    // article-level evidence 可以没有 excerpt
  rank: number | null
  strategy: {
    name: string
    version: string
  }
}
```

规则：

- `citationKey` 由服务端生成，不采用模型可猜测的 `[1]`、`sourceId` 或 `chunkId`；
- key 只能引用当前 Run 中 evidence-eligible Tool Result 暴露的安全 ref；
- key 不跨 Run、不从历史消息继承；
- `chunkId` 缺失时保持 source-level citation，不伪造 chunk identity；
- candidate excerpt 仍是 untrusted data，不能改变 system / developer policy；
- v1 Registry hard cap 为 10 refs，按 Tool execution sequence、Tool 内 rank 和 stable identity 确定性去重 / 排序；
- `get_article_detail` 与已有同 source evidence 合并，不以伪造 rank 或 chunk 的方式增加优先级；
- 超限必须记录 `registryTruncated`，不能静默丢弃。

### 5.4 Durable Message Grounding

对外与持久化的 v1 contract：

```ts
interface MessageGroundingV1 {
  schemaVersion: 1
  evidenceAvailability:
    | 'available'
    | 'partial'
    | 'none'
    | 'unavailable'
  outcome:
    | 'answered'
    | 'insufficient_evidence'
    | 'conflicting_evidence'
  citationIntegrity: 'validated'
  faithfulnessStatus: 'not_evaluated'
  citations: MessageCitationV1[]
}

interface MessageCitationV1 {
  citationId: string
  sourceId: number
  chunkId: string | null
  granularity: 'article' | 'chunk'
  title: string
  slug: string
  languageCode: string
  sectionPath: string | null
  excerpt: string | null
  rank: number | null
  href: string | null       // public projection only, server-derived
  strategy: {
    name: string
    version: string
  }
}
```

语义边界：

- `evidenceAvailability` 由服务端 Tool execution 事实派生，不由模型决定；
- `citationIntegrity: validated` 只表示引用身份属于本轮真实 evidence；
- 它不表示引用内容一定支持回答的每个断言；
- 第一版明确写 `faithfulnessStatus: not_evaluated`，禁止使用 `verified: true` 这类过度承诺；
- Registry 最多 10 refs，最终 `citations` 最多 5 条；二者是不同边界；
- Web 展示编号 `1..N` 由服务端或 UI 投影生成，不由模型控制；
- public `href` 由服务端根据持久化 slug 和 allowlisted route resolver 生成，不由模型提供，也不要求保存绝对 origin。

## 6. Runtime 流程

### 6.1 未建立 Grounding Session 的普通回答

保持现状：

```text
Agent Loop
  -> assistant text delta
  -> Message / Run terminalization
```

不要求所有回答都进入 Grounded finalization。

### 6.2 Grounding Session 已建立的回答

```text
Agent Loop
  -> evidence-eligible Tool invocation(s)
  -> Grounding Session + Evidence Registry（可以为空）
  -> 模型产生 final draft
  -> draft 不对用户可见、不写入 Message.content
  -> dedicated finalization sampling
       tools: only submit_grounded_answer@1
       context: draft + evidence availability + current Run Evidence Registry
  -> validate structured output
  -> replay validated answer through existing assistant_delta
  -> if replay completes: atomic persist content + grounding + run terminal state
  -> existing done event + optional grounding
```

第一版接受一个明确取舍：

- evidence-backed answer 在校验完成前不向用户流式显示；
- 校验通过后通过既有 `assistant_delta` 以确定性、Unicode-safe chunks 重放最终正文；chunks 拼接必须逐字符等于 validated answer；
- Grounding 只在全部 delta 重放完成后进入现有终态事务；用户在重放期间 Abort 时保留现有 ABORTED / partial-content 语义，不生成 completed Grounding；
- 这会增加首个可见 token 的等待时间，但避免已展示内容随后因 Citation 校验失败而回滚；
- 不新增 `citation_delta`，避免同时升级 Runtime、NDJSON parser、Web 状态机和 legacy client。

### 6.3 校验与重试

服务端校验：

1. schemaVersion 和字段类型正确；
2. `citationKeys` 去重后不超过 5；
3. `evidenceAvailability` 由服务端派生，模型不能提交或覆盖；
4. 每个 key 都属于当前 Run Evidence Registry；
5. `answered` 只允许 availability 为 `available | partial`，并至少包含一个有效 citation；
6. `conflicting_evidence` 只允许 availability 为 `available | partial`，并至少引用两个不同 `sourceId`；
7. `insufficient_evidence` 允许任何 availability；`none | unavailable` 时 citation 必须为空；
8. 不接受模型直接提交 `sourceId / chunkId / slug / URL` 代替 key；
9. answer 和 citations 通过安全长度、JSON、深度和字符边界检查；
10. replay chunks 不拆坏 Unicode code point，拼接结果与 persisted content / done.content 完全一致。

失败策略：

- 首次 finalization + 最多一次 correction，共 2 次独立 finalization attempt；
- 现有 Agent Loop sampling / Tool budget 保持不变，不能借 finalization reserve 继续执行 action Tool；
- correction 只反馈结构化校验错误，不回传 secret、原始 Prompt 或内部 stack；
- 第二次仍失败则 fail closed：不展示或持久化未验证 draft，Message / Run 按现有失败语义收口；
- 失败不是 `no_candidates`，不能伪装成“知识库无答案”。

## 7. 数据持久化定案

第一版不把 citation 塞进无约束的 `Message.metadata`，也不立即拆成大量规范化 citation 行。

推荐新增一对一 durable record：

```text
Message 1 --- 0..1 MessageGrounding
```

`MessageGrounding` 保存：

- `messageId`；
- `schemaVersion`；
- `evidenceAvailability`；
- `outcome`；
- `citationIntegrity`；
- `faithfulnessStatus`；
- versioned safe JSON `citations`（保存 source snapshot，不保存模型 URL；public href 在 projector 中派生）；
- timestamps。

选择一对一表而不是泛化 JSON bag 的原因：

- Citation 是核心产品事实，生命周期与 assistant Message 一致；
- schemaVersion 可演进；
- v1 最多 5 条 citation，读取时作为一个整体，不需要先做复杂分析查询；
- 后续只有出现真实逐 citation 查询、统计或权限需求时，才升级为规范化行。

必须满足：

- assistant `content/status`、MessageGrounding、AgentRun / AgentStep 终态在全部 validated delta 重放完成后，于同一终态事务中提交；
- commit outcome unknown 继续遵循现有数据库可靠性语义；
- 来源卡片保存 title / slug / language / section / excerpt 的安全快照，同时保留 sourceId / chunkId 追踪；
- 不在 MessageGrounding 中保存 raw embedding、distance、SQL、Provider payload、完整正文、完整 Prompt、reasoning 或 secret。

## 8. API 与兼容方案

### 8.1 历史消息

```ts
interface ConversationMessage {
  // existing fields...
  grounding?: MessageGroundingV1 | null
}
```

### 8.2 NDJSON 完成事件

```ts
interface ChatStreamDoneEvent {
  // existing fields...
  grounding?: MessageGroundingV1
}
```

兼容原则：

- 不新增新的 top-level stream event type；
- 只给现有 `done` 增加 optional field；
- legacy Message 没有 Grounding 时保持当前 UI；
- `start / delta / aborted / error` 不携带 Grounding；
- Web 重载后从 Messages API 得到与 `done` 相同的 durable projection；
- malformed Grounding 在 API projector 层 fail closed，不直接透传原始 JSON。

## 9. 证据不足与冲突行为

| 场景 | evidenceAvailability | outcome | Citation | 用户可见行为 |
| --- | --- | --- | --- | --- |
| 未调用 evidence-eligible Tool | 无 Grounding | 无 | 无 | 保持普通回答 |
| Retrieval zero-hit / detail not found | `none` | `insufficient_evidence` | 0 | 明确当前资料无法确认，不猜测 |
| eligible Tool 全部失败 | `unavailable` | `insufficient_evidence` | 0 | 明确检索能力暂不可用，不伪装知识库无答案 |
| 有成功 evidence，也有 Tool failure | `partial` | 三种 outcome 按有效 evidence 决定 | 0..5 | 明确结果是部分可用，不能引用失败通道 |
| 有近邻候选但不足以回答 | `available` | `insufficient_evidence` | 0..5 | 可以说明检查过哪些候选，但不能把候选写成确定答案 |
| 候选充分且一致 | `available | partial` | `answered` | 1..5 | 基于来源回答，展示来源卡片 |
| 两个或更多真实来源冲突 | `available | partial` | `conflicting_evidence` | 至少 2 个 source | 明确冲突点，不强行选边 |
| 模型提交未知 citationKey | 由 Session 事实决定 | finalization 校验失败 | 无 | correction 一次，仍失败则 fail closed |
| Prompt injection 出现在 excerpt | 由 Session 事实决定 | 按 untrusted data 处理 | 仅安全投影 | 不覆盖服务端政策 |

## 10. Web Source UI 边界

Task 3B 只消费 3A 的结构化 contract：

- 来源卡片只在 completed answer 的 Grounding 可用时出现；article-level Citation 可以没有 excerpt；
- streaming 期间不提前展示来源；
- 展示 title、language、sectionPath、bounded excerpt；
- 来源编号按 contract 顺序生成；
- URL 只能由服务端通过 allowlisted internal route 从 slug 派生，不能直接使用模型文本；
- `evidenceAvailability` 与 outcome 分开渲染；`none` 表示无命中，`unavailable` 表示工具不可用，`partial` 表示仅部分证据链成功；
- `insufficient_evidence` 和 `conflicting_evidence` 有明确状态文案；
- legacy、loading、partial、malformed、error、aborted 均有独立行为；
- Markdown renderer 不负责识别任意 `[1]`；
- 必须提供键盘操作、可访问名称和真实 Chromium 验收。

## 11. Admin Retrieval Inspector 边界

Task 3C 建立 typed safe Read Model，而不是把 AgentStep JSON 原样展示出来。

Inspector 建议展示：

- availability：`available | partial | unavailable`；
- Retrieval callId / tool version / strategy version；
- candidate count、registry ref count、registryTruncated、chunk evidence count、observation truncation、duration；
- finalization schema version、attempt count、evidence availability、outcome；
- citation count、sourceId / chunkId、granularity；
- candidate → cited 的关联；
- citation integrity；
- faithfulness 明确显示 `not_evaluated`。

禁止展示：

- raw Prompt / system instructions；
- model reasoning；
- raw embedding / distance；
- SQL、Provider payload、credential、stack；
- 完整 Article 正文；
- 未经边界限制的用户 query 或 excerpt。

Admin Auth / RBAC Task 4 未启动，因此 Task 3C 必须继续使用最小化、bounded、fail-closed 投影。

## 12. Evaluation 与验收策略

### 12.1 硬验收

- Citation reference integrity：100%；
- Registry 10 refs hard cap、确定性顺序、去重和 truncation 可由自动测试证明；
- `retrieve_article_context` 与 `get_article_detail` 的 evidence projection 可验证，`search_articles` 不会被误当作 citable evidence；
- 不存在未知 / 跨 Run / 伪造 citationKey 成功路径；
- `answered` 无 citation 必须失败；
- zero-hit、not found、partial failure、unavailable、weak evidence、conflict 行为可由确定性测试判定；
- validated delta replay 使用 Unicode-safe deterministic chunking；期间 Abort 保持现有 partial-content / ABORTED 语义；只有 replay 完成才原子提交 Message content + Grounding + Run terminalization；
- legacy API / Message / Stream 客户端行为不退化；
- Tool Call / Result pairing、Context Budget、Abort、deadline、commit outcome unknown 不退化；
- action-loop budget 与 grounded finalization attempt budget 分离，且所有模型调用仍进入统一 trace / usage 聚合；
- 真实 DeepSeek + Gemini + 隔离 pgvector smoke 至少覆盖 answered 与 insufficient 两条路径。

### 12.2 非阻塞评估

可以使用 Ragas faithfulness、context precision 或独立 LLM judge 作为离线观察，但第一版不把它们单独作为硬门槛：

- LLM judge 具有非确定性；
- 可能受模型版本、Prompt 和语言影响；
- 不能替代引用身份校验与确定性失败测试。

### 12.3 可观测性标准

可参考 OpenTelemetry GenAI 与 OpenInference 的 Agent / Tool / Retriever / Evaluator 分层命名，但 Phase 8 不因此新增 telemetry framework 依赖。

## 13. 明确不做

- 不在 v1 做 claim-level inline span / offset citation；
- 不解析 Markdown 中任意 `[1]`；
- 不把 similarity threshold 当拒答真值；
- 不引入在线第二模型强制 judge；
- 不引入 LangChain、LangGraph、LlamaIndex 运行时依赖；
- 不切换到 Provider-native citation API；
- 不做 PDF / Office、通用知识库、多租户 ACL、Memory、MCP、Multi-agent；
- 不自动启动 Admin Auth / RBAC；
- 不修改现有 Retrieval ranking、RRF、Embedding profile 或 Evaluation corpus。

## 14. 外部参考

- [OpenAI Responses API](https://platform.openai.com/docs/api-reference/responses)
- [Anthropic Citations](https://docs.anthropic.com/en/docs/build-with-claude/citations)
- [Google Vertex AI Grounding](https://cloud.google.com/vertex-ai/generative-ai/docs/grounding/grounding-with-google-search)
- [Vercel AI SDK UIMessage](https://ai-sdk.dev/docs/reference/ai-sdk-ui/ui-message)
- [DeepSeek JSON Output](https://api-docs.deepseek.com/guides/json_mode)
- [DeepSeek Function Calling](https://api-docs.deepseek.com/guides/function_calling)
- [LangChain Structured Output](https://docs.langchain.com/oss/javascript/langchain/structured-output)
- [LlamaIndex CitationQueryEngine source](https://github.com/run-llama/llama_index/blob/afd0fef371831f9bda13e5af7167cf4e981278ab/llama-index-core/llama_index/core/query_engine/citation_query_engine.py)
- [Ragas Metrics](https://docs.ragas.io/en/stable/concepts/metrics/available_metrics/)
- [OpenTelemetry GenAI Semantic Conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/)
- [OpenInference Semantic Conventions](https://arize-ai.github.io/openinference/spec/semantic_conventions.html)
- [Codex TypeScript ThreadItem](https://github.com/openai/codex/blob/a7edf37cb46b5fc4d50bd03df8e5999a86f602eb/sdk/typescript/src/items.ts)
- [Codex TypeScript ThreadEvent](https://github.com/openai/codex/blob/a7edf37cb46b5fc4d50bd03df8e5999a86f602eb/sdk/typescript/src/events.ts)

## 15. 当前正式动作

```text
Phase 8 Task 3：已经完成研究与子任务拆分
Task 3A：Next / Issue 未创建 / Gate 未执行
Task 3B：Planned / 依赖 3A
Task 3C：Planned / 依赖 3A
Active Agent Task：无
```

下一步只能把 Task 3A 规格整理成一个正式 Issue，并在 Issue 创建后交给 Codex 执行 Clarification Gate。本文档更新不等于授权实现。
