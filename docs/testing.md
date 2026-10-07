# 测试规范

单测与真实库测试用 Vitest（根目录 `vitest.config.ts`，分 api / db / agent / ai / web / admin / scripts 七个项目），浏览器回归用 Playwright。

## 放哪、叫什么

| 类型 | 位置与命名 |
| --- | --- |
| 单测 | 被测文件旁，`*.test.ts`（根 `scripts/` 下为 `*.test.mjs`） |
| 真实库测试 | 被测文件旁，`*.db.test.ts` |
| e2e | `apps/web/e2e/*.spec.ts`、`apps/admin/e2e/*.spec.ts` |

按命名放好就会被运行，不改配置，`package.json` 里也不登记文件路径。

## 入口

| 命令 | 什么时候用 |
| --- | --- |
| `pnpm test` | 需要跨包或完整单测回归时；局部改动优先定向运行，不需要数据库或先 build 共享包 |
| `pnpm --filter <包> test` | 只改了一个包（api / agent / ai / web / admin）时单跑本包 |
| `pnpm test:db` | 改了事务、deadline、落库清洗等只有真实 PostgreSQL 才能验证的行为 |
| `pnpm test:e2e` | 需要两端完整浏览器回归时；局部交互优先对应 app / 场景，使用本机 Chrome |

单跑文件或按标题过滤：`pnpm test <路径>`、`pnpm test -t <标题片段>`；watch 用 `pnpm exec vitest --project <项目名>`。不带 `--project` 直接跑 vitest 会连 db 项目一起收集，缺少测试数据库环境时真实库用例会失败；单测检查使用上述排除 db 的入口。单跑一个 app 的 e2e：先 `pnpm --filter @agent/contracts build`，再 `pnpm --filter @agent/admin exec playwright test`（前台换成 `@agent/web`）；可附 spec 路径或 `-g <场景>` 定向运行。

共享包 build 与 e2e 的准备命令会写 `dist`；API dev watcher 监听这些 import 并重启 API（`apps/api/scripts/dev-watch.mjs`），可能中断活动 Run。开发服务正在使用时，在独立 scratch worktree 执行这些检查；只读检查和直接读 src 的 Vitest 不需要先 build。必要检查通过后停止扩大或重复测试。

## 写法

- 断言用 `node:assert/strict`，不用 `expect`。
- mock 用 `vi`：`vi.spyOn(obj, 'method')`；替换了全局对象（如 `fetch`）的，在用例结束时恢复（`onTestFinished(() => spy.mockRestore())`）。
- 不写共享的 test util 层或 fixture 工厂：fixture 放在测试文件里，确有多个测试文件共用时才放同目录的 `__fixtures__.ts`。
- api 测试经 swc 编译，装饰器元数据生效：controller 测试可以起真实 Nest 应用，走全局 ValidationPipe。
- `@agent/contracts`、`@agent/ai`、`@agent/agent` 在测试里直接解析到源码，改了共享包不用先 build；agent 项目不加载 Nest/数据库。
- `pnpm check:agent-boundary` 是 TypeScript AST / 模块解析的架构检查，已接入根 typecheck；检查 type-only / dynamic import、barrel、别名与相对目录逃逸，不是正则断言业务源码。

## 真实库测试

- 只连 `TEST_DATABASE_URL`（compose 的 `postgres-test`：库 `agent_integration`，端口 5433）；缺了或与 `DATABASE_URL` 相同时测试直接失败，不碰开发库。
- 起库：`docker compose --profile integration up -d postgres-test`；已有测试库可复用。只停止本次启动且不承载其他任务的测试容器，不在收尾时停掉他人正在使用的实例。
- `pnpm test:db` 从根目录 `.env` 读这两个变量，命令行里已有的优先。
- 每个测试自建独立 schema 或探针表，结束时删掉；文件之间串行执行。

## 测什么，不测什么

该测：

- 不变量：终态所有权、模型可见 ⟺ 落库、失败归因同源、密钥与出站代理边界等（根 `AGENTS.md` 第 6 节；上下文重建的字段与例外见 [`context/README.md`](../apps/api/src/agent-runtime/context/README.md)）；
- 边界：空值、超限、Unicode（代理对、U+0000）、迟到结果与并发；
- 失败路径：上游错误、超时、取消、数据库失败时的收口与文案。

不测：

- 源码文本（用正则匹配 `.ts` / `.vue` 的内容）；要守的行为用单测、e2e 或 lint 规则验证（如 admin 的 `vue/no-v-html`）；
- 内部调用顺序、私有字段等不影响可观察行为的细节；
- 已有用例覆盖的同一行为（同一条代码路径换个入参再测一遍）；
- 只为已删功能的老数据保留的兼容分支；「未知 Step 类型按通用 Step 显示」这类通用兜底除外。

## 变异验证

核心层（`apps/api/src/agent-runtime/`、`packages/agent`、`packages/ai`）与高风险 Issue 的验收标准要求时做：临时改坏被测代码或去掉一条保护，确认对应用例失败，再恢复；改动、命令与输出写进 PR。
