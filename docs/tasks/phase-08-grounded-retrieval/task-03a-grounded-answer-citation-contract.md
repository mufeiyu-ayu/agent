# Phase 8 Task 3A：Grounded Answer 与 Citation Backend Contract

状态：**Completed / Issue #58 Closed / PR #59 Merged / merge `d6df7ac1`**。

## 1. 目标与最终结果

本 Task 为 Evidence-backed answer 建立了 Provider-neutral、可验证、可持久化的后端事实层：

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

本 Task 没有实现 Web 来源卡片，也没有实现 Admin Retrieval Inspector；它们分别属于 Task 3B 与 Task 3C。

## 2. 启动前代码事实

Task 3A 启动前：

- `retrieve_article_context@1` 已返回 candidate source，但 candidate 仍是 `unverified / untrusted`；
- `get_article_detail@1` 可以返回完整 Article，但没有 Citation / Evidence projector；
- `search_articles@1` 只负责关键词 discovery；
- Runtime 最终结果只有字符串 content；
- `ConversationMessage`、`ChatStreamDoneEvent` 与 Prisma Message 均没有 Grounding；
- 近邻候选不能证明 answer found，Task 2A 的 no-answer query 会返回 false-positive nearest candidates。

Task 3A 完成后，上述缺口均通过结构化 finalization、服务端 Citation identity validation、durable Grounding 与安全公共投影收口。

## 3. 已确认决策

| ID | 决策 | 说明 |
| --- | --- | --- |
| D-01 | 使用专用终态结构化输出 contract | 不解析任意 Markdown `[1]` |
| D-02 | 内部 contract 为 `submit_grounded_answer@1` | 只在 finalization sampling 暴露；不依赖宽松 JSON mode |
| D-03 | 它不是普通业务 Tool | 不进入 ToolInvocationService、不创建 Tool Result、不消耗 action Tool budget |
| D-04 | Evidence-backed answer 必须经过 finalization | 无 evidence-eligible Tool 的普通回答保持原路径 |
| D-05 | final draft 在校验前不可见、不可持久化 | 避免无效引用先流给 UI 或写入 Message |
| D-06 | 使用 Run-scoped opaque `citationKey` | 模型不能直接提交 sourceId / chunkId / URL 作为已验证引用 |
| D-07 | Citation key 只允许绑定本 Run 的真实 evidence ref | 不跨 Run、不从历史继承 |
| D-08 | v1 采用 message-level citations | claim-level span / offsets 延后 |
| D-09 | outcome 固定为 `answered / insufficient_evidence / conflicting_evidence` | 区分回答、资料不足和冲突 |
| D-10 | `citationIntegrity=validated` 只表示引用身份通过校验 | 不等价于 semantic faithfulness |
| D-11 | v1 固定 `faithfulnessStatus=not_evaluated` | 禁止虚构 `verified=true` |
| D-12 | 最多一次 correction sampling | 总 finalization attempt 上限为 2 |
| D-13 | Message Grounding 使用一对一 durable record | 不使用无约束 Message metadata bag |
| D-14 | citations 作为 versioned safe JSON 保存 | v1 最多 5 条，整体读取 |
| D-15 | `done` 事件只增加 optional `grounding` | 不新增 top-level stream event type |
| D-16 | Messages API 返回 optional Grounding | 页面重载与实时 done 使用同一 durable projection |
| D-17 | validated delta 重放完成后原子提交 content、Grounding、Step 与 Run | 重放期间 Abort 保持 partial-content / ABORTED |
| D-18 | Grounding 不自动进入未来模型历史 | UI / audit metadata 与 model-visible context 分层 |
| D-19 | Tool 自己产生 bounded evidence projection | Runtime 不解析任意 Tool data / modelContent 文本 |
| D-20 | v1 evidence-eligible Tool 为 Retrieval 与 Article Detail | Search Articles 保持 discovery-only；detail rank 可空 |
| D-21 | finalization 使用独立 attempt budget | 不挤占 action-loop sampling / Tool budget |
| D-22 | 首次调用 eligible Tool 即建立 Grounding Session | zero-hit、not found、Tool failure 也进入明确状态 |
| D-23 | `evidenceAvailability` 由服务端派生 | `available / partial / none / unavailable`，模型不能覆盖 |
| D-24 | Evidence Registry hard cap 为 10 refs | 确定性去重 / 排序，超限记录 `registryTruncated` |
| D-25 | completed Grounding 只属于完成的 assistant Message | RUNNING / FAILED / ABORTED 不持久化 completed Grounding |
| D-26 | validated answer 使用 Unicode-safe deterministic chunks 重放 | chunks 拼接必须等于 persisted content / done.content |

## 4. 最终公共 Contract

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

`MessageCitationV1` 使用公开、持久化的 `cit_<32hex>` ID，与内部 `evk_<32hex>` citationKey 分离。公共投影至少包含 source / optional chunk identity、title、slug、languageCode、nullable sectionPath、nullable bounded excerpt、nullable rank、nullable server-derived href 和 strategy name / version。

