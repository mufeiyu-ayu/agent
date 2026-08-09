# Admin Console Task 3：接入真实 Run Trace UI

## 目标

在 Task 2 的只读 Admin Run API 与共享 Read Contract 已验收稳定后，将现有 `apps/admin` 的静态 Run List / Run Detail 从类型化 Mock 切换到真实运行数据，并建立可持续扩展的 Agent Observability UI 基线。

本任务只消费 Task 2 API；不重新设计 Runtime、不新增 Agent 能力、不顺手修改服务端写模型。

## 背景

Admin Console Task 0-1 已完成：

- 独立 `apps/admin` 前端壳；
- `/runs` 静态 Run List；
- `/runs/:runId` 静态 Run Detail；
- Timeline / Messages / Safe Raw Data；
- 本地筛选、分页状态、亮暗主题和导航行为。

当前页面仍直接读取：

```text
mockRunList
getMockRunDetail(runId)
```

Task 1 的静态 Mock 主要用于先验证产品结构和交互，不是当前 Phase 6 Runtime 的事实源。Task 2 会先重新定义真实、受控、可扩展的 Admin Read Contract；Task 3 才允许替换数据源。

完成 Task 3 后，Admin Console 将从“静态展示 Demo”升级为真正的开发者 Observability Console，并作为后续 Context Engineering、RAG、MCP、HITL、Recovery 等能力的可视化扩展基础。

## 前置条件

必须同时满足：

1. Task 2 实施状态：已实现；
2. Task 2 验收状态：已通过；
3. Task 2 PR 已合并到 `master`；
4. `@agent/contracts` 中 Admin Run Read Contract 已稳定；
5. 两个真实 API 已可使用：

```http
GET /admin/runs
GET /admin/runs/:runId
```

未满足这些条件时，本 Task 保持 Planned，不创建 Issue、不提前实现。

## 学习重点

- 前端如何消费服务端稳定 Read Model，而不是 ORM Entity；
- server-side pagination / filter 与前端 query state 的职责边界；
- Vue 异步请求状态：loading / success / empty / error / not-found；
- RUNNING trace 的非终态展示；
- unknown future Step 的 generic UI fallback；
- feature-specific Inspector 与 generic Timeline shell 的分层；
- Observability UI 如何在后续 Agent 能力增加时增量扩展，而不重写页面。

建议源码阅读顺序：

```text
packages/contracts/src/admin-run.ts（以 Task 2 最终文件为准）
  -> apps/admin/src/features/runs/run.model.ts
  -> apps/admin/src/features/runs/run-list.store.ts
  -> apps/admin/src/features/runs/run.utils.ts
  -> apps/admin/src/views/RunsView.vue
  -> apps/admin/src/views/RunDetailView.vue
  -> apps/admin/src/features/runs/components/RunTimeline.vue
  -> apps/admin/src/features/runs/components/RunEventDetail.vue
  -> apps/admin/src/features/runs/run.mocks.ts
```

合并前需要能解释：

1. 哪些筛选 / 分页状态由 URL / Store 管理；
2. 哪些数据来自 API，哪些只是 UI 派生；
3. 为什么 unknown Step 必须有 generic fallback；
4. 为什么页面不应该重新解析 Prisma / raw Step JSON。

## UI 架构基线

数据流目标：

```text
Admin API
   ↓
Admin Runs API Client
   ↓
Run List / Detail Query State
   ↓
Shared Read Contract
   ↓
View / Timeline / Inspector
```

禁止回到：

```text
Vue View
  -> 猜数据库字段
  -> 解析原始 AgentStep.input/output
```

Timeline 必须保持可扩展：

```text
Timeline shell
  ├─ receive_user_message -> 专用 Inspector
  ├─ load_conversation_history -> 专用 Inspector
  ├─ model_sampling -> 专用 Inspector
  ├─ tool_execution -> 专用 Inspector
  ├─ assistant_output -> 专用 Inspector
  └─ unknown -> Generic Step Inspector
```

