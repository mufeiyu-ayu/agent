# Admin Console Task 2：真实 Run / Step 只读查询 API

## 目标

为 Admin Console 建立稳定、只读、可扩展的 Agent Run Observability API，使后台能够从真实 `AgentRun` / `AgentStep` / `Message` 数据读取 Run 列表与详情，而不是继续依赖静态 Mock。

本任务只建立服务端查询边界与共享 Read Contract；不接入 Admin 页面真实数据，不修改 Agent Runtime 行为。

## 背景

Phase 6 已完成 bounded sequential Agent Loop 与 Runtime reliability，当前 durable trace 的基础结构已经稳定：

```text
Conversation
  -> Message
  -> AgentRun
       -> AgentStep(sequence)
            -> receive_user_message
            -> load_conversation_history
            -> model_sampling
            -> tool_execution
            -> assistant_output
```

Admin Console Task 1 的 `RunDetail` / Timeline 是阶段 5 时期的类型化 Mock。它与当前真实 Phase 6 trace 已出现差异，因此不能把现有 Mock 类型直接当作 API Contract，也不能直接把 Prisma Model 暴露给前端。

当前已确认的真实代码事实：

- `AgentRun` 本身没有 model、sampling count、tool call count 或 token usage 字段；这些必须从 `AgentStep` 安全聚合；
- `model_sampling.input.requestedModel` 可能为 `null`，因为当前 Recorder 没有持久化 provider 最终 resolved model；API 不得编造模型名；
- `load_conversation_history.output` 当前只持久化 `messageCount`，没有旧 Mock 中的 `truncated`；
- `tool_execution.output` 当前真实字段包括 `ok / code / retryable / originalChars / observationChars / truncated / durationMs`；
- `model_sampling.output` 当前真实字段包括 `samplingAttemptId / finishReason / usage / toolCallCount / textChars / intermediateTextChars / durationMs`；
- `AgentStep.input/output` 是 durable semi-structured JSON，但 Admin API 只允许输出明确 allowlist 投影，不返回完整原始 JSON。

因此 Task 2 的核心不是“写两个 Prisma `findMany`”，而是定义长期可演进的 **Admin Read Model / Query Projection**。

## Clarification Gate

状态：**READY**。

当前没有阻塞实现的产品或架构歧义，以下决策作为 Task 2 基线：

1. API 只读，不增加 Run replay / retry / resume / cancel。
2. API Contract 与 Prisma Model 分层；前端不直接依赖生成的 Prisma 类型。
3. 共享的纯数据 Contract 放入 `@agent/contracts`；Nest query / param validation DTO 仍留在 API 内。
4. 第一版不提供 model filter；当前持久化无法可靠回答“实际 resolved model”。列表和详情只允许展示 `requestedModel: string | null`，`null` 代表调用方未显式指定模型，不解释成某个具体模型。
5. 日期过滤使用明确 ISO 8601 timestamp 边界，不由服务端猜客户端时区。
6. Run list 使用服务端稳定分页和排序，默认按 `createdAt DESC, id DESC`。
7. Timeline 只返回已知 allowlist 字段；遇到未来新增 Step type 时返回安全 generic projection，而不是 500 或泄露原始 JSON。
8. 当前 Admin 尚无登录 /权限系统，本任务只面向本地或受控开发环境；公网访问控制属于 Task 4。

## 学习重点

- Read Model / Projection 与写模型分离；
- 为什么 Observability API 不应直接返回 ORM Entity；
- 跨表聚合：`AgentRun + AgentStep + Message -> AdminRunDetail`；
- 稳定分页、筛选与排序；
- semi-structured JSON 的运行时安全解析与 allowlist projection；
- 派生指标与 durable facts 的区别；
- unknown / future step 的向前兼容；
- Observability 数据的最小披露原则。

建议源码阅读顺序：

```text
prisma/schema.prisma
  -> apps/api/src/agent-runtime/agent-run-recorder.service.ts
  -> apps/api/src/agent-runtime/agent-runtime.service.ts
  -> apps/admin/src/features/runs/run.model.ts
  -> apps/admin/src/features/runs/run.mocks.ts
  -> apps/admin/src/features/runs/run.utils.ts
  -> packages/contracts/src/**
  -> apps/api/src/conversations/** 的 Controller / DTO / Service 风格
```

合并前需要能解释：

