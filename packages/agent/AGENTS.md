# packages/agent 导图

`@agent/agent` 是内部 Node Agent 执行内核，只依赖 `@agent/ai`、`@agent/contracts` 与标准库。零 Nest、零 Prisma、零 `apps/**` 反向依赖（包括 type-only / dynamic import），不读 env、不持有 Provider/Serper 密钥或 WorkspaceCommit。唯一入口 `src/index.ts`，不从子路径 import。

## 入口与领域

| 文件 / 目录 | 职责 |
| --- | --- |
| `src/agent-runtime.ts` | 单次 Run 的 async generator；顺序工具调用、采样续轮、错误归因和 finally 收口 |
| `src/host.ts` | 当前执行需要的宿主函数、记录 DTO、deadline、错误分类；不是稳定的对外 SDK 或未来 operation 协议 |
| `src/agent-runtime.types.ts` / `agent-runtime.errors.ts` | 无凭据输入快照、内部运行事件与错误语义 |
| `src/context/` | 历史纯配对/还原、ModelContext、计数、现有 A/C/B 压缩编排；无 SQL |
| `src/lifecycle/run-cancellation.ts` | 唯一 RunCancellation 状态机；commit-owned 到确认完成的竞争规则 |
| `src/sampling/` | ai 流到采样决策、debug 捕获的纯序列化 |
| `src/tools/` | 调用/结果/显示契约、Observation 规范化；无具体工具实现或目录 |
| `src/context/user-attachments.ts` | 用户消息的附件怎么拼进给模型的正文（`<file name>` 格式）；图片随 `HistoryQuestion.images` 传到请求，每张固定按 `IMAGE_TOKENS` 估算，写摘要时不带 |
| `src/persistable-text.ts` | 持久副本文字清洗与 Unicode 安全截断 |

## 不变量

- 工具 `finishStep` 是必须 await 的提交屏障：宿主确认 Step 与文件指针后，复核取消，才发 tool_finished、加入下一轮上下文。不能改成事件监听里的异步保存。
- 用户消息提交确认与模型输入还原分开；createRun 和身份发布后才加载当前附件，失败不倒退持久状态。模型请求配置仍在 createRun 后解析；deadline 从 createRun 成功后起算。consumer return 仍由 finally 收口，关页仍取消，不含 R2 续跑。
- 不包装宿主异常；同一 `classifyError` 识别 deadline / COMMIT unknown / 会话不存在，保留原对象与 cause。超时错误工厂由宿主注入，工具层仍能识别原 DB 类。
- UI message、model input、运行事件与持久轨迹独立；[上下文重建契约](../../apps/api/src/agent-runtime/context/README.md) 继续是字段与已知偏差的来源。
- 纯机制的单测在包内，不加载 Nest/数据库。API 保留冻结的整条链与真实隔离库测试；业务工具校验仍只在 ToolInvocationService.invoke。

## 验证

`pnpm --filter @agent/agent test` / `typecheck` / `build`；`pnpm check:agent-boundary` 以 TypeScript AST 和模块解析核对本包及 ai/contracts 的导入边界（已接入根 typecheck）。生产 runtime 读 dist，types 和 Vitest 读 src；build 必须避开用户活动 dev watcher。