后续 Context / Retrieval 等新 Step 可以先通过 Generic Inspector 安全显示，再在对应 Agent Phase 中补专用展示。

## 范围

- 为 `apps/admin` 增加最小 Admin API client；
- 如共享 Contract 已可运行时导入，则直接复用 `@agent/contracts`，删除或收缩重复的本地 API 数据类型；
- `/runs` 改为服务端真实列表、summary、分页和筛选；
- `/runs/:runId` 改为服务端真实详情；
- 保留现有列表会话状态与导航体验；
- 实现 loading / skeleton、empty、error、404 与 retry；
- 正确展示 RUNNING / COMPLETED / FAILED / ABORTED；
- Timeline 按 API 返回的稳定顺序展示；
- 当前五类 Step 使用专用 Inspector；
- unknown Step 使用 Generic Inspector；
- Messages 继续只展示 API 明确返回的用户可见投影；
- Safe Raw Data 只显示 API allowlist projection；
- 移除页面对 `mockRunList` / `getMockRunDetail()` 的生产路径依赖；
- 保留或重构 Mock 为纯测试 fixture 时必须明确用途，不能继续冒充真实数据源；
- 增加 Admin 定向自动检查与真实浏览器验收。

## 不做什么

- 不修改 Task 2 API Contract，除非发现阻塞性 Contract 缺陷；若存在缺陷必须先停止 Task 3，并单独回到 Task 2 处理；
- 不修改 Prisma schema / migration；
- 不修改 Agent Runtime / Recorder；
- 不增加 ContextPlan、RAG、MCP、HITL、Recovery 等新 Agent 能力；
- 不实现 Run replay / retry / resume / cancel；
- 不实现登录 / RBAC /公网部署安全；
- 不增加任意 raw payload 浏览器；
- 不展示 chain-of-thought / reasoning；
- 不为了保留旧 Mock UI 而伪造后端不存在的字段。

## 交互与状态要求

### Run List

至少覆盖：

```text
initial loading
loaded with data
loaded empty
filtering / page change loading
API error + retry
```

筛选以 Task 2 最终 API 为准。第一版预计支持：

- Run ID / user question；
- Status；
- Date range；
- Page / pageSize。

除非 Task 2 后续真实记录了可验证 model 字段，否则不保留旧 Mock 的 model filter。

### Run Detail

至少覆盖：

```text
loading
found
404
API error + retry
RUNNING partial trace
terminal trace
```

RUNNING Run 必须允许：

- `endedAt = null`；
- token usage 部分未知；
- assistant output 未完成；
- Timeline 最后一项仍为 RUNNING。

不能因为数据未进入终态而把页面当作异常。

## Red：先定义失败用例

- [ ] 当前 `/runs` 仍依赖 `mockRunList`；
- [ ] 当前 `/runs/:runId` 仍依赖 `getMockRunDetail()`；
- [ ] 页面没有真实 API loading / error / retry 状态；
- [ ] 真实 404 不能被当前 Mock 路径表达；
- [ ] 真实 RUNNING partial trace 需要独立回归；
- [ ] server pagination 必须验证不会继续对完整列表做本地 `slice`；
- [ ] filters 必须真实进入 API query，而不是只过滤客户端 Mock；
- [ ] unknown Step 必须安全显示 Generic Inspector；
- [ ] `requestedModel=null` 必须显示为明确未知 / Default request，而不是猜测模型；
- [ ] Safe Raw Data 必须直接使用服务端 allowlist projection，不在前端重新拼 raw Prisma JSON；
- [ ] 详情导航返回后列表筛选 / page / pageSize 状态仍保留。

## Green：最小实现

- [ ] 新增 Admin Runs API client；
- [ ] 建立 list/detail async state；
- [ ] Run List 切换为 server response；
- [ ] Run Detail 切换为 server response；
- [ ] server-side pagination / filters 接入；
- [ ] loading / empty / error / 404 / retry 完成；
- [ ] RUNNING partial trace 正确展示；
- [ ] known Step Inspector 与 unknown Generic Inspector 工作；
- [ ] Safe Raw / Messages 使用服务端投影；
- [ ] 去除生产路径 Mock 依赖；
- [ ] Red 检查全部通过。

