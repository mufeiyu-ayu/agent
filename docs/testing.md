# 测试规范

单测与真实库测试用 Vitest（根目录 `vitest.config.ts`，分 api / db / ai / web / admin / scripts 六个项目），浏览器回归用 Playwright。

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
| `pnpm test` | 日常与提交前：全部单测；不需要数据库，也不需要先 build 共享包 |
| `pnpm --filter <包> test` | 只改了一个包（api / ai / web / admin）时单跑本包 |
| `pnpm test:db` | 改了事务、deadline、落库清洗等只有真实 PostgreSQL 才能验证的行为 |
| `pnpm test:e2e` | 改了前台对话或管理台交互；依次跑两个 app 的 Playwright，用本机 Chrome |

单跑文件或按标题过滤：`pnpm exec vitest run <路径>`、`pnpm exec vitest run -t <标题片段>`，去掉 `run` 进入 watch。单跑一个 app 的 e2e：先 `pnpm --filter @agent/contracts build`，再 `pnpm --filter @agent/admin exec playwright test`。

## 写法

- 断言用 `node:assert/strict`，不用 `expect`。
- mock 用 `vi`：`vi.spyOn(obj, 'method')`；替换了全局对象（如 `fetch`）的，在用例结束时恢复（`onTestFinished(() => spy.mockRestore())`）。
- 不写共享的 test util 层或 fixture 工厂：fixture 放在测试文件里，确有多个测试文件共用时才放同目录的 `__fixtures__.ts`。
- api 测试经 swc 编译，装饰器元数据生效：controller 测试可以起真实 Nest 应用，走全局 ValidationPipe。
- `@agent/contracts`、`@agent/ai` 在测试里直接解析到源码，改了共享包不用先 build。

## 真实库测试

- 只连 `TEST_DATABASE_URL`（compose 的 `postgres-test`：库 `agent_integration`，端口 5433）；缺了或与 `DATABASE_URL` 相同时测试直接失败，不碰开发库。
- 起库：`docker compose --profile integration up -d postgres-test`；跑完 `docker compose stop postgres-test`。
- `pnpm test:db` 从根目录 `.env` 读这两个变量，命令行里已有的优先。
- 每个测试自建独立 schema 或探针表，结束时删掉；文件之间串行执行。

## 测什么，不测什么

该测：

- 不变量：终态所有权、模型可见 ⟺ 落库、失败归因同源、密钥与出站代理边界等（根 `AGENTS.md` 第 6 节）；
- 边界：空值、超限、Unicode（代理对、U+0000）、迟到结果与并发；
- 失败路径：上游错误、超时、取消、数据库失败时的收口与文案。

不测：

- 源码文本（用正则匹配 `.ts` / `.vue` 的内容）；要守的行为用单测或 e2e 验证；
- 内部调用顺序、私有字段等不影响可观察行为的细节；
- 已有用例覆盖的同一行为（同一条代码路径换个入参再测一遍）；
- 只为已删功能的老数据保留的兼容分支；「未知 Step 类型按通用 Step 显示」这类通用兜底除外。

## 变异验证

核心层（`apps/api/src/agent-runtime/`、`packages/ai`）与高风险 Issue 的验收标准要求时做：临时改坏被测代码或去掉一条保护，确认对应用例失败，再恢复；改动、命令与输出写进 PR。
