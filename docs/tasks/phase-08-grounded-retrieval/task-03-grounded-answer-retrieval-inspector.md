# Phase 8 Task 3：Grounded Answer / Citation / Inspector 编排

> 本文件是 Task 3 的子任务编排入口，不再作为单一可执行 Task。正式执行状态以 Task 3A / 3B / 3C 文档、Issue、PR 和 GitHub 实时事实为准。

## 当前状态

```text
Task 3 研究与拆分：已定案
Task 3A：Completed / #58 Closed / #59 Merged / `d6df7ac1`
Task 3B：Next / 未启动
Task 3C：Planned / 依赖 3A
Active Agent Task：无
```

## 为什么拆分

原 Task 3 同时包含：

- Agent Runtime finalization；
- Citation 公共 contract；
- 数据库持久化；
- NDJSON / Messages API 兼容；
- Web 来源卡片；
- Admin Retrieval Inspector；
- 自动测试和真实浏览器验收。

这些内容跨越后端事实层、Web 产品层和 Admin 审计层。为了满足“一 Issue 一个明确 Task”，正式实现拆为：

| Task | 状态 | 目标 | 文档 |
| --- | --- | --- | --- |
| Task 3A：Grounded Answer & Citation Backend Contract | **Completed** | 终态结构化输出、Run-scoped evidence、服务端校验、durable Grounding、API / Streaming | [Task 3A](./task-03a-grounded-answer-citation-contract.md) |
| Task 3B：Web Source UI | **Next** | Web Chat 来源卡片、状态、兼容和真实浏览器验收 | [Task 3B](./task-03b-web-source-ui.md) |
| Task 3C：Admin Retrieval Inspector | Planned | typed safe Read Model、Retrieval / Citation 审计和真实浏览器验收 | [Task 3C](./task-03c-admin-retrieval-inspector.md) |

研究依据见：

- [`docs/research/phase-08-grounded-answer-citation-design.md`](../../research/phase-08-grounded-answer-citation-design.md)

## Task 3A 已稳定的共享 Contract

Task 3B 与 Task 3C 必须直接消费 Task 3A 已落地的事实层，不得重新发明另一套 schema：

```text
MessageGroundingV1
  ├─ schemaVersion: 1
  ├─ evidenceAvailability
  │    available / partial / none / unavailable
  ├─ outcome
  │    answered / insufficient_evidence / conflicting_evidence
  ├─ citationIntegrity: validated
  ├─ faithfulnessStatus: not_evaluated
  └─ citations: MessageCitationV1[]
```

实时 `done.grounding` 与页面重载后的 `ConversationMessage.grounding` 使用同一 durable safe projector。无 Grounding、legacy、malformed、FAILED 或 ABORTED Message 均必须保持 fail-closed 行为。

## 共享不变量

1. Retrieval candidate 不等于 answer found；
2. Citation identity 必须属于本次 Run 的真实 Retrieval evidence；
3. 不把模型生成的 `[1]`、URL、sourceId 或 chunkId 直接当作已验证 Citation；
4. Citation integrity 与 semantic faithfulness 分开表达；
5. v1 不宣称逐断言事实核验完成；
6. Tool Observation 继续是 untrusted model-visible data；
7. Message Grounding 是用户可见 / 可审计的 durable fact，不自动进入未来 model-visible history；
8. 不暴露 raw Prompt、reasoning、embedding、distance、SQL、Provider payload、完整正文或 secret；
9. 保持 Context Budget、Tool pairing、Streaming、Abort、deadline 和 Run terminalization 不退化；
10. Task 3B / 3C 只能消费 Task 3A contract，不能各自定义另一套 Citation schema。

## 依赖关系

```text
Task 2B Completed
  -> Task 3A Completed
       ├─> Task 3B Next
       └─> Task 3C Planned
  -> Phase 8 closeout
```

Task 3A 完成后，3B 与 3C 的技术依赖均已满足。当前执行顺序定为先启动用户侧 Task 3B，再讨论 Task 3C；两者仍需独立 Issue 和 Clarification Gate。

## Phase 8 Task 3 完成条件

只有以下条件全部完成，Task 3 才能在阶段层面视为完成：

1. Task 3A 完成 GPT 技术验收与用户确认；
2. Task 3B 完成 GPT 技术验收与用户确认；
3. Task 3C 完成 GPT 技术验收与用户确认；
4. answer、Grounding、Stream、Messages API、Web 和 Admin 使用同一版本化 contract；
5. zero-hit、weak evidence、conflict、invalid citation、legacy、error、aborted 路径均有证据；
6. Phase 8 完成条件和阶段文档完成最终归档。

## 当前 GitHub 状态

- Task 3A Issue：#58 Closed / Completed；
- Task 3A PR：#59 Merged；
- Task 3A 最终 head：`1e7f4c7182219d3e9c0892211ecc810c1bbda904`；
- Task 3A merge：`d6df7ac1f24137a304748d21f4bca42dcb0a6ddc`；
- Task 3A GPT 技术验收：AC-01～AC-24 PASS；
- Task 3A 用户确认：已完成；
- Task 3A 远程分支：保留，未获删除授权；
- Task 3B Issue：未创建；
- Task 3C Issue：未创建；
- Active Agent Task：无。

当前只允许创建并启动 Task 3B；不得把 Task 3C、并行 Tool Call、Admin Task 4 或 Minimal Compaction 顺手塞入同一个 Issue。
