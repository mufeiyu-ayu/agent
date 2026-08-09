# Admin Console Task 3：接入真实 Run Trace UI

## 目标

将 `apps/admin` 现有静态 Run List / Run Detail 从类型化 Mock 切换到 Task 2 已验收的真实 Admin Run API，建立可持续扩展的 Agent Observability UI 基线。

本任务只消费已稳定的 Admin Read Contract；不重新设计 Runtime、不新增 Agent 能力、不修改 Prisma schema，也不为了旧 Mock UI 伪造后端不存在的字段。

## 背景与前置条件

Admin Console 当前已经完成：

- Task 0：独立 `apps/admin` 前端壳；
- Task 1：静态 Run List / Run Detail UI；
- Task 2：真实 Run / Step 只读查询 API，Issue #33 / PR #34，merge commit `997d6b84341ad3a53e42786490361ea3f984bf7e`。

Task 2 已满足全部前置条件：

```http
GET /api/admin/runs
GET /api/admin/runs/:runId
```

并已在 `@agent/contracts` 建立稳定的 Admin Run Read Contract。

当前页面仍直接依赖：

```text
mockRunList
getMockRunDetail(runId)
```

Task 3 完成后，Admin Console 应从“静态展示 Demo”升级为真正使用运行数据的开发者 Observability Console，为后续 Context Engineering、RAG、MCP、HITL、Recovery 等能力提供可视化扩展基础。

## Clarification Gate 基线

当前任务方向已定案，正式 Issue 创建后由 Codex 重新读取最新 `master` 做开发前确认。

已确认产品 / 架构决策：

1. 生产数据源只能是 Task 2 Admin Run API，不再由页面解析 Prisma 或 raw `AgentStep.input/output`；
2. API client 使用相对 `/api/...` 路径，不在 Vue 代码硬编码后端域名；
3. Admin 本地开发应为 `/api` 提供 Vite proxy，优先复用 `apps/web` 的 `VITE_API_PROXY_TARGET ?? http://localhost:3000` 模式；
4. `apps/admin` 可新增对 `@agent/contracts` 的 workspace 依赖，Read Contract 以 Task 2 产物为唯一事实源；
5. server-side pagination / filter 由后端负责，Pinia / route 只维护用户查询上下文；
6. 第一版不保留旧 Mock 的 model filter，因为当前只有 `requestedModel` 且无法证明 resolved model；
7. `requestedModel=null` 显示为明确的未知 / Default request 语义，不猜具体模型；
8. unknown future Step 必须使用 Generic Inspector，不能导致 Timeline 崩溃；
9. 当前 Admin API 仍无认证，Task 3 只用于本地 / 受控开发环境，不宣称公网安全完成；
10. **真实浏览器验收必须使用 Computer Use 驱动浏览器，并提供截图证据。**

## 学习重点

- 前端如何消费服务端稳定 Read Model，而不是 ORM Entity；
- server-side pagination / filter 与前端 query state 的职责边界；
- Vue 异步请求状态：loading / success / empty / error / not-found；
- AbortController / request identity fencing 处理路由切换和迟到响应；
- RUNNING trace 的非终态展示；
- feature-specific Inspector 与 generic Timeline shell 的分层；
- Observability UI 如何随 Agent Runtime 增量扩展，而不是反向污染 Runtime。

建议源码阅读顺序：

```text
packages/contracts/src/admin-run.ts
  -> apps/api/src/admin-runs/**
  -> apps/admin/vite.config.ts
  -> apps/web/vite.config.ts（/api proxy 参考）
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
2. 哪些字段来自 API，哪些只是 UI 派生；
3. 为什么 unknown Step 必须有 generic fallback；
4. 为什么前端不再解析 raw Step JSON；
5. 为什么浏览器验收和截图证据不能被单元测试替代。

## UI 架构基线

```text
Admin API
   ↓
Admin Runs API Client
   ↓
List / Detail Async Query State
   ↓
@agent/contracts Read Model
   ↓
