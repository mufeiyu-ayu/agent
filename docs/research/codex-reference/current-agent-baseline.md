# 当前 Agent 项目基线与阶段 6 缺口

## 1. 当前结论

项目已经完成最小 Tool Calling 闭环，不再处于“Agent Runtime 前夜”。当前真实基线是：

```text
模型可以直接回答
或
模型提出一次 Tool Call
  -> 服务端验证并执行 search_articles
  -> Observation 回填 model input
  -> 第二轮 sampling 生成最终答案
```

同步与流式入口共享 `AgentRuntimeService.runTurnStream()`，Run / Step、timeout、abort、Observation 上限和安全记录均已具备基础。

当前唯一确定的下一正式阶段是：

```text
阶段 6：有界单 Agent Loop
```

目标不是继续堆工具，也不是立即建设完整 Context Engineering，而是把固定的一次工具调用 / 两轮 sampling 特例升级为服务端受控的顺序循环。

## 2. 已具备能力

### 2.1 会话与用户可见消息

- `Conversation` 长期会话；
- `Message` 用户可见消息；
- USER / ASSISTANT role；
- PENDING / STREAMING / COMPLETED / FAILED / ABORTED 状态；
- PostgreSQL 持久化；
- NDJSON streaming 与停止生成。

### 2.2 AgentRun / AgentStep

- 每次用户请求创建 `AgentRun`；
- 动态记录接收消息、加载历史、model sampling、tool execution、assistant output；
- 状态、顺序、startedAt / endedAt、受控 input / output 摘要；
- sampling usage、finish reason、时长和错误摘要；
- abort、failure 和 complete 终态收口。

### 2.3 模型事件与输入

- provider-neutral `ModelStreamEvent`；
- 文本、Tool Call、usage 与 response terminal 事件；
- `ModelInputItem` 可以表达普通消息、assistant Tool Call 和 Tool Result；
- Tool Result 作为 Observation 回填第二轮 sampling；
- UI Message 不保存内部 Tool Exchange。

### 2.4 Tool Contract / Registry / Invocation

- `ToolDefinition`、`RegisteredTool`、`ToolExecutor`、`ToolResult`；
- Registry 注册、查找、重复名称拒绝和稳定排序；
- JSON parse、schema parse、risk gate、timeout 与 Abort；
- 当前正式工具 `search_articles`；
- 当前只允许低风险、无副作用、不联网、无需审批的工具；
- 受控 `modelContent` 和 8,000 Unicode code point Observation 上限。

### 2.5 统一 Runtime

- `POST /seo/chat` 与 `POST /seo/chat/stream` 共享 `runTurnStream()`；
- 同步入口聚合 terminal event；
- 流式入口映射 `start / delta / done / error / aborted`；
- 外部协议不直接暴露 Tool Result 或 AgentStep。

## 3. 当前真实缺口

| 能力 | 当前状态 | 阶段 6 目标 |
| --- | --- | --- |
| 工具数量 | 只有 `search_articles` | 新增与搜索结果有依赖关系的 `get_article_detail` |
| Sampling | 固定 `[1, 2]` 两轮 | 服务端策略控制的有限多轮 sampling |
| Tool Call | 最多一次 | 支持多次顺序 Tool Call |
| 终止条件 | 第二轮必须结束，否则失败 | final answer、sampling limit、tool limit、timeout、abort 均有明确语义 |
| Loop policy | 隐含在 `for ([1, 2])` | 显式 `maxSamplingRounds`、`maxToolCalls` 等策略 |
| 错误语义 | 已有基础失败路径 | 区分零结果、资源不存在、参数失败、系统异常、timeout、abort、超限 |
| Trace | 可记录一次工具调用 | 可还原多个 sampling / tool execution 顺序 |
| 测试 | 覆盖最小 Tool Loop | 覆盖直接回答、一次工具、多次工具和所有终止路径 |

## 4. 阶段 6 的最小闭环

代表性成功路径：

```text
sampling #1
  -> search_articles
  -> observation #1
sampling #2
  -> get_article_detail
  -> observation #2
sampling #3
  -> final answer
```

也必须允许：

```text
sampling #1 -> final answer
sampling #1 -> search_articles -> sampling #2 -> final answer
```

Runtime 不能硬编码必须按某个固定流程使用工具。模型根据目标和 Observation 选择下一步，服务端负责验证、执行和限制。

## 5. 阶段 6 必须掌握的职责边界

### 模型负责

- 判断当前是否需要工具；
- 选择已暴露工具；
- 构造 Tool Call 参数；
- 根据 Observation 判断继续还是给出最终答案。

### Runtime 负责

- 决定哪些工具可见；
- 校验工具名和参数；
- 执行风险策略与 timeout；
- 追加合法 Tool Call / Tool Result；
- 控制 Sampling 和 Tool Call 上限；
- 传播 Abort；
- 收口 Run / Step 状态；
- 记录安全 Trace；
- 超限或异常时明确终止。

## 6. Context 在当前阶段的边界

阶段 6 只补 Agent Loop 必需的正确性：

- 当前用户输入恰好一次；
- 只使用合格状态的历史消息；
- Tool Call 在对应 Tool Result 之前；
- `callId` 完整配对；
- 多个 Tool Exchange 按实际顺序追加；
- Tool Result 保持低信任数据身份；
- 继续记录实际 Token Usage。

当前不建设：

- 通用 `ContextPlan`；
- TokenEstimator；
- completion reserve / safety margin；
- Source Priority Engine；
- 自动 Token 裁剪；
- 自动摘要、Compaction 或 Memory。

这些研究仍有长期价值，但只有出现真实容量、成本、延迟或质量问题后，才应重新评估为正式阶段。

## 7. 当前不要做什么

- RAG、Embedding、向量数据库；
- 写工具、Permission、Approval、HITL；
- Durable Recovery、跨进程 Resume；
- 并行 Tool Call、Planner、Workflow DSL；
- MCP、Plugin、Skill、Multi-agent；
- 通用 Agent Framework；
- 提前编排阶段 6 之后的 Task。

## 8. 当前任务顺序

```text
Task 0：get_article_detail 只读工具
  -> Task 1：有界顺序 Agent Loop
  -> Task 2：可靠性、回归与学习验收
```

只有 Task 0 已有详细正式规划。Task 1、Task 2 必须等待前置任务验收后，基于最新代码重新展开。

正式入口：[`../../tasks/phase-06-bounded-agent-loop/README.md`](../../tasks/phase-06-bounded-agent-loop/README.md)。
