# 腾讯云部署实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 AI-Mural 以单实例 Docker 服务部署到腾讯云，使前端、API、SQLite 和 DeepSeek 建议可通过 HTTPS 域名访问。

**Architecture:** 使用一台腾讯云 Lighthouse 或 CVM 运行现有 Docker 镜像，SQLite 数据保存在独立数据卷。Nginx 在主机上终止 HTTPS 并反向代理到仅绑定本机的应用端口；DeepSeek 密钥仅保存在服务器的 `.env` 文件中。

**Tech Stack:** 腾讯云 Lighthouse/CVM、Docker Compose、Nginx、Let's Encrypt、Node.js 24、SQLite、DeepSeek。

**Spec:** 用户请求：将项目推送到 `LiiiZnCu/-agent` 并部署到腾讯云，支持非本地调用。

## 全局约束

- 不修改现有 UI、交互方式、画布布局或业务功能。
- 只部署单实例；SQLite 不允许被多个应用实例共享。
- 仅开放 80 和 443 公网访问；22 端口限用户固定 IP。
- DeepSeek 密钥只存在服务器 `.env`，不进入 Git、镜像层、日志或浏览器。
- `CANVAS_RELAY_PUBLIC_URL` 必须为最终 HTTPS 域名。

## 审查重点

- 缺少 DeepSeek 配置时，容器必须明确失败而不是生成替代回复。
- 宿主机重启后，应用与 SQLite 数据卷必须保持可用。
- 反向代理必须保留 `Host`、`X-Forwarded-For` 与 `X-Forwarded-Proto`。
- 非 443/80/受限 22 端口不能被公网访问。
- 健康检查、首页与一次真实 AI 建议请求必须通过公网域名验证。

---

### Task 1: 完成腾讯云部署配置

**Files:**
- Modify: `deploy/docker-compose.host.yml`
- Create: `deploy/.env.example`
- Create: `deploy/nginx/aimural.conf.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: `Dockerfile` 提供的 5174 服务与 `/app/data` 持久化目录。
- Produces: 可由 `docker compose --env-file .env -f deploy/docker-compose.host.yml up -d --build` 启动的单实例服务。

- [ ] **Step 1: 写入仅含测试值的临时环境文件**

临时文件提供 `DEEPSEEK_API_KEY=test-key`、`DEEPSEEK_MODEL=test-model`、`CANVAS_RELAY_PUBLIC_URL=https://agent.example.com`，不使用真实密钥。

- [ ] **Step 2: 展开 Compose 配置，确认现有配置没有把模型变量传入容器**

Run: `docker compose --env-file 临时环境文件 -f deploy/docker-compose.host.yml config`

Expected: 展开结果缺少 `DEEPSEEK_MODEL: test-model`，从而证明当前容器不能接收模型配置。

- [ ] **Step 3: 最小化补齐 Compose、环境变量样例、Nginx 样例与部署说明**

Compose 仅接收环境变量，不复制 `.env`；Nginx 将 HTTPS 请求转发到 `127.0.0.1:46731`。


- [ ] **Step 4: 重新展开 Compose 配置并检查镜像构建**

Run: `docker compose --env-file 临时环境文件 -f deploy/docker-compose.host.yml config && docker build -t aimural:deploy-check .`

Expected: 配置可展开，镜像可构建，密钥不出现在输出中。

- [ ] **Step 5: 提交部署配置**

```bash
git add deploy README.md ARCHITECTURE.md CONTEXT.md
git commit -m "deploy: prepare Tencent Cloud runtime"
```

### Task 2: 在腾讯云单实例上线

**Files:**
- Create on server: `/opt/aimural/.env`
- Create on server: `/etc/nginx/sites-available/aimural`

**Interfaces:**
- Consumes: GitHub `LiiiZnCu/-agent` 的 `main` 分支、Task 1 的 Compose 文件、用户提供的域名及腾讯云服务器访问权限。
- Produces: 可公开访问的 HTTPS 地址与正常响应的 `/api/health`。

- [ ] **Step 1: 确认服务器、域名和安全组**

服务器为 Ubuntu 22.04/24.04、至少 2 核 4GB 和 40GB 磁盘；安全组只开放 80/443，22 仅限用户 IP；域名 A 记录已解析到服务器公网 IP。

- [ ] **Step 2: 在服务器写入仅本机可读的 `.env`**

包含 DeepSeek 配置、`CANVAS_RELAY_PUBLIC_URL=https://实际域名`，并设置文件权限为仅部署用户可读。

- [ ] **Step 3: 拉取代码、构建并启动单实例容器**

Run: `docker compose --env-file .env -f deploy/docker-compose.host.yml up -d --build`

Expected: 容器健康，SQLite 数据存在命名卷中。

- [ ] **Step 4: 配置 Nginx 与 HTTPS 证书**

反向代理到 `127.0.0.1:46731`，添加转发头，申请并安装实际域名的证书。

- [ ] **Step 5: 从公网验证**

Run: `curl -fsS https://实际域名/api/health`

Expected: 返回 `{ "ok": true }`；网页、分享链接和一次真实 AI 建议请求均成功。

### Task 3: 建立备份与交付记录

**Files:**
- Create on server: `/opt/aimural/backup.sh`
- Modify: `README.md`
- Modify: `CONTEXT.md`

**Interfaces:**
- Consumes: Task 2 的 Docker 卷与公网域名。
- Produces: SQLite 主文件、`-wal`、`-shm` 的可恢复备份及上线地址。

- [ ] **Step 1: 编写数据库备份脚本并在停写或 SQLite 在线备份模式下生成备份**

备份必须包含一致的数据快照，不能只复制主数据库文件。

- [ ] **Step 2: 执行一次恢复性检查**

Run: `sqlite3 备份文件 'PRAGMA integrity_check;'`

Expected: 返回 `ok`。

- [ ] **Step 3: 更新部署说明与项目进度并提交**

```bash
git add README.md CONTEXT.md
git commit -m "docs: record Tencent Cloud deployment"
```
