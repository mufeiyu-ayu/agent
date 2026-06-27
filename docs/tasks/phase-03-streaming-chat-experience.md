# 阶段 3：流式输出 + ChatGPT 级交互体验

## 阶段目标

把 Chat 从“一次性接口返回”升级为“实时生成 + 可中断 + 类 ChatGPT 体验”的 Agent Chat Runtime。

这一阶段的重点是交互体验和 streaming 链路，不是 Tool Calling，也不是复杂 Agent Step。

完成后，用户应该能看到 assistant message 逐步生成，而不是等待接口一次性返回完整答案。

## 前置条件

阶段 3 开始前，阶段 2 应该已经完成：

- conversation 数据已经存在
- message 已经归属 conversation
- Chat 请求已经绑定 conversationId
- 后端能根据 session 构建 prompt history
- 刷新页面后历史对话可以恢复

如果阶段 2 没有完成，不建议直接做阶段 3。

## 本阶段核心认知

从：

```txt
request -> response
```

升级为：

```txt
request -> stream chunks -> incremental UI update -> final message commit
```

也就是让模型输出从“结果”变成“过程”。

## 任务列表

### 本次已完成

- 完成阶段 3 Step 1 / Step 2 的基础能力：定义 `ChatStreamEvent`、补充 `MessageStatus.ABORTED`，并让后端 `LLMService.chatStream()` 具备模型流式读取能力。
- 引入 OpenAI SDK 替换原生 `fetch` + SSE 解析，把 OpenAI-compatible 调用下沉到 LLM client 适配层，上层只接收 `string` delta。
- 新增后端 `POST /api/seo/chat/stream` NDJSON stream API，并接入 `llmService.chatStream()` 输出 `start / delta / done / error / aborted` 业务事件。
- 新增前端 `streamChatWithSeoAgent()`，只实现 `fetch + ReadableStream + TextDecoder` NDJSON 解析能力，暂不替换现有发送流程和 UI。
- 前端 `useSeoWorkspace.sendMessage()` 已切换到 `streamChatWithSeoAgent()`，支持 `start / delta / done / error / aborted` 事件驱动的本地消息更新。
- `AgentConversation` 已支持 assistant 内容逐 chunk 增长展示，并补齐 `thinking / generating / done / error / aborted` 状态映射；停止生成按钮仍留到 Task 6。

### Task 1：确定 Streaming 协议和事件格式

状态：已完成（Step 1：协议和共享类型已定义；后端 stream API、前端 stream client 与前端发送流程均已接入）。

#### 核心要完成

- 选择一种 streaming 方案
- 明确前端如何读取数据
- 明确后端每次发送什么数据
- 明确 start / delta / done / error 的表达方式

#### 当前协议选择

- 统一采用 HTTP Streaming + NDJSON：后端返回 `application/x-ndjson`，每一行都是一个 JSON 序列化后的 `ChatStreamEvent`。
- 前端后续使用 `fetch` + `ReadableStream` 读取响应体，再用 `TextDecoder` 按行解析事件。
- 后端只向前端输出业务事件，不暴露 DeepSeek / OpenAI-compatible SDK 原始 chunk。
- 暂不使用 WebSocket，也不同时支持 SSE / NDJSON 多套协议。
- 共享类型定义在 `packages/contracts/src/seo.ts`，由 `@agent/contracts` 统一导出。

#### 推荐事件类型

- start：后端已创建 user message 和 assistant message
- delta：模型输出片段
- done：生成完成，assistant message 已完成落库
- error：生成失败
- aborted：用户主动停止

#### 关键约束

- 不同时支持多种协议
- 不直接把模型 SDK 原始事件暴露给前端
- 不做 tool calling stream
- 不做 agent step stream

#### 验收条件

- 前后端对事件格式有明确约定
- 前端能稳定解析 start / delta / done / error
- 后端输出格式可预测

### Task 2：后端支持 Streaming Response

状态：已完成基础版（已新增 `POST /api/seo/chat/stream`，输出 NDJSON 业务事件）。

#### 核心要完成

- 新增或改造 chat stream API
- 接收 conversationId 和 user input
- 根据 conversationId 加载 history
- 调用 LLM streaming
- 将 chunk 持续返回给前端
- stream 完成后保存最终 assistant message

#### 后端关注点

- 校验 conversationId
- 保存 user message
- 加载受控 history
- 持续输出 delta
- 完成后保存 assistant message

#### 验收条件

- 前端可以收到连续 chunk
- 后端不是等待完整内容后才返回
- stream 正常结束时能得到完整 assistant 内容
- 出错时前端能识别 error

### Task 3：前端支持逐 chunk 接收

