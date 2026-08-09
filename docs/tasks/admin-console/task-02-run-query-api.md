# Admin Console Task 2：真实 Run / Step 只读查询 API

## 目标

为 Admin Console 建立稳定、只读、可扩展的 Agent Run Observability API，使后台能够从真实 `AgentRun` / `AgentStep` / `Message` 数据读取 Run 列表与详情，而不是继续依赖静态 Mock。

本任务只建立服务端查询边界与共享 Read Contract；不接入 Admin 页面真实数据，不修改 Agent Runtime 行为。

## 背景

Phase 6 已完成 bounded sequential Agent Loop 与 Runtime reliability，durable trace 的基础结构已经稳定：

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

Admin Console Task 1 的 `RunDetail` / Timeline 是阶段 5 时期的类型化 Mock，不能继续反向决定真实 API Contract。

当前代码事实：

- `AgentRun` 本身没有 model、sampling count、tool call count 或 token usage；这些必须从 `AgentStep` 派生；
- `model_sampling.input.requestedModel` 可能为 `null`，当前 Recorder 没有可靠保存 provider 最终 resolved model；
- `load_conversation_history.output` 当前只有 `messageCount`，没有旧 Mock 的 `truncated`；
- `model_sampling.output` 当前记录 `samplingAttemptId / finishReason / usage / toolCallCount / textChars / intermediateTextChars / durationMs`；
- `tool_execution.output` 当前记录 `ok / code / retryable / originalChars / observationChars / truncated / durationMs`；
- `AgentStep.input/output` 是 semi-structured JSON，Admin API 必须做 runtime-safe allowlist projection，不能原样返回。

因此本任务的核心不是简单增加 Prisma 查询，而是建立长期可演进的 **Admin Read Model / Query Projection**。

## Clarification Gate

状态：**READY**。

已确认决策：

1. API 只读，不增加 Run replay / retry / resume / cancel。
2. API Contract 与 Prisma Model 分层；前端不直接依赖生成的 Prisma 类型。
3. 共享纯数据 Contract 放入 `@agent/contracts`；Nest query / param validation DTO 留在 API 内。
4. 第一版不提供 model filter；只允许展示 `requestedModel: string | null`。有有效 `model_sampling` 时，`null` 表示调用方未显式指定模型；零 sampling 的早期终止只能表示“未持久化记录”。两种情况都不得猜成某个 provider model。
5. 日期过滤使用明确 ISO 8601 timestamp，不由服务端猜客户端时区。
6. Run List 默认稳定排序为 `createdAt DESC, id DESC`。
7. 当前五类 Step 使用明确 allowlist projection；未来 unknown Step 使用 generic safe projection，不能因为未识别类型而 500，也不能泄露 raw JSON。
8. 当前 Admin 尚无登录 / 权限系统，本任务只面向本地或受控开发环境；公网访问控制属于 Task 4。

## 学习重点

- Read Model / Projection 与写模型分离；
- 为什么 Observability API 不应直接返回 ORM Entity；
- `AgentRun + AgentStep + Message -> AdminRunDetail` 跨表聚合；
- stable pagination / filters / ordering；
- JSON runtime parser / type guard；
- durable facts 与 derived metrics 的区别；
- unknown future Step 的 forward compatibility；
- Observability 数据最小披露原则。

建议源码阅读顺序：

```text
prisma/schema.prisma
  -> apps/api/src/agent-runtime/agent-run-recorder.service.ts
  -> apps/api/src/agent-runtime/agent-runtime.service.ts
  -> apps/admin/src/features/runs/run.model.ts
  -> apps/admin/src/features/runs/run.mocks.ts
  -> apps/admin/src/features/runs/run.utils.ts
  -> packages/contracts/src/**
  -> apps/api/src/conversations/**
```

合并前需要能解释：

1. 哪些 Admin 字段是数据库原始事实；
2. 哪些字段从多个 Step 派生；
3. 为什么 `requestedModel=null` 不能被映射成猜测的真实模型；
4. 为什么 Safe Raw Data 仍然不是 Prisma 原始 JSON。

## API 与 Contract 基线

第一版只新增：

```http
GET /api/admin/runs
GET /api/admin/runs/:runId
```

### `GET /api/admin/runs`

支持：

- `page`；
- `pageSize`，必须有服务端硬上限；
- `status`；
- `query`：Run ID 或用户问题文本；
- `dateFrom`：ISO 8601 timestamp；
- `dateTo`：ISO 8601 timestamp。

