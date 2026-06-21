# AI SEO Agent Tasks Index

本文件是任务索引目录，用于快速查看每个阶段的目标、状态和下一步。

## 阶段索引

| 阶段 | 任务 | 状态 | 核心目标 | 文档 |
| --- | --- | --- | --- | --- |
| 阶段 1 | LLM + Chat 基础能力 | 已完成 | 完成 Vue + Nest + LLMService + JSON Output + 错误恢复 + 会话 UI 练习 | 不再单独维护 |
| 阶段 2 | Agent Chat Session + 数据持久化系统 | 待开始 | 建立多会话、消息数据化、持久化、Session 驱动 Chat Flow | [phase-02-agent-chat-session.md](./phase-02-agent-chat-session.md) |
| 阶段 3 | 流式输出 + ChatGPT 级交互体验 | 待开始 | 实现 Streaming、渐进式渲染、运行状态和 Abort | [phase-03-streaming-chat-experience.md](./phase-03-streaming-chat-experience.md) |

## 当前执行顺序

1. 先做阶段 2：Agent Chat Session + 数据持久化系统。
2. 阶段 2 验收通过后，再做阶段 3：流式输出 + ChatGPT 级交互体验。
3. 阶段 3 稳定后，再考虑 Tool Calling、Agent Runtime、RAG 等后续能力。

## 维护规则

- 每个阶段只维护一个独立任务文档，避免一开始拆得过碎。
- 阶段文档内的任务从简到繁排列。
- 每个阶段必须写清楚验收条件。
- 如果某个任务变大，再从阶段文档中拆出单独任务文档。
- 不把暂不做的能力混入当前阶段，避免学习主线发散。
