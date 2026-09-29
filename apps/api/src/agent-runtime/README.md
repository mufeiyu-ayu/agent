# Agent Runtime 模块导航

本目录负责一次用户输入对应的 AgentRun 编排。根目录只保留模块公共入口与公共语言；内部实现按领域分组。

## 入口

| 文件 | 职责 |
| --- | --- |
| `agent-runtime.module.ts` | Nest Provider 组装 |
| `agent-runtime.service.ts` | 单次 Run 的主编排入口 `runTurnStream()` |
| `agent-runtime.types.ts` | Runtime 输入与内部事件 |
| `agent-runtime.errors.ts` | Runtime 公开错误语义 |
| `persistable-text.ts` | 写进 `Message.content` 与 Step JSON 前把 U+0000 / 孤立代理项换成 U+FFFD（PostgreSQL 拒收，见根 `AGENTS.md` 第 6 节）；service 与 `sampling/` 的 debug 抓取共用 |

## 内部领域

| 目录 | 职责 |
| --- | --- |
| `lifecycle/` | Run / Step 持久化与取消、deadline、终态竞争 |
| `context/` | Model Context、History Selection、Token 估算与每轮 Context Plan |
| `sampling/` | 模型流到 Sampling Decision 的转换与安全 Debug 捕获 |

## 主调用链

```text
ChatService（LlmModelConfigService.resolveModel 解析模型行快照；RuntimeConfigService.loadSnapshot 读运行配置快照：运行限制、调试开关、Serper Key）
  -> AgentRuntimeService.runTurnStream()
  -> lifecycle: create Run + cancellation（deadline 取自 input.runtimeConfig.limits）
  -> resolveRunConfiguration()（私有方法）：模型可见的 Tool 说明（来自工具清单 TOOL_DEFINITIONS）+ resolveChatRequestConfig
  -> context: select and plan model-visible input
  -> sampling: consume model stream and return decision（正文推 assistant_delta；思考原文推 reasoning_delta，只给界面，不进正文与模型上下文；每轮完整思考随采样 Step 落库，只有收完的 Tool Call 轮是回填内容，最后一轮与被停止 / 失败那一轮的只为界面还原；第一段正文的时刻记成 answerStartedMs，此后收口的采样 Step 都带上）
  -> executeToolBatch()（私有 async generator）：顺序处理一批 Tool Call，每个 call 一个 tool_execution Step；判定与执行都交给 ToolInvocationService.invoke，这里按它返回的 result / argumentsValidated / observation 记账与回喂；开 Step 前推 tool_started、收口后推 tool_finished（只给界面，不进模型上下文；工具给的 display 同时存进 tool Step，只为刷新后还原），被停止或 deadline 打断的 call 不推 tool_finished
  -> lifecycle: atomic terminalization
```

领域目录可以依赖根目录的公共错误与类型；根编排器负责组合各领域。不要把领域状态机放进通用 `utils/`，也不要新增仅做路径转发的 barrel。