1. 哪些 Admin 字段是数据库原始事实；
2. 哪些字段是从多个 Step 派生的；
3. 为什么 `requestedModel=null` 不能被映射成一个猜测的真实模型；
4. 为什么 Safe Raw Data 仍然不是 Prisma 原始 JSON。

## 建议 Contract

具体命名允许在实现时小幅调整，但语义必须保持。

### Run List

```ts
interface AdminRunListResponse {
  items: AdminRunListItem[]
  pagination: {
    page: number
    pageSize: number
    total: number
  }
  summary: {
    totalRuns: number
    completedRuns: number
    successRate: number
    avgDurationMs: number | null
    totalTokens: number
  }
}
```

`AdminRunListItem` 至少包含：

```text
id
conversationId
status
questionPreview
requestedModel | null
samplingCount
toolCallCount
inputTokens | null
outputTokens | null
totalTokens | null
durationMs | null
startedAt
endedAt | null
createdAt
```

Token 聚合只能使用真实 `model_sampling.output.usage`；usage 缺失时不能伪造 0。`summary.totalTokens` 可以只汇总已知 usage，但单 Run 的 unknown 必须继续用 `null` 表示。

### Run Detail

```text
Run Overview
Messages
Timeline
Safe Raw Projection
```

Timeline 至少覆盖当前五类 durable Step：

```text
receive_user_message
load_conversation_history
model_sampling
tool_execution
assistant_output
```

同时必须支持：

```text
unknown future step -> generic safe timeline item
```

Generic item 只能返回公共字段和受控摘要，不返回完整 `input/output`。

## API 范围

第一版只新增：

```http
GET /admin/runs
GET /admin/runs/:runId
```

### `GET /admin/runs`

支持：

- `page`；
- `pageSize`，必须有服务端硬上限；
- `status`；
- `query`：Run ID 或用户问题文本；
- `dateFrom`：ISO 8601 timestamp；
- `dateTo`：ISO 8601 timestamp。

不支持：

- model filter；
- 任意字段 sort；
- raw SQL / Prisma 参数透传；
- 导出；
- replay / retry / resume / cancel。

### `GET /admin/runs/:runId`

返回单个安全 `AdminRunDetail`；Run 不存在时返回标准 404。

## 范围

- 新增 Admin Runs API module / controller / query service；
- 新增 query / param validation DTO；
- 在 `@agent/contracts` 增加 Admin Run 只读 Contract；
- 实现 Run List 的稳定分页、筛选、summary 与派生指标；
- 实现 Run Detail 的 Overview / Messages / Timeline / Safe Raw Projection；
- 为当前 Phase 6 Step JSON 建立窄的 runtime parser / projection，不依赖未经校验的类型断言；
- unknown future Step 使用 generic safe projection；
- 增加定向 API / query service 自动测试；
- 同步本任务文档的真实实现与验证结果。

## 不做什么

- 不修改 Prisma schema / migration / seed；
- 不修改 `AgentRuntimeService`、Recorder 的写入语义或 Step 类型；
- 不为了 Admin 补录 `resolvedModel`；
- 不返回 system prompt、reasoning / chain-of-thought、完整 Tool arguments、完整 Tool Result、Observation、provider raw payload、stack、secret 或 Authorization；
- 不接入 Admin Vue 真实数据；
- 不实现登录、RBAC、API key 或公网安全边界；
- 不实现 Run 操作类接口；
- 不启动 Task 3 或 Phase 7 Context Engineering。

## Red：先定义失败用例

实现前先用测试锁定 Read Contract 和安全边界。

- [ ] 当前系统不存在 `GET /admin/runs` 与 `GET /admin/runs/:runId`；
- [ ] 多次 `model_sampling` 能正确聚合 sampling count 与真实 usage；
- [ ] 多次 `tool_execution` 能正确聚合 tool call count；
- [ ] `requestedModel=null` 保持 `null`，不得被默认模型名替代；
- [ ] ordinary success、tool success、RUNNING、FAILED、ABORTED 能投影为稳定列表项；
- [ ] Run Detail Timeline 按 `AgentStep.sequence` 稳定排序；
- [ ] 当前五类 Step 都只暴露 allowlist 字段；
- [ ] unknown future Step 返回 generic projection 且不泄露原始 JSON；
- [ ] Message 只返回用户可见安全字段 / preview，不返回内部模型上下文；
- [ ] Run 不存在返回 404；
- [ ] 非法 status、page/pageSize、date timestamp 被 DTO 拒绝；
- [ ] pageSize 超出服务端上限被拒绝而不是静默无限查询；
- [ ] query/status/date filters 与稳定分页组合行为有确定性测试；
- [ ] Safe Raw Projection 不包含禁止字段或完整 Step `input/output`。

