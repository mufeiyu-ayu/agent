# Admin Console Task 3：接入真实 Run Trace UI

## 状态

**Completed / 已验收并合入 `master`**

- Issue：#35 `Admin Console Task 3：接入真实 Run Trace UI 与 Computer Use 验收`
- PR：#36 `feat(admin): 接入真实 Run Trace UI 与 Computer Use 验收`
- 最终实现 head：`147cb22a7cb020cc42a4eca53e0dcb950efd4fa6`
- merge commit：`4c689c4c8a8d3975192d13eb3f5a1c24463fcd7b`
- Clarification Gate：READY
- GPT 技术验收：通过
- 用户验收 / 合并授权：已确认
- 完成日期：2026-08-10

## 目标

将 `apps/admin` 的静态 Run List / Run Detail 从 Mock 切换到 Task 2 已验收的真实 Admin Run API，建立后续 Agent 能力可持续扩展的 Observability UI 基线。

## 最终交付

### 数据接入

- `apps/admin` 直接复用 `@agent/contracts` Admin Run Read Contract；
- API client 使用相对地址：
  - `GET /api/admin/runs`
  - `GET /api/admin/runs/:runId`
- Admin Vite 增加 `/api` proxy，默认目标为 `VITE_API_PROXY_TARGET ?? http://localhost:3000`；
- 删除生产路径 `mockRunList` / `getMockRunDetail()` 依赖；
- server-side pagination / filters / summary 由 Task 2 API 负责，不再对完整列表本地 `slice`。

### Run List / Detail

- Run List 支持真实 `query / status / date / page / pageSize`；
- Run Detail 使用真实 `AgentRun / AgentStep / Message / Safe Raw` projection；
- 支持 `RUNNING / COMPLETED / FAILED / ABORTED`；
- 完成 loading / empty / error / retry / 404；
- `requestedModel=null` 显示为 `Default request`，不猜测实际 provider model；
- 五类已知 Step 使用专用 Inspector；future / unknown Step 使用 Generic Inspector；
- 返回列表后保留筛选、分页和路由上下文。

### 异步可靠性

List / Detail 均使用 AbortController 与 request / route identity fencing，快速筛选、翻页或连续切换 Run 时，旧请求不会覆盖新页面状态。

### API 开发模式修复

开发过程中发现 Nest DTO decorator metadata 在原 `tsx` 开发入口下存在实际问题，因此修复了 API 开发启动链路：

- `dev` 改为执行 `tsc` 产物；
- `dev:watch` 使用 Node 标准库管理 TypeScript watch 与 Nest 重启；
- 保留 class-validator / class-transformer 所需 decorator metadata；
- 该修复未修改 Task 2 API Contract、Prisma schema 或 Agent Runtime。

## 安全边界

Admin UI 只展示 Task 2 服务端 allowlist projection：

- 不解析 Prisma Entity；
- 不直接读取 raw `AgentStep.input/output`；
- 不展示 system prompt、reasoning / chain-of-thought、完整 Tool arguments / result、Observation、provider raw payload、stack、secret 或 Authorization；
- Admin 登录 / RBAC / 公网安全仍属于 Task 4。

## 自动验证

最终记录全部通过：

```text
pnpm --filter @agent/contracts build     PASS
pnpm --filter @agent/admin test          PASS
pnpm --filter @agent/admin typecheck     PASS
pnpm --filter @agent/admin lint          PASS
pnpm --filter @agent/admin build         PASS
pnpm --filter @agent/api test:admin-runs PASS（15/15）
pnpm --filter @agent/api typecheck       PASS
pnpm --filter @agent/api lint            PASS
pnpm --filter @agent/api build           PASS
pnpm typecheck                           PASS
git diff --check                         PASS
```

另完成真实 `dev:watch` HTTP smoke：合法分页参数返回 200、非法 `pageSize` 返回 400；源码变化后自动编译 / 重启正常；终止后子进程和端口均正确释放。

## Computer Use 验收

使用真实 Nest API + Admin Vite + Chrome 完成主验收，覆盖：

- 1440×900 / 1280×900；
- light / dark；
- 真实 Run List 与终态 Run Detail；
- query / status / date / page / pageSize；
- direct-final、多 sampling / 多 Tool；
- RUNNING / FAILED / ABORTED；
- 404、API error + retry；
- Generic Inspector；
- 返回列表保留 query state；
- 快速请求切换无 stale response 覆盖；
- Console 无阻塞 error / warning；
- 页面无全局水平溢出。

RUNNING / unknown Step 等不稳定场景使用受控安全 fixture，经真实 Task 2 API 返回；验收后 fixture 已清理。

## 截图证据

- `docs/assets/admin-console/task-03-real-run-list-light.jpg`
- `docs/assets/admin-console/task-03-real-tool-trace-dark.jpg`
- `docs/assets/admin-console/task-03-running-trace.jpg`
- `docs/assets/admin-console/task-03-error-or-404.jpg`

## 最终验收标准

- [x] 生产路径不再使用静态 Mock；
- [x] list 使用真实 server pagination / filters / summary；
- [x] detail 使用真实 Run / Step / Message projection；
- [x] 多 sampling / 多 Tool Trace 正确；
- [x] RUNNING / FAILED / ABORTED / COMPLETED 正确；
- [x] loading / empty / error / 404 / retry 完整；
- [x] unknown Step 有 Generic Inspector；
- [x] 不展示 API 未授权内部数据；
- [x] requested model unknown 不被伪造；
- [x] 返回列表时 filter / page / pageSize 上下文不丢失；
- [x] 无 stale response 覆盖；
- [x] Admin / API / workspace 验证通过；
- [x] Computer Use 主验收无阻塞问题；
- [x] 4 张合规截图已提交；
- [x] Console 无阻塞 error / warning，无全局水平溢出；
- [x] 未修改 Runtime / Prisma schema / Task 2 API Contract；
- [x] 后续 Agent Phase 未在本 Task 实现。

## 后续

Admin Observability Baseline 至此建立完成。Task 4 登录 / 权限 / 脱敏保持 Planned；是否进入下一 Agent 主线阶段需要基于最新 `master` 重新讨论，不由本 Task 自动推进。
