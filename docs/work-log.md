# 项目工作记录

本文件用于记录每次阶段性开发、提交或重要讨论的上下文，帮助 Codex 后续快速恢复项目记忆。

`docs/learning-log.md` 记录“学到了什么 Agent 概念”；本文件记录“项目推进了什么、这次 commit 或阶段完成了什么”。

## 当前项目状态

| 模块 | 当前状态 | 已完成 | 下一步 |
| --- | --- | --- | --- |
| 项目架构 | 进行中 | 已迁移为 `pnpm workspace`，拆分 `apps/api` 与 `apps/web` | 把 AI SEO 能力接入后端接口 |
| 后端 API | 初始完成 | NestJS demo 接口 `GET /api/demo` 可访问 | 新增最小 AI SEO Agent 接口 |
| 前端 Web | UI 与目录规范初版完成 | 接入 Tailwind CSS 与 Lucide，按设计稿重构 AI SEO Agent 单屏工作台；补齐 `components`、`views`、`hooks`、`types`、`utils`、`assets` 等前端基础目录；新增 Web 前端开发约束 skill | 将前端表单接入后端 SEO 生成接口，并按规范逐步拆分组件和 hooks |
| Agent 能力 | 学习迁移中 | 已学习 API 调用、多轮对话、JSON Output、Tool Calling、Streaming | 将 DeepSeek JSON Output 落到 Nest 服务中 |

## 工作记录

