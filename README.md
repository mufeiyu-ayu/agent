# DeepSeek 最小调用示例

这个项目先保留最小结构，用 TypeScript 直接调用 DeepSeek 的 OpenAI 兼容 API。

## 快速开始

```sh
pnpm install
cp .env.example .env
pnpm dev
```

把 `.env` 里的 `DEEPSEEK_API_KEY` 替换成你自己的 DeepSeek API Key。

## 常用命令

```sh
pnpm dev
pnpm typecheck
pnpm lint
pnpm lint:fix
```

## 目录结构

```text
src/
  Index.ts
  services/
  utils/
  types/
docs/
  learning-log.md
```

## 当前阶段

当前先不引入 Agent 框架和复杂工作流，重点跑通 DeepSeek API 调用，并理解 `messages` 如何维护多轮对话上下文。学习过程记录在 `docs/learning-log.md`。
