# AI SEO Agent 项目完成任务计划

本文件是后续开发的主任务看板。以后推进项目时，优先以本文件判断“当前该做什么、做到什么程度算完成”。

`docs/work-log.md` 记录每次项目推进的上下文；`docs/learning-log.md` 记录 Agent 概念学习复盘。本文件只记录业务相关任务，不记录环境配置、格式化、lint、提交流程等非业务事项。

## 计划设计原则

本项目不是传统前端页面项目，也不是算法研究项目，而是一个面向前端开发者的 Agent 应用开发学习项目。

当前用户基础：

- Vue / Nuxt / TypeScript 较熟。
- 有前端工程化和业务页面经验。
- NestJS / Node.js 有基础但生疏。
- 目标是能独立开发可落地的 Agent 应用。
- 当前不以成为传统后端专家为目标。

因此后续任务必须遵守：

1. 先跑通最小闭环，再扩展复杂能力。
2. 每个任务只聚焦一个主要能力，不把 Nest、LLM、JSON Output、前端联调一次性揉在一起。
3. 先用 mock 验证接口和模块边界，再替换成真实模型调用。
4. Agent 能力要逐步落地，不一开始做 RAG、多 Agent、复杂工作流。
5. 前端继续保持模块化，不退回到 `App.vue` 巨型文件。
6. 后端继续保持 Controller / Service / LLMService / Tool 的职责边界。
7. 每个任务必须有明确验收标准，否则不进入“已完成”。

## 状态说明

| 状态 | 含义 |
| --- | --- |
| 已完成 | 已经有可运行或可复盘的交付结果 |
| 进行中 | 当前正在实现或正在补齐 |
| 准备中 | 下一批优先进入开发的任务 |
| 未开始 | 已纳入项目范围，但当前阶段暂不做 |
| 暂缓 | 当前阶段明确不做，等最小闭环完成后再评估 |

## 当前主线

当前主线不是继续优化 UI，而是跑通第一版 AI SEO Agent MVP：

```txt
用户输入页面主题 / 语言 / 关键词
  -> Vue 前端调用 Nest API
  -> Nest 后端组织生成流程
  -> 先返回 mock SEO 结果
  -> 再替换为 LLM JSON Output
  -> 前端展示 title / description / suggestions
```

第一版完成前，暂不做：

- 用户登录
- 数据库存储
- RAG
- 多 Agent
- 外部搜索 API
- 复杂工作流引擎
- 复杂权限系统
- 生产部署
- 大规模 UI 重设计

## 项目完成任务表

