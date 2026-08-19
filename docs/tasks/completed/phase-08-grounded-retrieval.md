# Phase 8：Grounded Retrieval / RAG Baseline

状态：**Completed / 已归档**。

完成日期：2026-08-16（Asia/Shanghai）；归档日期：2026-08-20。

本文件是 Phase 8 的最终归档事实来源，合并了原 `docs/tasks/phase-08-grounded-retrieval/` 目录（总览与 Task 0、1、2A、2B、3、3A、3B、3C 全部文档）的核心内容，原目录已删除。详细需求、澄清、实现过程、Review 与完整验收记录以对应 GitHub Issue / PR、最终代码和 Git 历史为准。

## 阶段目标

Phase 8 建立的不是“向量数据库 Demo”，而是一条可评估、可索引、可检索、可引用、可观察的 Grounded Retrieval 链路：

```text
Article Source
  -> deterministic Chunking
  -> Gemini Embedding / pgvector Index
  -> Lexical + Vector Retrieval
  -> Hybrid RRF Ranking
  -> Context-safe Observation
  -> Grounded Finalization + Citation Validation
  -> durable MessageGroundingV1
  -> Web Source UI
  -> Admin Retrieval Inspector
```

## 交付记录

| Task | Issue / PR | 最终验收 head | Merge | 验收 |
| --- | --- | --- | --- | --- |
| Task 0：Retrieval Boundary & Offline Evaluation | #48 / #49 | `79c6f44b` | `4c2f7950` | GPT 技术验收 + 用户确认 |
| Task 1：Article Chunking & Embedding Index | #50 / #52 | `32598c73` | `76d66abf` | GPT 技术验收 + 用户确认 |
| Task 2A：Vector / Hybrid Retrieval & Evaluation | #54 / #55 | `32ff3443` | `3abdcb8a` | AC-01～AC-13 PASS |
| Task 2B：Retrieval Tool & Agent Integration | #56 / #57 | `9008c7be` | `4f3ba1c1` | AC-01～AC-16 PASS |
| Task 3A：Grounded Answer & Citation Backend | #58 / #59 | `1e7f4c71` | `d6df7ac1` | AC-01～AC-24 PASS；GPT 四轮验收 |
| Task 3B：Web Chat Source UI | #60 / #61 | `516dbd3f` | `572ad206` | AC-01～AC-12 PASS；Chromium 9 / repeat 27 |
| Task 3C：Admin Retrieval Inspector | #62 / #63 | `aadcadf5` | `20f838fb` | AC-01～AC-12 PASS；Admin 136 / DB 17 / Chromium 12 / repeat 36 |

所有 Task 均完成 GPT 技术验收和用户明确确认；对应 Issue 已 Closed、PR 已 Merged。Task 2B 的云端 Codex Review 因额度耗尽未产生 Review，不得表述为 Review 通过。

## Task 0：Retrieval Boundary 与离线 Evaluation Baseline

为现有 Article 关键词检索建立与 Tool / LLM 解耦的内部边界，并用无 LLM、无网络、无数据库的版本化 fixture 固化第一份离线评估基线。

- 建立 Article 专属 Retrieval 契约（query、ordered hits、total、rank、strategy/version）与 `PrismaArticleRetriever`；`search_articles` 委托 Retriever 且外部行为兼容；
- Retrieval 层不依赖 ToolDefinition、Registry、Tool call ID、LLM role、Prompt、`modelContent` 或 ChatStreamEvent；
- 建立版本化 fixture adapter、Recall@K / RR / Mean Recall@K / MRR 评估器与 `test:retrieval`、`eval:retrieval-baseline` 命令；
- baseline：`article-retrieval-baseline-v1` / `fixture_lexical/1`，8 cases，meanRecallAtK 0.875、MRR 0.875、zeroHit 1。该结果只证明 contract 与评估逻辑，不是线上检索质量认证。

核心认知：Retrieval 是内部数据能力，Tool 是 Agent 调用与 Observation 适配边界，两者不应互相污染；先固化 corpus、指标和可复现命令，再讨论新检索策略。

