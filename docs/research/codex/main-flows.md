# Codex 核心主链路

本文只保留对当前 AI SEO Agent 有迁移价值的主链路。

## 1. 用户输入进入 runtime

```txt
TUI / exec / SDK
  -> app-server client
  -> thread/start 或 thread/resume
  -> turn/start
  -> Op::UserInput
  -> Session submission queue
```

结论：入口只负责把用户行为标准化，真正的 Agent loop 在 core runtime。

迁移到当前项目：`SeoController` 应保持协议边界，不继续堆复杂 runtime 逻辑。

## 2. Thread 生命周期

```txt
thread/start
  -> ThreadManager.start_thread_with_options
  -> Codex::spawn
  -> Session
  -> listener / persistence
```

```txt
thread/resume
  -> load stored thread / rollout
  -> reconstruct history
  -> resume session
```

结论：Thread 是长期工作线，不是一次请求。

迁移到当前项目：`Conversation` 已经是最小 Thread。

## 3. Turn 执行过程

```txt
Op::UserInput
  -> submission_loop
  -> RegularTask
  -> run_turn
  -> build prompt
  -> ModelClientSession::stream
  -> stream events
  -> TurnComplete / TurnAborted
```

结论：Turn 是一次用户输入触发的可观测、可中断运行过程。

迁移到当前项目：阶段 4 的 `AgentRun` 就是这个概念的 TypeScript/NestJS 落地。

## 4. Tool call 执行

```txt
model output tool call
  -> ToolRouter 识别
  -> ToolRegistry 查 executor
  -> runtime 执行工具
  -> observation 写回 model history
  -> follow-up sampling
```

结论：模型只提出工具调用，后端才真正执行。

迁移到当前项目：阶段 5 再做 `ToolDefinition`、`ToolExecutor`、`ToolRegistry`，第一版只做低风险只读 SEO 工具。

## 5. Approval 与 sandbox

```txt
Tool call
  -> policy 判断风险
  -> approval request
  -> user decision
  -> sandbox / permission profile
  -> execute
```

结论：审批表示用户是否同意，sandbox 限制工具能做什么，两者不是一回事。

迁移到当前项目：当前只需要 human-in-the-loop，不需要 OS sandbox。

## 6. Context 与持久化

```txt
UI transcript
  != model history
  != runtime event
  != persistent log
```

结论：这四类数据不能混为一谈。

迁移到当前项目：阶段 4 先记录 `AgentRun` / `AgentStep`，阶段 7 再升级 `SeoContextBuilder`。

## 7. SDK 复用 runtime

```txt
SDK
  -> protocol client
  -> app-server / exec JSONL
  -> shared runtime
```

结论：SDK 不应该重新实现 Agent loop。

迁移到当前项目：未来如果做 SDK，只封装 Nest API，不在 SDK 内调用模型。