| 任务 ID | 阶段 | 业务任务 | 目标交付 | 当前需要学习 / 练习 | 验收标准 | 状态 | 下一步 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| T01 | 产品定义 | 明确 AI SEO Agent MVP 边界 | 用户输入页面主题、语言、关键词，系统返回 SEO title、meta description 和检查结果 | Agent 产品闭环、MVP 范围控制 | `context/ai-seo-agent-plan.md` 已描述输入、输出、第一版边界和暂不处理内容 | 已完成 | 后续需求变化先同步本任务表 |
| T02 | 前端工作台 | 搭建 AI SEO Agent 单屏工作台 | 页面包含主题输入、语言选择、关键词维护、生成按钮、结果展示和复制能力 | Vue 页面组织、AI 工具型产品交互 | 用户能在页面完成输入、生成、查看结果和复制结果的基本流程 | 已完成 | 等后端接口完成后替换模拟生成逻辑 |
| T03 | 前端模块化 | 拆分前端 SEO 工作台模块 | 将页面、布局组件、SEO 组件、hook、types、utils 分离 | 前端业务模块边界、组合式状态封装 | `App.vue` 只作为入口，SEO 工作台逻辑集中在 view / components / hook 中 | 已完成 | 接口接入时继续保持 `api`、`hooks`、`types` 分层 |
| T04 | 后端 HTTP 边界 | 建立 Nest API 基础响应边界 | 后端具备统一成功响应、异常响应、请求校验和 request id | Nest 基础设施、HTTP 错误处理、全局边界 | `/health` 可访问，错误响应结构稳定，后续业务接口可复用全局能力 | 已完成 | 在此基础上新增 SEO 业务模块 |
| T05 | SEO 接口骨架 | 新增 `POST /api/seo/generate`，先不接模型 | 接口接收页面主题、语言、关键词，并返回后端 mock 的 title / description | Nest Module、Controller、Service、DTO、基础请求校验 | `curl` 请求接口可成功返回 mock SEO 结果；Controller 不直接写业务生成逻辑；Service 负责组织返回 | 已完成 | 前端在 T06 接入真实接口 |
| T06 | 前端真实接口接入 | 前端调用 `POST /api/seo/generate` | 用真实后端 mock 结果替换 `useSeoWorkspace` 中的前端 `setTimeout` 模拟生成 | Vue hook 调接口、loading / success / error 状态管理、axios 响应解包 | 点击 Generate 后请求后端接口；成功时展示后端返回结果；失败时展示错误状态；前端不再本地伪造生成结果 | 已完成 | 后续 T08 开始封装后端 `LLMService` |
| T07 | 本地 SEO 检查工具 | 在后端实现确定性的 SEO 检查 | 当前阶段只检查生成结果是否包含 title、description，以及关键词是否覆盖 | Tool 函数边界、确定性业务规则、后端业务校验 | 曾用于最小闭环验证本地确定性后处理 | 暂缓 | 用户确认 SEO Checks 对第一版产品价值不高，已从接口响应和前端展示中移除；后续 Tool Calling 重新设计更有用的工具 |
| T08 | LLM 调用封装 | 在后端封装基础 `LLMService` | 统一封装 DeepSeek / OpenAI-compatible API 调用，暂不强求完整 JSON Output | API Key 环境变量、模型调用参数、Service 分层、模型错误处理 | SEO 业务代码不直接拼模型请求细节；模型 base URL、model、API Key 来自后端配置；前端不接触密钥 | 已完成 | 原生 fetch 实现；已补齐根目录 `.env` 加载、配置校验和 Base URL 规范化；下一步进入 T09：JSON Output 落地 |
| T09 | JSON Output 落地 | 让模型稳定返回结构化 SEO JSON | Prompt 约束输出字段，代码解析并校验模型结果 | JSON Output、结构化 prompt、运行时校验、模型输出不可信原则 | 模型返回非法 JSON 或字段缺失时，后端返回明确错误；合法时输出 `title`、`description` 等结构化字段 | 已完成 | 已新增 prompt、output validator 和 `SeoGenerationService`，并在 T10 正式链路中复用 |
| T10 | LLM 替换 mock | 将 SEO 接口的 mock 生成替换为真实模型生成 | `POST /api/seo/generate` 由 LLM 生成 title / description | Nest Service 编排、LLMService 调用、模型输出后处理 | 固定输入可获得真实模型结果；后端返回 `title`、`description`；接口错误可被前端识别 | 已完成 | 固定样例已通过真实接口验证；T11 已完成最小闭环联调 |
| T11 | 最小闭环联调 | 跑通 Vue -> Nest -> LLM -> Vue 完整链路 | 页面输入一次真实主题后，完成模型生成、后端校验、前端展示 | 前后端联调、模型调用错误定位、端到端验收 | 使用固定样例完成一次可复现生成：`PUBG UC 充值页面`、`English`、`PUBG UC/top up/instant delivery`；页面显示 title、description、loading、error 状态 | 已完成 | 已完成前端到后端真实模型链路联调；T12 基础错误恢复已收口 |
| T12 | 基础错误恢复 | 补齐模型调用失败和 JSON 解析失败的用户反馈 | 区分模型调用失败、JSON 解析失败、模型字段缺失、请求参数错误 | Agent 调用失败分类、业务错误提示、后端日志定位 | 前端能显示可理解的失败原因；后端能通过 request id 定位错误；错误不泄露 API Key 或敏感信息 | 已完成 | 已补齐 LLM/JSON Output 错误 HTTP 映射、前端 message 提示、requestId 日志定位、后端 LLM 请求超时和响应 JSON 解析兜底；T13 与 T16 暂缓，下一步优先 T14 结果优化建议 |
| T13 | 输入边界与成本控制 | 限制用户输入和模型请求范围 | 对页面主题长度、关键词数量、关键词长度做基础限制 | 输入校验、token 成本控制、Agent 安全边界 | 超长输入、空主题、过多关键词会在调用模型前被拦截；前端和后端限制保持一致 | 暂缓 | 当前已保留 Page Topic 和 Keywords 必填内联校验；具体长度、数量和成本规则等需求稳定后再恢复 |
| T14 | 结果优化建议 | 生成可执行的 SEO 改进建议 | 除 title / description 外，返回 3 到 5 条优化建议 | Prompt 结构化输出、业务结果分层 | 前端能展示建议列表；建议和输入主题、关键词相关；字段校验稳定 | 已完成 | 已扩展后端 JSON Output、validator 和前端展示；同时移除第一版不再需要的 SEO Checks |
| T15 | 会话级生成记录 | 前端保存当前会话内最近生成结果 | Results 以对话线程展示用户输入和 Agent 生成结果，刷新后允许丢失 | 前端状态管理、会话级记忆、历史记录 UI、是否持久化的边界判断 | 前端至少保留最近 3 次生成结果；不引入数据库；不影响主生成流程；Results 能展示 user / agent 对话 turn | 已完成 | 当前只做前端会话记忆，不传历史给模型；下一步进入 T17 流式输出 |
| T16 | 基础效果评估 | 建立可重复的生成质量评估样例 | 用固定输入样例检查生成质量、字段完整性和错误处理 | Agent 结果评估、测试样例设计、prompt 回归检查 | 有一组固定输入和预期检查点，用于判断 prompt 或模型调用改动后是否退化 | 暂缓 | 用户确认当前不需要做，不作为第一版主线任务；后续确有 prompt 回归需求时再恢复 |
| T17 | 流式输出 | 实现 SEO 生成的流式体验 | 后端通过 SSE 或流式协议把生成过程状态和最终结构化结果返回前端 | Streaming、SSE、chunk 消费、前端增量渲染 | 用户能看到生成过程，而不是只等待最终结果；非流式接口仍保留可用 | 未开始 | 基于 T15 对话 turn 的 loading / success / error 状态接入流式事件 |
| T18 | Tool Calling 升级 | 引入一个简单 SEO 工具调用闭环 | 模型决定是否调用工具，后端执行工具，模型基于工具结果生成最终建议 | Tool Calling、工具参数校验、工具结果回传模型 | 能清楚区分“模型决策调用工具”和“后端真实执行工具”；工具参数有运行时校验 | 未开始 | 结果优化建议稳定后，再重新设计一个对产品更有价值的工具场景 |
| T19 | 简单会话上下文 | 支持一次生成任务内的上下文组织 | 后端能组织 system / user / assistant message，必要时保留单次任务上下文 | messages 组织、上下文管理、token 控制 | 生成流程中的 messages 结构清晰；不会把无关历史无限追加进模型上下文 | 未开始 | JSON Output 和最小闭环稳定后再补 |
| T20 | 产品收尾 | 完成 AI SEO Agent 第一版体验闭环 | 前端、后端、LLM、SEO 建议、会话结果和错误反馈形成完整可演示产品 | 端到端 Agent 应用组织、产品验收、作品集整理 | 新用户按 README 启动后，可以完成一次完整 SEO 生成流程；README 有清晰演示说明 | 未开始 | T17 基础流式体验完成后进行收尾 |

