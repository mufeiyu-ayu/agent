# Admin Console Task 3：接入真实 Run Trace UI

## 目标

将 `apps/admin` 现有静态 Run List / Run Detail 从 Mock 切换到 Task 2 已验收的真实 Admin Run API，建立可持续扩展的 Agent Observability UI 基线。

本任务只消费已稳定的 Admin Read Contract；不重新设计 Runtime、不新增 Agent 能力、不修改 Prisma schema，也不为了旧 Mock UI 伪造后端不存在的字段。

## 前置条件

Task 0-2 已完成。Task 2 最终交付：Issue #33 / PR #34，merge commit `997d6b84341ad3a53e42786490361ea3f984bf7e`。

真实 API：

```http
GET /api/admin/runs
GET /api/admin/runs/:runId
```

`@agent/contracts` 已提供 Admin Run Read Contract。

当前 Admin UI 仍依赖：

```text
mockRunList
getMockRunDetail(runId)
```

## 已确认设计决策

1. 生产数据源只能是 Task 2 API；Vue 不解析 Prisma 或 raw `AgentStep.input/output`；
2. API client 使用相对 `/api/...`，不在页面硬编码后端 host；
3. Admin Vite 增加 `/api` proxy，优先复用 `apps/web` 的 `VITE_API_PROXY_TARGET ?? http://localhost:3000` 模式；
4. `apps/admin` 可新增 `@agent/contracts` workspace 依赖；
5. server pagination / filter 由 API 负责，Pinia / route 只维护 query state；
6. 第一版删除 / 隐藏旧 Mock model filter；
7. `requestedModel=null` 显示为明确未知 / Default request，不猜具体模型；
8. unknown future Step 使用 Generic Inspector；
9. Admin API 当前无认证，本任务仅用于本地 / 受控开发环境；Task 4 才处理登录 / RBAC / 公网安全；
10. **Computer Use 真实浏览器验收与截图证据是强制验收项。**

## 范围

- 新增最小 Admin Runs API client；
- 接入 `@agent/contracts`；
- Admin Vite 增加 `/api` dev proxy；
- `/runs` 使用真实 list / summary / server pagination / filters；
- `/runs/:runId` 使用真实 Run Detail；
- 保留筛选、分页、导航返回上下文；
- loading / empty / error / retry；
- detail 404 / API error / retry；
- RUNNING / COMPLETED / FAILED / ABORTED；
- 当前五类 Step 专用 Inspector；
- Generic Inspector fallback；
- Messages / Safe Raw 直接使用服务端安全 projection；
- 移除生产路径对 `mockRunList` / `getMockRunDetail()` 的依赖；
- 处理快速筛选 / 翻页 / route 切换的 stale response；
- 增加 Admin 定向自动测试；
- 使用 Computer Use 做真实浏览器验收并保存截图证据。

## 不做什么

- 不修改 Task 2 API Contract；若发现阻塞性 Contract 缺陷，停止并返回 `BLOCKED`；
- 不修改 Prisma schema / migration；
- 不修改 Agent Runtime / Recorder；
- 不实现 ContextPlan、RAG、MCP、HITL、Recovery；
- 不实现 Run replay / retry / resume / cancel；
- 不实现登录 / RBAC / 公网部署安全；
- 不展示 chain-of-thought / reasoning；
- 不增加任意 raw payload 浏览器；
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

筛选只使用 Task 2 已支持参数：Run ID / user question、Status、Date range、page、pageSize。

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

RUNNING 必须容忍 `endedAt=null`、部分 token unknown、assistant output 未完成、最后 Step 仍为 RUNNING。

### 请求竞态

快速筛选 / 翻页 / route 切换时，旧请求不得覆盖新请求结果。使用 AbortController、request identity 或等价 fencing。

## Red / Green / Refactor

### Red

- [ ] `/runs` 生产路径仍依赖 `mockRunList`；
- [ ] `/runs/:runId` 仍依赖 `getMockRunDetail()`；
- [ ] Admin 当前没有 `/api` dev proxy；
- [ ] 页面缺少真实 loading / error / retry / 404；
- [ ] server pagination 仍可能被本地 `slice` 替代；
- [ ] unknown Step 没有 Generic Inspector；
- [ ] `requestedModel=null` 仍可能被猜测；
- [ ] 快速请求切换存在 stale response 风险。

### Green

- [ ] 新增 API client、contracts 依赖和 `/api` proxy；
- [ ] list/detail 切换到真实 API；
- [ ] server pagination / filters 接入；
- [ ] loading / empty / error / 404 / retry 完成；
- [ ] RUNNING partial trace 正确；
- [ ] known Step Inspector + Generic Inspector；
- [ ] Safe Raw / Messages 使用服务端 projection；
- [ ] 生产路径不再依赖 Mock；
- [ ] stale response 有确定性处理。