第一版不支持：

- model filter；
- 任意字段 sort；
- raw Prisma / SQL 参数透传；
- 导出；
- replay / retry / resume / cancel。

列表返回至少包含：

```text
items
pagination
summary
```

`AdminRunListItem` 至少投影：

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

Token 只能使用真实 `model_sampling.output.usage`。单 Run usage 不完整时必须保留 unknown / `null` 语义，不能为了 UI 好看伪造 0。

### `GET /api/admin/runs/:runId`

返回安全 `AdminRunDetail`：

```text
Run Overview
Messages
Timeline
Safe Raw Projection
```

Timeline 覆盖当前五类 durable Step：

```text
receive_user_message
load_conversation_history
model_sampling
tool_execution
assistant_output
```

未来新增未知 Step 时：

```text
unknown step -> generic safe timeline item
```

Generic item 只返回公共字段和受控摘要，不返回完整 `input/output`。

Run 不存在时返回标准 404。

## 范围

- 新增 Admin Runs API module / controller / query service；
- 新增 query / param validation DTO；
- 在 `@agent/contracts` 增加 Admin Run Read Contract；
- 实现 Run List 稳定分页、筛选、summary 与派生指标；
- 实现 Run Detail Overview / Messages / Timeline / Safe Raw Projection；
- 为当前 Phase 6 Step JSON 建立窄的 runtime parser / projection；
- unknown future Step 使用 generic safe projection；
- 增加定向 API / query service 自动测试；
- 同步本任务文档的真实实现与验证结果。

## 不做什么

- 不修改 Prisma schema / migration / seed；
- 不修改 `AgentRuntimeService`、Recorder 写入语义或 Step 类型；
- 不为了 Admin 补录 `resolvedModel`；
- 不返回 system prompt、reasoning / chain-of-thought、完整 Tool arguments、完整 Tool Result、Observation、provider raw payload、stack、secret 或 Authorization；
- 不接入 Admin Vue 真实数据；
- 不实现登录、RBAC、API key 或公网安全边界；
- 不实现 Run 操作类接口；
- 不启动 Task 3 或 Phase 7。

## Red：先定义失败用例

- [x] 当前系统不存在 `GET /api/admin/runs` 与 `GET /api/admin/runs/:runId`；
- [x] 多次 `model_sampling` 正确聚合 sampling count 与真实 usage；
- [x] 多次 `tool_execution` 正确聚合 tool call count；
- [x] `requestedModel=null` 保持 `null`；
- [x] ordinary success、tool success、RUNNING、FAILED、ABORTED 都能稳定投影；
- [x] Run Detail Timeline 按 `AgentStep.sequence` 排序；
- [x] 当前五类 Step 都只返回 allowlist；
- [x] unknown future Step 返回 generic projection 且不泄露 raw JSON；
- [x] Message 只返回用户可见安全字段 / preview；
- [x] Run 不存在返回 404；
- [x] 非法 status、page/pageSize、timestamp 被 DTO 拒绝；
- [x] pageSize 有服务端硬上限；
- [x] query/status/date/pagination 组合行为确定；
- [x] Safe Raw Projection 不包含完整 Step `input/output` 或禁止字段；
- [x] 查询策略不存在明显逐 Run N+1。

## Green：最小实现

- [x] 建立 `@agent/contracts` Admin Run Contract；
- [x] 新增 Admin Runs module / controller / service / DTO；
- [x] 实现只读 Prisma 查询与稳定分页；
- [x] 实现 list/detail projector；
- [x] 实现五类已知 Step parser / projection；
- [x] 实现 generic unknown Step projection；
- [x] 实现安全 preview / summary helper；
- [x] 让 Red 测试全部通过。

## Refactor：整理边界

- [x] Query、Projection、DTO validation、Contract 职责分离；
- [x] 消除旧 Admin Mock 对服务端语义的反向控制；
- [x] Controller 不堆积 Prisma / JSON projection 逻辑；
- [x] 确认没有为了后台查询修改 Runtime 写路径；
- [x] 检查所有返回字段都能说明来源与敏感级别。

## 实现结果