## 当前 Sprint 计划

### Sprint 1：后端 SEO 接口骨架

对应任务：

- T05
- T07 的最小版本

目标：

```txt
先不接模型，只完成 Nest SEO 模块和后端本地 SEO checks。
当前第一版已移除 checks 响应和展示，本段只保留历史阶段脉络。
```

建议改动：

```txt
apps/api/src/seo/seo.module.ts
apps/api/src/seo/seo.controller.ts
apps/api/src/seo/seo.service.ts
apps/api/src/seo/dto/generate-seo.dto.ts
apps/api/src/seo/types/seo.types.ts
apps/api/src/app.module.ts
```

验收：

```txt
curl POST /api/seo/generate 可以拿到 title / description
pnpm --filter @agent/api typecheck 通过
pnpm --filter @agent/api lint 通过
```

暂不做：

```txt
不接 DeepSeek
不接 LLMService
不做 JSON Output
不改前端 UI
```

### Sprint 2：前端真实调用后端

对应任务：

- T06

目标：

```txt
把前端 setTimeout mock 替换成真实 HTTP 请求。
```

建议改动：

```txt
apps/web/src/api/seo.ts
apps/web/src/hooks/useSeoWorkspace.ts
apps/web/src/types/seo.ts
```

验收：

```txt
点击 Generate 后请求 Nest 接口
成功时展示后端返回结果
失败时展示错误状态
pnpm --filter @agent/web typecheck 通过
pnpm --filter @agent/web lint 通过
pnpm --filter @agent/web build 通过
```