## Task 1：Article Chunking 与 Embedding Index

将 Article 富 HTML 转换为可重复生成、可追踪版本、可幂等重建的 Chunk 与 Embedding Index。

数据流：

```text
Article snapshot
  -> canonical structural block stream（cheerio）
  -> deterministic token-aware chunks（js-tiktoken cl100k_base）
  -> EmbeddingProvider（数据库事务外）
  -> commit 前 FOR UPDATE + sourceHash fencing
  -> delete old chunks + insert full replacement + upsert state（单事务）
```

### Deterministic Chunking 与 identity

- Chunk profile：`article-html-cl100k-v1`，targetTokens 600 / hardMaxTokens 800（含 title / section prefix）/ overlapTokens 80；超长块先按句子边界切分，再用 Unicode-safe tokenizer fallback；不生成纯 overlap Chunk；空正文 0 Chunk 且不调 Provider；
- `sourceHash` 由 `title + languageCode + canonical normalized structural block stream` 生成；style、class、无关 wrapper、事件属性和图片 URL 不进 hash；
- SHA-256 生成 `contentHash`、`embeddingInputHash` 与 deterministic Chunk ID；Chunk ID 至少绑定 `articleId + chunkerVersion + embeddingVersion + ordinal + embeddingInputHash`；ordinal 从 0 连续递增。

### Index 与 CLI 可靠性

- 正式 migration 启用 `vector` extension；新增 `ArticleChunk`（`vector(1536)`）与 `ArticleIndexState`；Vector raw SQL 收敛在专用 Repository；每篇 Article 只保留一个 active index；不创建 HNSW / IVFFlat，不引入独立 Vector DB；
- `index:articles` 支持 incremental / full / `--source-id`；`sourceId ASC` keyset 分批、Article 级并发 1；PostgreSQL session advisory lock 阻止并发 indexing；Embedding 调用在事务外；提交前复算 `sourceHash`，变化记 stale 不写入；Provider、协议、数据库、Abort、重试耗尽均 fail closed；CLI 输出脱敏 JSON summary 并用非零 exit code 表达异常；
- Embedding Provider 为项目内 Contract，独立 `EMBEDDING_*` 配置，不回退 `LLM_*`；SDK 隐式重试关闭，显式治理 timeout / retry / Abort；严格验证 response model、数量、index、顺序、维度与有限数值。

Task 1 时的 active profile 为 `openai:text-embedding-3-small:1536:v1`，在 Task 2A 整体迁移为 Gemini profile，通过 `embeddingVersion` 显式隔离，无双读 / fallback / 在线迁移。Task 1 验收时接受的真实 pgvector 环境验证缺口，已由 Task 2A 隔离 integration 环境与后置维护 #84（dev 主库镜像对齐 pgvector）收口。

## Task 2A：Vector / Hybrid Retrieval 与 Evaluation

### 最终 active Embedding profile

```text
provider: google
model: gemini-embedding-2
dimensions: 1536
embeddingVersion: google:gemini-embedding-2:1536:search-result-v1
```

Indexing 与 Query 共用同一 `EmbeddingProvider`、profile、formatter 与 Gemini adapter；Embedding 只读取 `GEMINI_API_KEY`；DeepSeek 继续负责 Chat / Agent LLM。

- Query formatter：`task: search result | query: {normalized query}`；
- Document formatter：`title: {article title} | text: {section path + normalized chunk text}`；
- 固定 `outputDimensionality = 1536`；校验 cardinality、顺序、维度、有限数值和非零向量。

### Retrieval

