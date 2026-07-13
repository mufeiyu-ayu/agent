# Agent 架构术语对照

Codex 列以 `ab6a7eb87cc8a816c88b86c44cf291e251ed2136` 为源码事实；当前项目列以 `5f2ad11f2c65425e84392e81048364d55ec626ef` 为证据起点。“计划/后续”均为迁移建议，不是已实现事实。

## 1. 核心对象

| 中文助记 | Codex | 当前项目 | 边界说明 |
| --- | --- | --- | --- |
| 长期工作线 | Thread | `Conversation` | 跨多次输入持续存在的会话容器 |
| 一次回复任务 | Turn | `AgentRun` | 一次用户输入触发的完整 Agent 工作 |
| 任务执行器 | Task / RegularTask | `AgentRuntimeService.runTurnStream()` | 承担本次运行的编排，不等于数据库记录 |
| 语义对象 | Item / response item / TurnItem | Message、Tool Call/Result 的运行投影 | Item 有内容/身份/完成形态，不等于 lifecycle event，也不与 AgentStep 一一对应 |
| 运行步骤 | Task phase / lifecycle event 的持久化投影 | `AgentStep` | 当前项目是粗粒度可审计步骤，不是 Codex Item 的直译 |
| 用户可见消息 | Message / AgentMessage Item | `Message` | UI transcript 的基本对象 |
| 模型可见历史 | ResponseItem history | `ChatMessage[]` | 发送给模型的上下文，不等于数据库消息列表 |
| 运行事件 | `EventMsg` / app-server notification | `AgentRuntimeEvent` | runtime 向上游报告过程 |
| 对外流协议 | app-server notification | `ChatStreamEvent` | 给客户端消费的稳定契约 |
| 工具说明书 | `ToolSpec` | `ToolDefinition`（计划） | 模型看到的名称、描述、参数 schema |
| 工具路由器 | `ToolRouter` | `ToolRouter`（后续） | 把模型输出识别为具体工具调用 |
| 未验证调用信封 | Codex `ToolCall` 的 raw payload 路由语义 | `UnvalidatedToolCallEnvelope`（计划） | callId/name/rawArgumentsJson/samplingAttemptId，仍不可执行 |
| 已验证调用 | handler/runtime 解析后的 typed request | `ValidatedToolInvocation<T>`（计划） | registry lookup、parse、schema validation 全通过后才可进 executor |
| 工具注册表 | `ToolRegistry` | `ToolRegistry`（计划） | 工具名到执行能力的确定性映射 |
| 工具执行器 | handler / runtime | `ToolExecutor`（计划） | 验证参数并执行真实业务逻辑 |
| 工具观察结果 | function/custom tool output | `ToolObservation`（后续） | 回填模型历史的结构化执行结果 |
| 长期事实日志 | rollout / thread store | PostgreSQL run/step/message | 支持查询、恢复和审计的事实，不保存所有 delta |
| 上下文管理器 | `ContextManager` | `SeoContextBuilder`（当前很薄） | 负责 model history、预算、裁剪和压缩 |
| 模型传输会话 | `ModelClientSession` | 尚无同等对象 | Turn 内复用 WebSocket/sticky state，不能跨 Turn 泄漏 previous response state |
| 单次采样能力快照 | `StepContext` | 尚无同等对象 | 固定本次 sampling 的 environments、capability roots、MCP/tool 与 AGENTS.md；不等于 `AgentStep` |
| 扩展贡献注册表 | `ExtensionRegistry` | 尚无 | host-controlled typed contributors，不等于插件市场 |
| Agent 控制面 | `AgentControl` | 尚无 | 管理独立 child Threads、通信、容量和生命周期 |
| 长期目标 | `ThreadGoal` / GoalExtension | 当前 `/goal` 仅是产品级长期任务能力，不是业务表 | 跨 Turn 的 objective/status/budget/usage；不等于 Turn、Task 或思维链 |

## 2. 容易混淆的区别

### Conversation 不等于 Model History

`Conversation` 是业务会话实体；model history 是某次模型请求实际可见的输入。后者可能包含：

- system / developer instructions
- 选中的历史消息
- tool call 与 tool output
- 页面或 SEO 任务上下文
- 压缩摘要
- 当前 turn 输入

### AgentRun 不等于 AgentRuntimeService

- `AgentRun`：数据库里的运行事实。
- `AgentRuntimeService`：执行和协调运行的应用服务。

一个是“发生过什么”，一个是“如何让它发生”。

### AgentStep 不等于模型思维链

`AgentStep` 只能记录系统可观察的执行阶段，例如：

- 加载历史
- 调用模型
- 执行工具
- 等待审批
- 回填 observation

不能把模型私有推理过程伪装成 step，也不应存储不可验证的 chain-of-thought。

### Delta 不等于持久化事实

文本 delta 是传输增量。最终 assistant message、工具调用结果和 run 终态才是主要持久化事实。为每个 token 写数据库会带来成本、乱序和恢复复杂度。

### Item 不等于 Event

- Item：message、tool call、tool output 等可被完成、记录或投影的语义对象。
- Event：item/turn 的 started、delta、completed 等生命周期通知。

`OutputItemDone(item)` 是“一个 event 携带一个完成 item”，不能据此把 Item、Event、AgentStep 三者互换。

### Approval 不等于 Permission，也不等于 Sandbox

- Approval：这次动作是否得到用户或策略同意。
- Permission：当前身份被允许做什么。
- Sandbox：即使代码有 bug 或恶意，也从运行环境限制其能力。

当前云端 SEO Agent 应先实现前两层；只有引入通用代码执行或不可信工具时，才评估 OS sandbox。

### Plugin、Skill、MCP、Hook、App 不等价

- Plugin：组合与分发单元。
- Skill：按需加载的指令/资源。
- MCP：外部工具与资源协议。
- Hook：生命周期拦截，可阻断或在受控 contract 内改写输入。
- App / Environment：由产品或环境提供的能力来源。

它们最终可通过 extension/tool/context 边界汇入 Runtime，但不能互相授予权限。

### ToolDefinition 不等于 ToolExecutor

- `ToolDefinition` 面向模型，追求清晰、稳定、最小参数。
- `ToolExecutor` 面向系统，负责鉴权、校验、超时、执行和错误分类。

两者分离后，才能对同一个工具做版本、权限和实现替换。

### Tool call envelope 不等于 validated invocation

模型提供的 name/raw JSON 先进入 unvalidated envelope；系统查 registry、解析 JSON、按对应 tool version schema 验证后，才形成 executor 可接受的 invocation。把两个对象都简称 `ToolCall` 会掩盖最关键的信任边界。

## 3. 当前项目的建议命名层次

```text
HTTP / NDJSON contract
  ChatStreamEvent

Application runtime
  AgentRuntimeService
  AgentRuntimeEvent
  ToolRouter
  ToolRegistry
  ToolExecutor

Domain / persistence
  Conversation
  Message
  AgentRun
  AgentStep
  ToolCallRecord / ApprovalRequest（后续评估）

Provider adapter
  LLMService
  OpenAICompatibleClient
```

命名应表达边界，避免所有东西都叫 Agent、Runtime 或 Message。
