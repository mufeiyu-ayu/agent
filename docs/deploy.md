# 部署与服务器

公开仓库：不写 IP、密钥名、密码、token、`.env` 内容。服务器变更先说明命令、影响、回滚并经用户确认，做完回写本文。

## 服务器

- 腾讯云轻量，中国香港，2 核 8G、80G SSD；Ubuntu 24.04，`amd64`（本机 Mac 是 `arm64`，镜像须 `--platform linux/amd64`）。
- 连接：`ssh agent-hk`（别名、IP、私钥只在本机 `~/.ssh/config`）；用户 `ubuntu`，有 sudo。
- SSH 失联时：腾讯云控制台「登录」走网页终端。
- 状态：未部署服务；#195 登录做完、部署 Issue 完成后上线。

## 已有配置

| 项 | 内容 | 回滚 |
| --- | --- | --- |
| SSH | `/etc/ssh/sshd_config.d/00-hardening.conf`：仅密钥登录、禁 root 登录 | 删文件，`sudo systemctl reload ssh` |
| Docker | 官方 apt 源的 docker-ce + compose 插件，开机自启；`ubuntu` 在 `docker` 组 | `apt purge` 相关包，删 `/etc/apt/sources.list.d/docker.list` |
| 防火墙 | 腾讯云控制台放行 TCP 22 / 80 / 443 与 ICMP；`ufw` 不启用 | 控制台增删规则 |

## 常用命令

```bash
ssh agent-hk 'uptime; free -h; df -h /'
ssh agent-hk 'docker ps'
ssh agent-hk 'docker logs --tail 200 <容器名>'
ssh agent-hk '[ -f /var/run/reboot-required ] && echo 需要重启 || echo 无需重启'
```

## 部署

部署 Issue 完成后补。
