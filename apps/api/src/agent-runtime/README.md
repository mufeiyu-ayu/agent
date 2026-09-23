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
| `configuration/` | Runtime Policy：启动期从 env 解析一次的历史候选上限、采样轮数、Tool Call 预算与 Run deadline（`agent-runtime.policy.ts`）。单次 Run 的配置组合不在这里，是 `agent-runtime.service.ts` 的私有方法 `resolveRunConfiguration` |
| `lifecycle/` | Run / Step 持久化与取消、deadline、终态竞争 |
| `context/` | Model Context、History Selection、Token 估算与每轮 Context Plan |
| `sampling/` | 模型流到 Sampling Decision 的转换与安全 Debug 捕获 |
| `grounding/` | Evidence Registry、Grounded Finalization、Citation 校验与安全投影 |

## 主调用链

```text
ChatService（LlmModelConfigService.resolveModel 解析模型行快照）
  -> AgentRuntimeService.runTurnStream()
  -> lifecycle: create Run + cancellation（deadline 取自 configuration 的 policy）
  -> resolveRunConfiguration()（私有方法）：Tool allowlist + resolveChatRequestConfig
  -> context: select and plan model-visible input
  -> sampling: consume model stream and return decision
  -> ToolInvocationService / grounding
  -> lifecycle: atomic terminalization
```

领域目录可以依赖根目录的公共错误与类型；根编排器负责组合各领域。不要把领域状态机放进通用 `utils/`，也不要新增仅做路径转发的 barrel。