## Green：最小实现

- [ ] 建立 `@agent/contracts` Admin Run Contract；
- [ ] 新增 API Admin Runs module / controller / service / DTO；
- [ ] 实现只读 Prisma 查询与稳定分页；
- [ ] 实现 list/detail projector；
- [ ] 实现五类已知 Step parser / projection；
- [ ] 实现 generic unknown Step projection；
- [ ] 实现安全 preview / summary helper；
- [ ] 让 Red 测试全部通过。

## Refactor：整理边界

- [ ] Query、Projection、DTO validation、Contract 职责分离；
- [ ] 消除 Admin Mock 语义对 API 实现的反向控制；
- [ ] 避免在 Controller 中堆积 Prisma / JSON projection 逻辑；
- [ ] 确认没有为了后台查询修改 Runtime 写路径；
- [ ] 检查所有返回字段均能说明来源与敏感级别。

## 验证命令

实现时至少增加一个稳定的 Admin Runs 定向测试入口，例如：

```bash
pnpm --filter @agent/contracts build
pnpm --filter @agent/api test:admin-runs
pnpm --filter @agent/api typecheck
pnpm --filter @agent/api lint
pnpm typecheck
git diff --check
```

若实现没有新增 `test:admin-runs` script，则必须记录实际使用的等价定向测试命令，不得伪报不存在的脚本。

本任务明确不要求 migration 验证，因为不允许修改 Prisma schema。

## 验收标准

- [ ] 两个只读 Admin Run API 可从真实数据库返回数据；
- [ ] API Contract 与 Prisma Model 明确分层；
- [ ] 列表分页、筛选与排序确定且有测试；
- [ ] sampling/tool count 与 token usage 从真实 durable Step 正确派生；
- [ ] `requestedModel=null` 不被伪造成 resolved model；
- [ ] Run Detail 能表达当前 Phase 6 多 sampling / 多 Tool Trace；
- [ ] 当前五类 Step 有明确安全投影，未来未知 Step 不导致接口失败；
- [ ] 不返回 prompt、reasoning、完整 Tool 数据、Observation、stack 或 secret；
- [ ] 404 与非法 query 有明确行为；
- [ ] 不修改 Agent Runtime 行为、Prisma schema 或外部 Chat / NDJSON 协议；
- [ ] contracts / API / workspace typecheck 与 API lint 通过；
- [ ] Task 3 仍未启动。

## 风险点

| 风险 | 应对 |
| --- | --- |
| 旧 Admin Mock 与真实 Phase 6 Trace 不一致 | 以最新 Recorder / DB durable facts 为源重新定义 Read Contract，不兼容错误 Mock 假设 |
| `AgentStep.input/output` 为 Json，类型容易被盲目断言 | 使用窄 runtime parser / type guard；解析失败降级为 generic safe projection |
| 列表逐 Run 查询 Step 导致 N+1 | 在 Query Service 设计批量聚合 / 有界查询；测试或 review 检查查询策略 |
| Token usage 部分缺失 | 单 Run unknown 保持 `null`；只基于真实 usage 聚合，不伪造 |
| requested model 与真实 resolved model 不等价 | 字段明确命名 `requestedModel`；`null` 保持未知，不推断 provider 默认值 |
| Admin 无认证 | 本阶段限定本地/受控环境；Task 4 负责访问控制，禁止把当前接口当公网安全完成态 |
| 未来新增 Context / Retrieval Step | unknown generic projection 先保证可见与安全，后续再增加专用 Inspector Contract |

## GitHub 交付记录

- Issue：待创建
- 分支：未创建
- PR：未创建
- GPT 验收结论：未提供
- 用户确认：未确认

## 任务状态

- 看板状态：**Next**（用户已确认下一项；Issue 创建后进入 Active）
- Clarification Gate：**READY**
- 实施状态：未开始
- 验收状态：未验收

只有“实施状态：已实现”且“验收状态：已通过”时，Task 2 才可以进入 Completed；Task 2 未完成前不得启动 Task 3。