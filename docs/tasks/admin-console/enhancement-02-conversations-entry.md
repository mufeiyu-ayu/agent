# Admin Console Enhancement 2：会话记录入口

## 状态

```text
实施状态：已实现
验收状态：已通过
任务状态：Completed
PR 状态：Merged
```

- Issue：[#88](https://github.com/mufeiyu-ayu/agent/issues/88) / Closed
- PR：[#89](https://github.com/mufeiyu-ayu/agent/pull/89) / Merged
- Merge commit：`e059cebb62c7bf074a728fe56cc114de69cdc568`
- 实现分支：`codex/issue-88-admin-conversations`（远程与本地均已删除）
- Clarification Gate：`READY`（澄清决策见 Issue 正文）
- Review：commit 前 /code-review 两轮共 13 项，12 项修复、1 项记录为后续清理；用户确认验收并授权合并（2026-08-22）

本任务是 Admin Observability 的独立 Enhancement，不改变 Admin Task 4 Planned 或 Agent 主线状态。

## 目标与交付

新增会话维度浏览入口，解决多会话 AgentRun 混排无法区分的问题：

```text
会话列表 -> 会话详情（对话内容 / 运行记录）-> 现有 Run 详情与轨迹
```

- `GET /api/admin/conversations`：分页会话列表（title、消息数、run 数、最近活跃），按 `updatedAt DESC, id DESC`；
- `GET /api/admin/conversations/:conversationId`：会话详情 + 完整 transcript（用户可见 Message 全量 content，`createdAt ASC, id ASC`）；
- `GET /api/admin/runs` 新增可选 `conversationId` 过滤；
- Admin 前端：会话记录菜单、会话列表页、会话详情页（聊天气泡 transcript + 按块懒加载渲染 / 会话内 run 列表）；
- run 列表新增会话列、Run Trace Header 新增会话跳转链接；
- 通用层沉淀：`features/shared/` 下 admin-api（HTTP client）、detail-fetch.state、paged-list.state。

安全边界：transcript 为新的会话级投影，只含用户可见 Message 字段；现有 run 投影 500 字截断与 `safeRawData` 白名单不变。

## 验证记录（2026-08-22）

- `pnpm typecheck`（workspace 全部通过）
- `pnpm --filter @agent/api lint`、`pnpm --filter @agent/admin lint`
- `pnpm --filter @agent/admin test`（state / i18n / run-data 检查通过）
- `pnpm --filter @agent/api test:admin-runs`（140/140，含新增 conversationId 过滤用例）
- `pnpm --filter @agent/api test:admin-conversations`（4/4）
- commit 前 `/code-review` 两轮：第一轮 8 项已处理；第二轮 5 项中 4 项已修复，runs 表格组件化抽取记录为后续清理（详见 PR 描述）

## 已知遗留

- runs 表格在 RunsView / ConversationDetailView 各有一份渲染实现（ConversationsView 另有相似列表样式）；组件化抽取留待后续清理，避免验收前重构已验收页面。
- transcript API 仍一次性返回全部消息（Issue 决策）；前端按 30 条/块懒加载渲染，服务端分页为数据量增长后的升级路径。