- `AdminRunsModule` 提供列表与详情两个只读端点；Controller 复用全局校验、成功包装与异常格式。
- 列表使用一次分页查询（同时选择当前页所需 Step）和一次相同过滤集的状态分组查询，无逐 Run N+1；默认 `page=1`、`pageSize=20`，上限 50。
- 详情一次读取 Run、直属 user / assistant Message 与全部 Step；Message 只返回 preview。
- `samplingCount`、`toolCallCount` 按 durable Step 行数计算；三个 token 维度分别严格聚合，缺失或非法时保持 `null`。
- 五类已知 Step 按真实写入 shape 和状态做 allowlist；unknown 或 malformed Step 统一降级 generic，Safe Raw 只复用安全摘要。

## 验证命令

至少提供等价于：

```bash
pnpm --filter @agent/contracts build
pnpm --filter @agent/api test:admin-runs
pnpm --filter @agent/api typecheck
pnpm --filter @agent/api lint
pnpm typecheck
git diff --check
```

如果仓库尚无 `test:admin-runs` script，实现可以新增稳定脚本；否则必须记录真实使用的等价定向测试命令，不得伪报不存在的脚本。

本任务禁止修改 Prisma schema，因此不要求 migration 验证。

真实验证结果（2026-08-09）：

| 验证 | 结果 |
| --- | --- |
| `pnpm --filter @agent/contracts build` | PASS |
| `pnpm --filter @agent/api test:admin-runs` | PASS，15 tests |
| `pnpm --filter @agent/api typecheck` | PASS |
| `pnpm --filter @agent/api lint` | PASS |
| `pnpm typecheck` | PASS，4 个 workspace |
| 变更文件定向 ESLint | PASS |
| `git diff --check` | PASS |
| 真实 PostgreSQL + HTTP smoke | 列表 200、详情 200；读取到 30 个 Run |

额外执行的全仓 `pnpm lint` 仍命中 101 个既有 `docs/research/**` Markdown 代码片段问题；这些文件不在本任务 diff，任务要求的 API lint 与变更文件定向 lint 均通过。

## 验收标准

- [x] 两个只读 Admin Run API 可从真实数据库返回数据；
- [x] API Contract 与 Prisma Model 明确分层；
- [x] server pagination / filters / stable ordering 有确定性测试；
- [x] sampling/tool count 与 token usage 从真实 durable Step 正确派生；
- [x] `requestedModel=null` 不被伪造成 resolved model；
- [x] Run Detail 能表达 Phase 6 多 sampling / 多 Tool Trace；
- [x] 五类已知 Step 有安全 typed projection；
- [x] unknown future Step 能安全降级；
- [x] 不返回 prompt、reasoning、完整 Tool 数据、Observation、stack 或 secret；
- [x] 404 与非法 query 有明确行为；
- [x] 不修改 Runtime、Prisma schema、外部 Chat / NDJSON 协议；
- [x] contracts / API / workspace typecheck 与 API lint 通过；
- [x] Task 3 仍未启动。

## 风险点

| 风险 | 应对 |
| --- | --- |
| 旧 Admin Mock 与真实 Phase 6 Trace 不一致 | 以最新 Recorder / DB durable facts 为源重新定义 Read Contract |
| `AgentStep.input/output` 为 Json | 使用窄 runtime parser / type guard；解析失败降级为 generic safe projection |
| 列表逐 Run 查询 Step 导致 N+1 | Query Service 使用批量 / 有界聚合；测试或 Review 检查查询策略 |
| Token usage 部分缺失 | 单 Run unknown 保持 `null`；不伪造 |
| requested model 与 resolved model 不等价 | 明确字段名 `requestedModel`；零 sampling 时 `null` 表示未持久化记录，其余 `null` 保持调用方未指定语义 |
| Admin 无认证 | 本阶段限定本地 / 受控环境；Task 4 负责访问控制 |
| 未来新增 Context / Retrieval Step | generic projection 先保证可见与安全，后续再增加专用 Inspector |

## GitHub 交付记录

- Issue：#33 `Admin Console Task 2：实现真实 Run / Step 只读查询 API`
- 分支：`codex/issue-33-admin-run-query-api`
- PR：未创建
- GPT 验收结论：未提供
- 用户确认：用户已确认启动 Task 2；尚未确认最终验收

## 任务状态

- 看板状态：**Active**
- Clarification Gate：**READY**
- 实施状态：已实现
- 验收状态：待验收

只有“实施状态：已实现”且“验收状态：已通过”时，Task 2 才可以进入 Completed；Task 2 未完成前不得创建 Task 3 Issue 或开始 Task 3 实现。