- pgvector cosine distance + exact nearest-neighbor（无 HNSW / IVFFlat）；过滤 active profile、chunker / embedding version、language、stale 与 Chunk count 一致性；
- 最多 40 个 Chunk candidates，聚合为最多 10 个唯一 Article，每篇保留最佳一个 evidence chunk（真实 `chunkId`、`sectionPath`、cosine distance），rank 连续稳定；
- lexical strategy：title exact > title / slug / seoTitle contains > seoDescription > content；`%`、`_`、`\` 按 literal 处理；
- Hybrid RRF：`1 / (60 + lexicalRank) + 1 / (60 + vectorRank)`，单通道只累加存在分量，同分按 `sourceId` 稳定排序；
- DB deadline / Abort 有真实 PostgreSQL integration test 证明 query 终止、连接释放与 pool 复用；
- 隔离 pgvector 环境：`pgvector/pgvector:0.8.6-pg16-bookworm`、独立 container / 端口 5433 / volume；`index:articles:integration` 只读取 `ARTICLE_INDEX_TEST_DATABASE_URL`，缺失、回退或与开发 URL 相同时 fail closed。

### 真实收口证据与 quality-v2

隔离 full indexing：68 / 68 Articles、2044 Chunks、providerRequests 68、retryCount 0、exit 0；审计无 stale、无 OpenAI 混入、无空 / 零维向量、无 ordinal 断档。

| Strategy | Hit@5 | Recall@5 | Precision@5 | MRR | No-answer Acc | FP query / hit | Zero-hit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| legacy lexical | 0.2 | 0.2 | 0.04 | 0.2 | 1.0 | 0 / 0 | 7 |
| Gemini vector exact cosine | 1.0 | 1.0 | 0.24 | 1.0 | 0 | 3 / 15 | 0 |
| hybrid RRF | 1.0 | 1.0 | 0.24 | 1.0 | 0 | 3 / 15 | 0 |

### Similarity Threshold 决策

正样本 cosine distance：min 0.1335 / median 0.1556 / max 0.2685；负样本：min 0.1533 / median 0.3866 / max 0.4885。正负分布明显重叠（negative min < positive max），单一 threshold 无法同时保留召回并拒绝全部负样本，因此 `similarity threshold = null`。这是证据驱动的决定，不是遗漏；no-answer query 会返回近邻 false-positive candidates，该基线被明确记录而不是被拍脑袋阈值掩盖。

## Task 2B：Retrieval Tool 与 Agent Integration

### `retrieve_article_context@1`

- 输入：`query`（≤100 字符）、可选 `languageCode`、可选 `limit`（默认 3，1～5，Tool Boundary 再次 `slice`）；
- `timeoutMs = 30_000`；`maxObservationChars = 8_000`；
- Tool 只依赖 `ArticleRetriever`，不复制 Vector SQL、Embedding ranking、Article aggregation 或 RRF；
- 输出为安全候选投影：`kind: 'article_retrieval_candidates'`、`status: 'candidates_returned' | 'no_candidates'`、恒为 `answerStatus: 'unverified'`、strategy name/version、sources（sourceId、slug、title、languageCode、rank、excerpt、optional evidence `chunkId` / `sectionPath`）；不包含 raw embedding、cosine distance、完整正文、SQL / Provider payload、credential 或 stack trace。

### 候选语义与 Prompt 边界

- `candidates_returned` 不等于 `answer_found`；语义近邻候选不代表站内知识一定存在答案；证据不足、过弱或矛盾时必须说明无法确认；
- system prompt 区分三个 Tool：`search_articles` 关键词 discovery、`retrieve_article_context` 语义候选证据、`get_article_detail` 已有 `sourceId` 时读全文；不因 Retrieval 结果出现 `sourceId` 就自动读全文；
- excerpt 是低信任正文，内部指令不得覆盖 system / developer policy。

### Runtime 组装与治理

- `HybridArticleRetrievalRuntime` 懒初始化：普通启动 / build / 无关测试不要求 `GEMINI_API_KEY`，首次调用才解析配置并创建连接池，Module 销毁释放；
- Tool network access 三态 `none | trusted_provider | arbitrary`；只有 low-risk、无副作用、幂等、无需审批且网络为 `none` / `trusted_provider` 的工具可执行，其余 fail closed；模型 arguments 不能覆盖 server-owned risk metadata；
- Observation 先经 8,000 字符 Tool ceiling，再经 Phase 7 Context Planner，超限保留 truncation marker；Retrieval 内容只进 model-visible `tool_result`，不写入用户可见 `Message.content`；Tool Call / Result 以相同 `callId` 配对；
- `normalizeToolStepSummary`：2,000 字符预算、最大 5 层深度；BigInt、undefined、function、symbol、非有限数字、循环引用、超大超深、非普通顶层对象 fail closed；非法 summary 安全忽略，不影响 pairing 与 Run 收口；Retrieval Step 只记录 status、strategy、计数与最多 5 个 `sourceId / chunkId` 引用。

失败行为要点：参数非法前置拒绝（Retriever / DB / Provider 不执行）；zero-hit 是成功空结果；Provider / DB 失败脱敏 `execution_failed`，不伪装 zero-hit、不自动 migration；lexical 或 vector 单通道失败则整体失败，不静默降级；Abort 沿用 Run cancellation 所有权收口 ABORTED。

## Task 3 编排：共享 Contract 与不变量

Task 3 拆分为 3A（后端事实层）、3B（用户侧来源表达）、3C（开发者侧审计），后续层只消费前一层已稳定的事实。

```text
MessageGroundingV1
  ├─ schemaVersion: 1
  ├─ evidenceAvailability: available / partial / none / unavailable
  ├─ outcome: answered / insufficient_evidence / conflicting_evidence
  ├─ citationIntegrity: validated
  ├─ faithfulnessStatus: not_evaluated
  └─ citations: MessageCitationV1[]
