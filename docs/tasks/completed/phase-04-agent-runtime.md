# 阶段 4：Agent Runtime 基础

状态：已完成。

## 阶段目标

从“能流式聊天的 Chat 应用”升级为“能记录一次 Agent 运行过程的 Runtime”。

## 已完成任务

| 任务 | 核心完成 | 关键产物 |
| --- | --- | --- |
| Task 1 | 新增 `AgentRun` / `AgentStep` 基础模型 | Prisma model、contracts、recorder service |
| Task 2 | 抽出 `AgentRuntimeService.runTurnStream()` | runtime 主编排入口 |
| Task 3 | 定义 `AgentRuntimeEvent` 并映射到 `ChatStreamEvent` | 内部事件、SEO mapper |
| Task 4 | 抽出 `SeoContextBuilder` | SEO model messages 构造边界 |

## 最终产物

- `AgentRun`
- `AgentStep`
- `AgentRunRecorderService`
- `AgentRuntimeService`
- `AgentRuntimeEvent`
- `SeoContextBuilder`

## 验收结果

- 每次 stream chat 会创建 `AgentRun`。
- 一次 run 内记录基础 `AgentStep`。
- `done/error/aborted` 会同步收口 message、run、step 状态。
- Runtime 内部事件已与前端 `ChatStreamEvent` 协议解耦。
- SEO Agent 的 model messages 构造有独立边界。
- 当前前端 stream 协议不变。
- `typecheck`、`lint`、`git diff --check` 已通过。

## 本阶段未做

- Tool Calling
- 用户确认按钮
- RAG
- Multi-agent
- workflow engine
- AgentStep 前端时间线 UI

## 下一阶段交接

进入阶段 5：最小 Tool Calling。

阶段 5 只做低风险只读工具闭环，先验证：

- 工具定义
- 工具注册
- 工具执行
- 工具结果回填模型
- 工具调用过程记录到 `AgentStep`
