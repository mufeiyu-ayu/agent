# 项目工作记录

本文件只记录项目当前状态、近期关键推进和 commit 级上下文。旧阶段的长记录不再放正文，需要时查看 Git 历史。

## 当前快照

| 类型 | 当前记录 | 下一步 |
| --- | --- | --- |
| 当前阶段 | 阶段 5 已归档；阶段 6 Task 0 与横向 Issue #27 已完成；Task 1 已在 Draft PR #30 实现、待验收 | 对 Issue #29 / Draft PR #30 进行技术与学习验收；确认前不启动 Task 2 |
| 横向工程 | Issue #27 已统一 64K 输入、40 条 Completed 历史、DeepSeek Model Profile、应用输出策略、三类请求超时、Article excerpt 与分级 Tool Observation 预算 | 已通过 PR #28 收口；不再作为 Active 任务 |
| 阶段 6 | `get_article_detail`、运行参数基线和有界顺序 Agent Loop 已建立；当前 Run 显式开放两个 Article Tool，并支持 DeepSeek thinking continuation | Task 1 保持“已实现、待验收”；阶段仍 Active，Task 2 仍 Planned |
| Admin Console | 已具备独立 `apps/admin` 基础壳、静态 Run List / Run Detail、类型化 Mock、Trace、Messages、Safe Raw Data 和 Review 交互修复 | Task 2 规划只读 Run / Step 查询 API；Task 3 接真实数据；Task 4 补登录、权限和脱敏 |
| 文档结构 | docs 以 `roadmap`、`tasks`、`research`、`work-log` 四类入口组织；正式任务状态以 `docs/tasks/**` 为准 | 不再由 `development-task-plan.md` 维护第二套路线，也不提前编号阶段 6 之后的任务 |
| 任务规范 | 新任务使用 TDD 风格模板；一个 Issue 对应一个清晰 Task；验收通过与授权合并保持分离 | Issue #29 Gate 为 READY；Draft PR #30 不代表验收通过、Ready 或允许合并 |
| 研究资料 | `docs/research/**` 继续保留 Context、Recovery、HITL、MCP 等长期研究，但不代表当前执行顺序 | 仅在真实业务和代码证据支持时迁移为正式 Task |

## 近期工作记录

