---
name: web-frontend-development
description: Vue / Vite / TypeScript 前端开发约束。Use when Claude Code needs to create, modify, refactor, review, or organize files under apps/web, including Vue components, views, hooks/composables, utils, types, assets, Tailwind UI, responsive layouts, theme switching, and frontend API integration in this project.
---

# Web 前端开发约束

## 基本流程

修改 `apps/web` 前，先检查 `apps/web/package.json`、`apps/web/vite.config.ts`、`apps/web/src` 目录和相邻实现。优先复用现有模式，不为单个页面过早引入复杂抽象。

前端实现默认使用：

- Vue 3 `<script setup lang="ts">`
- TypeScript 严格类型
- Tailwind CSS
- Lucide 图标
- axios 与 `src/api` 封装

## 目录约定

`apps/web/src` 下按职责放置：

- `api/`：HTTP client、接口请求函数、接口入参/响应类型。不要在组件里散写 URL 和 axios 配置。
- `assets/`：图片、字体、静态素材等非代码资源。全局样式仍可保留在 `src/style.css`。
- `components/`：可复用组件，文件名使用 PascalCase，例如 `SeoResultCard.vue`。
- `views/`：页面级视图或路由页面。页面负责组合组件，不堆积底层 UI 细节。
- `hooks/`：组合式逻辑，函数名使用 `useXxx`，例如 `useSeoGenerator.ts`、`useTheme.ts`。
- `types/`：跨模块复用类型。只在单个组件内部使用的类型优先放在组件内。
- `utils/`：纯工具函数。不要依赖 Vue 响应式状态、DOM、HTTP 请求或浏览器全局副作用。

## 组件规范

组件拆分以可读性和复用为准，不为了目录完整而机械拆分。一个页面可以先留在 `App.vue` 或 `views`，当出现以下情况再拆组件：

- 同一 UI 结构复用两次以上。
- 单文件同时承担表单、结果展示、状态处理、接口请求，阅读成本明显上升。
- 组件有清晰输入输出，可以通过 `props` / `emits` 表达。

Vue 单文件组件约定：

- 使用 `<script setup lang="ts">`。
- `props`、`emits`、列表项、接口响应都要有明确类型。
- 避免 `any`。确实需要断言时，在代码附近说明运行时边界。
- 基础展示组件不直接请求接口；接口调用放在 `api/`、页面或 `hooks/`。
- 业务组件只接收必要数据，不把整个后端响应对象无差别透传。
- 图标优先使用 `@lucide/vue`，按钮图标要有 `title` 或 `aria-label`。

## Tailwind 与布局

采用移动优先。先写默认移动端布局，再用 `sm`、`md`、`lg`、`xl`、`2xl` 扩展桌面布局。

工作台类页面要按真实浏览器 viewport 设计：

- 不要默认用固定设计稿宽度或居中 `max-width` 限制主应用。
- 桌面一屏工具台可使用 `h-screen`、`min-h-0`、`overflow-hidden` 控制外层。
- 内容超出时优先让具体面板内部滚动，不让整个页面出现无意义滚动。
- 所有 grid/flex 子项需要考虑 `min-w-0`，避免长文本撑破布局。
- 固定格式元素用稳定尺寸，例如图标按钮、状态 badge、结果卡片操作区。
- 不使用负字距，不用随 viewport 缩放字体。

Tailwind 使用约定：

- 优先使用 utility class，避免新增 scoped CSS，除非是动画、全局 reset、主题变量或 Tailwind 难表达的样式。
- 页面级大段重复 class 出现后，再考虑抽组件，不急着抽 CSS 类。
- 保持视觉克制，避免无意义装饰和单一色系堆叠。

## 主题切换

新增主题能力时，优先建立 `hooks/useTheme.ts`，职责包括：

- 读取用户选择：`light`、`dark`、`system`。
- 监听系统主题变化。
- 将主题写入 `document.documentElement.dataset.theme` 或 class。
- 持久化到 `localStorage`。

颜色应逐步收敛到 CSS 变量或 Tailwind token，不要在多个组件里散落大量互不关联的硬编码颜色。

## 工具函数规范

`src/utils` 只放纯函数。工具函数必须满足：

- 文件名使用 kebab-case 或按领域命名，例如 `text-count.ts`、`seo-format.ts`。
- 导出函数使用明确参数和返回类型。
- 不读取或修改外部状态。
- 不直接访问 DOM、`window`、`localStorage`，这类逻辑应放入 `hooks`。
- 每个导出的工具函数都要写中文 TSDoc，说明用途、参数、返回值，必要时给示例。

TSDoc 示例：

```ts
/**
 * 判断文本长度是否落在推荐区间内。
 *
 * @param value - 需要检查的文本。
 * @param min - 推荐最小长度，包含边界值。
 * @param max - 推荐最大长度，包含边界值。
 * @returns 如果文本长度在推荐区间内，返回 `true`。
 *
 * @example
 * ```ts
 * isTextLengthInRange('Buy PUBG UC Online', 10, 60)
 * ```
 */
export function isTextLengthInRange(value: string, min: number, max: number): boolean {
  const length = value.length

  return length >= min && length <= max
}
```

## API 与状态管理

接口请求统一放在 `src/api`。推荐结构：

```txt
api/
  http.ts          # axios 实例和通用拦截
  seo.ts           # SEO 相关接口函数
```

页面调用接口时，简单状态可直接用 `ref`；当一个流程包含 loading、error、data、retry、reset 等状态，并且会被多个组件使用时，再提取到 `hooks/useXxx.ts`。

前端不得保存模型平台 API Key。涉及 DeepSeek / OpenAI-compatible 调用时，前端只请求 Nest 后端。

## 验证要求

前端改动后至少运行：

```sh
pnpm --filter @agent/web typecheck
pnpm --filter @agent/web lint
pnpm --filter @agent/web build
```

如果修改影响整个 workspace，再运行：

```sh
pnpm typecheck
pnpm lint
```

涉及可访问页面时，启动开发服务并检查真实浏览器尺寸、移动端断点、控制台错误、loading / empty / success / error 状态。
