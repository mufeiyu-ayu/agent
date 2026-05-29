---
name: update-agent-learning-log
description: 更新 Agent 应用开发学习日志。Use only when the user asks to 更新学习日志、记录 Agent 学习、写学习复盘、总结 Agent 学习阶段, or when a task explicitly teaches/practices Agent concepts such as LLM API calls, messages, prompt design, JSON Output, streaming, tool calling, context management, memory, evaluation, safety, or Agent observability.
---

# 更新 Agent 学习日志

## 概述

维护项目内的 `docs/learning-log.md`，让 Agent 应用开发学习过程可追踪、可复盘。这个 skill 只关注 Agent 概念学习，不记录普通项目进度、默认工程搭建、UI 调整、依赖安装或提交上下文。

`docs/work-log.md` 记录项目推进和 commit 上下文；不要把这些内容混进 `docs/learning-log.md`。

## 默认流程

1. 先确认当前工作目录是否为本项目根目录或其子目录；如果不是，先定位当前项目根目录和 `docs/learning-log.md`。
2. 读取项目 `AGENTS.md`、`CLAUDE.md`、已有 `docs/learning-log.md`、`git status --short`，并按需要读取本次涉及的 Agent 相关关键文件。
3. 先判断是否应该更新本日志。只有以下情况才更新：
   - 用户明确要求记录 Agent 学习、学习复盘或当前学习阶段。
   - 本次任务实际学习或练习了 Agent 概念，例如 LLM API 调用、`messages`、prompt、JSON Output、streaming、Tool Calling、上下文管理、记忆、评估、安全边界、Agent 可观测性。
   - 本次排查的是 Agent 链路问题，例如模型参数、模型返回格式、tool arguments、流式中断、上下文组织、token/cost 控制。
4. 以下情况默认不更新 `docs/learning-log.md`，除非用户明确要求并且内容能提炼出 Agent 学习点：
   - 普通业务功能开发、页面调整、样式调整、组件拆分。
   - Nest/Vue/Vite/pnpm 默认工程搭建、依赖安装、lint/typecheck/build 配置。
   - middleware、pipe、filter、interceptor 等通用后端基础设施，除非它们直接服务于 Agent 调试链路并且用户正在学习该 Agent 相关边界。
   - commit、工作记录、项目管理、AI 编程助手迁移规范、skill 元数据维护。
5. 更新 `docs/learning-log.md`：
   - 如果文件不存在，创建包含“学习路线看板”“日志记录”“记录规则”的最小模板。
   - 只在有实质 Agent 学习进展时，在“日志记录”表格追加一行。
   - 如果学习阶段状态变化，同步更新“学习路线看板”。
6. 更新后做轻量自审，确认记录具体、真实、可复盘，没有泄露敏感信息，也没有混入普通项目进度。

## 表格字段

“日志记录”表格使用这些字段：

- `日期`：使用 `YYYY-MM-DD`。
- `阶段`：写学习阶段，不写空泛标题。
- `本次学习`：说明本次理解或练习了哪个 Agent 概念。
- `Agent 关键概念`：写本次真正涉及的 Agent 概念。
- `练习入口 / 材料`：写最小练习代码、官方文档或讨论材料；不要写普通业务改动清单。
- `理解验证`：写概念验证方式、运行结果或用户澄清后的正确理解；不要写普通提交验证流水账。
- `复盘`：一句话说明这次学习的关键理解。
- `下一步`：写一个具体、可执行的下一步。

## 记录原则

- 用简体中文记录。
- 只记录真实发生的 Agent 学习，不替用户补不存在的学习结论。
- 优先写“Agent 概念如何通过最小练习验证”，不要写空泛心得。
- 可以记录支撑 Agent 学习的代码入口，但不要把项目进度、提交内容或默认工程配置当成学习记录。
- 小任务可以一行记录；复杂任务可以在表格外新增简短小节，但不要把日志写成日报。
- 不记录 API Key、token、密码、私有服务密钥、完整报错中的敏感字段。
- 如果本次只是普通问答或普通代码改动，默认不更新；只有用户明确要求记录 Agent 学习时才追加。

## 推荐记录粒度

一条记录应能回答这些问题：

- 今天学到了哪个 Agent 概念？
- 这个概念解决什么问题？
- 通过哪个最小练习、官方材料或关键代码入口验证了理解？
- 哪个结果能证明理解是对的？
- 下一步应该练什么？

## 输出方式

完成更新后，简短告诉用户新增或修改了哪条记录，并给出 `docs/learning-log.md` 的位置。只有在用户要求时才粘贴完整日志内容。
