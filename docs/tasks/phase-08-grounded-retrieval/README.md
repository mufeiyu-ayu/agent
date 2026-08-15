# Phase 8：Grounded Retrieval / RAG Baseline

状态：**Active / Task 0、Task 1、Task 2A、Task 2B Completed / Task 3 Next**。

本文件是 Phase 8 的阶段总览与任务编排入口。正式 Task 状态以各 Task 文档、Issue / PR 和 GitHub 实时事实为准。

## 1. 阶段目标

Phase 8 的目标不是堆叠一个“向量数据库 Demo”，而是建立一条可评估、可索引、可检索、可引用和可观察的 Grounded Retrieval 链路：

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

- 检索数据来自哪里；
- 为什么返回这些结果；
- 与 lexical baseline 相比是否有可验证提升；
- 哪些 Chunk 真正进入模型上下文；
- 最终回答引用了哪些真实来源；
- 检索失败、证据不足或上下文裁剪发生在哪里。

## 2. Task 看板

| Task | 状态 | 核心目标 | 交付 |
| --- | --- | --- | --- |
| Task 0：Retrieval Boundary & Offline Evaluation Baseline | **Completed** | 解耦 Retrieval 与 Tool，固化 Prisma lexical 行为和离线评估基线 | #48 / #49 / merge `4c2f7950` |
| Task 1：Article Chunking & Embedding Index | **Completed** | 确定性 Chunk、稳定身份、Embedding 边界与幂等 pgvector index | #50 / #52 / merge `76d66abf` |
| Task 2A：Vector / Hybrid Retrieval & Evaluation | **Completed** | Gemini Provider、exact vector retrieval、Article aggregation、RRF 与 quality-v2 | #54 / #55 / merge `3abdcb8a` |
| Task 2B：Retrieval Tool & Agent Integration | **Completed** | `retrieve_article_context@1`、受控 Observation、Agent Loop / Context Budget 集成 | #56 / #57 / merge `4f3ba1c1` |
| Task 3：Grounded Answer & Retrieval Inspector | **Next / 未启动** | 结构化引用、Grounded Answer、Web 来源展示与安全 Retrieval Inspector | Issue 未创建 / Gate 未执行 |

当前没有 Active Agent Task。Task 3 是下一项正式任务，但尚未创建 Issue，也未执行 Clarification Gate。

## 3. 已完成基线

### Task 0：Retrieval Boundary & Offline Evaluation

已建立：

- 与 Tool / LLM 解耦的 `ArticleRetriever` Contract；
- 保持既有行为的 Prisma lexical adapter；
- query / language / limit 规范化边界；
- 确定性离线 corpus；
- Recall@K、Mean Recall@K、Precision@K 与 MRR baseline。

### Task 1：Article Chunking & Embedding Index

已建立：

- Cheerio canonical structural block stream；
- `cl100k_base` 确定性 Chunking，固定 `600 / 800 / 80` profile；
- stable `sourceHash`、Chunk identity 与版本化 hash；
- PostgreSQL `ArticleChunk`、`ArticleIndexState` 与 `vector(1536)`；
- incremental / full 幂等 CLI；
- advisory lock、stale fencing、原子替换、Abort 与脱敏 summary。

Task 1 当时建立的是 OpenAI-specific Embedding baseline；真实 OpenAI smoke 与真实 pgvector integration / concurrency 当时未执行。该历史事实保持不变。

### Task 2A：Gemini Vector / Hybrid Retrieval

最终 active profile：

```text
provider: google
model: gemini-embedding-2
dimensions: 1536
embeddingVersion: google:gemini-embedding-2:1536:search-result-v1
```

最终链路：

```text
Gemini Query Embedding
  -> exact cosine Chunk retrieval
  -> unique Article aggregation
  -> lexical candidates
  -> RRF(k=60)
  -> article-level top-k + best evidence
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
- 正负距离分布重叠，因此 similarity threshold 保持 `null`。

production quality-v2：

| Strategy | Hit@5 | Recall@5 | Precision@5 | MRR | No-answer Acc | FP query / hit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| legacy lexical | 0.2 | 0.2 | 0.04 | 0.2 | 1.0 | 0 / 0 |
| Gemini vector exact cosine | 1.0 | 1.0 | 0.24 | 1.0 | 0 | 3 / 15 |
| hybrid RRF | 1.0 | 1.0 | 0.24 | 1.0 | 0 | 3 / 15 |

### Task 2B：Retrieval Tool & Agent Integration

已完成：

```text
用户问题
  -> DeepSeek sampling
  -> retrieve_article_context@1
  -> Gemini Query Embedding
  -> lexical + pgvector exact retrieval
  -> hybrid_rrf@1
  -> candidate / unverified / untrusted Observation
  -> Phase 7 Context Planner
  -> follow-up sampling
  -> 最终回答