| 日期 | 提交 / 事项 | 类型 | 核心完成 | 关键文件 | 验证结果 |
| --- | --- | --- | --- | --- | --- |
| 2026-08-08 | Issue #29 / Draft PR #30 实现提交 `3d6340bbf500432d2afaee45bb62566c3b03b2f3` | feat / Agent Runtime / LLM Provider / docs | 将固定两轮特例升级为 3 sampling / 2 Tool Call 的 policy 驱动顺序 Loop；增加 600s Run deadline；开放 search + detail Run allowlist；完成 DeepSeek `reasoning_content` 采集、归属、续传与不泄漏边界 | `apps/api/src/agent-runtime/**`、`apps/api/src/llm/**`、`.env.example`、阶段 6 任务文档 | Tool Loop 32、Model Stream 47、Tools 33、SEO 10、Recorder 9、LLM Config 17 个测试通过；API / Web / workspace typecheck、API lint、`git diff --check` 通过；实施状态已实现，验收状态待验收 |
| 2026-07-26 | PR #28 合并，merge commit `4a50c18c175a345251b4d4512849a612145f3a2f`；Issue #27 Closed | feat / configuration / Runtime / Tool contract / docs | 统一 64K 输入、40 条 Completed 历史、DeepSeek 1M / 384K Model Profile、65,536 / 131,072 应用输出策略、metadata / chat / stream 三类超时、500 字符 excerpt 与 16K / 64K / 128K Observation 预算；清洁环境测试前置已闭环 | `packages/contracts/**`、`apps/api/src/llm/**`、`apps/api/src/agent-runtime/**`、`apps/api/src/tools/**`、`.env.example`、任务文档 | LLM Config 17、Tools 33、Tool Loop 24、Model Stream 37、SEO 10 个测试通过；API / Web / workspace 类型、lint、build 和 prod-only contracts runtime import 通过；Codex 最新 Review 未发现 major issues |
| 2026-07-26 | Draft PR #28 Codex Review P2 修复，commit `575983d` | fix / test infrastructure | 为 `test:seo-service` 增加显式 contracts build，消除清洁 checkout 下 DTO runtime import 对旧 `dist` 的命令顺序依赖；未给不依赖 runtime export 的测试增加无意义前置步骤 | `apps/api/package.json`、Issue #27 任务文档 | contracts dist 不存在时，LLM Config 17、Tools 33、Tool Loop 24、Model Stream 37 均独立通过且不生成 dist；SEO 命令随后执行 contracts build，2 files / 2 suites / 10 tests 通过 |
| 2026-07-26 | Issue #27 / Draft PR #28 实现完成 | feat / configuration / Runtime / Tool contract | 建立 contracts 运行时常量出口、DeepSeek Model Profile、启动期 fail-fast 的 LLM runtime config、40 条 Completed 历史策略与 16K / 64K / 128K Observation 预算；保持固定两轮 sampling 与当前 Tool allowlist | `packages/contracts/**`、`apps/api/src/llm/**`、`apps/api/src/agent-runtime/**`、`apps/api/src/tools/**`、`.env.example`、任务文档 | 实现提交完成后进入 Review；最终结果以上方合并记录为准 |
| 2026-07-26 | Issue #27 创建：运行参数、Model Profile 与输出预算治理 | planning / configuration / cross-cutting | 基于当时 `master` 核对输入 16K、历史 12、输出 32K、普通请求 10s、Observation 8K、excerpt 200 等分散参数；确定生产基线与职责边界 | Issue #27、`docs/tasks/runtime-configuration-governance.md`、任务看板与 roadmap | 完成规格和 docs 同步；Phase 6 Task 1 保持未启动 |
| 2026-07-26 | PR #26 合并，merge commit `d3609d3fb17780ca08724dd79741195238f91e22`；Issue #25 Closed | feat / refactor / Tool Calling / docs | 将 Tool 基础设施与 Article 业务工具整理为 `core/ + articles/`；新增严格只读 `get_article_detail`；用本轮 `toolDefinitions` 阻止全局已注册但未开放的工具被执行；Task 0 经 GPT 技术验收和用户确认后收口 | `apps/api/src/tools/**`、`apps/api/src/agent-runtime/**`、`docs/tasks/**`、`docs/roadmap.md` | Tools 30、Tool Loop 21、Model Stream 36 个测试通过；API typecheck / lint、workspace typecheck、`git diff --check` 通过；Codex 最新 Review 未发现 major issues |
| 2026-07-26 | 阶段 6 路线重新评估并改为有界单 Agent Loop | docs / learning roadmap | 用户与 GPT 重新审查 Tool Calling 后的真实能力缺口，确认当前应学习生命周期完整、执行有界的单 Agent Loop，而不是提前建设完整 Context Budget / Truncation 系统；建立 `get_article_detail -> 有界 Loop -> 可靠性验收` 的阶段边界 | `README.md`、`docs/README.md`、`docs/roadmap.md`、`docs/tasks/**`、`docs/development-task-plan.md`、`docs/research/**`、`docs/work-log.md` | 无业务代码改动；旧阶段 7-9 正式规划已删除 |
| 2026-07-26 | PR #24 合并，merge commit `190fecea0bf4975e8a3740db5258bc69eaa3a7ee` | feat / fix / SEO Chat | 将聊天输入上限从 2,000 提升到 16,000 字符，将默认及 SEO 输出上限提升到 32,768 tokens，并在 streaming 阶段使用纯文本渲染避免长回复反复 Markdown 解析 | `apps/api/src/llm/**`、`apps/api/src/seo/**`、`apps/web/src/components/agent/**`、`apps/web/src/components/seo/SeoChatComposer.vue` | 以 PR #24 合并事实和 merge commit diff 为准；后续 Issue #27 已再次治理这些运行参数 |
| 2026-07-20 | PR #22 验收合并与 Admin Console Task 1 收口 | feat / fix / docs / Admin Console | 完成静态 Run List / Run Detail、类型化 Mock、Trace、Messages 与 Safe Raw Data，并修复不同 Run Tab、详情菜单高亮、列表筛选与分页状态保留 | `apps/admin/src/features/runs/**`、相关 views / store、`docs/tasks/admin-console.md` | Admin typecheck / lint / test / build、Web typecheck / build、API typecheck、workspace typecheck、真实 Chrome 验证通过；三个 Review Thread 已解决 |
| 2026-07-19 | PR #20 验收合并与 Admin Console Task 0 收口 | feat / docs / Admin Console | 建立独立 `apps/admin`，实现 Vben Ant Design 视觉基线的 Sidebar、Header、Breadcrumb、Route Tabs、主题和折叠状态 | `apps/admin/**`、Admin 任务和路线文档 | Admin typecheck / lint / test / build、Web build、API typecheck、workspace typecheck 与真实 Chrome 验证通过 |
| 2026-07-18 | PR #17 验收合并与阶段 5 归档 | docs / Agent Runtime / Tool Calling | 统一同步与流式 SEO Chat 的唯一 Agent Runtime；阶段 5 标记 Completed | `apps/api/src/seo/**`、`apps/api/src/agent-runtime/**`、阶段 5 归档 | 8 个 SEO Service、9 个 Recorder、20 个 Tool Loop、35 个 Model Stream、24 个 Tools 测试通过；API / Web / workspace 检查通过 |
| 2026-07-17 | PR #15 验收合并收口 | Agent Runtime / Tool Calling | 完成动态 AgentStep、两轮 sampling usage / finish reason、工具安全摘要、真实 timeout 和 Observation 上限 | `prisma/**`、contracts、runtime、tools、阶段 5 文档 | Recorder、Tool Loop、Model Stream、Tools 测试及 typecheck / lint 通过；Codex Review 无 major issues |
| 2026-07-16 | PR #12 验收合并收口 | Agent Runtime / Tool Calling | 完成最多一次工具调用、最多两轮 sampling 的最小单 Agent Tool Loop | `apps/api/src/agent-runtime/**`、`apps/api/src/llm/**` | Tool Loop、Model Stream、Tools 测试与 API / workspace 检查通过 |
| 2026-07-15 | PR #10 验收合并收口 | Tool Calling | 新增第一只只读业务工具 `search_articles`，返回受控文章字段、截断 excerpt 和 `modelContent` | 当时的 Tool 文件、测试、Tools Module | Tools、Model Stream 回归和 API / workspace 检查通过；Review 修复 LIKE 通配符问题 |