```

实时 `done.grounding`、历史 `ConversationMessage.grounding` 与 Admin `retrievalInspector` 消费同一 durable fact，不建立平行 Citation schema。

共享不变量：

1. Retrieval candidate 不等于 answer found。
2. Citation 必须追溯到本 Run 的真实 evidence identity。
3. 不解析任意 Markdown `[1]`、URL、title 或数组位置作为 Citation。
4. `citationIntegrity=validated` 不代表 semantic faithfulness。
5. Tool Observation 继续是低信任 model-visible data。
6. UI transcript、model-visible context、durable Grounding 与 Admin trace 分层。
7. malformed、legacy、FAILED、ABORTED 数据 fail closed。
8. 不暴露 Prompt、reasoning、embedding、SQL、Provider payload、完整正文或 secret。
9. Streaming、Abort、deadline、Tool pairing、Context Budget 和 Run terminalization 不退化。
10. Web 与 Admin 只能消费 Task 3A contract，不能重新定义事实层。

## Task 3A：Grounded Answer 与 Citation Backend Contract

### 最终链路

```text
evidence-eligible Tool outcome
  -> Grounding Session
  -> Run-scoped Evidence Registry
  -> hidden final draft
  -> submit_grounded_answer@1
  -> server-side Citation validation
  -> validated assistant_delta replay
  -> Message + Grounding + finalization Step + assistant Step + Run 原子终态
  -> optional grounding on done / Messages API
