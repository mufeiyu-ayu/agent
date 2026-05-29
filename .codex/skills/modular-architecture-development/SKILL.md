---
name: modular-architecture-development
description: 模块化架构开发约束。Use when creating, modifying, refactoring, or reviewing frontend/backend code so the AI avoids one-file implementations, clarifies file responsibilities, separates common and business code, and keeps Vue/NestJS code maintainable.
---

# 模块化架构开发约束

## 1. 目标

这个 skill 用来防止 AI 写代码时“一把梭”：把页面、状态、接口、工具函数、类型、模型调用、业务流程全部堆进一个文件。

本项目是 Agent 应用开发学习项目。代码不只要能跑，还要帮助用户养成真实软件系统的开发思维：

- 文件有职责边界
- 模块有输入输出
- 公共能力和业务独享逻辑分开
- 前端页面不直接承载所有业务逻辑
- 后端 Controller 不直接塞满模型调用和工具逻辑
- 当前阶段不过度抽象，但也不继续扩大巨型文件

## 2. 使用时机

当任务涉及以下情况时，应主动使用本 skill：

- 新增页面、组件、接口、hook、service、tool、DTO、类型文件
- 修改 `apps/web/**`
- 修改 `apps/api/**`
- 接入 LLM API、Tool Calling、JSON Output、Streaming
- 用户要求“顺手加一下逻辑”，但该逻辑会让现有文件继续膨胀
- 代码 review 时发现单文件职责过多
- 需要判断某段代码应该放公共模块还是业务模块

## 3. 总体原则

### 3.1 先判断职责，再写代码

写代码前先回答：

```txt
这段代码属于什么职责？
它是页面展示、交互状态、接口请求、业务流程、模型调用、工具函数、类型定义，还是配置？
它是当前业务独享，还是未来可能复用？
```

不要因为“文件少、改起来快”就把所有内容写进入口文件。

### 3.2 小项目也要有边界

当前项目可以保持轻量，但不能没有结构。

轻量结构的含义是：

- 不引入复杂框架
- 不做过度泛化
- 不做微服务式拆分
- 但基础职责必须拆清楚

### 3.3 抽离不是越多越好

不要为了模块化而机械拆文件。满足以下任一条件时才优先抽离：

- 单文件同时承担 3 类以上职责
- 单文件超过约 250-300 行且仍会继续增长
- 同类逻辑出现 2 次以上
- 逻辑需要独立测试或独立复用
- 代码阅读时必须上下滚动很多次才能理解一个流程
- 组件 props / emits 可以清楚表达输入输出
- 后端流程可以拆成 Controller / Service / Tool / LLMService

## 4. 前端模块化规则

### 4.1 推荐目录

`apps/web/src` 推荐按职责组织：

```txt
apps/web/src/
  api/
    http.ts
    seo.ts
  assets/
  components/
    common/
    seo/
  hooks/
    useSeoGenerator.ts
  types/
    seo.ts
  utils/
    seo-check.ts
    text.ts
  views/
    SeoWorkspaceView.vue
  App.vue
  main.ts
  style.css
```

### 4.2 App.vue 职责

`App.vue` 应逐步收敛为应用入口，不应该长期承担完整业务页面。

推荐职责：

- 挂载主视图
- 放少量全局布局
- 未来接 router 时承载 `<RouterView />`

不推荐职责：

- 维护所有 SEO 表单状态
- 写所有生成逻辑
- 写所有 mock 数据
- 写所有 UI 卡片
- 直接调用 axios
- 写大量 SEO 检查算法

### 4.3 views 职责

`views/` 放页面级组合，例如：

```txt
views/SeoWorkspaceView.vue
```

页面负责组合业务组件和 hook：

```txt
SeoWorkspaceView
  -> useSeoGenerator
  -> SeoInputPanel
  -> SeoResultPanel
  -> SeoCheckList
```

页面可以知道业务流程，但不要承担所有底层 UI 和工具函数。

### 4.4 components 职责

`components/seo/` 放 AI SEO Agent 业务组件，例如：

