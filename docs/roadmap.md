# AI SEO Agent 学习路线

本文是当前项目的路线总览。详细执行任务以 `docs/tasks/README.md` 为准。

## 当前判断

项目已经完成从固定字段 SEO 生成器到 Session Chat 的迁移，并完成流式输出最终态一致性收口。阶段 4 已完成 `AgentRun` / `AgentStep` 基础模型和 `AgentRuntimeService.runTurnStream()` 抽取，当前进入内部 `AgentRuntimeEvent` 设计与映射，不要直接跳到 Tool Calling、RAG 或多 Agent。

## 阶段路线

| 阶段 | 状态 | 目标 | 主要产物 | 验收重点 |
| --- | --- | --- | --- | --- |
| 阶段 1：LLM + Chat 基础 | 已完成 | 跑通基础 LLM 调用和 Chat UI | 基础聊天链路 | 能完成一次问答 |
| 阶段 2：Session Chat 持久化 | 已完成 | 多会话、消息落库、受控 history | `Conversation`、`Message` | 刷新不丢、多会话不串 |
| 阶段 3：Streaming Chat | 已完成 | 流式输出、停止生成、最终态一致 | NDJSON stream、`ABORTED` 状态 | `done/error/aborted` 不残留 `STREAMING` |
| 阶段 4：Agent Runtime 基础 | 进行中 | 记录一次 Agent 运行过程并抽 runtime 边界 | `AgentRun`、`AgentStep`、`AgentRuntimeService`、`AgentRuntimeEvent` | 每次发送都有 run/step，runtime event 与前端协议解耦 |
| 阶段 5：最小 Tool Calling | 后续 | 让模型请求只读 SEO 工具，后端执行 | `ToolDefinition`、`ToolExecutor`、`ToolRegistry` | 工具 observation 能回到模型 |
| 阶段 6：Human-in-the-loop | 后续 | 中风险工具执行前需要用户确认 | `approval_required`、确认接口 | 拒绝不执行，确认才执行 |
| 阶段 7：Context 管理 | 后续 | 区分 UI message、model message、runtime event | `SeoContextBuilder`、预算规则 | 上下文可控，不污染 UI |
| 阶段 8：可观测性与作品集 | 后续 | 把项目沉淀为可展示 Agent 应用 | run/step 日志、错误分类、技术文档 | 能解释一次 Agent 如何运行 |

## 当前优先级

| 优先级 | 任务 | 说明 |
| --- | --- | --- |
| P0 | 阶段 4 Task 3 | 定义内部 `AgentRuntimeEvent`，并映射到当前 `ChatStreamEvent` |
| P1 | RuntimeEvent 边界 | 确保 runtime 不直接依赖前端 stream 协议 |
| P1 | SeoContextBuilder | 整理 model messages 构造，为后续工具上下文做准备 |
| P2 | Tool Calling | 只做低风险只读工具 |

## 现在暂不做

| 暂不做 | 原因 |
| --- | --- |
| Tool Calling | 先把 runtime event 与前端协议解耦 |
| RAG / 向量数据库 | 当前主线是 Agent Runtime，不是知识库问答 |
| Multi-agent | 单 Agent run/step/tool loop 还没稳定 |
| MCP / 插件系统 | 先把内置工具闭环跑通 |
| OS sandbox | 当前不执行 shell，不需要 Codex 级 sandbox |
| Workflow engine | 目前用 TypeScript service 编排更适合学习 |
| WebSocket 多路复用 | NDJSON 已能满足当前流式任务 |