```

### 关键决策（D-01～D-26 精要）

- 使用专用终态结构化输出 contract `submit_grounded_answer@1`，只在 finalization sampling 暴露；它不是普通业务 Tool——不进 ToolInvocationService、不创建 Tool Result、不消耗 action Tool budget，且使用独立 attempt budget（最多一次 correction，总计 2 attempts）；
- Evidence-backed answer 必须经过 finalization；无 evidence-eligible Tool 的普通回答保持原 Streaming 路径；
- final draft 在校验前不可见、不可持久化；校验通过后用 Unicode-safe deterministic chunks 经既有 `assistant_delta` 重放，拼接必须等于 persisted content / done.content；
- Citation 使用 Run-scoped opaque `citationKey`（`evk_<32hex>`，内部）与公开持久化 `cit_<32hex>`（外部）分离；key 只允许绑定本 Run 真实 evidence ref，不跨 Run、不从历史继承；模型不能直接提交 sourceId / chunkId / URL 作为已验证引用；
- v1 为 message-level citations（claim-level span 延后）；outcome 固定三值；`faithfulnessStatus` 固定 `not_evaluated`，禁止虚构 verified；
- v1 evidence-eligible Tool 为 Retrieval 与 Article Detail；Search Articles 保持 discovery-only；首次调用 eligible Tool 即建立 Grounding Session，zero-hit / not found / Tool failure 也进入明确状态；
- `evidenceAvailability` 完全由服务端事实派生（available / partial / none / unavailable），模型不能覆盖；Evidence Registry hard cap 10 refs，确定性去重 / 排序，超限记录 `registryTruncated`；
- eligible Tool 必须显式提交 bounded、allowlisted evidence projection；`{ refs: [] }` 是合法 zero-hit，缺失或 malformed projection 是 evidence failure；Runtime 不从 data / modelContent / 日志猜证据；
- completed Grounding 只属于 COMPLETED assistant Message（一对一 durable record，citations 为 versioned safe JSON，最多 5 条）；RUNNING / FAILED / ABORTED 不持久化 completed Grounding；replay 期间 Abort 保留 partial content / ABORTED；
- `done` 事件只增加 optional `grounding`，Messages API 与实时 done 使用同一 durable projection；Grounding 不自动进入未来模型历史。

### 校验与失败语义

- finalization 必须完整返回唯一 `submit_grounded_answer` Tool Call、`response_completed` 与 `finishReason=tool_calls`；schema / Citation 错误允许 correction 一次，Provider 流故障不消耗 correction；
- unknown、伪造、重复、cross-run citationKey 没有成功路径；`answered` 至少 1 条有效 Citation；`conflicting_evidence` 至少 2 个不同 source；`none / unavailable` 只能 insufficient 且零 Citation；`available / partial + insufficient_evidence` 可携带 0～5 条“已检查的资料”；
- eligible Tool 全部失败为 `unavailable`（不伪装无答案）；部分成功为 `partial`（只允许引用成功 evidence）；Article Detail 产生 article-level Citation，不伪造 chunkId / excerpt；
- finalization sampling、usage、Abort、deadline 与终态事务失败的 attempt 事实不丢失；Admin samplingCount / Token 聚合包含 finalization，metadata 不可信时 all-or-nothing fail closed；commit outcome unknown 延续未知结果语义，不盲目重试；legacy Message 按无 Grounding 渲染；persisted Grounding malformed 时 projector fail closed，不泄漏原始 JSON。

GPT 四轮技术验收：第一轮收紧 Context 信任边界与 finalization 原子终态等七项；第二轮补齐 sampling failure / replay Abort attempt 记账；第三轮发现 post-sampling availability check 位于 `try` 外导致 attempt 丢失；第四轮确认窗口覆盖，P0 / P1 / P2 均为 0。已知非阻塞事实：answerable live smoke 曾出现一次 Provider 保守判断为 insufficient（未放宽门禁、未引入“重试直到 answered”）；`href` v1 恒为 null；同轮仍只接受单个 Tool Call。

## Task 3B：Web Chat Source UI

在不解析模型任意 Markdown 引用的前提下，让 Web Chat 消费 durable `MessageGroundingV1`，展示可靠、可访问、可重载的来源状态。

关键决策：来源由结构化 Grounding 渲染（不扫描 `[1]`）；只在 completed answer 后出现；编号由 UI 按 contract 顺序生成，模型不控制；URL 只能来自服务端安全投影（v1 `href` 为 null，Source Card 用非交互元素，不自行拼接路由）；answered / insufficient / conflicting 使用不同产品语义，不把“有候选”渲染成“已验证答案”；malformed Grounding 按“无 Grounding”处理，正文保留、区域隐藏；aborted / error 不展示 completed Grounding。

状态行为：streaming 期间不显示候选；`none` 显示“没有找到可用资料”；`unavailable` 显示“检索能力暂不可用”，不得伪装成无资料；`partial` 显示“部分证据链不可用”，只展示合法 Citation；`available + insufficient` 显示“资料不足以支撑结论”，Citation 标为“已检查的资料”；conflict 显示冲突提示并列出至少两个来源；legacy / 普通回答 UI 不变。

实现落点：`utils/message-grounding.ts`（normalization / done 合并 / 终态清理）→ `hooks/useSeoWorkspace.ts` → `utils/conversation-turns.ts`（只投影 COMPLETED assistant）→ `utils/grounding-presenter.ts`（outcome × availability 状态表）→ `AgentGroundingPanel.vue` / `AgentSourceCard.vue`；全部复用 `@agent/contracts` 的 `parseMessageGroundingV1()`，Web 侧无第二套 contract。来源卡片最多展示 UI 编号、title、language、sectionPath、bounded excerpt 与 granularity，不展示 score / distance / slug / rank / strategy 主视觉。

浏览器证据：desktop answered、narrow answered 长内容、desktop insufficient + unavailable、narrow conflicting + partial 截图与 reload 一致性断言（截图归档时未保留，以 Chromium 测试与 PR #61 记录为准）。

## Task 3C：Admin Retrieval Inspector

在现有 Run Trace Workspace 中增加 typed、bounded、fail-closed 的 Retrieval / Grounding Inspector，回答：本 Run 调用了哪些 evidence-eligible Tool、候选与 evidence identity、最终 Citation 用了哪些 source / chunk、finalization outcome / attempt / validation / usage，以及 zero-hit、failure、Abort、legacy、malformed 发生在哪一层。

- `packages/contracts/src/admin-run.ts` 新增 `AdminRetrievalInspector` 及 Call / Finalization / Citation summary 类型与 `AdminRunDetail.retrievalInspector`；Run 级 `candidateCount / evidenceRefCount` 区分“确定为 0”与“无法确认为 null”；
- `admin-retrieval-inspector.projector.ts` 只从持久化事实（AgentRun + eligible Tool Steps + grounded_finalization Step + MessageGrounding）构建 Read Model；`name@version + evidencePolicy` 三态分类；`sourceId + nullable chunkId` 精确 correlation；malformed 单项回落 Generic，不拖垮 Run Detail；allowlist 输出，不返回原始 Step JSON；
- availability 语义：`not_applicable`（无 eligible call / finalization / Grounding 且无不可分类 Step）、`unavailable`（已进入链路但无足够可信事实）、`available`（Run COMPLETED + 全部 metadata 可信 + finalization COMPLETED / validation passed + Grounding 合法 + Citation 全部 matched + evidence count 与 Registry 一致）、`partial`（有部分可信事实但链路不完整 / 截断 / 兼容降级）；与 Grounding 的 availability 分层，zero-hit 审计事实完整时 Inspector 仍可 `available`；
- finalization 状态机严格 reader：非最后 attempt 只能是 correction rejection；成功 / sampling failure 必须是最后一次；顶层错误字段严格互斥；`PENDING / RUNNING` 只能 `output=null`；post-validation replay / commit failure 可保留 `validation=passed` 但 Inspector 只能 `partial`；
- Admin API 与 DOM 不暴露 Prompt、reasoning、hidden draft、raw arguments / Observation、excerpt、完整正文、embedding、distance、SQL、Provider payload、Key、内部 `citationKey / evk_`；前端不解析原始 JSON 重建 Inspector；
- Playwright 覆盖 COMPLETED answered、RUNNING partial、FAILED、zero-hit、Tool unavailable、`ok=null`、`not_applicable`、unclassifiable、malformed、320px / 1024px 布局边界。

已知边界：`get_article_detail@1` evidence-eligible 但不提交 `stepSummary`，独占 Citation 会 `unmatched -> partial`；query v1 无 typed metadata 来源保持 `null`；20 calls / 5 refs 上限在 `maxToolCalls=2` 下主要由 fixture 验证；Admin 全局仍 `min-width: 1024px`；Admin Auth / RBAC 未实现，按最小披露处理。

浏览器证据：answered / zero-hit / failed / malformed / unclassifiable / narrow-320 等 11 类场景截图（归档时未保留，以 Playwright 测试与 PR #63 记录为准）。

## 最终验证摘要

| Task | 关键证据 |
| --- | --- |
| Task 0 | baseline 可离线重复、稳定 JSON；Tool / Loop 回归通过 |
| Task 1 | Article Indexing 46、Retrieval 18、Tools 40、Tool Loop 52；68 Articles / 2044 Chunks 连续运行 digest 一致 |
| Task 2A | 隔离 full indexing 68 / 68、2044 Chunks；真实 Gemini smoke 1×1536；quality-v2 三策略完整比较 |
| Task 2B | seo-service 19、tools 69、tool-loop 54、context 24、retrieval 35、retrieval-db 9、model-stream 67；真实 Retrieval Tool smoke（hybrid_rrf@1、3 sources、truncated=false） |
| Task 3A | grounding 168、grounding-db 9、共 14 个 suite 全绿；真实 DeepSeek + Gemini + 隔离 pgvector answered / insufficient smoke 均 run_completed |
| Task 3B | Web node 43、seo-stream 12、Chromium 9、repeat-each=3 27，0 flaky；reload 一致性断言 |
| Task 3C | admin-runs 136、grounding 168、grounding-db 17、Admin Chromium 12、repeat 36；frozen install / contracts / typecheck / lint / build 全 PASS |

各 Task 的源码 scoped lint / typecheck / build 均通过；根 `pnpm lint` 保留既有 Markdown baseline 错误（收口时 113 个），不属于 Phase 8 各 Task。DB integration 验证均使用 `ARTICLE_INDEX_TEST_DATABASE_URL` 指向的隔离 pgvector PostgreSQL（一次性 schema、结束 DROP CASCADE、拒绝与 `DATABASE_URL` 相同）。

## 阶段不变量

- Retrieval 是内部数据能力，Tool 是 Agent 调用和 Observation 边界。
- Indexing 与 Query Embedding 使用一致 provider / model / dimensions / formatter / version。
- candidate 不等于 answer found。
- Tool / Retrieval 内容始终是低信任 Context。
- Citation 必须追溯到本 Run 的真实 source / optional chunk。
- Citation identity validation 不冒充 semantic faithfulness。
- UI transcript、model-visible context、durable Grounding、Admin trace 分层。
- Inspector 不暴露 Prompt、reasoning、embedding、SQL、Provider payload、完整正文或 secret。
- 不因为进入 RAG 阶段自动引入 LangChain、LangGraph、独立 Vector DB 或通用知识库框架。

## 已知边界与后置项

以下不是 Phase 8 缺陷，而是明确后置，不得因 Phase 8 完成自动启动：

- no-answer nearest-neighbor false positives（threshold 保持 null 的既定基线）；
- claim-level inline citation spans；在线第二模型 judge；
- PDF / Office 与通用知识库；多租户 ACL、外部连接器；
- Agentic query planning、复杂 rerank / query rewrite；
- Admin Auth / RBAC（Task 4）；Durable Recovery；
- Memory、MCP、Multi-agent；自动 Compaction；并行 Tool Call。

## 完成条件核对

1. Task 0、1、2A、2B、3A、3B、3C 均完成 GPT 技术验收和用户确认：满足。
2. deterministic Chunk 与 Gemini profile 幂等索引：满足。
3. Hybrid Retrieval 有版本化评估：满足。
4. Agent 消费受控 Observation 且不破坏 Tool / Context 不变量：满足。
5. evidence-backed answer 使用服务端验证的 durable Citation：满足。
6. Web 与 Admin 消费同一 Grounding / Retrieval 事实：满足。
7. zero-hit、conflict、invalid citation、legacy、error、aborted 路径完成归档：满足。

## 合并后维护记录

Phase 8 收口后的后置维护（详见 `docs/work-log.md`）：#64-#67、#71 后置修复；#72-#77 全仓源码审计批量收口；#84 开发环境自举缺陷（dev 主库镜像对齐 pgvector）。均已合并关闭。

## 阶段收口

```text
阶段 1-8：Completed
Phase 8：Completed / 已归档
Active Agent Task：无
Minimal Compaction：Gated
Admin Task 4：Planned
Phase 9：未定案
当前阶段：Phase 8 源码阅读（学习阶段）
```

当前进入源码阅读学习阶段：回读 Phase 8 代码与数据链路，不创建 Issue、不修改正式代码；下一阶段学习内容暂不定义。Phase 9 在源码阅读完成后基于真实需求再讨论。
