# AI SEO Agent Docs

这里是项目文档入口。项目已经完成 Session Chat、Streaming、Agent Runtime 与最小 Tool Calling baseline，当前进入阶段 5 源码复盘。

## 当前状态

| 方向 | 状态 | 入口 |
| --- | --- | --- |
| 总路线 | 阶段 5 已完成并归档；阶段 6 尚未启动 | [roadmap.md](./roadmap.md) |
| 当前任务 | 当前没有 Active 正式实现任务，先进行源码复盘 | [tasks/README.md](./tasks/README.md) |
| 阶段 5 归档 | Tool Calling 最终能力、验收和阅读顺序 | [tasks/completed/phase-05-tool-calling.md](./tasks/completed/phase-05-tool-calling.md) |
| 开发工作流 | GPT 规划、Issue 固化、Codex 实现、PR 审查、修复和学习验收规范 | [development-workflow.md](./development-workflow.md) |
| Codex 研究资料 | 作为架构参考资料，不直接当执行任务 | [research/codex/README.md](./research/codex/README.md) |
| 工作记录 | 记录历史提交和阶段进展 | [work-log.md](./work-log.md) |
| 优化清单 | 暂不立即实现的优化项 | [optimization-backlog.md](./optimization-backlog.md) |

## 文档分层

| 目录 | 用途 |
| --- | --- |
| `tasks/README.md` | 当前任务看板，Active / Completed 以这里为准 |
| `tasks/completed/phase-05-tool-calling.md` | 阶段 5 最小 Tool Calling 的最终归档与源码复盘入口 |
| `tasks/completed/` | 已完成阶段的简洁归档 |
| `development-workflow.md` | 正式代码任务的 GitHub 学习交付流程 |
| `research/` | 深度研究资料和外部项目分析 |

## 维护原则

- 当前可执行任务放在对应阶段目录中，并在 `tasks/README.md` 标记状态。
- 研究资料放在 `research/`，只作为设计依据。
- 任务文档必须写清楚范围、不做什么、测试、验收标准。
- 已完成任务保留简洁归档，不继续占用当前任务入口。