```txt
components/seo/SeoInputPanel.vue
components/seo/SeoResultPanel.vue
components/seo/SeoCheckList.vue
components/seo/SeoStatusCard.vue
```

`components/common/` 只放跨业务复用组件，例如：

```txt
components/common/BaseButton.vue
components/common/EmptyState.vue
components/common/StatusBadge.vue
```

不要把只在 SEO 页面使用一次的组件过早放进 `common/`。

### 4.5 hooks 职责

`hooks/` 放组合式状态逻辑，例如：

```txt
hooks/useSeoGenerator.ts
```

适合放入 hook 的内容：

- loading / error / data 状态
- generate / reset / retry 行为
- 调用 `api/seo.ts`
- 整理前端所需的派生状态

不适合放入 hook 的内容：

- 大段模板 UI
- 纯文本长度算法
- axios 实例配置
- DOM 操作和页面布局细节

### 4.6 api 职责

`api/` 只处理 HTTP 调用：

```txt
api/http.ts
api/seo.ts
```

规则：

- 不在 Vue 组件中直接散写 URL。
- 不在组件中直接 `axios.post('/api/...')`。
- 请求入参和响应类型要明确。
- 前端不得保存或传递模型平台 API Key。

### 4.7 types 职责

`types/` 放跨多个文件复用的业务类型，例如：

```ts
export interface GenerateSeoRequest {
  pageTopic: string
  language: string
  keywords: string[]
}

export interface GenerateSeoResponse {
  title: string
  description: string
  checks: SeoCheck[]
}
```

只在单个组件内部使用的局部类型，可以先留在组件内。

### 4.8 utils 职责

`utils/` 放纯函数。纯函数必须满足：

- 输入明确
- 输出明确
- 不读写 Vue ref
- 不访问 DOM
- 不直接发请求
- 不修改外部状态

示例：

```txt
utils/seo-check.ts
utils/text-count.ts
```

导出函数必须写中文 TSDoc，说明用途、参数、返回值和必要示例。

## 5. 后端模块化规则

### 5.1 推荐目录

`apps/api/src` 推荐逐步演进为：

```txt
apps/api/src/
  app.module.ts
  main.ts
  health/
    health.controller.ts
  seo/
    seo.module.ts
    seo.controller.ts
    seo.service.ts
    dto/
      generate-seo.dto.ts
    types/
      seo.types.ts
    tools/
      seo-check.tool.ts
    prompts/
      seo-generation.prompt.ts
  llm/
    llm.module.ts
    llm.service.ts
    llm.types.ts
    deepseek.client.ts
  common/
    errors/
    utils/
```

当前阶段可以少建一些文件，但 Controller、业务 Service、LLM 调用、Tool 函数这几类职责不要混在一个文件里。

### 5.2 Controller 职责

Controller 只做 HTTP 边界：

- 定义路由
- 接收请求体 / query / params
- 做轻量参数入口处理
- 调用 Service
- 返回响应

Controller 不应该：

- 直接写 prompt
- 直接调用模型 SDK
- 直接解析模型 JSON
- 直接写 SEO 检查算法
- 堆积复杂 try/catch 流程

### 5.3 Service 职责

业务 Service 负责组织流程，例如：

```txt
SeoService.generateSeoContent()
  -> 构造 prompt 输入
  -> 调用 LLMService
  -> 校验模型输出
  -> 调用 SEO Tool
  -> 返回业务结果
```

Service 可以知道业务，但不要知道太多 HTTP 细节。

### 5.4 LLMService 职责

LLMService 只封装模型调用：

- base URL
- API Key
- model
- messages
- response_format
- stream
- timeout / retry 基础策略

LLMService 不应该知道具体页面 UI，也不应该直接返回前端展示文案结构，除非这是很薄的一层示例封装。

### 5.5 Tool 职责

Tool 是确定性能力，不是“又一个模型调用”。

例如：

```txt
seo-check.tool.ts
  -> checkTitleLength
  -> checkDescriptionLength
  -> checkKeywordIncluded
```

Tool 函数应该：

- 输入输出明确
- 可独立测试
- 不依赖 HTTP 请求对象
- 不读取环境变量
- 不直接调用模型

