# Phase 8 Task 3：Grounded Answer / Citation / Inspector 编排

> 本文件是 Task 3 的子任务编排与最终归档入口。正式事实以 Task 3A / 3B / 3C 文档、Issue、PR 和 GitHub 实时状态为准。

## 当前状态

```text
Task 3：Completed
Task 3A：Completed / #58 Closed / #59 Merged / d6df7ac1
Task 3B：Completed / #60 Closed / #61 Merged / 572ad206
Task 3C：Completed / #62 Closed / #63 Merged / 20f838fb
Active Agent Task：无
```

## 子任务拆分

| Task | 状态 | 目标 | GitHub | 文档 |
| --- | --- | --- | --- | --- |
| Task 3A：Grounded Answer & Citation Backend Contract | **Completed** | structured finalization、Run-scoped evidence、服务端校验、durable Grounding、API / Stream | #58 / #59 / `d6df7ac1` | [Task 3A](./task-03a-grounded-answer-citation-contract.md) |
| Task 3B：Web Source UI | **Completed** | Web Chat 状态、Sources disclosure、Source cards、浏览器验收 | #60 / #61 / `572ad206` | [Task 3B](./task-03b-web-source-ui.md) |
| Task 3C：Admin Retrieval Inspector | **Completed** | typed safe Retrieval / Grounding audit、Citation correlation、浏览器验收 | #62 / #63 / `20f838fb` | [Task 3C](./task-03c-admin-retrieval-inspector.md) |

## 为什么拆分

原 Task 3 同时跨越：

- Agent Runtime finalization；
- Citation 公共 contract；
- 数据库持久化；
- NDJSON / Messages API；
- Web 用户侧来源表达；
- Admin 开发者审计；
- DB integration 与真实浏览器验收。

拆分后保持“一 Issue 一个明确 Task”，并让后续层只消费前一层已稳定的事实。

## 最终共享 Contract

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

实时 `done.grounding`、历史 `ConversationMessage.grounding` 与 Admin `retrievalInspector` 均消费同一 durable fact，不建立平行 Citation schema。

## 最终链路

```text
evidence-eligible Tool outcome
  -> Grounding Session
  -> Run-scoped Evidence Registry
  -> hidden final draft
  -> submit_grounded_answer@1
  -> server-side Citation validation
  -> validated assistant_delta replay
  -> atomic Message + Grounding + finalization Step + assistant Step + Run
  -> optional grounding on done / Messages API
  -> Web status + Sources disclosure
  -> Admin Retrieval / Finalization / Citation audit
```

## 共享不变量

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

## 最终 GitHub 事实

### Task 3A

- Issue #58 Closed；PR #59 Merged；
- final head `1e7f4c7182219d3e9c0892211ecc810c1bbda904`；
- merge `d6df7ac1f24137a304748d21f4bca42dcb0a6ddc`；
- AC-01～AC-24 PASS；用户确认完成。

### Task 3B

- Issue #60 Closed；PR #61 Merged；
- final head `516dbd3ffd22a0d3adc83ce3166c4f5a8225b13d`；
- merge `572ad206271c0089eccc83e2a307bdb7909beeb1`；
- AC-01～AC-12 PASS；Chromium 9 / 9，repeat 27 / 27；用户确认完成。

### Task 3C

- Issue #62 Closed；PR #63 Merged；
- final head `aadcadf510b20ea3c958b99ad1a8bfcf363dedf7`；
- merge `20f838fb1fd5139d787f973a90f4906d7ab8ea14`；
- AC-01～AC-12 PASS；Admin tests 136、DB 17、Chromium 12，repeat 36；用户确认完成。

## 完成结论

Task 3 的后端事实层、用户侧来源表达和开发者侧审计链路已全部闭环。后续 claim-level Citation、在线 judge、Admin Auth / RBAC、Recovery、Memory、MCP 和 Multi-agent 均属于独立后续阶段，不在本 Task 范围。