## 5. 最终实现边界

### 5.1 Evidence 与 Registry

- Retrieval 与 Article Detail 为 evidence-eligible；Search Articles 为 discovery-only；
- eligible Tool 必须显式提交 bounded、allowlisted evidence projection；
- `{ refs: [] }` 表示合法 zero-hit / not found；缺失或 malformed projection 表示 evidence failure；
- Runtime 只从安全 projection 建立 Registry，不从 data、modelContent 或日志猜证据；
- citationKey 只在当前 Run 有效；Registry 最多 10 refs；
- stable dedupe / ordering 与 `registryTruncated` 可审计；
- `available / partial / none / unavailable` 完全由服务端事实派生。

### 5.2 Finalization 与安全边界

- 普通无 Grounding Session 的回答保持既有 Streaming 路径；
- Evidence-backed answer 的 hidden draft 在校验前不外发、不落库；
- finalization 的 system message 只包含服务端规则与派生标量；evidence 和 draft 保持低信任 user data；
- finalization 必须完整返回唯一 `submit_grounded_answer` Tool Call、`response_completed` 与 `finishReason=tool_calls`；
- schema / Citation 错误允许 correction 一次；Provider 流故障不消耗 correction；
- unknown、伪造、重复、cross-run citationKey 没有成功路径；
- `answered` 至少一条有效 Citation；`conflicting_evidence` 至少两个不同 source；
- `none / unavailable` 只能 insufficient 且零 Citation；
- `available / partial + insufficient_evidence` 可以携带 0～5 条“检查过的资料”。

### 5.3 Persistence、Streaming 与审计

- 新增 assistant Message 一对一 MessageGrounding durable record；
- validated answer 通过 Unicode-safe deterministic chunks 使用既有 `assistant_delta` 重放；
- Message、Grounding、assistant output Step、finalization Step 与 AgentRun 同事务终态化；
- replay Abort 保留允许的 partial content，Run / Step 为 ABORTED，不创建 completed Grounding；
- finalization sampling、usage、Abort、deadline 与终态事务失败的 attempt 事实不会丢失；
- Admin samplingCount 与 Token 聚合包含 finalization，metadata 不可信时 all-or-nothing fail closed；
- `done.grounding` 与 Messages API 共用 `parseMessageGroundingV1` / durable safe projector；
- malformed、legacy、非 COMPLETED assistant Message 的 Grounding 不对外成立；
- smoke 在断言安全后才输出，失败只写脱敏错误。

## 6. 边界与失败行为

| ID | 场景 | 最终行为 |
| --- | --- | --- |
| E-01 | 本 Run 未调用 evidence-eligible Tool | 普通回答路径，无 Grounding |
| E-02 | zero-hit / detail not found | `none + insufficient_evidence + 0 citation` |
| E-03 | eligible Tool 全部失败 | `unavailable + insufficient_evidence`，不伪装无答案 |
| E-04 | 部分 evidence 成功、部分失败 | `partial`；只允许引用成功 evidence |
| E-05 | 近邻候选不足 | `available | partial + insufficient_evidence` |
| E-06 | 充分且一致 | `available | partial + answered`，至少一个 Citation |
| E-07 | 真实来源冲突 | `available | partial + conflicting_evidence`，至少两个 source |
| E-08 | 未知 citationKey | 校验失败，不进入 durable Grounding |
| E-09 | cross-run citationKey | 校验失败 |
| E-10 | Article Detail / source-only evidence | article granularity，不伪造 chunkId / excerpt |
| E-11 | schema / JSON 异常 | correction 一次，仍失败则 fail closed |
| E-12 | finalization timeout / Provider failure | 安全失败，不伪装 zero-hit |
| E-13 | finalization 前 Abort | ABORTED，不展示 draft、不生成 Grounding |
| E-14 | validated delta 重放期间 Abort | partial content / ABORTED，无 completed Grounding |
| E-15 | commit outcome unknown | 延续未知结果语义，不盲目重试 |
| E-16 | legacy Message | API 与客户端按无 Grounding 渲染 |
| E-17 | persisted Grounding malformed | projector fail closed，不泄漏原始 JSON |

## 7. 验收结果