暂不做：

```txt
不接模型
不做流式输出
不改页面大布局
```

### Sprint 3：LLMService 与 JSON Output

对应任务：

- T08
- T09
- T10

目标：

```txt
把后端 mock 生成替换为 DeepSeek / OpenAI-compatible JSON Output。
```

建议改动：

```txt
apps/api/src/llm/llm.module.ts
apps/api/src/llm/llm.service.ts
apps/api/src/llm/llm.types.ts
apps/api/src/seo/prompts/seo-generation.prompt.ts
apps/api/src/seo/validators/seo-output.validator.ts
apps/api/src/seo/seo.service.ts
.env.example
```

验收：

```txt
API Key 只在后端环境变量中
模型返回 JSON 可被解析
字段缺失时返回明确错误
合法输出会继续进入 SEO check tool
```

暂不做：

```txt
不做 Tool Calling
不做 Streaming
不做数据库
```

### Sprint 4：端到端最小闭环

对应任务：

- T11
- T12 的最小版本
- T13 的最小版本

目标：

```txt
完成 Vue -> Nest -> LLM -> SEO Tool -> Vue 的可演示闭环。
```

验收固定样例：

```txt
pageTopic: PUBG UC 充值页面
language: English
keywords:
  - PUBG UC
  - top up
  - instant delivery
```

必须观察到：

```txt
前端 loading
成功结果
title
description
失败错误提示
后端 request id
```

### Sprint 5：第一版增强

对应任务：

- T14
- T15

目标：

```txt
补齐优化建议和会话级历史，让项目具备作品集展示价值。
```

暂不做：

```txt
不做数据库
不做登录
不做复杂权限
```

### Sprint 6：Agent 能力增强

对应任务：

- T17
- T18
- T19

目标：

```txt
在最小闭环稳定后，再学习 Streaming、Tool Calling、上下文管理。
```

注意：

```txt
这些是 Agent 进阶能力，不是当前第一优先级。
```

## 提交时维护规则

- 每次提交前，如果本次改动推进了表中的业务任务，必须更新对应任务的 `状态`、`验收标准` 或 `下一步`。
- 新增业务能力时，先判断是否属于已有任务；如果不属于，再新增任务行。
- 不把环境配置、依赖安装、lint、格式化、提交记录等非业务事项写入本表。
- `docs/work-log.md` 继续记录每次提交发生了什么；本表只维护项目完成路径和当前进度。
- 涉及 Agent 概念学习时，再同步更新 `docs/learning-log.md`。
- 如果某个任务实际实现时发现过大，优先拆小任务，不要把多个阶段强行塞进一个 commit。
