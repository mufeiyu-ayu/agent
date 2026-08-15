# Phase 8 Task 3：Grounded Answer / Citation / Inspector 编排

> 本文件是 Task 3 的子任务编排入口，不再作为单一可执行 Task。正式执行状态以 Task 3A / 3B / 3C 文档、Issue、PR 和 GitHub 实时事实为准。

## 当前状态

```text
Task 3 研究与拆分：已定案
Task 3A：Next / 未启动
Task 3B：Planned / 依赖 3A
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
| Task 3A：Grounded Answer & Citation Backend Contract | **Next** | 终态结构化输出、Run-scoped evidence、服务端校验、durable Grounding、API / Streaming | [Task 3A](./task-03a-grounded-answer-citation-contract.md) |
| Task 3B：Web Source UI | Planned | Web Chat 来源卡片、状态、兼容和真实浏览器验收 | [Task 3B](./task-03b-web-source-ui.md) |
| Task 3C：Admin Retrieval Inspector | Planned | typed safe Read Model、Retrieval / Citation 审计和真实浏览器验收 | [Task 3C](./task-03c-admin-retrieval-inspector.md) |

研究依据见：

- [`docs/research/phase-08-grounded-answer-citation-design.md`](../../research/phase-08-grounded-answer-citation-design.md)

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
10. Task 3B / 3C 不得在 Task 3A contract 稳定前自行发明另一套 Citation schema。

## 依赖关系

```text
Task 2B Completed
  -> Task 3A Next
       -> Task 3B Planned
       -> Task 3C Planned
  -> Phase 8 closeout
```

3B 与 3C 在 3A 完成后可以分别启动，但仍需独立 Issue 和 Clarification Gate。

## Phase 8 Task 3 完成条件

只有以下条件全部完成，Task 3 才能在阶段层面视为完成：

1. Task 3A 完成 GPT 技术验收与用户确认；
2. Task 3B 完成 GPT 技术验收与用户确认；
3. Task 3C 完成 GPT 技术验收与用户确认；
4. answer、Grounding、Stream、Messages API、Web 和 Admin 使用同一版本化 contract；
5. zero-hit、weak evidence、conflict、invalid citation、legacy、error、aborted 路径均有证据；
6. Phase 8 完成条件和阶段文档完成最终归档。

## 当前 GitHub 状态

- Task 3A Issue：未创建
- Task 3B Issue：未创建
- Task 3C Issue：未创建
- 分支：未创建
- PR：未创建
- Clarification Gate：未执行

当前只允许创建并启动 Task 3A；不得把 3B、3C 顺手塞入同一个 Issue。
