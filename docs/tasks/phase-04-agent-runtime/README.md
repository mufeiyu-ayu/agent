# 阶段 4：Agent Runtime 基础

## 阶段目标

把项目从“能流式聊天的 Chat 应用”升级为“能记录一次 Agent 运行过程的 Runtime”。

阶段 4 的重点不是 Tool Calling，而是先建立这三个概念：

```txt
Conversation：长期会话
Message：用户可见消息
AgentRun / AgentStep：一次 Agent 执行过程
```

## 当前前置条件

阶段 3 已完成收口：

- `done` 后 assistant message 是 `COMPLETED`。
- `error` 后 assistant message 是 `FAILED`。
- 用户停止后 assistant message 是 `ABORTED`。
- 多会话切换不会串流。
- 不会残留长期 `STREAMING`。

## 任务列表

| 任务 | 状态 | 文档 | 目标 |
| --- | --- | --- | --- |
| Task 1 | Completed | [task-01-agent-run-step-model.md](./task-01-agent-run-step-model.md) | 新增 `AgentRun` / `AgentStep` 基础模型，并接入当前 stream chat |
| Task 2 | Planned | 待创建 | 抽出 `AgentRuntimeService.runTurnStream()` |
| Task 3 | Planned | 待创建 | 定义内部 `AgentRuntimeEvent` 并映射到 `ChatStreamEvent` |
| Task 4 | Planned | 待创建 | 抽出 `SeoContextBuilder`，整理 model messages 构造 |

## 本阶段不做

- 不做 Tool Calling。
- 不做确认按钮。
- 不做 RAG。
- 不做 Multi-agent。
- 不做 workflow engine。
- 不做 AgentStep 前端时间线 UI。

## 阶段验收标准

- 每次用户发送消息都会产生一条 `AgentRun`。
- 一次 run 内至少记录基础 step。
- `AgentRun.status` 与本次 stream 的最终状态一致。
- `AgentStep` 能定位失败或中断发生在哪个阶段。
- 当前 Chat UI 行为不被破坏。
- `typecheck`、`lint` 通过。

## 后续阶段

阶段 4 稳定后，再进入阶段 5：最小 Tool Calling。