| 日期 | 提交 | 类型 | 目标 | 核心完成 | 业务进度 | 讨论与决策 | 关键文件 | 验证结果 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-05-28 | `edb34ee feat: 搭建前后端工作区骨架` | 架构迁移 | 从单文件 CLI 学习项目升级为前后端工程骨架 | 新增 `apps/api` Nest 后端、`apps/web` Vue/Vite 前端、axios 请求封装，删除旧根目录 `src/` 示例代码 | 前端已能通过 Vite 代理访问 Nest demo 接口 | 确认使用 Vue + Nest + pnpm workspace，根目录保留 Antfu ESLint；旧 `src/` 可删除，后续模型调用放到后端 | `pnpm-workspace.yaml`、`apps/api/src/app.controller.ts`、`apps/web/src/api/http.ts`、`apps/web/src/App.vue` | `pnpm typecheck`、`pnpm lint`、`pnpm --filter @agent/web build` 通过；`curl` 验证 `localhost:3000/api/demo` 与 `localhost:5173/api/demo` 均返回后端数据 | 在 Nest 中实现最小 AI SEO Agent 接口，并由 Vue 表单调用 |
| 2026-05-28 | `edb34ee feat: 搭建前后端工作区骨架` | 工作流规范 | 新增提交专用 skill，固定提交前后的项目记忆更新流程 | 创建 `.codex/skills/git-commit`，要求 commit 前更新 `docs/work-log.md`，必要时更新 `docs/learning-log.md`，再运行验证和提交 | 项目具备更稳定的 Codex 记忆维护流程 | 明确 skill 不能自动调用 skill，但可以在 `git-commit` 流程中规定 Codex 主动执行两个日志更新职责 | `.codex/skills/git-commit/SKILL.md`、`AGENTS.md`、`docs/work-log.md` | `pnpm lint`、`pnpm typecheck`、`pnpm --filter @agent/web build` 通过 | 下次用户要求 commit 时，使用该 skill 串起记录、验证和提交 |
| 2026-05-28 | `1195d6c fix: 修复 monorepo eslint 配置` | 工程修复 | 修复 Antfu ESLint 在 monorepo 子目录和 Vue 文件中不稳定生效的问题 | 根 ESLint 配置显式开启 `vue`，忽略所有子包 `dist`；给 `apps/api`、`apps/web` 补 `lint` / `lint:fix` 脚本；Cursor/VS Code 增加 `eslint.workingDirectories` 自动识别 | web 子包内的 Vue 文件现在能被根目录和子包 lint 同时检查 | 根因是 Antfu 在根目录运行时没有从 `apps/web/package.json` 自动推断 Vue 能力，导致 `eslint .` 漏掉 `.vue` 文件；monorepo 下应显式声明 Vue 支持和编辑器工作目录 | `eslint.config.mjs`、`.vscode/settings.json`、`apps/web/package.json`、`apps/api/package.json`、`apps/web/src/App.vue` | `pnpm lint`、`pnpm --filter @agent/web lint`、`pnpm --filter @agent/api lint`、`pnpm typecheck`、`pnpm --filter @agent/web build` 通过 | 后续提交前使用 `git-commit` skill 统一触发 lint、typecheck 和工作记录更新 |
| 2026-05-28 | `e7c47ad chore: 补充 node 版本约束` | 环境规范 | 补充根目录 Node.js 版本信息 | 新增 `.nvmrc` 固定推荐 Node `20.19.3`，在 `package.json.engines` 写入 Node 与 pnpm 约束，并在 README 补充快速开始前的环境要求 | 项目环境约束更明确，新成员或 Codex 后续进入项目时可先按版本切换环境 | 推荐版本选择 Node `20.19.3`，同时保留 Vite 兼容范围 `^20.19.0 \|\| >=22.12.0`，避免误把本机 Node `25.2.1` 当作项目标准 | `.nvmrc`、`package.json`、`README.md` | `pnpm lint`、`pnpm typecheck`、`pnpm --filter @agent/web build` 通过 | 后续提交前运行 lint、typecheck 和 web build |
| 2026-05-28 | 待提交 | 功能开发 | 按 UI 设计稿还原 AI SEO Agent 工作台，并调整为浏览器真实一屏布局 | 安装 `tailwindcss`、`@tailwindcss/vite`、`@lucide/vue`；接入 Tailwind Vite 插件和全局样式；将 demo 页面重构为带左侧侧边栏、顶部状态、输入表单、结果面板、SEO checks 和复制按钮的工作台；删除设计稿底部的状态预览、移动端预览和错误展示模块；去掉居中 `max-width` 画布限制，让工作台按真实浏览器宽度铺满 | 前端从 demo 接口展示页推进到 AI SEO 工具 UI 初版，后续只需把模拟生成逻辑替换为后端 SEO 接口调用 | 明确第一版产品页面不做设计稿说明区，保留真实工作台核心功能；桌面端使用 `h-screen`、`min-h-0` 和全宽 grid 控制一屏展示，面板内部在极端高度下自行滚动 | `apps/web/package.json`、`apps/web/vite.config.ts`、`apps/web/src/main.ts`、`apps/web/src/style.css`、`apps/web/src/App.vue` | `pnpm --filter @agent/web typecheck`、`pnpm --filter @agent/web lint`、`pnpm --filter @agent/web build`、`pnpm typecheck`、`pnpm lint` 通过；内置浏览器当前无可用实例，未能自动截图验收 | 接入 `POST /api/seo/generate`，把前端模拟生成替换为真实 Nest + DeepSeek JSON Output 调用 |
| 2026-05-28 | 待提交 | 工程规范 | 建立前端目录基础和 Web 开发约束 skill，方便后续维护 | 新增 `apps/web/src/components`、`views`、`hooks`、`types`、`utils`、`assets` 目录；创建 `.codex/skills/web-frontend-development`，约束 Vue 组件拆分、Tailwind 真实尺寸适配、移动端响应式、主题切换、API / hooks / utils / types 分层，以及 `utils` 导出函数中文 TSDoc 规范；在 `AGENTS.md` 中加入使用该 skill 的触发说明 | 前端工程规范从口头约定沉淀为项目内可复用 skill，后续改 `apps/web` 时有明确约束 | 目录先用 `.gitkeep` 占位，不提前迁移当前 `App.vue`；等接入真实 SEO 接口或组件复杂度上升后再按规范拆分 | `AGENTS.md`、`.codex/skills/web-frontend-development/SKILL.md`、`.codex/skills/web-frontend-development/agents/openai.yaml`、`apps/web/src/components/.gitkeep`、`apps/web/src/views/.gitkeep`、`apps/web/src/hooks/.gitkeep`、`apps/web/src/types/.gitkeep`、`apps/web/src/utils/.gitkeep`、`apps/web/src/assets/.gitkeep` | `manual skill structure check passed`；官方 `quick_validate.py` 因当前 Python 环境缺少 `PyYAML` 未能运行，未安装额外 Python 包 | 下一步接入真实 SEO 接口时，将请求封装到 `api/seo.ts`，必要时把生成流程提取到 `hooks/useSeoGenerator.ts` |

## 记录规则

- 每次阶段性开发、重要讨论或 commit 前后补一条记录。
- 如果记录发生在 commit 前，`提交` 写 `待提交`；如果已经 commit，写短 hash 和提交信息。
- 只记录核心事实：目标、完成内容、业务进度、关键决策、验证结果和下一步。
- 学习概念写入 `docs/learning-log.md`；项目推进和 commit 上下文写入本文件。
- 不记录 API Key、token、密码、私有服务密钥等敏感信息。
