# 部署与服务器

公开仓库：不写 IP、密钥名、密码、token、`.env` 内容。服务器变更先说明命令、影响、回滚并经用户确认，做完回写本文。

## 服务器

- 腾讯云轻量，中国香港，2 核 8G、80G SSD；Ubuntu 24.04，`amd64`（本机 Mac 是 `arm64`，镜像须 `--platform linux/amd64`）。
- 连接：`ssh agent-hk`（别名、IP、私钥只在本机 `~/.ssh/config`）；用户 `ubuntu`，有 sudo。
- SSH 失联时：腾讯云控制台「登录」走网页终端。
- 状态：#197 起用 `pnpm ship` 部署，线上 `https://askkuro.com`（管理台 `/admin/`）；服务器文件在 `~/kuro`，见下文「部署」。

## 已有配置

| 项 | 内容 | 回滚 |
| --- | --- | --- |
| SSH | `/etc/ssh/sshd_config.d/00-hardening.conf`：仅密钥登录、禁 root 登录 | 删文件，`sudo systemctl reload ssh` |
| Docker | 官方 apt 源的 docker-ce + compose 插件，开机自启；`ubuntu` 在 `docker` 组 | `apt purge` 相关包，删 `/etc/apt/sources.list.d/docker.list` |
| 防火墙 | 腾讯云控制台放行 TCP 22 / 80 / 443 与 ICMP；`ufw` 不启用 | 控制台增删规则 |
| Docker 日志轮转 | `/etc/docker/daemon.json`：`json-file`，单容器 10MB × 3 份；只对之后新建的容器生效 | 删文件，`sudo systemctl restart docker` |
| 时区 | `Asia/Shanghai`（`sudo timedatectl set-timezone Asia/Shanghai`；购买时已是） | `sudo timedatectl set-timezone <原时区>` |
| 应用目录 | `~/kuro`：`compose.yml`、`.env`（600）、`current`、`releases`、`backups/`，见「部署」 | — |

## 常用命令

```bash
ssh agent-hk 'uptime; free -h; df -h /'
ssh agent-hk 'docker ps'
ssh agent-hk 'docker logs --tail 200 <容器名>'
ssh agent-hk '[ -f /var/run/reboot-required ] && echo 需要重启 || echo 无需重启'
```

## 部署

三个容器：`caddy`（80 / 443，自动 HTTPS，`/` 前台、`/admin/` 管理台、`/api/` 反代）、`api`、`postgres`（只在 Docker 网络内）。镜像在本机构建（`deploy/Dockerfile`，`linux/amd64`，标签是 commit 短哈希），经 ssh 直传，不用镜像仓库。

服务器 `~/kuro`：

| 文件 | 内容 |
| --- | --- |
| `compose.<版本>.yml` / `compose.yml` | 每个版本上传时的 `deploy/compose.yml`，切换与回退都用该版本自己的；`compose.yml` 是当前版本的副本，手工操作用 |
| `.env` | 线上密钥，权限 600，只在服务器，不上传、不入库 |
| `current` / `releases` | 当前版本；保留的版本与部署时间（最近 5 个，与服务器上的镜像、编排一一对应） |
| `backups/` | 每次迁移前的 `pg_dump -Fc`，文件名 `<时间>-before-<版本>.dump`；部署成功后才轮转，保留最近 5 份 |

### 首次部署

1. 服务器 Docker 日志轮转（上表，只需一次）：

   ```bash
   ssh agent-hk 'printf "%s\n" "{\"log-driver\": \"json-file\", \"log-opts\": {\"max-size\": \"10m\", \"max-file\": \"3\"}}" | sudo tee /etc/docker/daemon.json && sudo systemctl restart docker'
   ```

2. 在服务器上生成 `.env`（值在服务器上随机生成，不经过本机；已存在就不覆盖：换掉 `AGENT_SECRET_KEY` 会让库里的服务商密钥全部无法解密）：

   ```bash
   ssh agent-hk 'mkdir -p ~/kuro && cd ~/kuro && test ! -e .env && umask 077 && printf "POSTGRES_PASSWORD=%s\nAGENT_SECRET_KEY=%s\nAPP_ORIGINS=https://askkuro.com\n" "$(openssl rand -hex 24)" "$(openssl rand -hex 32)" > .env && ls -l .env'
   ```

   其余可选变量（`AGENT_*`、`OUTBOUND_PROXY_URL` 等）按 `.env.example` 追加到这个文件，改完在服务器上 `cd ~/kuro && export KURO_VERSION=$(cat current) && docker compose up -d` 生效（`pnpm ship` 拒绝重复部署当前版本）。`API_HOST`、`TRUST_PROXY`、`DATABASE_URL` 由 `compose.yml` 设置，不写进 `.env`。

