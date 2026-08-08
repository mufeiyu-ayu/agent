# 阶段 6：有界单 Agent Loop

- 阶段状态：**Active**
- 当前执行入口：Task 2（Next，尚未启动）
- Task 1：**Completed**
- PR #30：Draft，已验收，尚未合并

## 阶段目标

阶段 6 的目标是把阶段 5 的“最多一次 Tool Call、固定两轮 sampling”升级为服务端受控的单 Agent Loop：模型可以根据 Observation 连续决定下一步，Runtime 负责授权、预算、执行、取消与终止。

当前 Runtime 已具备：

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

后端不硬编码 `search -> detail -> final`。模型决定下一步，Runtime 只提供受控能力。

## 任务看板

| Task | 状态 | Issue / PR | 结果 |
| --- | --- | --- | --- |
| Task 0：新增 `get_article_detail` | Completed | Issue #25 / PR #26 | 第二个只读 Article Tool 与 `core/ + articles/` 分层已完成并合并 |
| 横向前置：运行参数治理 | Completed | Issue #27 / PR #28 | 输入、历史、Model Profile、输出、timeout 与 Observation 预算已完成并合并 |
| Task 1：有界顺序 Agent Loop | **Completed** | Issue #29 / Draft PR #30 | GPT 最终技术验收通过，用户已确认收口；PR 尚未合并 |
| Task 2：可靠性、回归与阶段学习验收 | **Next** | 未创建 | 等 PR #30 合并后再基于最新 `master` 编写规格 |

## Task 1 已建立的能力

- Runtime 不再依赖固定 `[1, 2]` sampling 特例；
- 默认 Loop policy：`3` 次 sampling、`2` 次 Tool Call、`600s` Run deadline；
- `AGENT_MAX_TOOL_CALLS=0` 时不向模型暴露 Tool；
- 当前 Run allowlist 仅开放 `search_articles` 与 `get_article_detail`；
- 支持 direct final、一次 Tool、两次顺序 Tool 后 final；
- 第三次 Tool Call 不执行，也不会伪造 Tool Result；
- Tool Call / Tool Result 按真实顺序和 `callId` 配对进入后续 sampling；
- Run deadline 与用户 Abort 使用 first-cause 语义，deadline 为 FAILED，用户 Abort 为 ABORTED；
- DeepSeek Tool Call 的 `reasoning_content` 只作为当前 Run 内部 continuation data，不进入 UI Message、Runtime Event 或 Safe Raw Data；
- 同步与流式入口继续共享唯一 `AgentRuntimeService.runTurnStream()`。

## Task 1 验收基线

最终验收基于 PR #30 head `f40b2926c689d52970833d2d2ada9d39c3fe0e22`。

Codex 在 PR 中记录的最新验证：

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

GPT 已核对 Issue #29、最新 diff、关键测试、Runtime 状态机、DeepSeek continuation 与 P2 修复，未发现新的阻塞问题；用户随后明确确认收口。

说明：GitHub 当前没有对应 Actions CI，因此上述命令结果属于 PR 中记录的 Codex 本地验证证据，不表述为 GitHub CI 结果。

## 阶段级不变量

阶段 6 最终必须保持：

- 模型可以直接回答，不被强迫调用工具；
- 每轮最多处理一个 Tool Call，不支持并行；
- Sampling、Tool Call 与 Run deadline 都由服务端拥有硬上限；
- Tool Call 在对应 Tool Result 之前，且 `callId` 完整配对；
- Tool Result 始终是低信任数据；
- `PENDING / STREAMING / FAILED / ABORTED` 不进入可靠聊天历史；
- 用户当前输入恰好出现一次；
- 工具失败、timeout、Abort、deadline 与 loop limit 有明确终态；
- `AgentRun` 与所有已开始 `AgentStep` 最终状态一致；
- UI `Message` 只保存用户可见内容，不保存内部 Tool Exchange 或 reasoning。

## Task 2 方向

Task 2 只负责阶段级可靠性、回归和学习验收，不重新设计 Agent Loop。

正式规格应在 PR #30 合并后再根据最新 `master` 编写，重点预计包括：

- 失败、timeout、Abort、deadline、loop limit 的阶段级回归矩阵；
- Run / Step Trace 是否能完整还原一次多步骤执行；
- 同步 / streaming 行为一致性；
- 必要的真实 Provider / 数据链路验证；
- 用户能否脱离文档解释 Agent Loop、执行预算、状态机和 Tool / Observation 边界。

Task 2 尚未创建 Issue，以上只是阶段方向，不是最终实现规格。

## 本阶段不做

- 并行 Tool Call、Planner、Workflow DSL；
- RAG、Embedding、向量数据库、长期 Memory；
- 写工具、Permission、Approval、Human-in-the-loop；
- Durable Recovery、跨进程 Resume；
- 完整 ContextPlan、TokenEstimator、自动摘要或 Compaction；
- MCP、Plugin、Skill、Hook、Multi-agent；
- 通用 Agent Framework 或 LangGraph 类抽象层。

## 建议源码阅读顺序

```text
1. apps/api/src/agent-runtime/agent-runtime.service.ts
2. apps/api/src/agent-runtime/agent-runtime.policy.ts
3. apps/api/src/agent-runtime/model-sampling-decision.ts
4. apps/api/src/llm/model-input.types.ts
5. apps/api/src/llm/model-stream.types.ts
6. apps/api/src/llm/clients/openai-compatible-stream.adapter.ts
7. apps/api/src/llm/clients/openai-compatible.client.ts
8. apps/api/src/tools/core/tool-invocation.service.ts
9. apps/api/src/tools/articles/search-articles.tool.ts
10. apps/api/src/tools/articles/get-article-detail.tool.ts
11. apps/api/src/agent-runtime/agent-run-recorder.service.ts
12. 对应 Runtime / Model Stream / Tool 测试
```

## 研究入口

- [`../../research/codex-reference/core-runtime.md`](../../research/codex-reference/core-runtime.md)
- [`../../research/codex-reference/tool-loop.md`](../../research/codex-reference/tool-loop.md)
- [`../../research/codex-reference/context-history.md`](../../research/codex-reference/context-history.md)
- [`../../research/codex-reference/how-to-use.md`](../../research/codex-reference/how-to-use.md)

## 下一步

当前不启动 Task 2。先等待用户单独授权 PR #30 转 Ready / 合并；合并后再从最新 `master` 为 Task 2 建立正式规格和 Issue。
