# Task 04-01：AgentRun / AgentStep 基础模型

## 目标

为每次 stream chat 创建一条可追踪的 Agent 运行记录，并记录最小执行步骤。

这个任务的目标是“运行过程可观测”，不是 Tool Calling，也不是推理过程展示。

## 背景

当前项目已经有：

```txt
Conversation：长期会话
Message：用户和 assistant 的可见消息
```

但还缺少：

```txt
AgentRun：一次用户输入触发的一次 Agent 运行
AgentStep：这次运行中发生的执行阶段
```

可以把 `AgentRun.id` 理解为当前项目里的 `runId`，也就是类似 Codex `turnId` 的角色。

## 范围

- 新增 Prisma model：`AgentRun`。
- 新增 Prisma model：`AgentStep`。
- 新增 enum：`AgentRunStatus`、`AgentStepStatus`。
- 在 `@agent/contracts` 中新增 `AgentRun` / `AgentStep` 类型。
- 在当前 stream chat 流程里创建 `AgentRun`。
- 记录最小 steps：
  - `receive_user_message`
  - `load_conversation_history`
  - `call_llm`
  - `stream_assistant_reply`
- 根据 stream 最终结果更新 run 状态：
  - done -> `COMPLETED`
  - error -> `FAILED`
  - 用户停止 -> `ABORTED`

## 不做什么

- 不接 UI。
- 不接 Tool Calling。
- 不做确认按钮。
- 不展示模型真实 chain-of-thought。
- 不做复杂 workflow engine。
- 不做多 Agent。

## 数据模型设计

### AgentRun

字段要求：

- `id`
- `conversationId`
- `userMessageId`
- `assistantMessageId` 可为空
- `status`: `RUNNING / COMPLETED / FAILED / ABORTED`
- `startedAt`
- `endedAt`
- `createdAt`
- `updatedAt`

建议关系：

```txt
Conversation 1 -> N AgentRun
Message(user) 1 -> N AgentRun
Message(assistant) 0/1 -> N AgentRun
AgentRun 1 -> N AgentStep
```

### AgentStep

字段要求：

- `id`
- `runId`
- `type`
- `title`
- `status`: `PENDING / RUNNING / COMPLETED / FAILED / ABORTED`
- `input` 可选 JSON
- `output` 可选 JSON
- `errorMessage` 可选
- `startedAt`
- `endedAt`
- `createdAt`
- `updatedAt`

## 推荐 step title

| type | title |
| --- | --- |
| `receive_user_message` | 接收用户消息 |
| `load_conversation_history` | 加载会话上下文 |
| `call_llm` | 调用语言模型 |
| `stream_assistant_reply` | 流式生成回复 |

这些 title 是产品化执行过程，不是模型真实推理过程。

## Red：先定义失败用例

实现前先确认当前系统不具备这些能力：

- [ ] 发送一条 stream chat 后，数据库中没有 `AgentRun` 记录。
- [ ] 无法查询一次回答经历了哪些 step。
- [ ] 用户停止生成后，没有 run 级别的 `ABORTED` 记录。
- [ ] 模型失败后，无法知道失败发生在 `call_llm` 还是 `stream_assistant_reply`。
- [ ] contracts 中没有可复用的 `AgentRun` / `AgentStep` 类型。

## Green：最小实现

### 1. Prisma schema

- [ ] 新增 `AgentRunStatus` enum。
- [ ] 新增 `AgentStepStatus` enum。
- [ ] 新增 `AgentRun` model。
- [ ] 新增 `AgentStep` model。
- [ ] 添加必要索引：`conversationId`、`userMessageId`、`assistantMessageId`、`runId`、`status`、`createdAt`。
- [ ] 生成 migration。

### 2. Contracts

- [ ] 在 `packages/contracts` 中新增 `agent-run` 相关类型。
- [ ] 导出 `AgentRunStatus`、`AgentStepStatus`。
- [ ] 导出 `AgentRun`、`AgentStep`。

### 3. 后端最小接入

- [ ] 保存 user message 后创建 `AgentRun(status=RUNNING)`。
- [ ] 创建 `receive_user_message` step 并标记 `COMPLETED`。
- [ ] 加载 history 前创建 `load_conversation_history` step。
- [ ] history 加载成功后标记该 step `COMPLETED`。
- [ ] 调用 LLM 前创建 `call_llm` step。
- [ ] 收到首个 delta 或模型 stream 建立后，将 `call_llm` 标记 `COMPLETED`。
- [ ] 创建 `stream_assistant_reply` step 并在生成过程中保持 `RUNNING`。
- [ ] done 时将 `stream_assistant_reply` 和 `AgentRun` 标记为 `COMPLETED`。
- [ ] error 时将当前 step 和 `AgentRun` 标记为 `FAILED`。
- [ ] aborted 时将当前 step 和 `AgentRun` 标记为 `ABORTED`。

## Refactor：整理边界

- [ ] 不要把 step 创建逻辑散落到过多位置，优先收敛成小的 service/helper。
- [ ] 保持 `SeoService.chatStream()` 可读，不在本任务里抽完整 runtime。
- [ ] 命名统一使用 `run`，不要同时混用 `turn` 字段名。
- [ ] `AgentRun.id` 可以在后续作为 stream event 的 `runId`。

## 验证命令

```bash
pnpm prisma:generate
pnpm exec prisma validate
pnpm typecheck
pnpm lint
```

如果生成 migration 后需要本地验证：

```bash
pnpm prisma:migrate --name add_agent_run_step
```

## 手动验收路径

1. 创建或进入一个 conversation。
2. 发送一条普通消息并等待完成。
3. 查询数据库，确认生成 1 条 `AgentRun` 和 4 条基础 `AgentStep`。
4. 再发送一条消息后点击停止生成。
5. 查询数据库，确认对应 run 是 `ABORTED`。
6. 制造一次模型错误。
7. 查询数据库，确认对应 run 是 `FAILED`，且有失败 step 的 `errorMessage`。

## 验收标准

- [ ] 每次 stream chat 都会创建一条 `AgentRun`。
- [ ] 每条 run 绑定 `conversationId` 和 `userMessageId`。
- [ ] `assistantMessageId` 可以在 assistant message 创建后回填。
- [ ] 每条 run 至少有 4 个基础 step。
- [ ] done/error/aborted 会更新 run 最终状态和 `endedAt`。
- [ ] step 的最终状态能反映失败或中断位置。
- [ ] 不改变当前 UI 行为。
- [ ] `typecheck`、`lint` 通过。

## 风险点

| 风险 | 应对 |
| --- | --- |
| step 记录太细导致代码变乱 | 本任务只记录 4 个基础 step |
| run 状态和 message 状态不一致 | done/error/aborted 分支里同时更新 message 和 run |
| 用户停止时 event 发不回前端 | 以后端数据库最终状态为准 |
| 误把 AgentStep 当模型推理过程 | step 只记录系统执行阶段，不展示 chain-of-thought |

## 完成状态

状态：进行中（当前准备执行）。
