# Phase 8 Task 3A：Grounded Answer 与 Citation Backend Contract

状态：**Active / Issue #58 / Gate READY / 实施状态：已实现 / 验收状态：待验收**。

## 1. 目标

为 Evidence-backed answer 建立 Provider-neutral、可验证、可持久化的后端事实层：

```text
本 Run Retrieval evidence
  -> structured finalization
  -> server validation
  -> atomic Message + Grounding + Run terminalization
  -> optional grounding on done event / Messages API
```

本 Task 不实现 Web 来源卡片，也不实现 Admin Retrieval Inspector。

## 2. 当前代码事实

- `retrieve_article_context@1` 已返回最多 5 个 candidate source；
- `get_article_detail@1` 可返回完整 Article，但没有 Citation / Evidence projector；
- `search_articles@1` 只负责关键词 discovery，不是证据片段；
- candidate 具有 `sourceId`、title、slug、language、rank、excerpt 和可选 `chunkId / sectionPath`；
- candidate 语义为 `unverified / untrusted`；
- 当前 Runtime 最终只输出字符串 content；
- 当前 `ConversationMessage` 与 `ChatStreamDoneEvent` 没有 Grounding；
- 当前 Message 表没有 Citation metadata；
- 当前 Web NDJSON parser 对未知 top-level event type fail closed，但允许已有 event 上出现额外字段；
- 当前数据库终态链路已经处理 deadline、Abort、late result fencing 与 commit outcome unknown。

## 3. 已确认决策

| ID | 决策 | 说明 |
| --- | --- | --- |
| D-01 | 使用专用终态结构化输出 contract | 不解析任意 Markdown `[1]` |
| D-02 | 内部 contract 建议命名 `submit_grounded_answer@1` | 只在 finalization sampling 暴露；不依赖宽松 JSON mode |
| D-03 | 它不是普通业务 Tool | 不进入 ToolInvocationService、不创建 Tool Result、不消耗 Tool budget |
| D-04 | Evidence-backed answer 必须经过 finalization | 无 evidence-eligible Tool 的普通回答保持现状 |
| D-05 | final draft 在校验前不可见、不可持久化 | 避免校验失败后的 UI 回滚与脏 Message |
| D-06 | 使用 Run-scoped opaque `citationKey` | 模型不能直接提交 sourceId / chunkId / URL 作为已验证引用 |
| D-07 | Citation key 只允许绑定本 Run 成功 evidence ref | 不跨 Run、不从历史继承 |
| D-08 | v1 采用 message-level citations | claim-level span / offsets 延后 |
| D-09 | outcome 固定为 `answered / insufficient_evidence / conflicting_evidence` | 明确区分回答、资料不足和冲突 |
| D-10 | `citationIntegrity=validated` 只表示引用身份通过校验 | 不等价于 semantic faithfulness |
| D-11 | v1 固定 `faithfulnessStatus=not_evaluated` | 禁止虚构 `verified=true` |
| D-12 | 最多一次 correction sampling | 第二次仍失败则 fail closed |
| D-13 | Message Grounding 使用一对一 durable record | 不使用无约束 Message metadata bag |
| D-14 | citations 作为 versioned safe JSON 保存 | v1 最多 5 条，按整体读取；后续有真实查询需求再规范化 |
| D-15 | `done` 事件只增加 optional `grounding` | 不新增 top-level stream event type |
| D-16 | Messages API 返回 optional Grounding | 页面重载与实时 done 使用同一 durable projection |
| D-17 | validated delta 重放完成后，content、Grounding、Run / Step 终态原子提交 | 重放期间 Abort 保持现有 partial-content / ABORTED 语义 |
| D-18 | 不把 Grounding 自动注入未来模型历史 | UI / audit metadata 与 model-visible context 分层 |
| D-19 | Tool 自己产生 bounded evidence projection | Runtime 不解析任意 Tool data / modelContent 文本 |
| D-20 | v1 evidence-eligible Tool 为 Retrieval 与 Article Detail | `search_articles` 保持 discovery-only；detail rank 可空 |
| D-21 | Grounded finalization 使用独立 attempt budget | v1 最多 2 次，不挤占 action-loop sampling / Tool budget |
| D-22 | 首次调用 eligible Tool 即建立 Grounding Session | zero-hit、not found、Tool failure 也进入明确状态 |
| D-23 | `evidenceAvailability` 由服务端派生 | `available / partial / none / unavailable`，模型不能覆盖 |
| D-24 | Evidence Registry v1 hard cap 为 10 refs | 确定性去重 / 排序，超限记录 `registryTruncated` |
| D-25 | Grounding 只属于完成的 assistant Message | RUNNING / FAILED / ABORTED 不持久化 completed Grounding |
| D-26 | validated answer 使用 Unicode-safe deterministic chunks 重放 | chunks 拼接必须等于 persisted content / done.content |

