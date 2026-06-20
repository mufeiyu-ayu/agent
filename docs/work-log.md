# 项目工作记录
| 类型 | 当前记录 | 下一步 |
| --- | --- | --- |
| 当前状态 | Vue + Nest + pnpm workspace，主接口为 `POST /api/seo/chat` | 继续 T19-A |
| 最新转向 | `fb4152a` 将固定字段 SEO 生成器简化为普通 SEO Agent 聊天链路 | 加入受控 history |
| 组件现状 | `df4a928` 接入 `shadcn-vue`，复杂交互用组件库，强定制布局继续手写 | 不为了统一强行替换 |
| UI 整体 | Web 端首页与工作台 UI polish 已完成；首页已接入中英文切换，并完成首轮无视觉差性能优化；工作台新增暖色 / 橄榄余烬双主题 | 后续继续 T19-A 受控 history |
| 配置现状 | `6cf5756` / `4c62a1d` 将默认模型示例收敛为 `deepseek-v4-flash` | 提交前确认是否推送本地 ahead 提交 |
| 历史细节 | 旧阶段细节不再放正文 | 需要时看 `git log` / `git show` |

## 工作记录

| 日期 | 提交 | 类型 | 核心完成 | 关键文件 | 验证结果 |
| --- | --- | --- | --- | --- | --- |
| 2026-06-20 | 待提交 | UI polish | 首页与工作台样式打磨：暗色品牌 hero、中英文语言切换、工作台暖色 / 橄榄余烬双主题切换（持久化到 `localStorage`）、对话区 Markdown 渲染、首页动态 placeholder，以及一轮无视觉差的首屏性能优化（路由动态导入、动画降帧）。同步替换头像/背景图资产，新增 `gsap`、`markdown-it` 依赖 | `apps/web/src/components/seo/SeoHomeHero.vue`、`apps/web/src/components/layout/WorkspaceThemeSwitcher.vue`、`apps/web/src/hooks/useWorkspaceTheme.ts`、`apps/web/src/components/agent/AgentMarkdownContent.vue`、`apps/web/src/router/index.ts`、`DESIGN.md` 等 | `pnpm --filter @agent/web typecheck` / `lint` / `build` 通过 |
