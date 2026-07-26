# 项目工作记录

本文件只记录项目当前状态、近期关键推进和 commit 级上下文。旧阶段的长记录不再放正文，需要时查看 Git 历史。

## 当前快照

| 类型 | 当前记录 | 下一步 |
| --- | --- | --- |
| 当前阶段 | 阶段 5 最小 Tool Calling 已完成并归档；阶段 6 Task 0 已通过 Issue #25 / PR #26 完成实现、验收和合并；横向工程 Issue #27 已实现、待验收 | 等待 Issue #27 Draft PR Review、GPT 验收和用户确认；验收收口前不启动 Phase 6 Task 1 |
| 横向工程 | Issue #27 已统一 64K 输入、40 条 Completed 历史、DeepSeek Model Profile、应用输出策略、三类请求超时、Article excerpt 与分级 Tool Observation 预算 | 当前只记录“实施状态：已实现、验收状态：待验收”；不推进 Agent Loop、reasoning continuation 或 Token Context Engineering |
| 阶段 6 | `get_article_detail` 已通过统一 Registry / Invocation 建立，Tool 目录已整理为 `core/ + articles/`；当前 Runtime 仍只向模型暴露并允许执行 `search_articles` | Issue #27 验收后，再规划有界顺序 Agent Loop、执行预算、DeepSeek continuation 与失败终态 |
| Admin Console | 已具备独立 `apps/admin` 基础壳、静态 Run List / Run Detail、类型化 Mock、Trace、Messages、Safe Raw Data 和 Review 交互修复 | Task 2 规划只读 Run / Step 查询 API；Task 3 接真实数据；Task 4 补登录、权限和脱敏 |
| 文档结构 | docs 以 `roadmap`、`tasks`、`research`、`work-log` 四类入口组织；正式任务状态以 `docs/tasks/**` 为准 | 不再由 `development-task-plan.md` 维护第二套路线，也不提前编号阶段 6 之后的任务 |
| 任务规范 | 新任务使用 TDD 风格模板；一个 Issue 对应一个清晰 Task；验收通过与授权合并保持分离 | Issue #27 与 Phase 6 Task 1 必须独立实现、独立验收 |
| 研究资料 | `docs/research/**` 继续保留 Context、Recovery、HITL、MCP 等长期研究，但不代表当前执行顺序 | 仅在真实业务和代码证据支持时迁移为正式 Task |

## 近期工作记录

