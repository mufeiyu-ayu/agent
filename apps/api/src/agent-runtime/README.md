# Agent Runtime 模块导航

本目录负责一次用户输入对应的 AgentRun 编排。根目录只保留模块公共入口与公共语言；内部实现按领域分组。

## 入口

| 文件 | 职责 |
| --- | --- |
| `agent-runtime.module.ts` | Nest Provider 组装 |
| `agent-runtime.service.ts` | 单次 Run 的主编排入口 `runTurnStream()` |
| `agent-runtime.types.ts` | Runtime 输入与内部事件 |
| `agent-runtime.errors.ts` | Runtime 公开错误语义 |
| `persistable-text.ts` | 写进 `Message.content` 与 Step JSON 前把 U+0000 / 孤立代理项换成 U+FFFD（PostgreSQL 拒收，见 `context/README.md`）；截断时不切开代理对（`truncateCodeUnits`）；service、`sampling/` 的 debug 抓取与 `context/` 的摘要输入共用 |

## 内部领域

| 目录 | 职责 |
| --- | --- |
| `lifecycle/` | Run / Step 持久化与取消、deadline、终态竞争 |
| `context/` | 模型上下文：历史读取与还原（`conversation-history.ts`）、每轮输入组装与粗估计数（`model-context.ts`、`token-estimate.ts`）、上下文压缩（切点与提示词在 `compaction.ts`，编排在 `context-compaction.service.ts`） |
| `sampling/` | 模型流到 Sampling Decision 的转换与安全 Debug 捕获 |

## 主调用链

```text
ChatService（LlmModelConfigService.resolveModel 解析模型行快照；RuntimeConfigService.loadSnapshot 读运行配置快照：单次最长时间、压缩保留最近 Tokens、调试开关、Serper Key）
  -> AgentRuntimeService.runTurnStream()
  -> lifecycle: create Run + cancellation（deadline 取自 input.runtimeConfig.limits；不限轮数与工具调用次数，只由它兜底）
  -> resolveRunConfiguration()（私有方法）：模型可见的 Tool 说明（工具清单 TOOL_DEFINITIONS 全部）+ resolveChatRequestConfig
  -> context: 在一个 REPEATABLE READ 快照里读最新压缩记录、全部已完成消息的轻量元数据、各组 Run 的状态，再仅读未被覆盖组的正文与回答 Step，还原成「摘要 + 按问答分组、带之前工具记录的历史」；不删历史、不截短工具结果
  -> 每轮调模型前（检查点 A）：估算超过模型「单次输入上限」就先压缩（先把较早的已结束问答写成历史摘要，仍超线再把本 Run 前面的工具轮写成前缀摘要），压缩 Step 排在采样 Step 之前
  -> sampling: consume model stream and return decision（正文推 assistant_delta；思考原文推 reasoning_delta，只给界面，不进正文与模型上下文；每轮完整思考随采样 Step 落库，只有收完的 Tool Call 轮是回填内容，最后一轮与被停止 / 失败那一轮的只为界面还原；第一段正文的时刻记成 answerStartedMs，此后收口的采样 Step 都带上）
  -> executeToolBatch()（私有 async generator）：顺序处理一批 Tool Call，每个 call 一个 tool_execution Step；判定与执行都交给 ToolInvocationService.invoke，这里按它返回的 result / argumentsValidated / observation 记账与回喂；开 Step 前推 tool_started、收口后推 tool_finished（只给界面，不进模型上下文；工具给的 display 同时存进 tool Step，只为刷新后还原），被停止或 deadline 打断的 call 不推 tool_finished
  -> 服务商报输入超长（检查点 C）：本轮没推出过 delta 时，失败的采样 Step 照常收口，强制压缩一次后新开采样重试；连续超长只救一次
  -> lifecycle: atomic terminalization
  -> 提交确认后（检查点 B）：不 await，在后台对下一次问答的历史预压，超过触发线 0.8 才压；只写压缩记录、失败只记日志
```

领域目录可以依赖根目录的公共错误与类型；根编排器负责组合各领域。不要把领域状态机放进通用 `utils/`，也不要新增仅做路径转发的 barrel。

上下文、reasoning 与持久化重建的详细契约和已知偏差见 [context/README.md](context/README.md)，只在修改对应路径时读取。
