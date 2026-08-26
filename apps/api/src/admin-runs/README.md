# Admin Runs 模块导航

本模块把持久化的 AgentRun / AgentStep / MessageGrounding 投影成安全、稳定的 Admin Read Model。数据库查询与 HTTP 入口留在根目录；所有 JSON 解析、兼容和 fail-closed 投影位于 `projection/`。

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
| `context-inspector.projector.ts` | Context metadata 解析、跨 Sampling 不变量与降级 |
| `retrieval-inspector.projector.ts` | Retrieval、Finalization、Grounding 与 Citation 审计投影 |
| `sampling-usage.projector.ts` | action sampling / finalization 次数和 Usage 汇总 |
| `safe-readers.ts` | 无领域状态的 fail-closed primitive / JSON readers |

依赖方向固定为：

```text
AdminRunsService
  -> admin-run.projector (facade)
  -> context / retrieval / sampling-usage
  -> safe-readers
```

子 Projector 之间不得互相反向 import；损坏或旧版 metadata 只能安全降级，不能为了展示完整而猜测事实。
