# 部署与服务器运维

工作台的线上服务器怎么登录、做过什么、日常怎么操作。服务器上的每次变更都回写到本文（初始化记录或部署记录），先写清命令、影响和回滚，再执行。

本仓库是公开仓库：**本文不写服务器 IP、密钥名、密码、token 或任何 `.env` 内容**。IP 与私钥只在维护者本机（`~/.ssh/config` 与 `~/.ssh/` 下的私钥文件）。

## 1. 服务器概况

| 项 | 值 |
| --- | --- |
| 厂商与规格 | 腾讯云轻量应用服务器，中国香港，锐驰型 2 核 8G、80G SSD、200M 峰值带宽、不限流量 |
| 系统与架构 | Ubuntu 24.04 LTS，`amd64`（维护者的 Mac 是 `arm64`，构建镜像要指定 `linux/amd64`） |
| 登录用户 | `ubuntu`（有 sudo；root 禁止直接登录） |
| 选型理由 | 连 Google 不用代理、免备案、国内可直连；见 Claude Docs《Agent 产品方案》部署一节 |
| 当前状态 | 已初始化，**未部署任何服务**：第一期登录（后端鉴权）做完前不上线，避免无鉴权 API 暴露在公网 |

## 2. 登录

维护者本机 `~/.ssh/config` 有别名 `agent-hk`（HostName、User、IdentityFile 都在本机配置里，不入库）：

```bash
ssh agent-hk                 # 交互登录
ssh agent-hk '<命令>'         # 远程执行一条命令
```

- 只能用密钥登录，密码登录已关闭。私钥丢失时，在腾讯云控制台为实例重新绑定密钥，或用控制台「登录」进网页终端处理。
- 被锁在外面（改坏 SSH 配置等）时：控制台「登录」走网页终端，不依赖 SSH。

## 3. 初始化记录（2026-09-27）

| 项 | 做了什么 | 回滚 |
| --- | --- | --- |
| SSH 加固 | 新建 `/etc/ssh/sshd_config.d/00-hardening.conf`：`PasswordAuthentication no`、`KbdInteractiveAuthentication no`、`PermitRootLogin no`；`sudo sshd -t` 校验后 `sudo systemctl reload ssh`。文件名以 `00-` 开头，优先于镜像自带的 `50-cloud-init.conf`（sshd 取第一次出现的值） | 删除该文件后 `sudo systemctl reload ssh` |
| 系统更新 | `sudo apt-get update && sudo apt-get upgrade -y`，之后在控制台重启一次 | 不回滚 |
| Docker | 按 Docker 官方 apt 源安装 `docker-ce`、`docker-compose-plugin` 等，开机自启；`ubuntu` 加入 `docker` 组（免 sudo） | `sudo apt-get purge docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin`，删除 `/etc/apt/sources.list.d/docker.list` |
| 云防火墙 | 腾讯云控制台只放行 TCP 22、80、443 与 ICMP；系统内 `ufw` 不启用，避免两层规则 | 控制台防火墙页增删规则 |

## 4. 常用操作

只读、低开销的检查放心用；会改变状态的操作（重启服务或主机、删除数据、改配置）先写清影响与回滚，再执行。

```bash
# 资源与负载
ssh agent-hk 'uptime; free -h; df -h /'

# 容器状态与日志（部署后）
ssh agent-hk 'docker ps'
ssh agent-hk 'docker logs --tail 200 <容器名>'

# SSH 策略是否仍然生效
ssh agent-hk "sudo sshd -T | grep -Ei '^(passwordauthentication|permitrootlogin) '"

# 系统更新后是否需要重启
ssh agent-hk '[ -f /var/run/reboot-required ] && echo 需要重启 || echo 无需重启'
```

服务器不是临时工作区：不留调试脚本、下载包、测试镜像；为验证拉取的镜像用完即删（如 `docker rmi hello-world`）。

## 5. 部署（待第一期部署 Issue 补全）

部署做完后在这里补：镜像怎么构建与传到服务器、生产 compose 与 Caddy 配置放哪、环境变量怎么放（服务器本地文件，不入库）、首次部署与更新的命令、数据库备份与回滚方式。部署时一并配置的两项已定：Docker 日志轮转（`/etc/docker/daemon.json` 限制单容器日志大小与份数）、系统时区改为 `Asia/Shanghai`。
