# AI SEO Agent Development Task Plan

本目录用于维护 AI SEO Agent 的阶段任务规划。

当前项目已经完成第一阶段基础能力练习，后续不再继续扩展固定字段 SEO 生成器，而是转向自然语言驱动的 SEO Agent 聊天助手。

## 当前路线

| 阶段 | 主题 | 状态 | 任务文档 |
| --- | --- | --- | --- |
| 阶段 1 | LLM + Chat 基础能力 | 已完成 | 不再单独维护 |
| 阶段 2 | Agent Chat Session + 数据持久化系统 | 待开始 | [phase-02-agent-chat-session.md](./tasks/phase-02-agent-chat-session.md) |
| 阶段 3 | 流式输出 + ChatGPT 级交互体验 | 待开始 | [phase-03-streaming-chat-experience.md](./tasks/phase-03-streaming-chat-experience.md) |

## 任务维护方式

- `docs/development-task-plan.md` 只作为总入口和路线说明。
- `docs/tasks/index.md` 维护所有阶段任务索引。
- 每个阶段单独维护一个任务文档。
- 阶段任务文档需要包含目标、任务拆解、推荐实现顺序、验收条件和本阶段不做的内容。

## 当前主线

从固定字段 SEO 生成器升级为自然语言 SEO Agent 聊天助手。

接下来优先完成：

1. 阶段 2：让 Chat 系统具备多会话、数据持久化和 session 上下文能力。
2. 阶段 3：让 Chat 系统具备流式输出、实时渲染和可中断能力。

## 暂不进入的方向

- Tool Calling
- RAG
- Multi-agent
- 外部搜索
- 复杂工作流
- 生产级部署

这些能力会在阶段 2 和阶段 3 稳定后再评估。
