# Docs

本目录只做导航。正式任务状态以 [`tasks/README.md`](./tasks/README.md) 为准，顺序与触发以 [`research/workbench-direction.md`](./research/workbench-direction.md) 第 7 节为准，阶段路线以 [`roadmap.md`](./roadmap.md) 为准，协作流程以 [`workflow.md`](./workflow.md) 为准（`AGENTS.md` 自动导入）。

## 当前状态

只在 [`tasks/README.md`](./tasks/README.md) 维护，本文件不复制。

## 文档入口

| 文档 | 用途 |
| --- | --- |
| [roadmap.md](./roadmap.md) | 阶段路线、方向定案、后置清单 |
| [research/workbench-direction.md](./research/workbench-direction.md) | 内部数据工作台方向；第 7 节是唯一的顺序与触发来源 |
| [tasks/README.md](./tasks/README.md) | 正式任务看板与状态事实来源 |
| [tasks/completed/](./tasks/completed/) | 已完成阶段与横向任务的归档 |
| [tasks/admin-console.md](./tasks/admin-console.md) | Admin Console 支线，Task 4 Planned |
| [workflow.md](./workflow.md) | 单角色流程、硬约束、Issue 模板与任务状态 |
| [testing.md](./testing.md) | 测试放哪、测什么、四个测试入口与真实库测试 |
| [research/README.md](./research/README.md) | 研究入口：Pi 参照、Phase 8 设计依据、配置地图 |
| [research/pi-reference/README.md](./research/pi-reference/README.md) | Pi 参考知识库：模块正文、8 张图、实现路线 |
| [research/pi-reference/roadmap.md](./research/pi-reference/roadmap.md) | 每步（R0～R5、web_fetch）的 Pi 素材与证明完成 |
| [work-log.md](./work-log.md) | 已发生事实 |

## 事实来源

发生冲突时按以下顺序判断：

1. GitHub 当前代码、Issue、PR、commit 与真实验证；
2. `docs/tasks/**`；
3. `docs/workflow.md`；
4. `docs/research/workbench-direction.md` 第 7 节（只管顺序与触发）；
5. `docs/roadmap.md`；
6. `docs/work-log.md`；
7. 其余 `docs/research/**`。

## 维护原则

- 本文件只做入口，不复制其他文档的内容；
- 一个正式 Issue 只对应一个任务单元；
- Completed 必须有 PR 逐条验收 PASS 并合并的记录；
- 研究文档不能替代任务规格；
- 候选子系统未立 Issue 前不进入实现；Admin Task 4、并行 Tool Call、Memory、MCP、Multi-agent 不自动启动。
