# 阶段 5：最小 Tool Calling

## 阶段目标

在现有 `AgentRuntimeService` 基础上实现最小只读工具闭环，让模型可以请求工具，后端执行工具，并把 observation 回填给模型继续生成回答。

阶段 5 先验证工具调用主链路，不做复杂权限系统。

## 当前前置条件

阶段 4 Agent Runtime 基础已完成：

- stream chat 会创建 `AgentRun`。
- 基础执行过程会记录 `AgentStep`。
- `AgentRuntimeService.runTurnStream()` 已成为 runtime 主编排入口。
- `AgentRuntimeEvent` 已与前端 `ChatStreamEvent` 解耦。
- `SeoContextBuilder` 已承接 SEO Agent 的 model messages 构造。
- 已准备 68 篇文章 Demo 数据：优先使用 `zh-cn`，缺少简体中文时回退到 `en`。

## 任务入口

| 任务 | 状态 | 目标 |
| --- | --- | --- |
| Task 0 | Completed | 新增 `Article` 表并导入 68 篇文章 Demo 数据（15 篇 `zh-cn`、53 篇 `en`） |
| Task 1 | Planned | 定义最小 `ToolDefinition` / `ToolRegistry` / `ToolExecutor` 边界 |
| Task 2 | Planned | 实现一个低风险只读 SEO 工具 |
| Task 3 | Planned | 让 runtime 识别模型 tool call、执行工具并回填 observation |
| Task 4 | Planned | 将工具调用过程记录到 `AgentStep`，保持当前 stream 协议稳定 |

## 本阶段不做

- 不做写操作工具。
- 不做用户确认按钮。
- 不做复杂权限策略。
- 不做 RAG / 向量数据库。
- 不做 Multi-agent。
- 不做 MCP / 插件市场。
- 不做工具结果前端时间线 UI。

## 阶段验收标准

- 工具定义和注册有清晰边界。
- 至少一个只读工具能被后端执行。
- 工具 observation 能回填给模型。
- 工具调用过程能记录到 `AgentStep`。
- 当前 `ChatStreamEvent` 前端协议不被破坏。
- `typecheck`、`lint`、`git diff --check` 通过。

## 后续阶段

阶段 5 稳定后，再进入阶段 6：Human-in-the-loop。