### 5.6 DTO / 类型 / 校验

模型输出和 HTTP 入参都需要运行时校验意识。

当前阶段可以不用立刻引入复杂校验库，但至少要明确：

- TypeScript 类型不能验证运行时数据
- 模型返回 JSON 后必须检查关键字段
- `title` / `description` / `checks` 不能只靠类型断言

如果未来引入依赖，再考虑 `zod` 或 `class-validator`，不要一开始为了校验引入过多复杂度。

## 6. 公共能力与业务独享的判断

### 6.1 放业务目录的情况

只服务 AI SEO Agent 的代码，优先放业务目录：

```txt
components/seo/
seo/
utils/seo-check.ts
```

例如：

- SEO title 长度检查
- 关键词是否命中
- SEO 结果面板
- 生成 SEO 文案的 prompt

### 6.2 放 common 的情况

满足以下条件再放 common：

- 至少两个业务模块会用
- 不包含 SEO、Agent、LLM 这类具体业务语义
- API 清晰稳定
- 不需要频繁随着某个业务变化

例如：

- 通用按钮
- 通用状态徽标
- 通用错误展示
- 通用字符串截断函数

### 6.3 可以暂时写死的内容

当前学习阶段可以暂时写死：

- 默认语言 `English`
- SEO title 推荐长度
- description 推荐长度
- 页面上的示例关键词
- 本地 demo 的少量 mock 文案

但要集中管理，不要散落在多个组件里。

### 6.4 不应该写死的内容

这些不应该写死到代码里：

- API Key
- 私有中转 base URL
- 生产模型名
- 数据库密码
- 用户 token
- 高风险操作开关

应放到环境变量或后端配置中，并提供 `.env.example` 示例，不放真实值。

## 7. Agent 应用中的模块边界

实现 Agent 功能时，必须区分：

```txt
用户输入
  -> 前端表单状态
  -> HTTP 请求 DTO
  -> 后端业务 Service
  -> LLM 调用
  -> Tool 执行
  -> 运行时校验
  -> 业务响应 DTO
  -> 前端展示状态
```

不要把 Agent 当成“页面里调用一个接口”。

最小 AI SEO Agent 可以先是单 Agent 流程，但文件结构要为后续演进留边界：

- Streaming 可以接到现有 API 层和 hook 层
- Tool Calling 可以扩展现有 tool 目录
- RAG 以后可以作为单独 knowledge 模块
- 记忆和会话以后可以作为 conversation 模块

## 8. 重构策略

如果当前文件已经很大，例如 `App.vue`，不要一次性粗暴大重构。

推荐顺序：

1. 先抽类型到 `types/seo.ts`。
2. 再抽纯函数到 `utils/seo-check.ts`。
3. 再抽接口请求到 `api/seo.ts`。
4. 再抽状态逻辑到 `hooks/useSeoGenerator.ts`。
5. 最后拆 UI 组件到 `components/seo/` 和页面到 `views/SeoWorkspaceView.vue`。

每一步都应保持项目可运行。

## 9. 修改前检查清单

写代码前检查：

```txt
当前要改的文件是否已经职责过多？
是否存在相邻模块可以复用？
这段逻辑是业务独享还是公共能力？
是否需要新增类型文件？
是否需要新增工具函数？
是否需要新增 API 封装？
后端是否应该新增 module/service/tool，而不是继续写进 app.controller.ts？
```

## 10. 修改后自审清单

提交或回复用户前检查：

```txt
是否仍然把接口请求写在组件里？
是否仍然把模型调用写在 Controller 里？
是否新增了没有必要的 common 抽象？
是否有 API Key 或敏感地址进入仓库？
是否存在 any 滥用？
是否有导出的 utils 缺少中文 TSDoc？
是否说明了未运行的验证命令和原因？
```

## 11. 输出要求

完成任务后，说明：

- 拆分了哪些文件
- 每个文件负责什么
- 为什么这个拆分对当前阶段足够
- 哪些地方暂时没有继续抽象
- 后续如果继续增长，下一步应该怎么拆
