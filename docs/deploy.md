# 部署与线上排查

给 AI 的部署与排查指南：线上是什么结构、怎么部署与回退、出了问题从哪查。只写现状，不记任务历史。

- 公开仓库：不写 IP、密钥文件名、密码、token、`.env` 的值。
- 操作服务器前读 `~/.agents/references/server-operations.md`，核对目标、命令、影响与恢复方式；按已有明确授权执行，范围未变不逐步重复确认。破坏性或授权范围外变更需具体授权；只读排查保持低开销、有界。结构变了（加容器、改编排、改 `.env` 的变量）同步改本文。
- 版本号、资源占用这类会变的数字以服务器上的实时结果为准，本文的是 2026-09-27 的基线。

## 服务器

- 腾讯云轻量，中国香港，2 核、7.5 GiB 内存、80 GB SSD；Ubuntu 24.04，`amd64`（本机 Mac 是 `arm64`，镜像要 `--platform linux/amd64`）。
- 连接：`ssh agent-hk`（别名、地址、私钥只在本机 `~/.ssh/config`），用户 `ubuntu`，有 sudo；SSH 失联时走腾讯云控制台的网页终端。
- 只开 22 / 80 / 443（腾讯云控制台防火墙，另放行 ICMP；`ufw` 不启用）。SSH 只允许密钥登录、禁止 root（`/etc/ssh/sshd_config.d/00-hardening.conf`）。
- Docker 来自官方 apt 源（含 compose 插件），`ubuntu` 在 `docker` 组。日志轮转在 `/etc/docker/daemon.json`：`json-file`，单容器 10 MB × 3 份，只对之后新建的容器生效。
- 宿主机时区 `Asia/Shanghai`。

## 线上结构

### 请求链路

```text
浏览器 ──443──> caddy（kuro-caddy-1：自动 HTTPS，只开 h1 / h2，http 永久跳转 https）
                  ├─ /          → 前台静态文件 /srv/web（SPA）
                  ├─ /admin/    → 管理台静态文件 /srv/admin（SPA）
                  └─ /api/*     → reverse_proxy api:3000（NDJSON 流逐块 flush；keepalive 4s，比 Node 的 5s 先关，否则 POST 会 502）
api（kuro-api-1：Nest，0.0.0.0:3000，不映射到宿主机）
  ├─ postgres:5432（kuro-postgres-1，只在 Docker 网络内）
  └─ 外网一律直连、不走代理：模型服务商、Google 登录、Serper、web_fetch 打开的网站
```

### 容器、网络与配置

| 项 | 内容 |
| --- | --- |
| compose 项目 | `kuro`；网络 `kuro_default`（bridge，只有 IPv4，`172.18.0.0/16`）；卷 `kuro_pgdata`（数据库）、`kuro_caddy-data`（证书）、`kuro_caddy-config` |
| 容器 | `kuro-caddy-1`（80 / 443 映射到宿主机）、`kuro-api-1`（Node 24，tini 做 PID 1）、`kuro-postgres-1`（pgvector 镜像，库 `agent`、用户 `agent`）；api 与 postgres 都不对外 |
| 镜像 | 在本机构建（`deploy/Dockerfile` 的 `api` / `caddy` 两个 target），标签是 commit 短哈希，经 ssh 直传，不用镜像仓库；`kuro-api` 约 620 MB、`kuro-caddy` 约 66 MB |
| api 的环境变量 | 只从 `~/kuro/.env` 读（`env_file`），再加 compose 里写死的 `DATABASE_URL`、`API_HOST=0.0.0.0`、`TRUST_PROXY=uniquelocal`（这三项不写进 `.env`）。线上 `.env` 应有的变量名：`AGENT_SECRET_KEY`、`APP_ORIGINS`、`GOOGLE_OAUTH_CLIENT_ID`、`GOOGLE_OAUTH_CLIENT_SECRET`、`POSTGRES_PASSWORD`；沙箱与工作文件要 8 个都配才提供代码工具：`E2B_API_KEY`、`E2B_API_URL`、`E2B_DOMAIN`、`E2B_TEMPLATE`、`OSS_ACCESS_KEY_ID`、`OSS_ACCESS_KEY_SECRET`、`OSS_BUCKET`、`OSS_REGION`。`OSS_WORKSPACE_GC_ENABLED` 不设即关闭对象回收，启用前按 [工作区 GC](../apps/api/src/workspaces/GC.md) 核定范围。当前应用已不读 `SERPER_API_KEY` 与 `AGENT_MAX_*`；但旧版本回退可能仍依赖它们，清理前核对保留的回退版本与看板决定，不能仅凭新代码不用就删除。新能力需要的其他变量按当前 `.env.example` 与对应模块核对 |
| 不能配的 | `OUTBOUND_PROXY_URL`：配了之后 `web_fetch` 由代理解析域名，连接时的 SSRF 检查失效 |
| 不能换的 | `AGENT_SECRET_KEY`：库里的服务商 API Key 与 Serper Key 用它加密，换掉就全部无法解密 |
| 模型服务商与模型 | 在库里，管理台「模型接入」配置，不在 `.env` |
| 运行配置 | 在库里，管理台「运行配置」配置：运行限制、调试抓取、联网搜索的 Serper API Key（库里只有密文，页面只显示尾四位）。Key 没填时搜索失败、对话照常；从 `.env` 迁过来时在这页重新填一次；旧 env Key 的清理需同时满足管理台已配置、回退版本不再依赖、用户已有对应清理授权 |