### Refactor

- [ ] API client、query state、presentation components 分层；
- [ ] 删除无意义 Mock-only derivation；
- [ ] View 不同时承担 URL、fetch、Contract 解析和全部展示；
- [ ] Timeline shell 不依赖固定 Step 数；
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

自动测试至少覆盖 API query serialization、server pagination / filters、loading / error / retry、404、RUNNING partial data、generic Step、requested model unknown、request race fencing、生产路径不再导入 Mock 数据源。

## Computer Use 真实浏览器验收（强制）

**Codex 必须使用 Computer Use 驱动真实 Chrome / Chromium 完成主验收。** 自动测试、Playwright 脚本或静态 screenshot script 不能替代。

验收环境：

```text
真实 Nest API
+
apps/admin Vite dev server
+
Computer Use 操作真实浏览器
```

如果执行环境无法使用 Computer Use：

- 不得声称浏览器验收 PASS；
- PR 保持 Draft；
- 明确记录工具能力阻塞；
- 等待 GPT / 用户决定后续处理。

至少验证：

1. `1440 × 900` 与 `1280 × 900`；
2. light / dark；
3. 真实 Run List；
4. query / status / date filters；
5. page / pageSize；
6. 进入详情后返回保留 query state；
7. ordinary direct-final Run；
8. 多 sampling / 多 Tool Run；
9. FAILED；
10. ABORTED；
11. RUNNING partial trace；
12. 404；
13. API error + retry；
14. Generic Inspector；
15. Console 无阻塞 error / warning；
16. 无全局水平溢出；
17. 快速筛选 / 翻页 / 切换 Run 无 stale response 覆盖。

RUNNING、404、API error、unknown Step 若无法从现有真实数据稳定复现，可使用受控测试数据 / 测试响应；正常 Run List 与至少一个终态 Run Detail 必须走真实 Task 2 API。

## 截图证据（强制）

至少提交 4 张由 Computer Use 验收过程产生的截图：

```text
docs/assets/admin-console/task-03-real-run-list-light.jpg
docs/assets/admin-console/task-03-real-tool-trace-dark.jpg
docs/assets/admin-console/task-03-running-trace.jpg
docs/assets/admin-console/task-03-error-or-404.jpg
```

分别覆盖：light 真实 Run List、dark 多 sampling / 多 Tool Detail、RUNNING partial trace、404 或 API error / retry。

截图不得包含 API Key、Authorization、secret、完整 Tool raw payload、reasoning / chain-of-thought。仓库为公开仓库，不得提交敏感真实用户内容；优先使用 fixture / demo Run 或 Task 2 已安全投影的非敏感内容。PR 描述必须列出截图路径 / 链接及对应验收项。

## 验收标准

- [ ] 生产路径不再使用静态 Mock；
- [ ] list 使用真实 server pagination / filters / summary；
- [ ] detail 使用真实 Run / Step / Message projection；
- [ ] 多 sampling / 多 Tool Trace 正确；
- [ ] RUNNING / FAILED / ABORTED / COMPLETED 正确；
- [ ] loading / empty / error / 404 / retry 完整；
- [ ] unknown Step 有 Generic Inspector；
- [ ] 不展示 API 未授权内部数据；
- [ ] requested model unknown 不被伪造；
- [ ] 返回列表时 filter / page / pageSize 上下文不丢失；
- [ ] 无 stale response 覆盖；
- [ ] Admin test / typecheck / lint / build 与 workspace typecheck 通过；
- [ ] Computer Use 主验收无阻塞问题；
- [ ] 至少 4 张合规截图已进入 PR；
- [ ] Console 无阻塞 error / warning，无全局水平溢出；
- [ ] 未修改 Runtime / Prisma schema / Task 2 API Contract；
- [ ] 后续 Agent Phase 未在本 Task 实现。

## GitHub 交付记录

- Issue：#35 `Admin Console Task 3：接入真实 Run Trace UI 与 Computer Use 验收`（Open）
- 分支：未创建
- PR：未创建
- GPT 验收结论：未提供
- 用户确认：用户已确认 Task 3 为下一任务；尚未确认最终验收

## 任务状态

- 看板状态：**Next**
- Clarification Gate：等待 Codex 开发前确认
- 前置任务：Admin Console Task 2 Completed
- 实施状态：未开始
- 验收状态：未验收

Codex Gate 返回 `READY` 后进入 Active；返回 `BLOCKED` 时停止实现并等待用户 / GPT 决策。