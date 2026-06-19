# AI SEO Agent 当前任务
| 项目阶段 | 当前结论 | 下一步 |
| --- | --- | --- |
| 第一阶段 | Vue + Nest + LLMService + JSON Output + 错误恢复 + 会话 UI 已练过 | 不再扩展固定字段生成器 |
| 当前主线 | 从固定字段 SEO 生成器转向自然语言 SEO Agent 聊天助手 | 做 T19-A 受控多轮上下文 |
| T19-A | 最近几轮 user / assistant history 受控传给后端并组装进 messages | 第二轮能引用上一轮信息 |
| 后续任务 | T19-B 控制 history 成本；T18 做 SEO Tool Calling；T20 做第一版收尾 | 按顺序推进 |
| 暂不做 | 登录、数据库、RAG、多 Agent、外部搜索、复杂工作流、生产部署 | 等主线稳定后再评估 |