| ID | 可观察行为 | 结果 |
| --- | --- | --- |
| AC-01 | Evidence-backed answer 只能通过结构化 finalization 完成 | PASS |
| AC-02 | 普通回答路径不被强制改成 Grounded finalization | PASS |
| AC-03 | citationKey 由服务端生成且仅本 Run 有效 | PASS |
| AC-04 | Retrieval / Article Detail evidence 受约束，Search Articles 不进入 Registry | PASS |
| AC-05 | Registry 10 refs hard cap、stable dedupe / order 与 truncation | PASS |
| AC-06 | 未知、伪造、cross-run key 不存在成功路径 | PASS |
| AC-07 | `answered` 至少一条有效 Citation | PASS |
| AC-08 | `conflicting_evidence` 至少两个不同 source | PASS |
| AC-09 | zero-hit、not found、Tool failure 与 partial 可区分 | PASS |
| AC-10 | weak evidence 输出 insufficient，不补全答案 | PASS |
| AC-11 | finalization 最多 2 attempts，不扩展 action Tool budget | PASS |
| AC-12 | correction 后仍无效时 draft 不可见且不落库 | PASS |
| AC-13 | Unicode-safe delta 拼接等于 persisted / done content | PASS |
| AC-14 | replay Abort 保留 partial content / ABORTED，无 completed Grounding | PASS |
| AC-15 | Message、Grounding、Run / Step 终态原子一致 | PASS |
| AC-16 | commit outcome unknown、deadline、Abort 语义不退化 | PASS |
| AC-17 | `done.grounding` 与 Messages API Grounding 一致 | PASS |
| AC-18 | legacy、普通回答与旧 stream consumer 兼容 | PASS |
| AC-19 | API / Step 不暴露 raw key、Prompt、reasoning、embedding、SQL 或 secret | PASS |
| AC-20 | schemaVersion 与 malformed data fail closed | PASS |
| AC-21 | Tool pairing、Context Planner 与 action-loop budget 不退化 | PASS |
| AC-22 | 真实 DeepSeek + Gemini + 隔离 pgvector 覆盖 answered | PASS |
| AC-23 | 真实环境覆盖 insufficient 且无伪造 Citation | PASS |
| AC-24 | Article Detail 产生 article-level Citation，不伪造 chunk / excerpt | PASS |

## 8. 最终验证

```text
test:grounding        168 pass / 0 fail
test:grounding-db       9 pass / 0 fail / 0 skip
test:agent-recorder    14 pass / 0 fail
test:tool-loop         54 pass / 0 fail
test:model-stream      67 pass / 0 fail
test:tools             86 pass / 0 fail
test:seo-service       24 pass / 0 fail
test:context           24 pass / 0 fail
test:retrieval         35 pass / 0 fail
test:retrieval-db       9 pass / 0 fail / 0 skip
test:db-reliability    11 pass / 0 fail / 0 skip
test:admin-runs        31 pass / 0 fail
test:llm-config        17 pass / 0 fail
test:seo-stream        12 pass / 0 fail
contracts / API / Web typecheck：PASS
API / Web lint + build：PASS
workspace typecheck：PASS
真实 DeepSeek + Gemini + 隔离 pgvector smoke：answered / insufficient 均 run_completed
```

验证数据库只使用 `ARTICLE_INDEX_TEST_DATABASE_URL` 指向的隔离 PostgreSQL + pgvector。`20260815160000_add_message_grounding` 尚未作用于开发数据库，后续由正常迁移流程处理。

workspace root `pnpm lint` 仍有 115 个历史 Markdown 错误，与分支创建前 master 一致；API 与 Web lint 为 0 错误。

## 9. Review 与风险记录

GPT 共执行四轮技术验收：

1. 第一轮收紧 Context 信任边界、finalization Step 原子终态、终态流完整性、evidence projection、公共 projector、采样统计与 smoke 门禁；
2. 第二轮补齐 sampling failure / replay Abort 的 attempt 记账、公共 Citation identity 与 smoke 输出顺序；
3. 第三轮发现 post-sampling availability check 位于 `try` 外导致 attempt 丢失；
4. 第四轮确认该窗口已覆盖，P0 / P1 / P2 均为 0，AC-01～AC-24 全部 PASS。

已知非阻塞风险：

- answerable live smoke 曾出现一次 Provider 保守判断为 `insufficient_evidence`；门禁未放宽，也未引入“重试直到 answered”；
- evidence 稳定命中预期来源使 Provider 波动更可能，但仅凭标题不能证明截断 excerpt 一定充分；
- 当前 Agent Loop 仍只接受同轮单个 Tool Call；并行 Tool Call 属于后续独立任务；
- `href` v1 恒为 null；
- `faithfulnessStatus` 固定为 `not_evaluated`。

## 10. 最终 GitHub 状态

- Issue：[#58](https://github.com/mufeiyu-ayu/agent/issues/58) Closed / Completed；
- PR：[#59](https://github.com/mufeiyu-ayu/agent/pull/59) Merged；
- 最终 head：`1e7f4c7182219d3e9c0892211ecc810c1bbda904`；
- merge：`d6df7ac1f24137a304748d21f4bca42dcb0a6ddc`；
- Clarification Gate：READY；
- GPT 技术验收：通过；
- 用户验收确认：已完成；
- 实施状态：已实现；
- 验收状态：已通过；
- Task 状态：Completed；
- 远程任务分支：保留，未获删除授权。

下一项正式任务：Task 3B Web Chat Source UI。
