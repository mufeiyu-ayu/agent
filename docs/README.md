# Docs

本目录只做导航。正式任务状态以 [`tasks/README.md`](./tasks/README.md) 为准，阶段路线以 [`roadmap.md`](./roadmap.md) 为准，协作流程以 [`workflow.md`](./workflow.md) 为准（`AGENTS.md` 自动导入）。

## 当前主线

```text
阶段 1-8：Completed，归档在 tasks/completed/
Active Agent Task：无
Next：#137（2026-09-19 审计后立项；#134 / #135 / #136 已于 2026-09-19 合并，SEO 产品命名已去掉、离线评估 baseline 与无运行记录的 smoke 已删、tools / agent-runtime / admin 的无消费者字段与重复类型已删；web_fetch 同日转 Gated；#116 已于 2026-09-19 合并；#117 已于 2026-09-18 关闭转 Gated；#118 / #119 / #120 / #124 已于 2026-09-17 合并，#126 / #127 / #115 已于 2026-09-18 合并）
当前阶段：本项目源码阅读；学完后由 AI 以 Pi 为参照实现云端 Agent，用户不读 Pi 代码（2026-09-15）
候选子系统：session 事件流与 replay、审批门、compaction、定时任务（候选不等于 Active）
Admin Task 4：Planned
```

## 文档入口

| 文档 | 用途 |
| --- | --- |
| [roadmap.md](./roadmap.md) | 阶段路线、当前学习阶段与学习出口、方向定案、后置清单 |
| [tasks/README.md](./tasks/README.md) | 正式任务看板与状态事实来源 |
| [tasks/completed/](./tasks/completed/) | 已完成阶段与横向任务的归档 |
| [tasks/admin-console.md](./tasks/admin-console.md) | Admin Console 支线，Task 4 Planned |
| [workflow.md](./workflow.md) | 单角色流程、学习环节、硬约束、Issue 模板与任务状态 |
| [research/README.md](./research/README.md) | 研究入口：Pi 参照、Phase 8 设计依据、配置地图 |
| [research/pi-reference/README.md](./research/pi-reference/README.md) | Pi 参考知识库：模块正文、8 张图、实现路线 |
| [research/pi-reference/roadmap.md](./research/pi-reference/roadmap.md) | 云端实现顺序 R0 → web_fetch → R2 → R1 → R3 → R4 → R5 |
| [work-log.md](./work-log.md) | 已发生事实 |

## 事实来源

发生冲突时按以下顺序判断：

1. GitHub 当前代码、Issue、PR、commit 与真实验证；
2. `docs/tasks/**`；
3. `docs/workflow.md`；
4. `docs/roadmap.md`；
5. `docs/work-log.md`；
6. `docs/research/**`。

## 维护原则

- 本文件只做入口，不复制其他文档的内容；
- 一个正式 Issue 只对应一个任务单元；
- Completed 必须有 PR 逐条验收 PASS 并合并的记录；
- 研究文档不能替代任务规格；
- 候选子系统未立 Issue 前不进入实现；Admin Task 4、并行 Tool Call、Memory、MCP、Multi-agent 不自动启动。
