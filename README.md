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
```

## 当前阶段

当前先不引入 Agent 框架和 MOR 架构，只跑通一次 DeepSeek API 调用。等 API Key、模型名和请求参数确认没问题后，再拆出配置、上下文、工具调用和 Agent loop。
