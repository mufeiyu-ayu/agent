# Agent Runtime 宿主导航

真正的循环、取消状态机、上下文与压缩机制在 [`@agent/agent`](../../../../packages/agent/AGENTS.md)。本目录只绑定 Nest、产品策略、凭据与持久化，不保留第二套内核。

## 文件

| 文件 | 职责 |
| --- | --- |
| `agent-runtime.module.ts` | Nest Provider 组装 |
| `agent-runtime.service.ts` | 保留原 DI / 调用入口；投影无凭据快照，委托包内 AgentRuntime |
| `agent-runtime-host.ts` | 每 Run 独立的宿主闭包：模型凭据绑定、指南激活与采样引用、工具进度投影、原异常分类、强制工具提交与资源释放 |
| `agent-runtime.types.ts` | ChatService 传入的可信宿主快照；内部事件从包入口 import |
| `lifecycle/agent-run-recorder.service.ts` | Run/Step 的真实事务与行锁；Source/Artifact 指针和工具 Step 同事务发布 |
| `context/conversation-history.ts` | REPEATABLE READ 历史 SQL：轻量元数据/Run 配对后，仅读保留组正文/Step；调用包内纯投影 |
| `context/context-compaction.service.ts` | 绑定摘要模型与 ConversationCompaction 存储；A/C/B 策略与循环全在包内 |

## 一次请求

```text
ChatService 读模型行/运行配置快照
  → AgentRuntimeService 投影核心输入（密钥只留在宿主闭包）
  → @agent/agent：检查会话、创建用户消息并 touch、createRun
  → 启用 deadline，再解析请求配置
  → 宿主加载历史快照，内核组装 ModelContext
  → 检查点 A：超线压缩 → 采样（正文/思考事件按原顺序）
  → 宿主按需确认指南 Step → 内核追加 instruction
  → tool_started → startStep → ToolInvocationService.invoke
  → await finishStep（宿主事务确认）→ 复核取消 → tool_finished → 回喂续轮
  → 检查点 C：无已推 delta 时，超长强制压缩后最多重试一次
  → completeRun（commit-owned callback → 真实 COMMIT 确认）
  → 检查点 B：成功确认后后台预压，不 await；启动资源释放再交付终态
  → finally：消费者提前 return 的兜底收口与必要释放等待
```

记录器保留实际事务、所有权/version 检查和 COMMIT 未知处理。工具发布闭包不进 JSON、不靠全局 Map、不可当作持久恢复凭据。指南状态与 Provider/Serper Key 按 Run 隔离；配置事后变更不影响本次采样或后台摘要。

错误对象不跨边界包装：Prisma 的 timeout / COMMIT unknown 及 Nest NotFoundException 由同一宿主分类函数识别；核心决定终态与类别，LLM 用户文案仍复用全局异常过滤器的工具函数。日志在未知终态事件之前写入。

HTTP close 仍 abort 并 drain；本次分包不含 R2 关页续跑或恢复。详细字段与已知偏差见 [context/README.md](context/README.md)。
