# tools 模块导航

Tool Calling 的框架与具体工具。一次工具调用的全部判定都在 `core/tool-invocation.service.ts` 的 `invoke`，runtime 只开关 Step、记账与回喂。

## 目录

| 位置 | 放什么 |
| --- | --- |
| `core/` | 框架，与具体工具无关：类型（`tool.types.ts`）、Registry、`invoke`、Observation 修剪（`tool-observation.ts`） |
| `articles/` | 具体工具：`search_articles` 的定义、执行器、参数解析与查询都在 `search-articles.tool.ts` |
| `tool-definitions.ts` | 唯一的工具清单 `TOOLS`（定义 + 执行器类）；`TOOL_DEFINITIONS` 由它派生 |
| `tools.module.ts` | 按清单把执行器放进 providers，`onModuleInit` 时成对注册进 Registry |

## 一次调用

```text
AgentRuntimeService.executeToolBatch：每个 call 开一个 tool_execution Step
  -> ToolInvocationService.invoke(call, { signal, databaseDeadline, argumentsTruncated })
       外部中断先抛 -> 截断批次直接失败 -> 按名字查找 -> JSON.parse + input.parse
       -> 执行器与 timeout / 停止赛跑 -> 按工具的 maxObservationChars 修剪
  <- { result, argumentsValidated, observation }
runtime：result 定 Step 的 ok / code；argumentsValidated 定回喂参数的形状（toFeedbackArgumentsJson）；
         observation 落库，并进下一轮的模型上下文
```

- `unknown_tool`、`invalid_arguments`、`truncated_arguments`：没走到执行，`argumentsValidated` 为 false，回喂的参数装进 `{"arguments": raw}`。
- `timeout`、`execution_failed`：参数已通过校验，`argumentsValidated` 为 true；异常原因只进服务端日志。
- 用户停止、Run deadline（包括先于工具 timeout 到期的 Run 数据库 deadline）：照常抛出，由 runtime 归因。其余失败结果都回喂给模型，由它决定下一步。

## 新增一个工具（以 `search_articles` 为例）

1. 在业务目录（如 `articles/`）写工具文件：
   - `ToolDefinition`：`name`、`description`、`input.schema` 给模型看；`input.parse` 在服务端把参数校验并规范化成输入类型，不合法就抛错；`timeoutMs`、`maxObservationChars` 只在服务端用。
   - 执行器类：`@Injectable()`，实现 `ToolExecutor<输入类型>`，依赖用 `@Inject` 注入（`SearchArticlesTool` 注入 `PrismaService`）；只收到校验过的输入，查询时尊重 `context.signal` 与 `context.databaseDeadline`；成功返回 `{ ok: true, modelContent }`，失败直接抛错交给 `invoke` 脱敏，不要自己返回 `invalid_arguments` 等只该由 `invoke` 给出的 code。
2. 在 `tool-definitions.ts` 的 `TOOLS` 加一行 `toolEntry(definition, 执行器类)`（两者输入类型不一致时编译不过）：模型可见的工具、Registry 注册与 Admin 概览的工具名都跟着变。执行器依赖的 Nest 模块不在 `ToolsModule.imports` 里时一并加上。
3. 在系统提示词（`chat/prompts/agent.prompt.ts`）写清这个工具什么时候用、什么时候不用。
4. 测试放在工具旁边（如 `articles/search-articles.*.test.ts`），测三件事：
   - `parse`：合法输入的规范化结果；缺字段、错类型、额外字段、越界都抛错；
   - 执行器：用假依赖断言查询条件与 `modelContent`，signal 已中断时不开始查询；
   - 经 `ToolInvocationService` 走一遍：合法参数得到预期结果，参数无效时不执行、返回 `invalid_arguments`。

`invoke` 自己的分支（截断批次、查找、超时、脱敏、`argumentsValidated`）在 `core/tool-invocation.service.test.ts`，新工具不用重复测。测试文件按命名放好就会被 `pnpm --filter @agent/api test` 运行，不用登记；写法见 `docs/testing.md`。
