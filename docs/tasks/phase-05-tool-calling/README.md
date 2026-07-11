# 阶段 5：最小 Tool Calling

状态：进行中。

## 阶段目标

在现有 `AgentRuntimeService` 基础上完成最小只读工具闭环：

```text
用户问题
  -> 模型提出 Tool Call
  -> Runtime 识别并执行工具
  -> Observation 回填模型
  -> 模型生成最终回答
```

阶段 5 重点学习 Tool Calling 主链路，不提前扩展复杂权限、RAG 或 Multi-agent。

## 当前前置条件

- 阶段 4 Agent Runtime 基础已完成。
- `AgentRuntimeService.runTurnStream()` 已成为 runtime 主编排入口。
- `AgentRuntimeEvent` 已与前端 `ChatStreamEvent` 解耦。
- `SeoContextBuilder` 已承接 SEO Agent 的 model messages 构造。
- 已准备 68 篇文章 Demo 数据，其中 15 篇 `zh-cn`、53 篇 `en`。

## 学习主线

```text
结构化模型事件
  -> Tool Contract 与 Registry
  -> 文章查询工具
  -> 单 Agent Tool Loop
  -> Tool Calling 运行记录
```

## 任务计划

| 任务 | 状态 | 核心目标 |
| --- | --- | --- |
| Task 0 | Completed | 新增 `Article` 表并导入文章 Demo 数据，为只读工具提供稳定数据源 |
| Task 1 | Planned | 将纯文本模型流升级为 provider-neutral `ModelStreamEvent`，让 Runtime 能识别文本、Tool Call 和本次 sampling 的结束原因 |
| Task 2 | Planned | 定义最小 `ToolDefinition`、`ToolRegistry`、参数验证、执行与结果边界 |
| Task 3 | Planned | 实现第一只只读工具 `search_articles`，查询并返回精简文章信息 |
| Task 4 | Planned | 实现单 Agent Tool Loop：模型请求工具、后端执行、Observation 回填、模型继续生成最终回答 |
| Task 5 | Planned | 将模型调用、工具执行和工具结果记录到 `AgentStep`，保持当前前端 stream 协议稳定 |

## 关键边界

- Provider 原始 SDK chunk 只在 LLM adapter 内处理，不能泄漏到 Runtime。
- 模型只能提出 Tool Call，工具是否存在、参数是否合法、是否允许执行由后端决定。
- `tool_call_completed` 只表示模型已经提出完整调用，不表示工具已验证或已执行。
- `finishReason = tool_calls` 只结束一次模型 sampling，不结束整个 `AgentRun`。
- 工具结果必须作为 Observation 回填模型，不能直接把数据库 JSON 当成最终回答返回前端。
- 第一版只支持低风险、只读、顺序执行的工具。
- 第一只工具只返回文章列表所需的精简字段，不返回全部正文。

## 本阶段不做

- 不建设完整自动化测试体系，当前使用固定场景进行手工验证。
- 不做写操作工具。
- 不做用户审批和 Human-in-the-loop。
- 不做复杂权限策略。
- 不做 RAG / 向量数据库。
- 不做 MCP / 插件市场。
- 不做 Multi-agent。
- 不做并行工具执行。
- 不做工具执行过程的前端时间线 UI。

## 阶段验收标准

- Runtime 能区分普通文本输出和模型 Tool Call。
- 工具定义、注册、验证和执行职责清晰。
- `search_articles` 能查询文章并返回受控结果。
- Observation 能进入下一次模型调用。
- 最终回答由工具执行后的后续 sampling 生成。
- 工具调用过程能记录到 `AgentStep`。
- 当前 `ChatStreamEvent` 前端协议不被破坏。
- 普通聊天、停止生成、消息持久化和 Run 状态通过固定场景手工回归。
- `typecheck`、`lint`、`git diff --check` 通过。

## 后续阶段

阶段 5 稳定后，进入阶段 6：Human-in-the-loop。
