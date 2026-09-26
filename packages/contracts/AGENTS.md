# packages/contracts 导图

`@agent/contracts`：前后端共享的协议类型与常量。只放跨端要一致的东西：请求 / 响应形状、枚举、取值表、共同校验常量；不放实现、不放单端私有类型。新增文件或改导出面时同步本文件。仓库基线见根目录 `AGENTS.md`。

## 文件

```txt
src/index.ts             # 唯一导出面，新增类型必须在这里 export
src/api-response.ts      # 全局响应包装 { success, code, message, data }
src/chat.ts              # ChatRequest / ChatModelOption / NDJSON 流事件（start / delta / done / error / aborted）、消息字数上限
src/conversation.ts      # 会话与消息
src/agent-run.ts         # AgentRun / AgentStep 的对外形状、Run 失败类别 AGENT_RUN_ERROR_CODES（唯一来源）
src/admin-llm.ts         # LLM 配置：LLM_PROVIDER_FAMILIES、LLM_FAMILY_CAPABILITIES（各家族 compat：thinkingFormat / requiresReasoningContent / toolCallIndexOptional / toolCallsMayFinishWithStop / reasoningEfforts，唯一来源）、Provider / Model 的读写形状
src/admin-run.ts         # 管理台 Run Trace 读模型
src/admin-conversation.ts / src/admin-overview.ts   # 管理台其他读模型
```

## 约束

- 改这里等于改协议：api 的 DTO、web / admin 的调用都要跟着看一遍，`pnpm typecheck` 全仓跑。
- 取值表（家族、强度、状态枚举）以这里为准，api 的 DTO 用它做 `IsIn`，前端用它渲染选项，不各自再抄一份。
- `package.json` 的 `exports` 里 `types` 指向 `src`、`import` 指向 `dist`：其他包的 typecheck 读 src，api 运行时与 web / admin 的 Vite（含 e2e）读 dist；测试经 Vitest 别名直接读 src，不需要先 build。`pnpm dev` 会 watch 本包并重建 dist。