```

核心边界：

- Tool 输入：`query`、可选 `languageCode`、可选 `limit`；默认 3、最大 5；
- 每条 excerpt 最多 500 字符，总 Observation ceiling 8,000 字符；
- Tool Boundary 自身强制最终来源数不超过 `limit`；
- 输出为 `candidates_returned` / `no_candidates`，`answerStatus` 恒为 `unverified`；
- 不向模型暴露 raw embedding、distance、完整正文、SQL、Provider payload 或 credential；
- Retrieval 内容始终是低信任 Tool data；
- Tool Call / Tool Result 保持同 `callId` pairing；
- Retrieval Observation 继续经过 Phase 7 Context Planner；
- `ToolStepSummary` 只保存安全元数据和少量 source / chunk 引用，并经过 JSON、大小和深度 fail-closed 校验；
- trusted-provider 网络访问只允许 low-risk、无副作用、幂等、无需审批的 server-owned Tool；
- `search_articles@1` 与 `get_article_detail@1` 保持兼容；
- SEO Agent prompt 明确关键词搜索、语义候选检索和全文读取的职责边界。

交付事实：

- Issue #56 Closed（Completed）；
- PR #57 Merged；
- 最终验收 head `9008c7be9176d4d8f322a31b96e7f0fef753f727`；
- merge `4f3ba1c109e8b0ade2328abeed24a72c295acd6d`；
- GPT 第二轮技术验收通过，AC-01～AC-16 全部 PASS；
- 用户明确确认验收并授权合并与 docs 收口；
- 云端 Codex Review 因额度耗尽未产生结果，该缺口未被表述为 Review 通过。

最终验证：

```text
test:seo-service    19 pass / 0 fail / 0 skip
test:tools          69 pass / 0 fail / 0 skip
test:tool-loop      54 pass / 0 fail / 0 skip
test:context        24 pass / 0 fail / 0 skip
test:retrieval      35 pass / 0 fail / 0 skip
test:retrieval-db    9 pass / 0 fail / 0 skip
test:model-stream   67 pass / 0 fail / 0 skip
typecheck / lint / build / workspace typecheck：PASS
```

最新真实 Retrieval Tool smoke：

```text
status=candidates_returned
answerStatus=unverified
strategy=hybrid_rrf@1
sourceCount=3
chunkEvidenceCount=3
observationChars=1772
truncated=false
elapsedMs=986
```

## 4. 阶段不变量

- Retrieval 是内部数据能力，Tool 是 Agent 调用与 Observation 适配边界；
- Chat LLM 与 Embedding Provider 可以来自不同厂商，但 Indexing 与 Query Embedding 必须使用一致的 provider / model / dimensions / formatter / version；
- Tool / Retrieval 数据始终是低信任 Context，不能升级为 system / developer policy；
- 检索结果必须经过 Observation ceiling 与 Phase 7 Context Budget；
- Chunk、Embedding 和 Index 必须具备稳定版本与幂等重建语义；
- 新策略必须使用版本化 corpus 和明确指标与 lexical baseline 比较；
- `candidates_returned` 不等于 `answer_found`；
- Citation 必须追溯到真实 source / chunk，不能由模型生成不存在的来源；
- Inspector 不暴露完整 Prompt、reasoning、raw Embedding 或敏感正文；
- 不因为进入 RAG 阶段就自动引入 LangChain、LangGraph、独立 Vector DB 或通用知识库框架。

## 5. 已知边界

- Vector / Hybrid 对 answerable query 的语义召回明显增强，但会为 no-answer query 返回近邻候选；
- 正负距离分布重叠，不能依赖单一 similarity threshold 稳定解决拒答；
- Task 2B 通过 `answerStatus: unverified`、低信任 envelope 和 prompt 约束表达风险，但没有实现最终 Grounded Answer enforcement；
- Prompt 自动测试锁定文本契约，不等价于真实模型 Tool 选择准确率评估；
- `ToolStepSummary` 的结构、大小和深度由 Runtime 强制，字段语义仍由具体 Tool projector 负责。

## 6. Task 3：下一项正式任务

Task 3 计划建立：

- 结构化 Citation contract；
- 最终回答与本次 Retrieval source / chunk 的可靠绑定；
- 证据不足、无结果、冲突候选和兼容状态的回答行为；
- Web Chat 来源卡片；
- Admin Retrieval Inspector；
- API、Read Model、自动测试和真实浏览器验收闭环。

Issue 创建前必须决定是否拆成：

```text
Task 3A  Grounded Answer + Citation backend contract
Task 3B  Web Source UI + Admin Retrieval Inspector
```

以及旧客户端兼容、citation marker、durable metadata、安全投影和浏览器验收边界。

## 7. 当前明确后置的能力

Phase 8 当前不包含：

- PDF / Office 文件上传与解析；
- 通用企业知识库和多数据源连接器；
- 多租户 ACL、文档权限和跨用户隔离；
- 长期 Memory；
- Agentic query planning、多轮自动检索或复杂 rerank pipeline；
- MCP、Plugin、Skill、Multi-agent；
- 自动 Summary / Compaction；
- 训练或微调 Embedding / rerank 模型；
- OpenAI / Gemini 双 active provider、fallback 或在线向量迁移。

## 8. Phase 8 完成条件

只有以下条件全部满足，Phase 8 才能标记 Completed：

1. Task 0、Task 1、Task 2A、Task 2B、Task 3 均完成 GPT 技术验收和用户确认；
2. Article 内容可通过确定性 Chunk 与 Gemini active profile 的幂等索引进入 Embedding 存储；
3. Hybrid Retrieval 能在同一版本化评估集上与 lexical baseline 比较；
4. Agent 能消费受控 Retrieval Observation，而不破坏 Tool / Context 不变量；
5. 最终回答能够输出可验证来源，Web 和 Admin 能安全展示检索证据；
6. 关键失败路径、回归测试、评估结果与阶段边界均已归档。

## 9. 当前正式动作

```text
Phase 8：Active
Task 0：Completed / #48 / #49 / merge 4c2f7950
Task 1：Completed / #50 / #52 / merge 76d66abf
Task 2A：Completed / #54 / #55 / merge 3abdcb8a
Task 2B：Completed / #56 / #57 / merge 4f3ba1c1
Task 3：Next / Issue 未创建 / Gate 未执行
Active Agent Task：无
Minimal Compaction：Gated
```

下一步只讨论 Task 3 的拆分方式、Citation contract、证据不足行为、Web 来源交互和 Admin Inspector 验收边界。正式 Issue 与 Gate `READY` 前不得实现 Task 3。
