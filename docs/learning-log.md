# Agent 学习路线
| 阶段 | 状态 | 关键结论 |
| --- | --- | --- |
| 基础调用 | 已完成 | 练过模型调用、messages、LLMService、JSON Output、错误恢复、事件级 streaming |
| 第一阶段 | 已完成 | 固定字段 SEO 生成器更像表单工具，不适合作为下一阶段主线 |
| 当前学习 | 进行中 | 自然语言 SEO Agent：system prompt、普通 chat messages、Session Chat、受控 history |
| Session Chat | 已完成 | `conversationId` 是多轮对话上下文边界；真实 chat 入口先保存 USER message，再读取当前 conversation 最近 messages 组装 LLM messages，最后保存 ASSISTANT message |
| Memory Layer | 已建立 | 阶段 2 把 `DB / Storage = 数据源` 落到工程里：前端只展示 active conversation 的 messages，后端负责按 session 构建上下文，避免 UI state 充当历史来源 |
| 下一步 | 准备做 | 阶段 2 Task 8：验证多会话不串、刷新恢复、删除同步、长历史不会全部传给模型 |
| 记录规则 | 持续遵守 | 只记录 Agent 概念学习；普通项目进度写 `docs/work-log.md` |
