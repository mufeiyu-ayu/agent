# Task 4：ContextPlan 接入共享 Agent Runtime

## 任务状态

- 看板状态：Planned
- 实施状态：未开始
- 验收状态：未验收
- 前置任务：Task 3 Completed
- Issue：未创建
- PR：未创建

## 目标

让同步与流式 SEO Chat 的共享 Agent Runtime 在每次 sampling 前都消费同一套 `ContextPlan`，包括 Tool 执行后的第二轮 sampling；同时把安全、可解释的 Context 决策摘要写入现有运行记录，而不持久化完整 prompt 或敏感数据。

## 背景

阶段 5 已经统一 `chat()` 与 `chatStream()` 到 `runTurnStream()`，这是本任务的重要前置。当前 Runtime 在第一次 sampling 前构造 `modelInputItems`，Tool 执行后直接追加 call / Observation 再进入第二轮 sampling。阶段 6 需要确保两轮输入都经过相同的 normalization 与 budget policy，而不是只对初始 history 预算。

## 学习重点

- Runtime orchestration 与 domain contributor 的职责划分。
- 为什么每次 sampling 都需要一个明确的 Context snapshot / plan。
- incremental append 与完整 re-plan 的取舍。
- 如何记录可观测决策而不记录 prompt、secret 或 chain-of-thought。
- 同步 JSON 与流式 NDJSON 为什么只能是同一 Runtime 的不同投影。

## 范围

- 将 `RunTurnStreamInput.buildModelMessages` 或等价旧边界迁移为 `buildContextPlan` / Context contributor 组合。
- `SeoContextBuilder` 只提供 SEO system / developer instructions 和业务资料，通用 history、normalization 与 budget 由 Agent Runtime Context 层负责。
- 第一次 sampling 前生成 plan。
- Tool 执行并产生 Observation 后，在第二次 sampling 前重新生成或安全增量更新 plan，必须重新验证总预算与 pair 完整性。
- model sampling 只接收 `ContextPlan.items` 经 provider adapter 转换后的输入。
- 在现有 `AgentStep` allowlist summary 中记录：
  - prompt version；
  - item count；
  - estimated input tokens；
  - input limit / completion reserve；
  - included / truncated / excluded source counts；
  - stable decision reason codes（必要时聚合）。
- 不记录：完整 system prompt、用户全文、完整历史、raw arguments、raw ToolResult、完整 Observation、secret、stack 或 chain-of-thought。
- 保持 `ChatStreamEvent`、HTTP 状态、Message / Run / Step 终态和一次 Tool Call / 两轮 sampling 上限不变。

## 不做什么

- 不拆成同步和 streaming 两套 Context Builder。
- 不新增第三轮 sampling、并行 Tool Call 或自动 retry。
- 不持久化完整 ContextPlan items。
- 不新增数据库 schema，除非 Issue Clarification Gate 证明现有安全摘要字段无法表达最小验收；默认不改 schema。
- 不实现跨进程 resume、RAG、Memory、summary、HITL。
- 不修改 Admin Console 接口。

## Red：先定义失败用例

- [ ] 第一次 sampling 受预算控制，但追加 Tool Observation 后第二次 sampling 超预算。
- [ ] 同步和流式入口对同一 conversation 生成不同 Context 输入。
- [ ] SEO builder 同时拥有通用 history 筛选和业务 prompt，职责无法独立测试。
- [ ] AgentStep 只能记录 `messageCount`，无法判断 Context 是否发生裁剪。
- [ ] 为了可观测性把完整 prompt 或 Tool Observation 写入数据库。
- [ ] Context 构造失败后 Message / Run / Step 留在非终态。

## Green：最小实现

- [ ] 共享 Runtime 在每次 sampling 前获得一个合法 ContextPlan。
- [ ] 第二轮 sampling 重新应用 normalization、pair validation 和 budget。
- [ ] SeoContextBuilder 降为明确的业务 contributor / prompt provider。
- [ ] provider adapter 只消费项目自有 model items，不反向污染 Context contract。
- [ ] 现有 Step 记录加入 allowlist Context summary。
- [ ] Context build / budget error 进入现有受控失败与终态收口路径。
- [ ] 同步和 streaming 集成测试对 plan 关键摘要一致。

## Refactor：整理边界

- [ ] Runtime orchestration、Context Builder、SEO contributor、provider adapter 各自职责可用一条调用链解释。
- [ ] 第一次与第二次 sampling 共用一个 helper，避免规则复制。
- [ ] 统一 context error taxonomy，不依赖错误文案字符串判断 HTTP 行为。

## 验证命令

```bash
pnpm --filter @agent/api test:context
pnpm --filter @agent/api test:seo-service
pnpm --filter @agent/api test:tool-loop
pnpm --filter @agent/api test:model-stream
pnpm --filter @agent/api test:agent-recorder
pnpm --filter @agent/api typecheck
pnpm --filter @agent/api lint
pnpm --filter @agent/web typecheck
pnpm --filter @agent/web build
pnpm typecheck
git diff --check
```

## 验收标准

- [ ] 同步与流式入口继续共享唯一 `runTurnStream()` 主链。
- [ ] 第一次和第二次 sampling 都消费合法、受预算约束的 ContextPlan。
- [ ] Tool Observation 追加后会重新验证总预算，不会绕过 Task 2 / Task 3 policy。
- [ ] `SeoContextBuilder` 不再承担通用 history / budget 规则。
- [ ] AgentStep 只保存安全 Context 摘要，不保存完整 prompt 或敏感数据。
- [ ] Context build error、budget error、abort、timeout 都能收口 Message / Run / Step 终态。
- [ ] `start / delta / done / error / aborted` 前端协议保持兼容。
- [ ] 普通回答与 Tool Loop 集成测试覆盖同步和 streaming。
- [ ] 用户能够从 Controller / SeoService / Runtime / Context / LLM adapter 还原完整调用链。

## 风险点

| 风险 | 应对 |
| --- | --- |
| Runtime 重构引入大范围回归 | 先保留阶段 5 测试，再逐步切换 plan 入口；每次 sampling 使用同一 helper |
| 第二轮 re-plan 丢失 Tool pair | current-turn pair 作为高优先级原子 unit，并有集成测试 |
| 可观测性泄漏 prompt | Step projector 只记录计数、估算和 reason code，增加禁止字段测试 |
| Context error 破坏终态 | 复用现有 catch / CAS / recorder 终态路径并补失败注入测试 |

## GitHub 交付记录

- Issue：未创建
- 分支：未创建
- PR：未创建
- GPT 验收结论：未提供
- 用户确认：未确认
