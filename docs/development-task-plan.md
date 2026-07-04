# AI SEO Agent Development Task Plan

本文件保留为旧入口兼容。当前路线和任务入口已经收敛到：

- [docs/README.md](./README.md)：文档总入口
- [docs/roadmap.md](./roadmap.md)：阶段路线
- [docs/tasks/README.md](./tasks/README.md)：当前任务看板

## 当前主线

| 阶段 | 状态 | 说明 |
| --- | --- | --- |
| 阶段 2：Session Chat 持久化 | 已完成 | 已归档到 `docs/tasks/completed/` |
| 阶段 3：Streaming Chat | 收口中 | 重点验证 `done/error/aborted` 最终态一致性 |
| 阶段 4：Agent Runtime | 下一步 | 使用 TDD 任务文档推进 `AgentRun` / `AgentStep` 和 runtime 边界 |

## 维护规则

- 新任务不再写入本文件。
- 具体执行任务统一写入 `docs/tasks/`。
- Codex 深度研究资料统一放入 `docs/research/codex/`。
- 已完成阶段只保留简洁归档，不再占用当前任务入口。