3. 在 master 上执行 `pnpm ship`。首次会拉 Postgres 镜像、申请证书，稍慢。

4. 建首个管理员（交互输入密码，不进 shell 历史）：

   ```bash
   ssh -t agent-hk
   cd ~/kuro && export KURO_VERSION=$(cat current)
   read -rsp '管理员密码：' ADMIN_PASSWORD && echo && export ADMIN_PASSWORD
   # -e 只写变量名：值从环境里取，不出现在进程参数里
   docker compose exec -e ADMIN_EMAIL=<邮箱> -e ADMIN_PASSWORD api node dist/create-admin.js
   ```

5. 登录 `https://askkuro.com/admin/`，在「模型接入」配置服务商与模型。

### Google 登录

Google 侧（项目 `kuro`，与 gsc 的项目分开）已按 #198 配好，换项目或重建客户端时照此操作：

1. Google Cloud「Google Auth Platform」：Branding 填应用名、首页 `https://askkuro.com`、授权域 `askkuro.com`、隐私政策 `https://askkuro.com/privacy`；受众选「外部」并发布为正式版（只用 `openid email profile`，不需要审核，不受 100 个测试用户上限限制）。
2. 「客户端」新建「Web 应用」类型的 OAuth 客户端：
   - 已获授权的重定向 URI：`https://askkuro.com/api/auth/google/callback`、`http://localhost:5173/api/auth/google/callback`、`http://localhost:5174/api/auth/google/callback`；
   - 已获授权的 JavaScript 来源（One Tap 要用）：`https://askkuro.com`、`http://localhost:5173`、`http://localhost:5174`。
3. 客户端 ID 与密钥只写进 `.env`：本机是仓库根 `.env`，线上是服务器 `~/kuro/.env`（`GOOGLE_OAUTH_CLIENT_ID=`、`GOOGLE_OAUTH_CLIENT_SECRET=` 两行，用编辑器在服务器上填，不经 shell 历史），再按上文让 api 重新读取 `.env`。两项缺一项时 Google 登录整体关闭，其他功能不受影响。
4. 陌生 Google 账号登录后是「待审核」，管理员在管理台「系统管理 → 用户列表」按状态筛选后通过或拒绝。

回调地址由 `APP_ORIGINS` 拼出，不读请求头里的 Host；本机开发访问 Google 走 `OUTBOUND_PROXY_URL`，线上直连。

### 日常

- `pnpm ship`：检查（在 master、工作区干净、与 `origin/master` 一致，`pnpm typecheck` / `lint` / `test` 通过）→ 构建两个镜像 → 直传 → 迁移前备份 → `prisma migrate deploy` → 换上新版本 → 健康检查 `https://askkuro.com/api/health`（90 秒内不通过就自动切回上一个版本并以非零退出）→ 记录版本，删掉超出 5 个的旧镜像与编排、超出 5 份的备份。换版本时容器启动报错同样自动切回；更早的步骤失败就停在那里，已在跑的版本不受影响（迁移已执行的除外）。当前已是这个版本时拒绝执行。
- `pnpm ship --skip-checks`：跳过分支、远端同步与测试检查，只用于演练（如故障注入）；工作区仍须干净，保证镜像标签对应一个 commit。
- `pnpm ship:rollback`：列出保留的版本（`*` 为当前），回到上一个；`pnpm ship:rollback <版本>` 回到指定版本。**只回退代码（镜像与该版本的编排），不动数据库**，所以迁移要写成新旧代码都能运行的形式。回退后启动报错或健康检查不通过同样自动切回。
- 服务器上手工看状态：`cd ~/kuro && export KURO_VERSION=$(cat current)`，再 `docker compose ps`、`docker compose logs --tail 200 api`。

### 数据库手动恢复

**还原会丢失备份之后写入的全部数据，每次都要用户确认后再执行。** 备份 `<时间>-before-<版本>.dump` 是部署该版本、执行迁移之前的库。

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

还原到第 1 步的备份，把上面第 3 步的文件换成 `before-restore-*.dump` 即可。
