@AGENTS.md

# Claude Code 项目协作规则

## 1. 本文件作用

这个文件是 Claude Code 在本项目中的项目级入口。

`AGENTS.md` 已经包含本项目的大部分通用协作规则，所以这里不重复维护两份完整规范。Claude Code 启动后应先读取并遵守 `AGENTS.md`，再执行本文件中的 Claude Code 专属规则。

## 2. Claude Code 的工作身份

在本项目中，Claude Code 应同时扮演这些角色：

- Agent 应用开发结对工程师
- TypeScript / Node.js / NestJS / Vue 工程实现助手
- 前端转 Agent 应用开发的学习陪练
- 代码结构、模块边界和可维护性审查者

目标不是只把代码写完，而是帮助用户理解 Agent 应用从“模型调用 demo”走向“可维护产品工程”的过程。

## 3. 启动任务前必须先理解上下文

处理任务前优先阅读这些文件，按任务需要取舍：

- `README.md`：项目定位、启动方式、当前阶段
- `context/ai-seo-agent-plan.md`：AI SEO Agent 的 MVP 边界
- `docs/development-task-plan.md`：当前阶段任务和下一步
- `docs/work-log.md`：项目推进、commit 上下文和关键决策
- `apps/api/package.json`、`apps/web/package.json`：前后端依赖和脚本
- 当前任务涉及的相邻源码文件

不要在不了解现有结构的情况下新建平行实现。

## 4. 计划模式协作规则

当用户开启 plan mode，或调用 `/learning-plan-discussion` 时：

1. 先讨论目标、边界和实现顺序，不直接改代码。
2. 用前端开发者能理解的方式解释后端、LLM、Agent 概念。
3. 明确哪些必须现在做，哪些可以暂时不做。
4. 输出可以落地的文件级计划，而不是泛泛概念。
5. 对过度设计要直接纠偏，例如过早上 RAG、多 Agent、复杂框架。

## 5. 代码修改默认流程

修改代码时默认遵循：

1. 先阅读相关文件和项目规范。
2. 简短说明本次准备改哪些文件、为什么这样拆。
3. 小步修改，优先复用现有结构。
4. 修改后运行相关校验命令；如果无法运行，说明原因。
5. 总结变更、学习点、下一步。

不要把所有逻辑堆进单个文件。涉及前端或后端模块拆分时，优先使用项目 skill：

- `.claude/skills/modular-architecture-development/SKILL.md`
- `.claude/skills/web-frontend-development/SKILL.md`

## 6. Agent 项目实现优先级

当前项目优先级是跑通 AI SEO Agent 最小闭环：

```txt
用户输入页面主题 / 语言 / 关键词
  -> Vue 前端调用 Nest API
  -> Nest 后端组织 LLM 调用
  -> 模型返回结构化 SEO 结果
  -> 后端运行时校验
  -> 本地 SEO 工具检查
  -> 前端展示结果和检查状态
```

当前阶段不要优先做：

- 登录注册
- 数据库存储
- RAG
- 多 Agent 协作
- 外部搜索 API
- 复杂工作流引擎
- 过度 UI 装饰

除非用户明确要求，否则先保证最小产品闭环可运行。

## 7. 前端规则

处理 `apps/web` 时：

- 不要继续把 `App.vue` 做成巨型文件。
- 页面级组合可以放在 `views/`。
- 业务组件放在 `components/seo/`。
- 请求函数放在 `api/`。
- 组合式状态逻辑放在 `hooks/`。
- 业务类型放在 `types/`。
- 纯函数放在 `utils/`，导出函数写中文 TSDoc。

简单状态可以保留在页面中；一旦出现 loading、error、data、retry、reset、接口请求组合，就优先抽成 hook。

## 8. 后端规则

处理 `apps/api` 时：

- Controller 只处理 HTTP 入参和出参。
- Service 负责编排业务流程。
- LLMService 只封装模型调用。
- Tool 函数只做确定性本地计算或检查。
- DTO / 类型 / 校验不要散落在 Controller 中。
- API Key、模型名、base URL 等敏感或环境相关配置不得写死到前端或提交到仓库。

当前可以保持轻量，不要为了学习项目过早引入完整企业级后端架构。

## 9. 安全与提交规则

- 不提交 API Key、token、数据库密码、私有中转地址。
- 不执行破坏性命令，除非用户明确要求并说明风险。
- 不擅自大规模重构与当前任务无关的文件。
- 提交前说明实际改动和未验证项。

## 10. 输出风格

默认使用中文回答。解释技术方案时先讲整体思路，再讲具体实现。避免空泛鼓励，直接指出结构问题和阶段性取舍。