服务器 `~/kuro`：

| 文件 | 内容 |
| --- | --- |
| `.env` | 线上密钥，权限 600，只在服务器，不上传、不入库 |
| `compose.<版本>.yml` / `compose.yml` | 每个版本上传时的 `deploy/compose.yml`，切换与回退都用该版本自己的；`compose.yml` 是当前版本的副本，手工操作用 |
| `current` / `releases` | 当前版本；保留的版本与部署时间（北京时间，最近 5 个，与服务器上的镜像、编排一一对应） |
| `backups/` | 每次迁移前的 `pg_dump -Fc`，`<时间>-before-<版本>.dump`，部署成功后才轮转，保留最近 5 份 |

### 与本地开发的差异

| 项 | 本地 | 线上 |
| --- | --- | --- |
| 出站 | `.env` 配了 `OUTBOUND_PROXY_URL`（Clash），Google、Serper、`web_fetch` 走代理 | 直连 |
| 进程 | `pnpm dev`：tsc watch + `node --watch dist/main.js` | `node dist/main.js` |
| 时区 | 北京时间 | **容器是 UTC**（没设 `TZ`）：api 日志、库里的时间都比北京时间少 8 小时；caddy 日志的 `ts` 是 Unix 秒 |
| 数据库 | 容器 `agent-postgres`，库 `agent_ai_seo` | 容器 `kuro-postgres-1`，库 `agent` |
| IPv6 | 随本机网络 | Docker 网络只有 IPv4，只解析出 IPv6 地址的网站连不上 |

## 部署

- `pnpm ship`（在 master 上）：
  - 顺序：检查（工作区干净、与 `origin/master` 一致，`pnpm typecheck` / `lint` / `test` 通过）→ 构建两个镜像 → 直传 → 迁移前备份 → `prisma migrate deploy` → 换上新版本 → 健康检查 `https://askkuro.com/api/health` → 记录版本，删掉超出 5 个的旧镜像与编排、超出 5 份的备份。
  - 健康检查 90 秒内不通过、或换版本时容器启动报错，都会自动切回上一个版本并以非零退出。更早的步骤失败就停在那里，已在跑的版本不受影响（迁移已执行的除外）。
  - 当前已是这个版本时拒绝执行。
