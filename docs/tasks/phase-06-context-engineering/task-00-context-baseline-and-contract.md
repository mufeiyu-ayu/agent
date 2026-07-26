# Task 0：Context 基线、契约与测试夹具

## 任务状态

- 看板状态：**Next**
- 实施状态：未开始
- 验收状态：未验收
- Issue：未创建
- PR：未创建

## 目标

在不改变当前聊天和 Tool Loop 对外行为的前提下，固化阶段 6 的真实代码基线，建立 provider-neutral 的最小 `ContextPlan` 契约、来源决策类型和确定性测试夹具，为后续 history normalization 与预算策略提供稳定接口。

本任务完成后，Runtime 不应再把“`ChatMessage[]` 就是 Context 的全部定义”作为长期架构前提，但仍保持当前生产行为兼容。

## 背景

当前链路大致是：

```text
SeoService.CHAT_HISTORY_LIMIT = 12
  -> AgentRuntimeService.listRecentChatMessages()
  -> SeoContextBuilder.buildModelMessages()
  -> ChatMessage[]
  -> toModelInputItems()
  -> LLM sampling
```

阶段 5 已经存在 `ModelInputItem`，可以表达 message、assistant Tool Call 和 Tool Result，因此本任务不是从零重新发明模型输入类型，也不引入某个模型 SDK 的 message 类型。当前缺少的是：一份能够同时表达模型输入、预算摘要、来源决策和 prompt version 的项目自有计划对象。

## 学习重点

- TypeScript 中“事实类型”“投影类型”“供应商 adapter 类型”的边界。
- 为什么 Context Builder 应返回计划与决策，而不只是数组。
- 如何先用 contract + fixture 固定行为，再逐步替换内部实现。
- 如何避免一次重构同时改变 history、预算、Tool Observation 和 LLM adapter。

## 范围

- 审计并记录当前 Context 调用链、固定 history limit、prompt 构造和两轮 sampling 的输入变化。
- 在项目自有层新增或整理最小 Context 类型：
  - `ContextPlan`；
  - budget summary；
  - source decision；
  - source / action / reason 的受控取值；
  - prompt version。
- 让现有 Context 构造路径能够产出兼容当前行为的 baseline plan。
- 为新增 Context 测试建立明确的 `test:context` package script，避免文档引用当前不存在的通用 `test` 命令。
- 建立确定性 fixture，至少覆盖：
  - 普通单轮问答；
  - 多轮 history；
  - 一次 Tool Call + Observation + 第二轮 sampling；
  - 空 history。
- 新增项目自有类型和单元测试，不让 Runtime 测试直接依赖 OpenAI、DeepSeek 或其他 provider SDK 类型。
- 在代码注释或任务交付中明确 Task 1-4 将分别接管 normalization、budget、Observation policy 和 Runtime integration，Task 5 负责阶段回归与收口。

## 不做什么

- 不改变当前消息筛选规则。
- 不删除 `CHAT_HISTORY_LIMIT` 或立即实现 token-based trimming。
- 不调整 `Message`、`AgentRun`、`AgentStep` 数据库 schema。
- 不持久化 ContextPlan、完整 prompt 或 model-visible items。
- 不实现摘要、compaction、RAG、Memory、Recovery 或 HITL。
- 不重写 LLM provider adapter。
- 不推进 Task 1。

## Red：先定义失败用例

- [ ] 当前 `buildModelMessages()` 只能返回消息数组，无法给出 budget、source decisions 或 prompt version。
- [ ] 现有测试不能用统一 fixture 比较普通回答与 Tool Loop 的 model-visible item 顺序。
- [ ] 如果未来修改 Context 规则，缺少 provider-neutral 的快照或结构断言判断行为是否意外变化。
- [ ] Context 类型若引用具体 provider SDK，应由类型测试或依赖检查失败。

## Green：最小实现

- [ ] 定义最小 `ContextPlan` 与关联类型，字段足以表达 items、预算摘要、来源决策和 prompt version。
- [ ] 使用当前逻辑生成 baseline plan；此时 budget 可以是“已知配置 + 当前估算/占位策略”，但字段语义必须清楚且可测试。
- [ ] 建立 deterministic fixtures 和 helper，能够构造普通 history、Tool Call / Observation pair 和空 history。
- [ ] 让现有 Context Builder 或一个最小 adapter 返回 baseline plan，同时为旧调用方提供明确迁移路径。
- [ ] 保持现有同步、流式和 Tool Loop 行为不变。

## Refactor：整理边界

- [ ] Context contract 放在 Agent Runtime 可复用层，SEO 模块只提供业务 prompt / contributor，不拥有通用预算类型。
- [ ] 统一命名 `model input`、`context item`、`source decision`，避免与 UI `Message` 混用。
- [ ] 将 fixture builder 与生产代码分离，防止测试 helper 进入运行时 bundle。

## 建议影响范围

最终路径由 Issue Clarification Gate 结合仓库确定，预计重点涉及：

```text
apps/api/src/seo/seo-context-builder.service.ts
apps/api/src/agent-runtime/agent-runtime.types.ts
apps/api/src/llm/model-input.types.ts
apps/api/src/**/__tests__ 或相邻 *.spec.ts
```

不应修改 Prisma schema、contracts 前端协议或 Admin UI。

## 验证命令

至少运行与实际改动匹配的命令：

```bash
pnpm --filter @agent/api test:context
pnpm --filter @agent/api test:seo-service
pnpm --filter @agent/api test:tool-loop
pnpm --filter @agent/api test:model-stream
pnpm --filter @agent/api typecheck
pnpm --filter @agent/api lint
pnpm typecheck
git diff --check
```

如果 API 测试脚本需要按文件执行，PR 中必须记录真实命令和用例数量。

## 验收标准

- [ ] 项目存在 provider-neutral 的最小 `ContextPlan` 契约。
- [ ] `ContextPlan` 至少表达 items、budget summary、source decisions 和 prompt version。
- [ ] 普通问答、多轮 history、空 history 和 Tool pair 有确定性 fixture。
- [ ] baseline plan 与当前生产 model input 顺序兼容，没有改变用户可见回答协议。
- [ ] Context contract 不引用具体模型供应商 SDK 类型。
- [ ] 不新增数据库表，不持久化完整 prompt，不推进 Task 1。
- [ ] 新增 `test:context` 入口可独立运行；相关既有回归、typecheck、lint 与 `git diff --check` 通过，或已明确记录既有非阻塞基线。
- [ ] 用户能够解释 `ChatMessage[]`、`ModelInputItem[]` 与 `ContextPlan` 的职责差异。

## 风险点

| 风险 | 应对 |
| --- | --- |
| Task 0 顺手重写整个 Context 链路 | 只建立契约、baseline adapter 和 fixture，行为变化留给后续 Task |
| 类型过度抽象 | 只覆盖当前 message、Tool Call、Tool Result 和最小决策报告，不建通用框架 |
| provider 类型泄漏 | Context contract 仅引用项目自有类型，由 LLM adapter 负责转换 |
| fixture 与真实链路脱节 | 至少从现有普通回答和 Tool Loop 测试抽取真实形状，并用集成断言校验 |

## GitHub 交付记录

仅在本任务进入正式实现后填写。

- Issue：未创建
- 分支：未创建
- PR：未创建
- GPT 验收结论：未提供
- 用户确认：未确认
