# Admin Runs 模块导航

本模块把持久化的 AgentRun / AgentStep 投影成 Admin Read Model。数据库查询与 HTTP 入口留在根目录；JSON 逐字段读取位于 `projection/`。

## 根入口

| 文件 | 职责 |
| --- | --- |
| `admin-runs.module.ts` | Nest Provider 组装 |
| `admin-runs.controller.ts` | Admin Runs HTTP 入口 |
| `admin-runs.service.ts` | Prisma 查询、筛选与分页，并调用投影入口；列表的 Step 行用 SQL 只取 usage / errorCode / 模型快照 / 错误文案，不读整列 output |
| `admin-model-refs.ts` | 按采样快照的 modelId 关联模型行得出显示名与家族；运行列表、Run 详情与概览共用 |
| `dto/` | Query / Params 运行时校验 |

## Projection

| 文件 | 职责 |
| --- | --- |
| `admin-run.projector.ts` | Run List / Detail 的 facade 与 Timeline 组合，含 sampling Step 的 `initialContext` / `contextPlan` 逐字段读取（候选历史条数取自 load_conversation_history）；列表输入是显式的瘦身行，详情输入由 `ADMIN_RUN_DETAIL_SELECT` 派生 |
| `sampling-usage.projector.ts` | 模型调用口径（有 usage 或 llm_* 失败才算）、次数与 Usage 逐项求和；`LLM_CALL_ERROR_CODES` 与概览 SQL 共用 |
| `safe-readers.ts` | 无领域状态的 primitive / JSON readers |
| `__fixtures__.ts` | projector 测试用的 Run / Step 记录 builder |

依赖方向固定为：

```text
AdminRunsService
  -> admin-run.projector (facade)
  -> sampling-usage
  -> safe-readers
```

投影规则：字段能读就读，读不出就 `null`；不因某个字段非法把整个 Step 降级为 Generic，也不做跨字段等式、跨 Step 序列或 attempt 状态机复核。Generic 只用于未知 `type`。数据库只有 runtime 一个写入方，读取端不重证明写入端不变量。
