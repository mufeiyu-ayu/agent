# 线上两个镜像共用这份构建，由 pnpm ship 调用（上下文是仓库根目录）：
#   docker build --platform linux/amd64 -f deploy/Dockerfile --target api|caddy .
# api：Nest 产物 + 生产依赖（含迁移用的 Prisma CLI）；caddy：前台 / 管理台静态文件 + HTTPS 反代。

# 编译在本机架构上跑（产物与平台无关），省掉 amd64 模拟下的 install 与构建耗时。
FROM --platform=$BUILDPLATFORM node:24-bookworm-slim AS build
ENV CI=true
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
COPY packages/agent/package.json packages/agent/
COPY packages/ai/package.json packages/ai/
COPY packages/contracts/package.json packages/contracts/
RUN pnpm install --frozen-lockfile
COPY . .
# api 的 prebuild 先生成 Prisma client、构建 contracts、ai 与 agent，前台与管理台的构建依赖 contracts 的 dist。
RUN pnpm --filter @agent/api build \
  && pnpm --filter @agent/web build \
  && pnpm --filter @agent/admin build

FROM node:24-bookworm-slim AS api
ENV CI=true NODE_ENV=production
# Prisma 的 schema engine 靠 openssl 识别平台。
RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY packages/agent/package.json packages/agent/
COPY packages/ai/package.json packages/ai/
COPY packages/contracts/package.json packages/contracts/
# prisma CLI 与 dotenv 已作为 @prisma/client 的 peer 依赖装进来（版本同锁文件）；提升到根目录，
# 迁移时 /app/prisma.config.ts 才解析得到。prisma --version 顺带下载本平台的 schema engine。
RUN pnpm install --prod --frozen-lockfile --filter @agent/api... --shamefully-hoist \
  && node_modules/.bin/prisma --version \
  && pnpm store prune && rm -rf /root/.cache
COPY prisma.config.ts ./
COPY prisma/schema.prisma prisma/
COPY prisma/migrations prisma/migrations/
COPY --from=build /app/packages/contracts/dist packages/contracts/dist/
COPY --from=build /app/packages/ai/dist packages/ai/dist/
COPY --from=build /app/packages/agent/dist packages/agent/dist/
COPY --from=build /app/apps/api/dist apps/api/dist/
WORKDIR /app/apps/api
USER node
EXPOSE 3000
CMD ["node", "dist/main.js"]

FROM caddy:2.11-alpine AS caddy
COPY deploy/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv/web/
COPY --from=build /app/apps/admin/dist /srv/admin/
