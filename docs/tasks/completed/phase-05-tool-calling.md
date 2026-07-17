# 阶段 5：最小 Tool Calling

状态：已完成并归档。

完成日期：2026-07-18（Asia/Shanghai）。

## 阶段目标

在阶段 4 `AgentRuntimeService` 基础上，完成一条低风险、只读、可记录、可中断的最小 Tool Calling 闭环：

```text
用户问题
  -> model_sampling #1
  -> 模型提出 Tool Call
  -> 后端验证并执行工具
  -> Tool Result 规范化为 Observation
  -> model_sampling #2
  -> 最终回答
```

## 已完成任务

| 任务 | 核心完成 | 关键产物 |
| --- | --- | --- |
| Task 0 | 准备稳定的文章演示数据 | `Article`、migration、68 篇 fixtures |
| Task 1 | 将模型流升级为结构化事件 | `ModelStreamEvent`、Tool Call 分片归并、usage / finish reason |
| Task 2 | 建立工具契约和执行边界 | `ToolDefinition`、Registry、参数验证、风险门禁、`ToolInvocationService` |
| Task 3 | 实现第一只只读业务工具 | `search_articles`、精简结果、受控 `modelContent` |
| Task 4 | 跑通单 Agent Tool Loop | 最多一次工具调用、最多两轮 sampling、Observation 回填、最终回答实时输出 |
| Task 5 | 完成可靠性和运行记录 | 动态 `AgentStep`、sequence、usage、timeout、Observation 上限、终态一致性 |
| 收口修复 | 统一同步与流式入口 | Issue #14、PR #17；两个 HTTP 入口共享唯一 Runtime |

## 最终调用链

```text
POST /seo/chat
  -> SeoService.chat()
  -> buildRunTurnInput()
  -> AgentRuntimeService.runTurnStream()
  -> 聚合 terminal event 为一次性 JSON

POST /seo/chat/stream
  -> SeoService.chatStream()
  -> buildRunTurnInput(signal)
  -> AgentRuntimeService.runTurnStream()
  -> 映射为 start / delta / done / error / aborted
```

两种 HTTP 响应形式只负责不同的结果投影，不再拥有两套 Message、history、Tool Loop 或错误持久化逻辑。

## 最终运行记录

普通回答：

```text
1 receive_user_message
2 load_conversation_history
3 model_sampling       finishReason=stop
4 assistant_output
```

Tool Loop：

```text
1 receive_user_message
2 load_conversation_history
3 model_sampling       finishReason=tool_calls
4 tool_execution
5 model_sampling       finishReason=stop
6 assistant_output
```

`Message` 只保存用户可见内容；`AgentRun` 表示一次任务整体终态；`AgentStep` 记录可审计执行事实，不记录模型 chain-of-thought。

## 关键工程边界

- 模型只能提出 Tool Call；工具存在性、参数合法性、风险和执行权由服务端决定。
- 当前只允许低风险、无副作用、无外部网络且无需审批的工具。
- `ToolDefinition.timeoutMs` 是真实 deadline；用户 abort 与工具 timeout 保留不同语义。
- 工具失败 Step 可以是 `FAILED`，但模型若能在第二轮给出有效解释，整个 Run 仍可 `COMPLETED`。
- Tool Observation 单条上限为 8,000 个 Unicode code point，超限后生成确定性预览 envelope。
- durable Step 只保存 allowlist 摘要，不保存完整 raw arguments、`ToolResult.data`、完整 `modelContent`、stack 或 secret。
- `ChatStreamEvent` 始终保持 `start / delta / done / error / aborted`，内部 run id、failure reason、Tool Result 和 AgentStep 不暴露给 Vue。
- 同步入口对缺失 Conversation 保留安全 404；其他 Runtime failure 使用受控 503，不根据错误文案做字符串判断。

## 验收结果

最终回归记录：

- SEO Service：8 / 8。
- Agent Recorder：9 / 9。
- Tool Loop：20 / 20。
- Model Stream：35 / 35。
- Tools：24 / 24。
- API typecheck / lint：通过。
- Web typecheck / lint / build：通过。
- workspace typecheck、`git diff --check`：通过。
- 全仓 `pnpm lint` 仍受既有 `docs/research/**` Markdown baseline 阻断，属于已知非本阶段回归。

真实验收覆盖普通回答、文章查询 Tool Loop、零结果、停止生成、同步 JSON、流式 NDJSON、缺失会话 404、刷新持久化和数据库 Step 顺序。Issue #13 的 Computer Use 记录为 6 个 PASS、0 个 FAIL、1 个因截图时机不足而 INCONCLUSIVE；该项对应的第二轮实时 delta 已由确定性自动化测试覆盖。

关键合并记录：

- PR #10：`search_articles`。
- PR #12：单 Agent Tool Loop。
- PR #15：Tool Calling 可靠性与 `AgentStep` 记录，merge commit `f6985627`。
- PR #17：统一同步与流式 SEO Chat Runtime，merge commit `db7b3d1f`；Issue #14 已关闭。

## 当前明确未做

- 写操作工具。
- Human-in-the-loop 和审批资源。
- 自动 Tool Retry、跨进程恢复和 durable execution。
- RAG、向量数据库、MCP、Multi-agent。
- 并行工具调用。
- AgentStep 前端时间线和 Run 查询页面。

这些不是阶段 5 缺陷，而是后续阶段的独立能力。

## 源码复盘顺序

建议先完成阶段复盘，再启动下一正式任务：

```text
1. apps/web/src/hooks/useSeoWorkspace.ts
2. apps/web/src/api/seo.ts
3. apps/api/src/seo/seo.controller.ts
4. apps/api/src/seo/seo.service.ts
5. apps/api/src/seo/seo-context-builder.service.ts
6. apps/api/src/agent-runtime/agent-runtime.service.ts
7. apps/api/src/agent-runtime/model-sampling-decision.ts
8. apps/api/src/tools/tool-invocation.service.ts
9. apps/api/src/tools/search-articles.tool.ts
10. apps/api/src/tools/tool-observation.ts
11. apps/api/src/agent-runtime/agent-run-recorder.service.ts
12. prisma/schema.prisma 与对应测试
```

复盘完成标准：能够从一次 SP Himeko 查询还原 Vue、Controller、SeoService、Runtime、LLM、Tool、Observation、第二轮 sampling、Message / Run / Step 收口的完整链路。

## 下一阶段交接

阶段 6 `Human-in-the-loop` 尚未启动。开始前应先完成阶段 5 源码复盘，并为中风险或写操作工具确定真实产品场景、审批资源和恢复语义。