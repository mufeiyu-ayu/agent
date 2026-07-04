# AI SEO Agent Docs

这里是项目文档入口。当前文档主线已经从普通 Chat 应用推进到 Agent Runtime 学习阶段。

## 当前状态

| 方向 | 状态 | 入口 |
| --- | --- | --- |
| 总路线 | 当前主线是阶段 3 收口 + 阶段 4 Agent Runtime | [roadmap.md](./roadmap.md) |
| 当前任务 | 使用 TDD 风格描述任务、测试和验收 | [tasks/README.md](./tasks/README.md) |
| Codex 研究资料 | 作为架构参考资料，不直接当执行任务 | [research/codex/README.md](./research/codex/README.md) |
| 工作记录 | 记录历史提交和阶段进展 | [work-log.md](./work-log.md) |
| 优化清单 | 暂不立即实现的工程优化项 | [optimization-backlog.md](./optimization-backlog.md) |

## 文档分层

| 目录 | 用途 |
| --- | --- |
| `tasks/active/` | 当前正在收口的任务 |
| `tasks/phase-04-agent-runtime/` | 下一阶段 Agent Runtime 的 TDD 任务 |
| `tasks/completed/` | 已完成阶段的简洁归档 |
| `research/` | 深度研究资料和外部项目分析 |

## 维护原则

- 当前可执行任务放在 `tasks/`，不要混进研究长文。
- 研究资料放在 `research/`，只作为设计依据。
- 任务文档必须写清楚范围、不做什么、测试、验收标准。
- 已完成任务保留简洁归档，不继续占用当前任务入口。