- 耗时约 5～6 分钟。最慢的是经 ssh 上传镜像，约 3～4 分钟（压缩后约 300 MB，家里上行约 1.5 MB/s）。上传慢不等于卡住：`nettop -p <ssh 进程号> -L 1 -x -J bytes_out` 看发送字节数还在不在涨。
- `pnpm ship --skip-checks`：跳过分支、远端同步与测试检查，只用于演练（如故障注入）；工作区仍须干净，保证镜像标签对应一个 commit。
- `pnpm ship:rollback`：列出保留的版本（`*` 为当前），回到上一个；`pnpm ship:rollback <版本>` 回到指定版本。**只回退代码（镜像与该版本的编排），不动数据库**，所以迁移要写成新旧代码都能运行的形式；回退后启动报错或健康检查不通过同样自动切回。
- 只改了 `.env`：在服务器上 `cd ~/kuro && export KURO_VERSION=$(cat current) && docker compose up -d` 让 api 重新读取（`pnpm ship` 不会重复部署当前版本）。

## 排查

### 日志

- `docker compose logs` 只看得到当前容器的日志：**每次 `pnpm ship` 都会重建 api 与 caddy 容器，旧日志随之消失**。更早的问题查库里的 Run / Step 记录（管理台 Run Trace）。
- api 日志是 Nest 默认格式，带 ANSI 颜色码；对象日志分多行打印。
- 工具执行失败的真实原因只写在日志里：事件 `tool_execution_failed`，带 `toolName`、`callId`、`errorName`、`message`，`callId` 与 Run Trace 里 tool Step 的一致。模型调用失败的类别在 Run 的 `errorCode`。

### 命令

```bash
ssh agent-hk
cd ~/kuro && export KURO_VERSION=$(cat current)           # 之后的 docker compose 命令都依赖它
cat current releases                                        # 当前版本与部署历史
docker compose ps
docker compose logs --since 30m --no-log-prefix api         # --since 按真实时间算，不受容器时区影响
docker compose logs --no-log-prefix api | grep -B3 -A4 <callId>   # 从 Run Trace 的 callId 找工具失败原因
curl -s https://askkuro.com/api/health
uptime; free -h; df -h /; docker stats --no-stream
[ -f /var/run/reboot-required ] && echo 需要重启 || echo 无需重启
# 只读查库（时间是 UTC）
docker compose exec -T postgres psql -U agent -d agent -c 'select id, status, "errorCode", "createdAt" from "AgentRun" order by "createdAt" desc limit 10'
```

资源基线：整机已用约 0.9 GiB 内存，三个容器常驻约 0.2 GiB（api 约 160 MiB）；磁盘用了 12%，Docker 镜像共约 3 GB，每份数据库备份不到 100 KB。

### 在线上容器里直接调用代码

要绕过模型、直接验证某段线上代码时（以 `web_fetch` 为例），可以在 api 容器里另起一个 node 进程，import `dist` 里的模块。这样不影响正在跑的服务，也不在服务器上留文件。脚本要从 stdin 读：`node -e` 的参数会被 worker 线程继承，`web_fetch` 的正文提取就会出错。

```bash
ssh agent-hk 'cd ~/kuro && export KURO_VERSION=$(cat current) && docker compose exec -T api node -' <<'EOF'
require('reflect-metadata')
;(async () => {
  const { WebFetchTool } = await import('/app/apps/api/dist/tools/web/web-fetch.tool.js')
  const tool = new WebFetchTool()
  for (const url of ['https://example.com/', 'http://postgres:5432/']) {
    try {
      const { modelContent } = await tool.execute({ toolName: 'web_fetch', input: { url } }, { signal: AbortSignal.timeout(15000), databaseDeadline: {} })
      console.log('OK ', url, modelContent.slice(0, 60))
    }
    catch (error) {
      console.log('ERR', url, error.message)
    }
  }
})()
EOF
```

## 常见操作

### 建管理员 / 重置管理员密码

账号已存在时重置它的密码，所以也用于找回管理员。密码交互输入，不进 shell 历史，也不出现在进程参数里：

```bash
ssh -t agent-hk
cd ~/kuro && export KURO_VERSION=$(cat current)
read -rsp '管理员密码：' ADMIN_PASSWORD && echo && export ADMIN_PASSWORD
docker compose exec -e ADMIN_EMAIL=<邮箱> -e ADMIN_PASSWORD api node dist/create-admin.js
```

### Google 登录核对