View / Timeline / Inspector
```

禁止：

```text
Vue View
  -> 猜数据库字段
  -> 解析原始 AgentStep.input/output
```

Timeline 必须保持可扩展：

```text
Timeline shell
  ├─ receive_user_message        -> 专用 Inspector
  ├─ load_conversation_history  -> 专用 Inspector
  ├─ model_sampling             -> 专用 Inspector
  ├─ tool_execution             -> 专用 Inspector
  ├─ assistant_output           -> 专用 Inspector
  └─ generic / unknown          -> Generic Step Inspector
```

后续 Context / Retrieval 等新 Step 可以先通过 Generic Inspector 安全显示，再在对应 Agent Phase 中补专用展示。

## 范围

- 为 `apps/admin` 新增最小 Admin Runs API client；
- 添加必要的 `@agent/contracts` workspace 依赖；
- 为 Admin Vite dev server 增加 `/api` proxy，保持 API client same-origin；
- `/runs` 改为真实服务端 list / summary / pagination / filters；
- `/runs/:runId` 改为真实 Run Detail；
- 保留现有列表查询状态与导航体验；
- 实现 initial loading、filter/page loading、empty、API error、retry；
- 实现 Detail loading、found、404、API error、retry；
- 正确展示 RUNNING / COMPLETED / FAILED / ABORTED；
- Timeline 按 API 返回的稳定顺序展示；
- 当前五类 Step 使用专用 Inspector；
- generic / unknown Step 使用 Generic Inspector；
- Messages 只展示服务端明确返回的用户可见 projection；
- Safe Raw Data 直接展示服务端 allowlist projection；
- 移除生产路径对 `mockRunList` / `getMockRunDetail()` 的依赖；
- Mock 如继续存在，只能作为测试 fixture，并明确用途；
- 增加 Admin 定向自动测试；
- 使用 Computer Use 完成真实浏览器验收并保存截图证据。

## 不做什么

- 不修改 Task 2 API Contract；若发现阻塞性 Contract 缺陷，停止 Task 3 并返回 `BLOCKED`，不得在本 PR 顺手改服务端契约；
- 不修改 Prisma schema / migration；
- 不修改 Agent Runtime / Recorder；
- 不增加 ContextPlan、RAG、MCP、HITL、Recovery 等新 Agent 能力；
- 不实现 Run replay / retry / resume / cancel；
- 不实现登录 / RBAC / 公网部署安全；
- 不增加任意 raw payload 浏览器；
- 不展示 chain-of-thought / reasoning；
- 不为了保留旧 Mock UI 而伪造后端不存在的 model / token / trace 字段；
- 不启动后续 Agent Phase。

## 交互与状态要求

### Run List

必须覆盖：

```text
initial loading
loaded with real data
loaded empty
filtering loading
page / pageSize loading
API error + retry
```

筛选只使用 Task 2 已支持的参数：

- Run ID / user question；
- Status；
- Date range；
- Page / pageSize。

第一版删除 / 隐藏旧 Mock model filter。

### Run Detail

必须覆盖：

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
- Timeline 最后一项仍为 RUNNING；
- 页面不能把非终态数据误判为异常。

### 请求竞态

快速筛选、翻页、连续打开不同 Run 或路由切换时：

- 旧请求不得覆盖新请求结果；
- unmount / route change 后不得产生无意义状态写入；
- 可以使用 AbortController、request identity 或等价 fencing；
- 不引入无必要的通用请求框架。

## Red：先定义失败用例

- [ ] `/runs` 生产路径仍依赖 `mockRunList`；
- [ ] `/runs/:runId` 生产路径仍依赖 `getMockRunDetail()`；
- [ ] Admin 当前没有 `/api` dev proxy；
- [ ] 页面没有真实 API loading / error / retry 状态；
- [ ] 真实 404 不能被当前 Mock 路径表达；
- [ ] RUNNING partial trace 需要独立回归；
- [ ] server pagination 必须验证不会继续对完整列表本地 `slice`；
- [ ] filters 必须真实进入 API query；
- [ ] unknown Step 必须安全显示 Generic Inspector；
- [ ] `requestedModel=null` 不得猜测模型；
- [ ] Safe Raw Data 不得在前端重新拼 raw Prisma JSON；
- [ ] 详情返回列表后筛选 / page / pageSize 状态必须保留；
- [ ] 快速请求切换不得出现迟到响应覆盖。

## Green：最小实现

- [ ] 新增 Admin Runs API client；
- [ ] 接入 `@agent/contracts`；
- [ ] 增加 Admin `/api` dev proxy；
- [ ] 建立 list/detail async state；
- [ ] Run List 切换为 server response；
- [ ] Run Detail 切换为 server response；
- [ ] server-side pagination / filters 接入；
- [ ] loading / empty / error / 404 / retry 完成；
- [ ] RUNNING partial trace 正确展示；
- [ ] known Step Inspector 与 Generic Inspector 工作；
- [ ] Safe Raw / Messages 使用服务端 projection；
- [ ] 去除生产路径 Mock 依赖；
- [ ] 请求竞态有确定性处理；
- [ ] Red 检查全部通过。

## Refactor：整理边界

- [ ] API client、query state、presentation components 分层；
- [ ] 删除无意义的 Mock-only derivation；
- [ ] View 不同时承担 URL 拼接、fetch、Contract 解析和全部展示逻辑；
- [ ] Timeline shell 不依赖固定 Step 数量；
- [ ] 为未来 Context / Retrieval Inspector 留清晰扩展点，但不提前实现；
- [ ] watch / route 切换无重复请求和竞态覆盖。

## 自动验证

至少执行：

```bash
pnpm --filter @agent/contracts build
pnpm --filter @agent/admin test
pnpm --filter @agent/admin typecheck
pnpm --filter @agent/admin lint
pnpm --filter @agent/admin build
pnpm --filter @agent/api typecheck
pnpm typecheck
git diff --check
```

如 Admin 的 dev / test / build 生命周期需要 contracts build，应保证清洁环境可运行，并记录真实命令和结果。

自动测试至少覆盖：

- API query serialization；
- server pagination / filters；
- loading / error / retry 状态转换；
- 404；
- RUNNING partial data；
- generic unknown Step；
- requested model unknown；
- route / request race fencing；
- 生产路径不再导入 Mock 数据源。

## Computer Use 真实浏览器验收（强制）

本任务属于 UI / Observability 交付，**Codex 必须使用 Computer Use 驱动真实浏览器完成验收**。自动测试、Playwright 脚本或静态截图生成不能替代 Computer Use 主验收。

如果当前 Codex 执行环境无法使用 Computer Use：

- 不得声称浏览器验收 PASS；
- PR 保持 Draft；
- 在交付记录中明确写出工具能力阻塞；
- 等用户 / GPT 决定是否更换环境或调整验收方式。

Computer Use 必须连接真实运行中的：

```text
Nest API
+
apps/admin Vite dev server
+
Chrome / Chromium 浏览器
```

至少验证：

1. 常用桌面宽度：`1440 × 900`，并补一个较窄桌面宽度（建议 `1280 × 900`）；
2. light / dark；
3. Run List 首屏真实数据；
4. Status / query / date filter 至少各验证一次；
5. page / pageSize；
6. 进入 Run Detail 后返回，列表筛选与分页上下文仍保留；
7. ordinary direct-final Run；
8. 至少一个真实多 sampling / 多 Tool Run；
9. FAILED；
10. ABORTED；
11. RUNNING partial trace；
12. 404；
13. API error + retry；
14. Generic Inspector fallback；
15. 浏览器 Console 无阻塞 error / warning；
16. 页面无全局水平溢出；
17. 快速筛选 / 翻页 / 切换 Run 不出现旧请求覆盖新页面。

RUNNING、404、API error、unknown Step 如无法稳定从现有真实数据复现，可以使用**受控、明确标记的测试数据或测试服务响应**验证 UI 状态，但生产路径仍必须通过真实 Task 2 API 读取正常 Run 数据。

## 截图证据（强制）

Computer Use 验收必须留下截图，并随 PR 可访问。建议写入：

```text
docs/assets/admin-console/<issue>-real-run-list-light.jpg
docs/assets/admin-console/<issue>-real-tool-trace-dark.jpg
docs/assets/admin-console/<issue>-running-trace.jpg
docs/assets/admin-console/<issue>-error-or-404.jpg
```

至少提供 4 张截图，覆盖：

1. light 模式真实 Run List；
2. dark 模式多 sampling / 多 Tool Run Detail；
3. RUNNING partial trace；
4. 404 或 API error / retry 状态。

截图要求：

- 必须由 Computer Use 验收过程中的真实浏览器产生；
- PR 描述中列出截图路径 / 链接及对应验收场景；
- 不得包含 API Key、Authorization、secret、完整 Tool raw payload、reasoning / chain-of-thought；
- 仓库为公开仓库时，不得把敏感真实用户内容写入截图；优先使用项目 fixture / demo Run，或只展示 Task 2 已安全投影的非敏感内容；
- 若需额外截图证明 query state 保留、窄屏或 Generic Inspector，可以补充，但不为了数量制造重复截图。

## 验收标准

- [ ] Run List / Detail 生产路径不再读取静态 Mock；
- [ ] 列表使用真实 server pagination / filters / summary；
- [ ] 详情使用真实 Run / Step / Message projection；
- [ ] Phase 6 多 sampling / 多 Tool Trace 正确显示；
- [ ] RUNNING / FAILED / ABORTED / COMPLETED UI 正确；
- [ ] loading / empty / error / 404 / retry 完整；
- [ ] unknown future Step 有 Generic Inspector；
- [ ] 不展示 API 未授权内部数据；
- [ ] requested model unknown 不被伪造；
- [ ] 返回列表时筛选 / page / pageSize 上下文不丢失；
- [ ] 快速请求切换无 stale response 覆盖；
- [ ] Admin test / typecheck / lint / build 与 workspace typecheck 通过；
- [ ] Computer Use 真实浏览器验收全部关键路径无阻塞问题；
- [ ] 至少 4 张符合要求的截图证据已进入 PR；
- [ ] Console 无阻塞 error / warning，页面无全局水平溢出；
- [ ] 没有修改 Agent Runtime / Prisma schema / Task 2 API Contract；
- [ ] 后续 Agent Phase 未在本 Task 实现。

## 风险点

| 风险 | 应对 |
| --- | --- |
| 旧 Mock UI 与 Task 2 Contract 不一致 | 以已验收 Contract 为唯一事实源，允许删除错误 Mock 字段 |
| server pagination 与 Pinia 本地分页冲突 | Store 只维护 query state，数据切片由服务端完成 |
| route / query 快速切换产生迟到响应 | AbortController、request identity 或等价 fencing |
| RUNNING 数据随刷新变化 | UI 支持 null / partial，不假定全部指标存在 |
| future Step type 导致 UI 失效 | Generic Inspector fallback |
| Admin API 当前无认证 | 仅本地 / 受控环境；Task 4 前不得宣称公网安全 |
| 截图泄露真实数据 | 使用 fixture / demo Run 或安全 projection，人工检查截图后再提交 |
| Computer Use 环境不可用 | PR 保持 Draft并明确 BLOCKED，不用其他自动化冒充人工浏览器验收 |

## GitHub 交付记录

- Issue：待创建
- 分支：未创建
- PR：未创建
- GPT 验收结论：未提供
- 用户确认：用户已确认 Task 3 为下一任务；尚未确认最终验收

## 任务状态

- 看板状态：**Next**
- 前置任务：Admin Console Task 2 Completed
- 实施状态：未开始
- 验收状态：未验收

正式 Issue 创建并完成 Clarification Gate 后进入 Active。