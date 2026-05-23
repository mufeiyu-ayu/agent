# Agent DeepSeek 学习框架

这是一个用于学习 Agent 开发的 TypeScript 小框架。它先从 DeepSeek 的 OpenAI 兼容 API 调用开始，再逐步扩展到上下文管理、工具调用和 Agent loop。

## 快速开始

```sh
pnpm install
cp .env.example .env
pnpm dev
```

把 `.env` 里的 `DEEPSEEK_API_KEY` 替换成你自己的 API Key。

## 常用命令

```sh
pnpm example:basic
pnpm example:stream
pnpm example:tool
pnpm typecheck
pnpm lint
pnpm lint:fix
```

## 目录结构

```text
src/
  config.ts              # 环境变量读取与校验
  index.ts               # 默认入口，演示一个轻量 Agent 调用
  deepseek/
    client.ts            # DeepSeek OpenAI SDK client
    chat.ts              # Chat Completions 封装
    types.ts             # DeepSeek 扩展字段类型
  agent/
    memory.ts            # 多轮上下文容器
    runner.ts            # 简化 Agent loop
    tools.ts             # 本地工具定义与执行
  examples/
    01-basic-chat.ts     # 非流式基础调用
    02-stream-chat.ts    # 流式输出
    03-tool-call.ts      # 工具调用示例
```

## 关于 MOR 架构

当前阶段先不引入完整 MOR / 多角色架构。原因是学习 Agent 时，优先掌握模型调用、消息上下文、工具调用和循环控制更重要。

本项目已经预留了可演进位置：后续可以把 `agent/runner.ts` 拆成 planner、executor、critic 或多角色协作模块，而不需要重写 DeepSeek 调用层。
