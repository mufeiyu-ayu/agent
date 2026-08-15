# Phase 8 Task 3：Grounded Answer 与 Retrieval Inspector

状态：**Next / 未启动**。

Task 2B 已通过 Issue #56 / PR #57 完成 Retrieval Tool 与 Agent Runtime 集成，Task 3 现在是 Phase 8 的下一项正式任务。当前尚未创建 Issue，也未执行 Clarification Gate，不得直接实现。

## 目标

建立回答来源引用和 Retrieval 可观察闭环，让 Web Chat 展示来源，让 Admin 展示安全的检索决策元数据。

## 已满足前置条件

- Task 0：Retrieval Boundary 与离线 Evaluation 已 Completed；
- Task 1：Article Chunking、Gemini Embedding 与 pgvector active index 已 Completed；
- Task 2A：Vector / Hybrid Retrieval 与 quality-v2 Evaluation 已 Completed；
- Task 2B：`retrieve_article_context@1`、受控 Observation 与 Agent Runtime 集成已 Completed；
- Retrieval Result 已具备稳定 `sourceId / chunkId / sectionPath` identity；
- Phase 7 已提供安全 Context Inspector 基线。

## 计划范围

- 定义结构化来源引用 contract；
- 将回答引用绑定到本次 Retrieval 的真实 source / chunk；
- 明确证据不足、无结果、冲突来源和 partial 状态下的回答行为；
- 在 Web Chat 展示来源卡片；
- 在 Admin Run Detail 展示 strategy、version、候选数、选入数和 outcome；
- 建立 API、Read Model、前端交互、自动测试与真实浏览器验收证据；
- 保持 Context Budget、Tool pairing、Streaming 和 Run terminalization 不退化。

## Issue 创建前必须定案

1. Task 3 是否拆分为后端 Grounded Answer / Citation 与 Web / Admin UI 两个独立 Task；
2. 外部 Citation contract 与旧客户端兼容方式；
3. 模型回答中的 citation marker 与服务端 source / chunk 绑定方式；
4. 可展示的 source / chunk 字段及安全脱敏边界；
5. 证据不足、无结果、冲突候选和 false-positive nearest candidates 的回答策略；
6. durable metadata 的存储位置、版本和安全投影；
7. Web 来源卡片的交互、loading、legacy、error 与 partial 状态；
8. Admin Retrieval Inspector 的页面结构和真实浏览器验收范围。

## 不做什么

- 不展示完整 Prompt、reasoning、raw Embedding 或完整正文；
- 不把模型自行生成的不存在来源当作 Citation；
- 不做文件上传、PDF / Office 解析或通用知识库；
- 不做多租户 ACL、外部连接器、Memory、MCP 或 Multi-agent；
- 不做复杂 Agentic Retrieval、Query Rewrite 或 rerank，除非后续证据证明属于独立任务；
- 不自动启动 Admin Auth / RBAC Task 4。

## 预期验收方向

- 最终回答引用可映射到本次 Retrieval 的真实 source / chunk；
- 不存在模型凭空生成 Citation 的成功路径；
- 无结果、来源不足、冲突候选和兼容状态行为明确；
- Web 与 Admin 的 loading、error、legacy 和 partial 状态可验证；
- Context Budget、Tool pairing、Streaming 和 Run terminalization 不退化；
- 自动测试、真实 API 数据和真实浏览器证据共同证明端到端闭环。

## GitHub 交付状态

- Issue：未创建
- 分支：未创建
- PR：未创建
- Clarification Gate：未执行

## 任务状态

```text
规划状态：Next
实施状态：未开始
验收状态：未验收
```

下一步只允许讨论和定案 Task 3 的拆分方式、Citation contract、证据不足行为及 Web / Admin 验收边界；正式 Issue 与 Gate `READY` 前不得实现。
