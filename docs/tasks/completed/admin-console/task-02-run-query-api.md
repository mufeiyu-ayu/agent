# Admin Console Task 2：真实 Run / Step 只读查询 API

状态：**Completed**。

完成日期：2026-08-09（Asia/Shanghai）。

本文件保留 Task 2 的最终任务事实；详细需求、实现过程、测试与 Review 继续以 Issue #33、PR #34 和 Git 历史为准。

## 目标

为 Admin Console 建立稳定、只读、可扩展的 Agent Run Observability API，使后台能够从真实 `AgentRun` / `AgentStep` / `Message` 数据读取 Run 列表与详情，而不是依赖阶段 5 时期的静态 Mock。

本任务只建立服务端查询边界与共享 Read Contract，不修改 Agent Runtime 写路径，也不接入 Admin Vue 真实数据。

## 最终交付

新增：

```http
GET /api/admin/runs
GET /api/admin/runs/:runId
```

主要能力：

- `@agent/contracts` 中新增与 Prisma 写模型分层的 Admin Run Read Contract；
- Run List 支持服务端分页、`status`、Run ID / 用户问题查询、时间范围过滤；
- 固定稳定排序 `createdAt DESC, id DESC`；
- `pageSize` 服务端硬上限为 50；
- 从 durable `model_sampling` / `tool_execution` Step 派生 sampling count、Tool count 与 token usage；
- token usage 缺失或不能可靠证明完整时保持 `null`，不伪造为 0；
- `requestedModel=null` 不被猜测成 provider resolved model；
- Run Detail 返回安全的 Overview / Messages / Timeline / Safe Raw Projection；
- 当前五类 Phase 6 Step 使用 typed allowlist projection；
- unknown 或 malformed Step 使用 generic safe projection；
- Message 只返回用户可见 preview；
- 不返回完整 Step `input/output`、system prompt、reasoning / chain-of-thought、完整 Tool arguments / result、Observation、provider raw payload、stack、secret 或 Authorization；
- 列表查询没有逐 Run N+1；
- Run 不存在返回标准 404，非法 query 返回 400。

## 架构边界

```text
Prisma AgentRun / AgentStep / Message
              ↓
       Admin Query Service
              ↓
      Safe Projector / Read Model
              ↓
        @agent/contracts
              ↓
          Admin HTTP API
```

确认保留以下原则：

1. Admin Read Model 与 Prisma Model 分层；
2. semi-structured `AgentStep.input/output` 必须先做 runtime-safe allowlist projection；
3. durable facts 与 derived metrics 分开理解；
4. unknown future Step 必须可安全降级；
5. 不为了后台展示反向污染 Runtime Domain Model；
6. 当前 Admin API 无登录 / RBAC，只用于本地或受控开发环境；公网安全边界属于 Task 4。

## 验证结果

PR #34 最终实现 head：`f03507f7cce4c032600f9c32f805ab6115174c5f`。

```text
pnpm --filter @agent/contracts build      PASS
pnpm --filter @agent/api test:admin-runs  PASS，15 tests
pnpm --filter @agent/api typecheck        PASS
pnpm --filter @agent/api lint             PASS
pnpm typecheck                            PASS，4 workspaces
git diff --check                          PASS
```

真实 PostgreSQL + HTTP smoke：

- Run List：HTTP 200；
- Run Detail：HTTP 200；
- 实际读取到 30 个 Run；
- Safe Raw 未暴露原始 `input/output` key。

全仓 `pnpm lint` 仍存在既有 `docs/research/**` Markdown baseline，不属于本 Task diff；API lint 与本次范围检查均通过。

## Review 与验收

- Codex Review：审核 commit `f03507f7cc`，未发现重大问题；
- GPT 技术验收：通过，无阻塞 P0 / P1 / P2 actionable finding；
- 用户确认：已确认验收通过；
- Task 3：Task 2 验收和合并前未提前实现。

## GitHub 交付记录

- Issue：#33 `Admin Console Task 2：实现真实 Run / Step 只读查询 API`，Closed / Completed；
- 分支：`codex/issue-33-admin-run-query-api`；
- PR：#34 `feat: 实现 Admin Run 只读查询 API`，Merged；
- PR 最终 head：`f03507f7cce4c032600f9c32f805ab6115174c5f`；
- merge commit：`997d6b84341ad3a53e42786490361ea3f984bf7e`。

## 任务状态

- 看板状态：**Completed**
- 实施状态：已实现
- 验收状态：已通过
- 合并状态：已合并到 `master`

下一步进入独立 Task 3：真实 Run Trace UI。