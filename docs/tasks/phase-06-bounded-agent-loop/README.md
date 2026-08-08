# 阶段 6：有界单 Agent Loop

- 阶段状态：**Active**
- 当前执行入口：Task 2（Next，尚未启动）
- Task 1：**Completed**
- Issue #29：Closed
- PR #30：Merged，merge commit `904b011d64e1aec7e36f706150fb8ef5ef89a761`

## 阶段目标

阶段 6 将阶段 5 的“最多一次 Tool Call、固定两轮 sampling”升级为服务端受控的单 Agent Loop：模型根据 Observation 决定下一步，Runtime 负责能力授权、执行预算、取消与终止。

```text
用户目标
  -> model sampling
  -> final answer --------------------> complete
  -> tool call
       -> Runtime 校验与执行
       -> append observation
       -> model sampling
       -> 继续或结束
```

后端不硬编码 `search -> detail -> final`。

## 任务看板

| Task | 状态 | Issue / PR | 结果 |
| --- | --- | --- | --- |
| Task 0：新增 `get_article_detail` | Completed | Issue #25 / PR #26 | 第二个只读 Article Tool 与 `core/ + articles/` 分层已完成并合并 |
| 横向前置：运行参数治理 | Completed | Issue #27 / PR #28 | 输入、历史、Model Profile、输出、timeout 与 Observation 预算已完成并合并 |
| Task 1：有界顺序 Agent Loop | **Completed** | Issue #29 / PR #30 | 已验收并合并，merge commit `904b011d` |
| Task 2：可靠性、回归与阶段学习验收 | **Next** | 未创建 | 基于当前最新 `master` 编写正式规格并创建独立 Issue |

## Task 1 已建立的能力

- Runtime 不再依赖固定 `[1, 2]` sampling 特例；
- 默认 Loop policy：`3` 次 sampling、`2` 次 Tool Call、`600s` Run deadline；
- `AGENT_MAX_TOOL_CALLS=0` 时不向模型暴露 Tool；
- 当前 Run allowlist 仅开放 `search_articles` 与 `get_article_detail`；
- 支持 direct final、一次 Tool、两次顺序 Tool 后 final；
- 第三次 Tool Call 不执行，也不会伪造 Tool Result；
- Tool Call / Tool Result 按实际顺序和 `callId` 配对进入后续 sampling；
- Run deadline 与用户 Abort 使用 first-cause 语义，deadline 为 FAILED，用户 Abort 为 ABORTED；
- DeepSeek Tool Call 的 `reasoning_content` 只作为当前 Run 内 continuation data，不进入 UI Message、Runtime Event 或 Safe Raw Data；
- assistant Tool Call 缺少中间文本时向 DeepSeek 发送非 null 空字符串 `content`；
- SEO system prompt 已区分 `search_articles` 与 `get_article_detail` 的模型选择规则；
- 同步与流式入口继续共享唯一 `AgentRuntimeService.runTurnStream()`。

## Task 1 验收基线

最终重新验收基于业务代码 commit `be9c0649bdfe0ebe670014b40952d4dfbe6cbb82`，后续仅追加 docs 收口并合入 `master`。

Codex 在分支记录的最新验证：

```text
Tool Loop       34 tests
Model Stream    49 tests
Tools           33 tests
SEO             10 tests
Recorder         9 tests
LLM Config      17 tests

API typecheck        PASS
API lint             PASS
Web typecheck        PASS
workspace typecheck  PASS
git diff --check     PASS
```

GitHub 没有对应 Actions CI，因此以上属于 Codex 本地验证证据。

## 已接受的后续风险：数据库等待与 Run deadline

`AGENT_RUN_DEADLINE_MS` 可以主动取消 in-flight model sampling 和 Tool Execution，但 Prisma query / transaction / Recorder 数据库等待目前不接受同一个 `AbortSignal`，数据库阻塞仍可能使 wall-clock 超过 Run deadline。

该风险不阻塞 Issue #29：AC-03 明确验收的是 model sampling / Tool Execution 的主动取消。本 Task 没有使用 `Promise.race` 伪装数据库取消，因为底层 Prisma 操作仍可能继续并产生 late result / late write。

Task 2 必须把以下问题作为正式输入：

- PostgreSQL statement / query timeout；
- 剩余 Run deadline budget 传播；
- Prisma timeout / cancellation 错误映射；
- deadline 后 late query / late write 的终态一致性；
- Recorder 数据库等待的超时与恢复语义。

## 阶段级不变量

- 模型可以直接回答，不被强迫调用工具；
- 每轮最多一个 Tool Call，不支持并行；
- Sampling / Tool Call 数量由服务端控制；
- Tool Call 与 Tool Result 按 `callId` 配对；
- Tool Result 始终是低信任数据；
- `PENDING / STREAMING / FAILED / ABORTED` 不进入可靠聊天历史；
- 当前用户输入恰好出现一次；
- 工具失败、timeout、Abort、deadline 与 loop limit 有明确终态；
- `AgentRun` 与已开始 `AgentStep` 最终状态一致；
- UI `Message` 不保存内部 Tool Exchange 或 reasoning。

## Task 2 方向

Task 2 只负责阶段级可靠性、回归和学习验收，不重新设计 Agent Loop。正式规格应基于当前最新 `master` 单独创建 Issue。

重点输入包括：

- 失败、timeout、Abort、deadline、loop limit 的阶段级回归矩阵；
- 数据库 deadline / late result 风险；
- Run / Step Trace 是否完整还原多步骤执行；
- sync / streaming 行为一致性；
- 必要的真实 Provider / 数据链路验证；
- 用户能否脱离文档解释 Agent Loop、执行预算、状态机和 Tool / Observation 边界。

## 本阶段不做

- 并行 Tool Call、Planner、Workflow DSL；
- RAG、Embedding、向量数据库、长期 Memory；
- 写工具、Permission、Approval、Human-in-the-loop；
- Durable Recovery、跨进程 Resume；
- 完整 ContextPlan、TokenEstimator、自动摘要或 Compaction；
- MCP、Plugin、Skill、Hook、Multi-agent；
- 通用 Agent Framework 或 LangGraph 类抽象层。

## 下一步

基于最新 `master` 为 Task 2 编写正式规格、创建独立 Issue 并执行 Clarification Gate；在 Issue 建立和 Gate READY 之前不开始 Task 2 实现。
