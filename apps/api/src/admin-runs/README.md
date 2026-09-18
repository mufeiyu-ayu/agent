# Admin Runs 模块导航

本模块把持久化的 AgentRun / AgentStep / MessageGrounding 投影成 Admin Read Model。数据库查询与 HTTP 入口留在根目录；JSON 逐字段读取位于 `projection/`。

## 根入口

| 文件 | 职责 |
| --- | --- |
| `admin-runs.module.ts` | Nest Provider 组装 |
| `admin-runs.controller.ts` | Admin Runs HTTP 入口 |
| `admin-runs.service.ts` | Prisma 查询、筛选与分页，并调用投影入口 |
| `dto/` | Query / Params 运行时校验 |

## Projection

| 文件 | 职责 |
| --- | --- |
| `admin-run.projector.ts` | Run List / Detail 的 facade 与 Timeline 组合 |
| `context-inspector.projector.ts` | sampling Step 的 `initialContext` / `contextPlan` 逐字段读取 |
| `retrieval-inspector.projector.ts` | evidence-eligible call 摘要、finalization Step 与 Citation 关联 |
| `sampling-usage.projector.ts` | action sampling / finalization 次数和 Usage 逐项求和 |
| `safe-readers.ts` | 无领域状态的 primitive / JSON readers |

依赖方向固定为：

```text
AdminRunsService
  -> admin-run.projector (facade)
  -> context / retrieval / sampling-usage
  -> safe-readers
```

投影规则：字段能读就读，读不出就 `null`；不因某个字段非法把整个 Step 降级为 Generic，也不做跨字段等式、跨 Step 序列或 attempt 状态机复核。Generic 只用于未知 `type`。数据库只有 runtime 一个写入方，读取端不重证明写入端不变量。