状态：已完成（已新增 stream API client，并接入 `useSeoWorkspace` 消费流式事件）。

#### 核心要完成

- 发起 stream 请求
- 读取返回的 chunk
- 解析事件数据
- 将 delta 内容追加到当前 assistant message
- 根据 done / error 更新状态

#### 前端关注点

- 能读取 stream
- 能解析事件
- 能持续追加内容
- 能避免重复追加 chunk

#### 验收条件

- 前端能逐步收到内容
- 页面内容会随着 chunk 增长
- done 后不再继续追加
- error 时能停止当前生成

### Task 4：assistant message 渐进式生成

状态：已完成基础版（assistant message 可随 delta 实时增长，完成后写入 `COMPLETED` 展示态）。

#### 核心要完成

- 用户发送后，先创建空 assistant message
- 收到 delta 后持续追加 content
- 生成过程中 UI 实时更新
- 生成完成后进入 done 状态

#### 核心流程

```txt
创建空 assistant message
  ↓
stream delta 持续追加 content
  ↓
UI 实时渲染
  ↓
stream 完成
  ↓
message 状态变为 done
```

#### 验收条件

- assistant message 会从空内容逐步增长
- delta 不会追加到错误 conversation
- 生成完成后 message 状态明确
- 刷新页面后能看到最终内容

### Task 5：运行状态设计

状态：已完成基础版（已接入 `thinking / generating / done / error / aborted`；停止按钮与 AbortController 留到 Task 6）。

#### 核心要完成

- 把普通 loading 升级为轻量 runtime 状态
- UI 能表达 thinking / generating / done / error / aborted
- 输入框、发送按钮、停止按钮与状态联动

#### 建议状态

- idle：空闲
- thinking：请求已发出，模型还没开始输出
- generating：已经收到 delta，内容正在增长
- done：生成结束
- error：生成失败
- aborted：用户主动停止

#### 验收条件

- 用户能看到模型正在准备输出
- 用户能看到模型正在生成
- 生成完成和失败状态能区分
- 状态不会卡死在 thinking 或 generating

### Task 6：请求可中断

#### 核心要完成

- 前端支持停止生成
- 中断当前 stream 请求
- 停止后 UI 不再追加 delta
- 对未完成的 assistant message 做合理展示

#### 关键约束

- 第一版只做停止当前生成
- 不做暂停后继续生成
- 不做多请求并发取消
- 不做队列取消

#### 验收条件

- 点击停止后，页面不再继续增长内容
- 输入框和按钮状态能恢复
- 当前 message 有明确 aborted 展示或被合理移除
- 后续可以继续发送新消息

### Task 7：Markdown 实时渲染

#### 核心要完成

- assistant message 边生成边渲染 markdown
- 兼容不完整 markdown
- 兼容不完整 code block
- 渲染失败时不影响整个 Chat 页面

#### 关键约束

- 第一版先保证稳定显示
- 不追求完美编辑器体验
- 不做富文本编辑
- 不做复杂语法高亮优化

#### 验收条件

- 普通 markdown 能边生成边展示
- code block 未闭合时页面不崩溃
- 渲染异常时有降级展示
- 生成完成后 markdown 显示正常

### Task 8：完成态落库与回归验收

#### 核心要完成

- stream 完成后保存完整 assistant message
- 刷新页面后能恢复最终内容
- 切换 conversation 后内容仍然存在
- aborted / error 的消息有合理展示方式
- 不破坏阶段 2 的多 conversation 能力

#### 验收路径

1. 在 conversation A 发送消息并完成 stream
2. 刷新页面后确认完整 assistant message 仍然存在
3. 创建 conversation B 并发送消息
4. 确认 A / B 的 stream 内容不会串线
5. 在 conversation B 中停止生成
6. 确认停止后还能继续发送新消息
7. 制造一次错误场景并确认 error 状态正常

#### 最终验收条件

- assistant 内容可以逐步出现在页面中
- 收到第一个 chunk 前有 thinking 状态
- 收到 chunk 后进入 generating 状态
- 生成完成后进入 done 状态
- 用户可以点击停止生成
- 停止后 UI 不会继续追加内容
- 生成失败时能展示 error 状态
- 生成完成后的 assistant message 可以持久化恢复
- 阶段 2 的多 conversation 能力不被破坏

## 本阶段不做

- Tool Calling
- Agent Step System
- Multi-agent
- RAG
- Long-term Memory
- Workflow Engine
- 复杂日志系统
- 复杂可观测性面板

## 完成后的下一阶段

进入阶段 4：Agent Runtime。

阶段 4 才开始考虑：

- Tool Calling
- Step Execution
- Agent Loop
- Human-in-the-loop
- 工具执行过程展示