| 日期 | 提交 / 事项 | 类型 | 核心完成 | 关键文件 | 验证结果 |
| --- | --- | --- | --- | --- | --- |
| 2026-07-26 | Issue #27 实现完成，待 Draft PR Review 与验收 | feat / configuration / Runtime / Tool contract | 建立 contracts 运行时常量出口、DeepSeek Model Profile、启动期 fail-fast 的 LLM runtime config、40 条 Completed 历史策略与 16K / 64K / 128K Observation 预算；保持固定两轮 sampling 与当前 Tool allowlist | `packages/contracts/**`、`apps/api/src/llm/**`、`apps/api/src/agent-runtime/**`、`apps/api/src/tools/**`、`.env.example`、任务文档 | LLM Config 17、Tools 33、Tool Loop 24、Model Stream 37、SEO 10 个测试通过；API / Web / workspace 类型、lint、build 和 prod-only contracts 运行时 import 通过 |
| 2026-07-26 | Issue #27 创建：运行参数、Model Profile 与输出预算治理 | planning / configuration / cross-cutting | 基于最新 `master` 核对输入 16K、历史 12、输出 32K、普通请求 10s、Observation 8K、excerpt 200 等分散参数；确定 64K 输入、40 条 Completed 历史、DeepSeek 1M / 384K Profile、应用 65,536 / 131,072 输出、分级 Observation 预算等生产基线 | Issue #27、`docs/tasks/runtime-configuration-governance.md`、任务看板与 roadmap | 仅完成规格和 docs 同步，尚未执行 Clarification Gate、代码修改或测试；Phase 6 Task 1 保持未启动 |
| 2026-07-26 | PR #26 合并，merge commit `d3609d3fb17780ca08724dd79741195238f91e22`；Issue #25 Closed | feat / refactor / Tool Calling / docs | 将 Tool 基础设施与 Article 业务工具整理为 `core/ + articles/`；新增严格只读 `get_article_detail`；用本轮 `toolDefinitions` 阻止全局已注册但未开放的工具被执行；Task 0 经 GPT 技术验收和用户确认后收口 | `apps/api/src/tools/**`、`apps/api/src/agent-runtime/**`、`docs/tasks/**`、`docs/roadmap.md` | Tools 30、Tool Loop 21、Model Stream 36 个测试通过；API typecheck / lint、workspace typecheck、`git diff --check` 通过；Codex 最新 Review 未发现 major issues |
| 2026-07-26 | 阶段 6 路线重新评估并改为有界单 Agent Loop | docs / learning roadmap | 用户与 GPT 重新审查 Tool Calling 后的真实能力缺口，确认当前应学习生命周期完整、执行有界的单 Agent Loop，而不是提前建设完整 Context Budget / Truncation 系统；删除旧 Context 正式 Task 0-5，建立 `get_article_detail -> 有界 Loop -> 可靠性验收` 的阶段边界；阶段 6 后不再提前编号 | `README.md`、`docs/README.md`、`docs/roadmap.md`、`docs/tasks/**`、`docs/development-task-plan.md`、`docs/research/**`、`docs/work-log.md` | 远程 `master` 逐文件写入后重新检查入口、状态、旧目录残留和链接一致性；旧阶段 7-9 正式规划已删除；无业务代码改动 |
| 2026-07-26 | PR #24 合并，merge commit `190fecea0bf4975e8a3740db5258bc69eaa3a7ee` | feat / fix / SEO Chat | 将聊天输入上限从 2,000 提升到 16,000 字符，将默认及 SEO 输出上限提升到 32,768 tokens，并在 streaming 阶段使用纯文本渲染避免长回复反复 Markdown 解析 | `apps/api/src/llm/**`、`apps/api/src/seo/**`、`apps/web/src/components/agent/**`、`apps/web/src/components/seo/SeoChatComposer.vue` | 以 PR #24 合并事实和 merge commit diff 为准；本轮 docs 重规划不修改这些业务代码 |
| 2026-07-26 | 阶段 6 Context Engineering 路线草案 | docs / learning roadmap | 曾将阶段 6 规划为 Context Engineering Task 0-5；后续同日经用户质疑、代码约束和学习收益重新评估，确认该方案过早且范围过大，已由有界单 Agent Loop 规划替代 | 原 `docs/tasks/phase-06-context-engineering/**`、当时的 roadmap / tasks / research 入口 | 作为真实发生的历史决策保留记录，但不再代表当前路线或正式 Task 状态 |
| 2026-07-20 | PR #22 验收合并与 Admin Console Task 1 收口 | feat / fix / docs / Admin Console | 完成静态 Run List / Run Detail、类型化 Mock、Trace、Messages 与 Safe Raw Data，并修复不同 Run Tab、详情菜单高亮、列表筛选与分页状态保留 | `apps/admin/src/features/runs/**`、相关 views / store、`docs/tasks/admin-console.md` | Admin typecheck / lint / test / build、Web typecheck / build、API typecheck、workspace typecheck、真实 Chrome 验证通过；三个 Review Thread 已解决 |
| 2026-07-19 | PR #20 验收合并与 Admin Console Task 0 收口 | feat / docs / Admin Console | 建立独立 `apps/admin`，实现 Vben Ant Design 视觉基线的 Sidebar、Header、Breadcrumb、Route Tabs、主题和折叠状态；merge commit `09ab8344b772783d6c502d8502cff5a29276517b` | `apps/admin/**`、Admin 任务和路线文档 | Admin typecheck / lint / test / build、Web build、API typecheck、workspace typecheck 与真实 Chrome 验证通过 |
| 2026-07-18 | PR #17 验收合并与阶段 5 归档 | docs / Agent Runtime / Tool Calling | 统一同步与流式 SEO Chat 的唯一 Agent Runtime；merge commit `db7b3d1f`，Issue #14 关闭；阶段 5 标记 Completed | `apps/api/src/seo/**`、`apps/api/src/agent-runtime/**`、阶段 5 归档 | 8 个 SEO Service、9 个 Recorder、20 个 Tool Loop、35 个 Model Stream、24 个 Tools 测试通过；API / Web / workspace 检查通过 |
| 2026-07-17 | PR #15 验收合并收口 | Agent Runtime / Tool Calling | 完成动态 AgentStep、两轮 sampling usage / finish reason、工具安全摘要、真实 timeout 和 Observation 上限；merge commit `f6985627` | `prisma/**`、contracts、runtime、tools、阶段 5 文档 | Recorder、Tool Loop、Model Stream、Tools 测试及 typecheck / lint 通过；Codex Review 无 major issues |
| 2026-07-16 | PR #12 验收合并收口 | Agent Runtime / Tool Calling | 完成最多一次工具调用、最多两轮 sampling 的最小单 Agent Tool Loop；merge commit `390d8497` | `apps/api/src/agent-runtime/**`、`apps/api/src/llm/**` | Tool Loop、Model Stream、Tools 测试与 API / workspace 检查通过 |
| 2026-07-15 | PR #10 验收合并收口 | Tool Calling | 新增第一只只读业务工具 `search_articles`，返回受控文章字段、截断 excerpt 和 `modelContent`；merge commit `d4a73c7` | `apps/api/src/tools/search-articles.tool.ts`、测试、Tools Module | Tools、Model Stream 回归和 API / workspace 检查通过；Review 修复 LIKE 通配符问题 |
