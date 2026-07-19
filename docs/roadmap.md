# AI SEO Agent 学习路线

本文是当前项目的路线总览。详细执行任务以 `docs/tasks/README.md` 为准。

## 当前判断

项目已经完成从固定字段 SEO 生成器到 Session Chat、Streaming Chat、Agent Runtime 和最小 Tool Calling 的连续迁移。阶段 5 已完成并归档：模型能够提出只读 Tool Call，后端统一验证和执行工具，将 Observation 回填第二轮 sampling，并以 `AgentRun` / `AgentStep` 记录可靠执行过程；同步与流式 SEO Chat 也已共享唯一 Runtime。

Admin Console Task 0 已完成实现并通过验收，建立了独立的 `apps/admin` 后台前端基础壳。它只是阶段 8 可观测性 UI 的基础设施，不包含 Run / Step 查询 API、真实运行数据或权限能力，不代表阶段 8 已启动或完成；阶段 6、阶段 7、阶段 8 的既有状态保持不变。

## 阶段路线

| 阶段 | 状态 | 目标 | 主要产物 | 验收重点 |
| --- | --- | --- | --- | --- |
| 阶段 1：LLM + Chat 基础 | 已完成 | 跑通基础 LLM 调用和 Chat UI | 基础聊天链路 | 能完成一次问答 |
| 阶段 2：Session Chat 持久化 | 已完成 | 多会话、消息落库、受控 history | `Conversation`、`Message` | 刷新不丢、多会话不串 |
| 阶段 3：Streaming Chat | 已完成 | 流式输出、停止生成、最终态一致 | NDJSON stream、`ABORTED` 状态 | `done/error/aborted` 不残留 `STREAMING` |
| 阶段 4：Agent Runtime 基础 | 已完成 | 记录一次 Agent 运行过程并抽 runtime 边界 | `AgentRun`、`AgentStep`、`AgentRuntimeService`、`AgentRuntimeEvent`、`SeoContextBuilder` | 每次发送都有 run/step，runtime event 与前端协议解耦，SEO 上下文构造有独立边界 |
| 阶段 5：最小 Tool Calling | 已完成 | 让模型请求只读 SEO 工具，后端执行并继续生成最终回答 | `ModelStreamEvent`、Tool contract / registry、`search_articles`、Tool Loop、可靠运行记录、统一 Runtime 入口 | Tool Call、Observation、第二轮 sampling、timeout / abort、AgentStep 与前端协议全部稳定 |
| 阶段 6：Human-in-the-loop | 后续，未启动 | 中风险工具执行前需要用户确认 | `approval_required`、审批资源、确认 / 拒绝接口 | 拒绝不执行，确认才执行，审批状态可恢复 |
| 阶段 7：Context 管理 | 后续 | 区分 UI message、model message、runtime event | `SeoContextBuilder`、预算规则 | 上下文可控，不污染 UI |
| 阶段 8：可观测性与作品集 | 后续 | 把项目沉淀为可展示 Agent 应用 | run/step 查询、错误分类、技术文档 | 能解释一次 Agent 如何运行 |

Admin Console 的任务边界与进度以 [tasks/admin-console.md](./tasks/admin-console.md) 为准；Task 0 已 Completed，Task 1-4 均为 Planned，当前没有 Active 的 Admin Console 正式任务。

## 当前优先级

| 优先级 | 任务 | 说明 |
| --- | --- | --- |
| P0 | 阶段 5 源码复盘（学习模式） | 按完整请求链阅读 Vue、SEO adapter、Runtime、sampling、Tool、Observation、Recorder 和测试；不创建 Issue、不改正式状态 |
| P1 | 决定 Admin Console Task 1 是否启动 | 需要继续后台建设时，再为静态 Run List / Run Detail UI 创建独立 Issue；当前不提前实施 |
| P1 | 决定阶段 6 的真实审批场景 | 源码复盘完成后，再选择一个中风险或写操作工具，先规划最小 Human-in-the-loop Issue |
| P2 | Context 管理增强 | 审批主链明确后，再加入页面数据、关键词、Tool Observation 和整体 prompt budget |

## 现在暂不做

| 暂不做 | 原因 |
| --- | --- |
| 新增更多只读工具 | 当前重点是理解现有 Tool Loop，不用工具数量代替架构掌握 |
| RAG / 向量数据库 | 当前 baseline 是结构化 Tool Calling，不是知识库问答 |
| Multi-agent | 单 Agent 已稳定，但尚无需要角色协作的真实产品问题 |
| MCP / 插件系统 | 先掌握内置工具、权限和 Context 边界 |
| 自动 Tool Retry / durable recovery | 需要幂等收据、恢复语义和更完整的 durable facts |
| OS sandbox | 当前不执行 shell，不需要 Codex 级 sandbox |
| Workflow engine | 目前用 TypeScript service 编排更适合学习 |
| WebSocket 多路复用 | NDJSON 已能满足当前交互式流式任务 |