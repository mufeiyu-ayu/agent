# Task 1：History 资格、规范化与配对不变量

## 任务状态

- 看板状态：Planned
- 实施状态：未开始
- 验收状态：未验收
- 前置任务：Task 0 Completed
- Issue：未创建
- PR：未创建

## 目标

建立唯一的 history eligibility 与 normalization 规则，明确哪些 `Message` 可以成为 model-visible history、当前用户输入如何恰好出现一次、不同状态如何处理，以及 Tool Call / Observation 如何保持合法顺序和完整配对。

## 背景

当前 Runtime 在创建用户消息后，按 `createdAt desc + take(limit)` 读取会话最近消息，再反转为正序。查询没有按 `MessageStatus` 过滤，当前用户消息也可能和 prior history 混在同一数组中。Tool Call / Observation 则只在当前 Runtime 内追加到第二轮模型输入。

UI 需要展示失败或中止消息，不代表模型下一轮必须把这些气泡当作可靠事实。Context 需要一个集中、确定性、可测试的投影规则。

## 学习重点

- UI state 与 model-visible facts 的差异。
- normalization、validation、projection 三者的区别。
- 为什么“按最近 N 条 Message”不能保证完整 Turn。
- Tool Call / Observation 的协议配对和顺序不变量。
- 如何通过纯函数和 fixture 测试复杂边界，而不是依赖真实 LLM。

## 范围

- 引入或完善 history candidate / normalized unit 的项目自有表达。
- 统一定义消息状态策略：
  - `COMPLETED`：可进入历史；
  - `PENDING`、`STREAMING`：不得进入下一轮 model history；
  - `FAILED`：保留在 UI，但默认不作为可靠对话事实进入 model history；
  - `ABORTED`：保留在 UI，阶段 6 MVP 默认排除部分 assistant 输出，避免把未完成句子当作可靠事实。
- 将当前用户输入与 prior history 显式区分；无论查询方式如何实现，最终 Context 中当前输入必须恰好出现一次。
- 保持会话时间顺序和同一 Turn 内 item 顺序。
- 定义完整 Turn / Context unit 的最小边界，裁剪时不制造孤立 assistant 消息。
- 对当前 Turn 的 Tool Call / Observation 建立配对校验：
  - `callId` 匹配；
  - Tool Call 在前；
  - Observation 在后；
  - 不允许孤立 result；
  - 不允许同一 `callId` 重复冲突。
- 对异常历史给出确定性行为：排除、修复或返回受控 Context 构造错误，不能静默重排。

## 不做什么

- 不把历史 Tool Call / Observation 新增为数据库 canonical facts。
- 不实现跨进程重建当前 Tool Loop。
- 不实现 token budget 或来源优先级裁剪；这些属于 Task 2。
- 不实现 Observation 字段投影；属于 Task 3。
- 不实现摘要、compaction、RAG、Memory 或 HITL。
- 不改变 UI 对 FAILED / ABORTED 消息的展示与持久化。

## Red：先定义失败用例

- [ ] history 中存在 `STREAMING` assistant 消息时，当前逻辑仍可能把它传给模型。
- [ ] history 中存在 `FAILED` 或 `ABORTED` assistant 消息时，没有明确 model-visible 策略。
- [ ] 当前用户输入可能因 history 查询和显式追加同时出现两次。
- [ ] 只有 Tool Result、没有对应 Tool Call 的输入没有被拒绝。
- [ ] 同一 `callId` 的 Tool Result 出现在 Tool Call 前时没有确定性错误。
- [ ] 截取最近消息可能从 assistant 开始，形成不完整 Turn。

## Green：最小实现

- [ ] 建立纯函数式 normalizer，输入候选项，输出有序、合法的 normalized units 与排除原因。
- [ ] 实现并测试上述 MessageStatus 策略。
- [ ] 当前用户消息通过 ID 或显式 current input source 去重，最终只出现一次。
- [ ] 对普通 user / assistant Turn 建立稳定分组和排序规则。
- [ ] 对 current-turn Tool Call / Observation pair 做 `callId`、顺序和重复校验。
- [ ] 不合法 pair 返回受控错误或明确 exclusion decision，不进入 LLM adapter。

## Refactor：整理边界

- [ ] 数据库查询只负责提供 candidate facts，不在 Prisma 查询里散落全部 Context 业务规则。
- [ ] normalizer 不依赖 NestJS、Prisma 或 LLM provider，可直接做单元测试。
- [ ] 排除原因使用受控 reason code，避免测试依赖自然语言文案。

## 验证命令

```bash
pnpm --filter @agent/api test:context
pnpm --filter @agent/api test:seo-service
pnpm --filter @agent/api test:tool-loop
pnpm --filter @agent/api typecheck
pnpm --filter @agent/api lint
pnpm typecheck
git diff --check
```

## 验收标准

- [ ] `COMPLETED / PENDING / STREAMING / FAILED / ABORTED` 的 model-visible 策略有自动化测试。
- [ ] 当前用户输入在 Context 中恰好出现一次。
- [ ] prior history 与当前输入边界清楚，不依赖偶然的 `createdAt` 排序去重。
- [ ] Context 不以孤立 assistant 消息或半个 Tool pair 开始 / 结束。
- [ ] Tool Call 与 Observation 按 `callId` 配对、顺序稳定，异常 pair 不会进入模型。
- [ ] normalizer 是 provider-neutral 的确定性逻辑。
- [ ] UI Message 持久化和前端展示行为没有回归。
- [ ] 用户能够解释为什么 FAILED / ABORTED 气泡可以保留在 UI，却默认不进入下一轮模型历史。

## 风险点

| 风险 | 应对 |
| --- | --- |
| 过滤过多导致上下文断裂 | 用完整 Turn fixture 验证，必要时保留明确的系统补充说明，但不直接信任失败文本 |
| 当前输入重复或丢失 | 使用 message ID / current source 不变量测试，不靠字符串去重 |
| Tool pair 被错误重排 | 同一 Turn 内保持原始 item sequence，只做验证与整单元处理 |
| 把 durable recovery 偷渡进本任务 | 只覆盖当前已有候选事实和 current-turn pair；数据库 canonical facts留到阶段 7 |

## GitHub 交付记录

- Issue：未创建
- 分支：未创建
- PR：未创建
- GPT 验收结论：未提供
- 用户确认：未确认
