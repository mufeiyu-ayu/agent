# Phase 8 Task 2B：Retrieval Tool & Agent Integration

状态：**Planned / 未启动**。

本 Task 是原“Task 2：Hybrid Retrieval & Agent Tool Integration”拆分后的第二部分。它只在 Task 2A 完成并通过 GPT 技术验收、用户确认后启动。

## 目标

将 Task 2A 已稳定、已评估的 Hybrid Retrieval 能力通过明确 Tool Boundary 接入 Agent Runtime，使模型可以按需检索受控 Article evidence，同时继续遵守 Tool validation、timeout、Abort、Observation Governance 与 Phase 7 Context Budget。

## 前置条件

- Task 2A Completed；
- Hybrid Retrieval strategy / version、Result contract、quality-v2 evaluation 与真实 pgvector 证据已经稳定；
- 不在本 Task 内重新设计 Vector Ranking 或通过改 Tool 来掩盖 Retrieval 质量问题。

## 已定方向

- 保留现有 `search_articles@1` 兼容行为，不静默改造成 RAG Tool；
- 第一版新增专用 Retrieval Tool，建议命名 `retrieve_article_context@1`；
- Tool 输入继续使用受控 query / language / limit，不暴露数据库、embedding、内部 score 调参能力；
- Tool 输出投影为安全 source + best evidence chunk，不包含原始 embedding、完整正文、未裁剪候选列表或内部错误栈；
- 默认只允许少量最终来源，每篇 Article 第一版最多一个 evidence chunk；
- Retrieval Observation 属于低信任内容，不能提升为 system / developer policy；
- Model-visible Observation 继续通过 Tool ceiling 与 Context Planner 二次治理；
- Retrieval 只由 Agent 在需要时调用，不在每轮 sampling 前无条件自动注入。

## 计划范围

- 新增 `retrieve_article_context@1` ToolDefinition / parser / executor；
- 将 Task 2A Hybrid Retriever 注入 Tool 层，不把 SQL / ranking 搬进 Tool；
- 定义安全 Tool Result / modelContent projection；
- 将真实 `sourceId`、slug、title、languageCode、chunkId、sectionPath、excerpt、rank 与 strategy/version 保留到受控结果中；
- 设置明确的来源数、单 chunk excerpt 与总 Observation 预算；
- 对低信任 Retrieval 内容增加明确 envelope / provenance 语义；
- 接入 Tool Registry 与 Agent Loop；
- 验证 Tool Call / Result pairing、timeout、Abort、deadline、retry / failure propagation 与 Context Budget；
- 保持现有 streaming protocol、Run / Step 终态与 `search_articles@1` 回归行为。

## 明确不做

- 不重新实现 Task 2A 的 Vector SQL、RRF 或 Evaluation；
- 不修改 `search_articles@1` 的既有外部语义；
- 不实现最终 Citation 格式、Grounded Answer enforcement、Web Citation UI；
- 不实现 Admin Retrieval Inspector；
- 不做 Query Rewrite、rerank、Agentic Retrieval、多轮自动检索；
- 不做文件上传、通用知识库、Memory、MCP、Multi-agent；
- 不把 Retrieval 结果直接写入 system prompt；
- 不将检索分数用于权限或 Tool execution 决策。

## 预期安全结果

第一版结果形态以以下语义为基线，最终字段在 Issue 创建前结合 Task 2A 实际 contract 定案：

```ts
{
  query: string
  strategy: {
    name: string
    version: string
  }
  sources: Array<{
    sourceId: number
    slug: string
    title: string
    languageCode: string
    chunkId: string
    sectionPath: string
    excerpt: string
    rank: number
    matchType: 'hybrid' | 'lexical' | 'vector'
  }>
}
```

不向模型暴露：

- raw embedding；
- 完整文章正文；
- 所有候选 chunk；
- 数据库内部调试字段；
- provider credential / request payload；
- stack trace；
- 未经解释的内部 similarity / distance 调参字段。

## Issue 创建前必须重新确认

1. Task 2A 最终 Retrieval Result contract 与 strategy/version；
2. Tool 名称、description 与模型何时应调用它；
3. 默认 source 数、单 evidence excerpt 长度、总 Observation budget；
4. zero-hit、partial retrieval、embedding/provider failure、database timeout 的 Tool-visible 语义；
5. 是否允许 lexical-only / vector-only degraded result；
6. AgentStep / event 中记录哪些安全 metadata；
7. 与 `get_article_detail` 的职责边界，避免模型重复拉取大正文。

## 预期验收方向

- 新 Tool 能在真实 Tool Loop 中返回 Task 2A 的稳定 Retrieval 结果；
- `search_articles@1` 与 `get_article_detail` 回归通过；
- Tool Result / modelContent 不含 raw embedding、完整正文或越权信息；
- Observation ceiling 与 Phase 7 Context Budget 均有效；
- zero-hit、timeout、Abort、provider failure、DB failure 有自动化行为测试；
- Tool Call / Result pairing、Run / Step 终态和 streaming protocol 不退化；
- Agent 不会因为 Retrieval 内容中的文本指令改变 system / developer policy；
- 本 Task 完成后才能启动 Grounded Answer / Citation / Retrieval Inspector。

## GitHub 交付状态

- Issue：未创建
- 分支：未创建
- PR：未创建
- Clarification Gate：未执行

## 任务状态

```text
规划状态：Planned
实施状态：未开始
验收状态：未验收
```

Task 2B 不得与 Task 2A 合并为同一个 Issue，也不得提前启动。