## 4. 推荐 contract

### 4.1 模型终态输入

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

### 4.2 对外 Grounding

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
```

`MessageCitationV1` 至少包含：

- server-issued `citationId`；
- `sourceId`；
- nullable `chunkId`；
- `granularity: article | chunk`；
- title / slug / languageCode；
- nullable sectionPath；
- nullable bounded excerpt snapshot；
- nullable rank；
- server-derived nullable href（public projection only）；
- retrieval strategy name / version。

内部字段命名可遵循项目惯例，但外部语义必须等价。

## 5. Runtime 实现范围

### 5.1 Grounding Session 与 Evidence Registry

- ToolDefinition 使用服务端 evidence policy 标记 eligible / discovery-only；
- 首次调用 eligible Tool 即建立 Grounding Session；
- Runtime 根据成功 refs、zero-hit / not found 和 Tool failure 派生 `evidenceAvailability`；
- 从本 Run evidence-eligible Tool Result 的安全 projection 构建；
- `retrieve_article_context@1` 投影 source / optional chunk evidence；
- `get_article_detail@1` found 时投影 article-level evidence；
- `search_articles@1` 不进入 Registry；
- ToolResult evidence projection 必须经过类型、大小、深度和字段 allowlist 校验；
- Runtime 为每个标准化 ref 生成 opaque citationKey；
- 保留 source / chunk identity 与安全展示快照；
- 不接受模型覆盖或扩展 Registry；
- 多次 Tool 调用时合并 evidence，并对相同 source/chunk 稳定去重；detail 不能伪造 chunk identity；
- Registry 最多 10 refs，按 Tool sequence、Tool 内 rank、stable identity 确定性排序；
- 超限记录 `registryTruncated`，不能静默丢弃；
- Registry 仍受现有 Run deadline、Context Budget 和内存边界治理。

### 5.2 Finalization Sampling

- 只在本 Run Grounding Session 已建立且即将产出最终回答时触发；Registry 可以为空；
- 输入为 final draft、server-derived evidenceAvailability、eligible Tool outcome summary 与本 Run Evidence Registry 的安全模型投影；
- action Tool 列表为空；只暴露终态 output contract；
- finalization 计入总 sampling count、token usage、trace 和 Run remaining time；
- 使用独立 finalization attempt budget，v1 首次 + correction 最多 2 次；
- finalization reserve 不能用于继续调用 action Tool；
- 记录专用、typed、bounded AgentStep metadata，包括 Registry ref count / truncated、availability、attempt；
- 不记录完整 finalization Prompt、reasoning 或 untrusted excerpt 全文。

### 5.3 Validation

至少校验：

- schema、JSON size / depth / string length；
- evidenceAvailability 由服务端派生，模型不能提交或覆盖；
- citation key 存在且属于当前 Run；
- citation 数量 0-5、稳定去重；
- `answered` 只允许 `available | partial`，且至少 1 个 citation；
- `conflicting_evidence` 只允许 `available | partial`，且至少 2 个不同 source；
- `insufficient_evidence` 允许 0..5 citation；availability 为 `none | unavailable` 时必须为 0；
- source-level evidence 不伪造 chunkId；
- 不接受 raw URL、sourceId、chunkId 替代 citationKey；
- malformed / unknown / cross-run key fail closed；
- delta replay 不拆坏 Unicode code point，拼接结果逐字符等于 validated answer。

### 5.4 Correction 与失败

- 第一次结构或引用校验失败后最多 correction 一次，总 attempt 上限为 2；
- 现有 action-loop sampling / Tool budget 保持不变；
- correction 只提供安全错误类别；
- 仍失败时不展示、不持久化 draft；
- 按现有 Message / Run failure semantics 收口；
- Provider / DB / timeout 与 zero-hit 必须区分；
- Abort 不得转成普通 finalization failure。

### 5.5 Persistence

新增 assistant Message 的一对一 Grounding durable record，保存：

- schema version；
- outcome；
- citation integrity；
- faithfulness status；
- evidence availability；
- versioned safe citations JSON；
- timestamps。

在 validated answer 的全部 `assistant_delta` 重放完成后，必须在同一终态事务中提交：

```text
assistant Message content/status
Message Grounding
assistant_output / finalization Step terminal state
AgentRun terminal state
```

继续覆盖：

- statement / lock timeout；
- deadline；
- late acquisition / late result fencing；
- commit outcome unknown；
- rollback 后无半完成 Grounding；
- delta 重放期间用户 Abort 时，沿用 partial assistant content + ABORTED，且不创建 completed Grounding。

### 5.6 Public API / Stream

- `ConversationMessage.grounding?: MessageGroundingV1 | null`；
- `ChatStreamDoneEvent.grounding?: MessageGroundingV1`；
- 既有 start / delta / error / aborted 不变；
- 无 Retrieval 的普通回答和 legacy Message 不产生 Grounding；
- API projector 对 malformed persisted JSON fail closed；
- public href 由服务端根据持久化 slug 和 allowlisted internal route 派生；
- 不暴露 raw Registry key、模型 URL 或内部 validation details。

## 6. 边界与失败行为

| ID | 场景 | 预期行为 |
| --- | --- | --- |
| E-01 | 本 Run 未调用 evidence-eligible Tool | 保持现有普通回答路径，无 Grounding |
| E-02 | zero-hit / detail not found | `evidenceAvailability: none` + `insufficient_evidence` + 0 citation |
| E-03 | eligible Tool 全部失败 | `evidenceAvailability: unavailable` + `insufficient_evidence`，明确工具不可用 |
| E-04 | 部分 evidence 成功、部分 Tool 失败 | `partial`；只允许引用成功 evidence |
| E-05 | 近邻候选不足 | `available | partial` + `insufficient_evidence`，不能转成确定答案 |
| E-06 | 充分且一致 | `available | partial` + `answered`，至少一个有效 citation |
| E-07 | 真实来源冲突 | `available | partial` + `conflicting_evidence`，至少两个不同 source |
| E-08 | 未知 citationKey | 校验失败，不进入 durable Grounding |
| E-09 | cross-run citationKey | 校验失败，防止历史 evidence 越界 |
| E-10 | Article Detail / source-only evidence | 允许 article granularity，不伪造 chunkId，excerpt 可空 |
| E-11 | schema / JSON 异常 | correction 一次，仍失败则 fail closed |
| E-12 | finalization timeout / Provider failure | 安全失败，不伪装 zero-hit |
| E-13 | finalization 前 Abort | 保持 ABORTED，不展示 draft、不生成 Grounding |
| E-14 | validated delta 重放期间 Abort | 保存现有允许的 partial content / ABORTED，不生成 completed Grounding |
| E-15 | commit outcome unknown | 延续现有未知结果语义，不盲目重试写入 |
| E-16 | legacy Message | API 与客户端按无 Grounding 渲染 |
| E-17 | persisted Grounding malformed | projector fail closed，不泄漏原始 JSON |

## 7. 验收标准

| ID | 可观察行为 | 验证方式 |
| --- | --- | --- |
| AC-01 | Evidence-backed answer 只能通过结构化 finalization 完成 | Runtime 自动测试 |
| AC-02 | 普通回答路径不被强制改成 Grounded finalization | 回归测试 |
| AC-03 | citationKey 由服务端生成且仅本 Run 有效 | 单元 + Runtime 测试 |
| AC-04 | Retrieval / Article Detail evidence projector 受约束，Search Articles 不进入 Registry | Tool + Runtime 测试 |
| AC-05 | Registry 10 refs hard cap、stable dedupe/order 与 truncation 可验证 | Unit + Runtime 测试 |
| AC-06 | 未知、伪造、cross-run key 不存在成功路径 | 负向测试 |
| AC-07 | `answered` 至少一条有效 Citation | contract 测试 |
| AC-08 | `conflicting_evidence` 至少两个不同 source | contract 测试 |
| AC-09 | zero-hit / not found 为 `none`；Tool failure 为 `unavailable`；混合结果为 `partial` | fixture + Runtime 测试 |
| AC-10 | weak evidence 输出 insufficient，不补全答案 | fixture + Runtime 测试 |
| AC-11 | finalization 最多 2 attempts，且不消耗/扩展 action Tool budget | 调用次数与 policy 断言 |
| AC-12 | correction 后仍无效时 draft 不可见且不落库 | Runtime + DB 测试 |
| AC-13 | validated delta 使用 Unicode-safe deterministic chunks，拼接等于 persisted / done content | Runtime + mapper 测试 |
| AC-14 | validated delta 重放期间 Abort 保留 partial content / ABORTED，且无 completed Grounding | Runtime + DB 测试 |
| AC-15 | Message content、Grounding、Run / Step 终态原子一致 | DB integration / failure injection |
| AC-16 | commit outcome unknown、deadline、Abort 语义不退化 | reliability regression |
| AC-17 | `done.grounding` 与 Messages API Grounding 内容一致 | API / mapper 测试 |
| AC-18 | legacy Message、普通回答、旧 stream consumer 保持兼容 | contract + Web parser regression |
| AC-19 | API / Step 不暴露 raw key、Prompt、reasoning、embedding、distance、SQL、secret | 安全投影负向测试 |
| AC-20 | Grounding schemaVersion 固定并对 malformed data fail closed | projector 测试 |
| AC-21 | Tool Call / Result pairing、Context Planner 与 action-loop budget 不退化 | 现有 test suites + policy tests |
| AC-22 | 真实 DeepSeek + Gemini + 隔离 pgvector 覆盖 answered 路径 | 脱敏 smoke |
| AC-23 | 真实环境覆盖 insufficient 路径并无伪造 Citation | 脱敏 smoke |
| AC-24 | `get_article_detail` 可产生 article-level Citation，且不会伪造 chunk / excerpt | Integration |

Issue 创建时必须把每条 AC 映射到具体测试命令、环境和证据。

## 8. 明确不做

- Web 来源卡片；
- Admin Retrieval Inspector；
- claim-level inline offsets；
- 在线第二模型 judge；
- similarity threshold / rerank / query rewrite；
- Provider-native citations；
- LangChain / LangGraph / LlamaIndex 依赖；
- 文件知识库、多租户 ACL、Memory、MCP、Multi-agent；
- Admin Auth / RBAC。

## 9. 学习重点

完成本 Task 后应能解释：

1. Tool Call 与 terminal structured output 的区别；
2. Citation reference integrity 与 faithfulness 的区别；
3. 为什么 UI metadata 不自动进入 model history；
4. 为什么 Grounding 必须与 Message 终态原子提交；
5. 为什么检索近邻不能直接等价为答案；
6. 如何在不更换 Provider 的前提下建立 Provider-neutral Citation contract。

## 10. GitHub 交付状态

- Issue：[#58](https://github.com/mufeiyu-ayu/agent/issues/58)
- 分支：`codex/issue-58-grounded-answer-citation-contract`
- PR：Draft
- Clarification Gate：`READY`
- 实施状态：已实现
- 验收状态：待验收

### 10.1 验证结果

全部命令均在本地真实执行（数据为 GPT Review 修复后的最新一轮）：

| 命令 | 结果 |
| --- | --- |
| `pnpm --filter @agent/api test:grounding` | pass 163 / fail 0 |
| `pnpm --filter @agent/api test:grounding-db` | pass 9 / fail 0 / skipped 0 |
| `pnpm --filter @agent/api test:agent-recorder` | pass 14 / fail 0 |
| `pnpm --filter @agent/api test:tool-loop` | pass 54 / fail 0 |
| `pnpm --filter @agent/api test:model-stream` | pass 67 / fail 0 |
| `pnpm --filter @agent/api test:tools` | pass 86 / fail 0 |
| `pnpm --filter @agent/api test:seo-service` | pass 24 / fail 0 |
| `pnpm --filter @agent/api test:context` | pass 24 / fail 0 |
| `pnpm --filter @agent/api test:retrieval` | pass 35 / fail 0 |
| `pnpm --filter @agent/api test:retrieval-db` | pass 9 / fail 0 / skipped 0 |
| `pnpm --filter @agent/api test:db-reliability` | pass 11 / fail 0 / skipped 0 |
| `pnpm --filter @agent/api test:admin-runs` | pass 30 / fail 0 |
| `pnpm --filter @agent/api test:llm-config` | pass 17 / fail 0 |
| `pnpm --filter @agent/web test:seo-stream` | pass 12 / fail 0 |
| `pnpm --filter @agent/contracts typecheck` | pass |
| `pnpm --filter @agent/web typecheck` / `lint` / `build` | pass |
| `pnpm --filter @agent/api typecheck` / `lint` / `build` | pass |
| `pnpm typecheck` | pass |
| `pnpm --filter @agent/api smoke:grounded-answer` | answered 与 insufficient 两条路径均 `run_completed`，exit 0 |

数据库范围：`test:grounding-db` 与 smoke 均只连接 `ARTICLE_INDEX_TEST_DATABASE_URL`
指向的隔离 PostgreSQL + pgvector；`20260815160000_add_message_grounding` 只在该隔离库
执行过 `prisma migrate deploy`，开发库未被改动。

`pnpm lint`（workspace 根）仍有 115 个错误，与本分支创建前的 `master` 完全一致
（全部位于 `docs/**` Markdown，本分支未新增任何一条）；`@agent/api` 与
`@agent/web` 的 lint 均为 0 错误。

### 10.2 已知限制

真实 smoke 的 answerable 场景存在模型判断波动：在 4 次真实运行中出现过 1 次
DeepSeek 把「Wuthering Waves soft pity」判为 `insufficient_evidence` 并因此
exit 1。已确认这不是证据链缺陷——同一 query 的 evidence projection 稳定返回
2 条合法 ref，命中的正是标题为「What Is Soft Pity In Wuthering Waves?」的文章。
门禁没有为此放宽：`answerable` 必须是 `answered` 且至少一条 Citation 是 AC-22
的硬要求，这里保留为已知的 Provider 判断波动。


真实 smoke 的两条 query 必须显式要求「只做一次语义检索」。原因是既有 Agent Loop
只接受同轮单个 Tool Call，而 DeepSeek 对开放式检索问题会并行返回多个 Tool Call
并触发既有保护。这是 Phase 6 既有协议约束，不属于 Task 3A 引入的问题，也未在本
Task 中修改；是否支持并行 Tool Call 建议作为独立任务评估。

### 10.3 GPT Review 修复记录

第一轮 GPT 技术验收结论为「需要修改」，已按 P1-01～P2-04 全部修复：

| ID | 修复要点 |
| --- | --- |
| P1-01 | finalization 的 `system` 只保留服务端规则与派生标量；Evidence 投影与 hidden draft 移入标注 `[untrusted_data:*]` 的低信任 user message，并新增 prompt-injection fixture |
| P1-02 | finalization Step 在 delta replay 期间保持 `RUNNING`，与 Message / Grounding / assistant_output Step / Run 在同一事务终态化；replay Abort 为 `ABORTED`，真实 DB 失败注入后不留下 `COMPLETED` |
| P1-03 | 终态 sampling 建立严格状态机；Provider 流不完整、错误 finish reason、多调用、未知调用、completion 后额外事件、连接异常均为 sampling failure，不消耗 correction |
| P2-01 | `normalizeToolEvidenceProjection` 返回 discriminated result；`{ refs: [] }` 才是合法零命中，缺失 / 损坏计为 evidence failure；`get_article_detail` not-found 显式返回合法空投影 |
| P2-02 | 语义校验抽到 `@agent/contracts` 的 `parseMessageGroundingV1`，服务端与 Web 共用；Messages API 只为 COMPLETED assistant Message 投影 Grounding |
| P2-03 | finalization attempts 与 usage 计入 Admin 的 `samplingCount` 与 Token 汇总，metadata 损坏时 fail closed |
| P2-04 | `smoke:grounded-answer` 增加脱敏结构断言，不满足预期时 exit 1 |

第二轮 GPT 技术验收结论仍为「需要修改」，已按 P2-01～P2-03 全部修复：

| ID | 修复要点 |
| --- | --- |
| P2-01 | finalization 模型调用一开始就建立 attempt 事实；采样故障携带 attempt / usage / duration / failure 类别且不消耗 correction，但计入 samplingCount；replay Abort、Step 失败与终态事务失败都保留已发生的 attempt 与 usage；Admin Token 汇总改为 all-or-nothing |
| P2-02 | 公共 `citationId` 必须匹配 `^cit_[0-9a-f]{32}$`，拒绝 `evk_` 前缀、截断值、空串与空白；chunk 粒度的 `chunkId` 必须是非空有界字符串，只有 `sectionPath` / `excerpt` 允许空串归一化为 null |
| P2-03 | smoke 改为「先断言、后输出」，不达标时 stdout 一个字节都不写，只输出脱敏错误；输出逻辑抽为可测试的 `emitGroundedAnswerSmokeResult()` |

第一轮修复过程中真实 smoke 还暴露出一个由 P2-02 引入的缺陷：真实语料存在 `sectionPath`
为空字符串的 chunk，被严格校验误判为损坏投影，导致 availability 退化为
`unavailable`。已修正为「空字符串等价于无内容并归一化为 `null`」，必填展示字段
仍不接受空串，并补充了两侧回归测试。