## Refactor：整理边界

- [ ] API client、query state、presentation components 分层；
- [ ] 删除已无意义的 Mock-only derivation；
- [ ] 避免 View 组件直接处理 URL 拼接、fetch、Contract 解析和展示全部职责；
- [ ] Timeline shell 不依赖固定 Step 数量；
- [ ] 为未来 Context / Retrieval Inspector 留清晰扩展点，但不提前实现；
- [ ] 检查响应式 watch / route 切换没有重复请求或竞态覆盖。

## 验证命令

至少执行：

```bash
pnpm --filter @agent/admin test
pnpm --filter @agent/admin typecheck
pnpm --filter @agent/admin lint
pnpm --filter @agent/admin build
pnpm --filter @agent/api typecheck
pnpm typecheck
git diff --check
```

如果 Task 2 要求先构建 `@agent/contracts`，Admin 的 dev / test / build 生命周期必须保证清洁环境下 Contract 可用；验证记录中应说明实际命令。

真实浏览器验收至少覆盖：

- 常用桌面宽度；
- light / dark；
- 列表首屏、筛选、分页；
- 进入详情并返回保留查询状态；
- ordinary direct-final Run；
- 两次 Tool 的 Phase 6 Run；
- FAILED；
- ABORTED；
- RUNNING（可通过受控测试数据或真实进行中请求验证）；
- 404；
- API error；
- console error / warning；
- 页面级水平溢出。

## 验收标准

- [ ] Run List / Detail 的生产路径不再读取静态 Mock；
- [ ] 列表使用真实服务端 pagination / filters / summary；
- [ ] 详情使用真实 Run / Step / Message projection；
- [ ] Phase 6 多 sampling / 多 Tool Trace 可以正确显示；
- [ ] RUNNING / FAILED / ABORTED / COMPLETED 都有正确 UI；
- [ ] loading / empty / error / 404 / retry 完整；
- [ ] unknown future Step 有 Generic Inspector，不导致页面崩溃；
- [ ] 不展示 API 未授权的内部数据；
- [ ] requested model unknown 不被伪造；
- [ ] 返回列表时筛选与分页上下文不丢失；
- [ ] Admin test / typecheck / lint / build 与 workspace typecheck 通过；
- [ ] 真实浏览器验收无阻塞问题；
- [ ] 没有修改 Agent Runtime / Prisma schema；
- [ ] Phase 7 Context Engineering 仍未在本 Task 实现。

## 风险点

| 风险 | 应对 |
| --- | --- |
| 旧 Mock UI 与 Task 2 Contract 不一致 | 以已验收 Contract 为唯一事实源，允许删除错误的 Mock 字段 |
| server pagination 与现有本地 Pinia pagination 冲突 | Store 只维护 query state，数据切片由服务端完成 |
| route 快速切换产生迟到响应覆盖 | API client / query layer 使用 AbortController 或 request identity fencing |
| RUNNING 数据随刷新变化 | UI 明确支持非终态 null / partial 字段，不假定全部指标存在 |
| future Step type 导致 discriminated union 不完整 | Contract 提供 generic item，UI 必须有 Generic Inspector fallback |
| Admin API 当前无认证 | 本地/受控开发使用；Task 4 前不得宣称公网安全完成 |
| Context/RAG 后续增加大量字段导致 UI 膨胀 | 每类能力采用独立 Inspector，Timeline shell 保持通用 |

## GitHub 交付记录

- Issue：未创建
- 分支：未创建
- PR：未创建
- GPT 验收结论：未提供
- 用户确认：未确认

## 任务状态

- 看板状态：**Planned**
- 前置任务：Admin Console Task 2 Completed
- 实施状态：未开始
- 验收状态：未验收

Task 2 未完成并验收前，不得创建 Task 3 正式 Issue 或开始实现。