- 回调地址由 `APP_ORIGINS` 拼出，不读请求头里的 Host；`GOOGLE_OAUTH_CLIENT_ID` 与 `GOOGLE_OAUTH_CLIENT_SECRET` 缺一个时，Google 登录整体关闭（`/api/auth/google/*` 返回 404），其他功能不受影响。
- Google Cloud 项目 `kuro`，OAuth 客户端类型是「Web 应用」，受众「外部」且已发布，只用 `openid email profile`。报 `redirect_uri_mismatch` 或 One Tap 来源错误时，核对客户端登记的地址：
  - 重定向 URI：`https://askkuro.com/api/auth/google/callback`、`http://localhost:5173/api/auth/google/callback`、`http://localhost:5174/api/auth/google/callback`；
  - JavaScript 来源（One Tap 要用）：`https://askkuro.com`、`http://localhost:5173`、`http://localhost:5174`。
- 陌生 Google 账号登录后是「待审核」，需要管理员在管理台「系统管理 → 用户列表」通过。用户说登不进去时先查这里。

### 数据库手动恢复

**还原会丢失备份之后写入的全部数据，每次都要用户确认后再执行。** 备份 `<时间>-before-<版本>.dump` 是部署该版本、执行迁移之前的库。

**数据库备份不等于完整工作区文件备份。** OSS 引用回收后，旧数据库中的 Source/Artifact 指针可能已不存在，需要重新生成文件和构建，不能保证完整工作区恢复或用户历史回滚。恢复前先停写与暂停自动 GC，核对 Bucket、持久清理目标及上传未知记录；不要把旧备份覆盖后的引用当作仍有效文件。回收启用/维护与故障核查见 [工作区 GC](../apps/api/src/workspaces/GC.md)：先 migration、停止旧 API、核定清理范围后才设 `OSS_WORKSPACE_GC_ENABLED=true`，默认不删除既有对象。

```bash
ssh agent-hk
cd ~/kuro && export KURO_VERSION=$(cat current)
ls -lt backups/
# 1. 先把当前库再备一份（放在 backups/ 外，不参与自动清理；确认不需要后手动删）
docker compose exec -T postgres pg_dump -U agent -d agent -Fc > before-restore-$(date +%Y%m%d-%H%M%S).dump
# 2. 停 api，避免还原期间写入
docker compose stop api
# 3. 还原（--clean 先删再建库内对象）
docker compose exec -T postgres pg_restore -U agent -d agent --clean --if-exists --no-owner < backups/<文件>.dump
# 4. 库结构回到了备份时刻：当前版本比备份新时，重新执行迁移；或先 pnpm ship:rollback 回到备份时的版本
docker compose run --rm --no-deps -w /app api node_modules/.bin/prisma migrate deploy
docker compose start api
```

要撤销这次还原，把第 3 步的文件换成第 1 步生成的 `before-restore-*.dump` 再执行一遍即可。

### 从零重建服务器

新机器装好 Docker 并配好 `ssh agent-hk` 之后：

1. 写日志轮转：`ssh agent-hk 'printf "%s\n" "{\"log-driver\": \"json-file\", \"log-opts\": {\"max-size\": \"10m\", \"max-file\": \"3\"}}" | sudo tee /etc/docker/daemon.json && sudo systemctl restart docker'`。
2. 在服务器上生成 `.env`。值在服务器上随机生成，不经过本机；`.env` 已存在就不覆盖：
   ```bash
   ssh agent-hk 'mkdir -p ~/kuro && cd ~/kuro && test ! -e .env && umask 077 && printf "POSTGRES_PASSWORD=%s\nAGENT_SECRET_KEY=%s\nAPP_ORIGINS=https://askkuro.com\n" "$(openssl rand -hex 24)" "$(openssl rand -hex 32)" > .env && ls -l .env'
   ```
   其余变量（Google 登录）照「容器、网络与配置」表里的变量名，用编辑器在服务器上补上。
3. 在 master 上 `pnpm ship`（首次会拉 Postgres 镜像、申请证书，稍慢）；再建管理员，登录 `https://askkuro.com/admin/`，在「模型接入」配置服务商与模型，在「运行配置」填 Serper API Key。
