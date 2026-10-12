# Cloudflare 部署手册

当前方案是一个 Cloudflare Worker + D1。网页和 `/api` 共用同一个 Worker，DeepSeek 密钥只放 Cloudflare secret。本手册不会删除本机 SQLite；导入前会先生成只读 SQL 文件。

## 1. 本地先验证

```bash
pnpm install
pnpm test
pnpm run test:node
pnpm build
pnpm db:migrate:local
pnpm export:d1-data data/canvas-relay.sqlite .work/aimural-d1-data.sql
wrangler d1 execute aimural-brainstorm --local --file=.work/aimural-d1-data.sql
```

启动本地 Worker 后检查页面、健康接口和深层链接：

```bash
wrangler dev --local --port 8787
# 另开终端
pnpm smoke:worker
```

看到 `Worker 冒烟检查通过` 后，用 `Ctrl+C` 停止本地 Worker。当前本机源数据库核对结果应为：`brainstorm_sessions=2`，其他六张业务表为 `0`。

## 2. 创建远端 D1

先完成 Cloudflare 登录：

```bash
wrangler login
wrangler d1 create aimural-brainstorm
```

把命令返回的真实 `database_id` 写入 `wrangler.jsonc` 的 `d1_databases[0].database_id`。不要保留全零占位 ID，也不要把账号令牌写入仓库。

## 3. 迁移表结构和已有数据

确认 `wrangler.jsonc` 已写入真实 ID 后执行：

```bash
pnpm db:migrate:remote
pnpm export:d1-data data/canvas-relay.sqlite .work/aimural-d1-data.sql
wrangler d1 execute aimural-brainstorm --remote --file=.work/aimural-d1-data.sql
```

导入后核对七张表：

```bash
wrangler d1 execute aimural-brainstorm --remote --command "SELECT 'sessions' AS table_name, COUNT(*) AS count FROM sessions UNION ALL SELECT 'participants', COUNT(*) FROM participants UNION ALL SELECT 'events', COUNT(*) FROM events UNION ALL SELECT 'murals', COUNT(*) FROM murals UNION ALL SELECT 'mural_invites', COUNT(*) FROM mural_invites UNION ALL SELECT 'mural_focus_claims', COUNT(*) FROM mural_focus_claims UNION ALL SELECT 'brainstorm_sessions', COUNT(*) FROM brainstorm_sessions;"
wrangler d1 execute aimural-brainstorm --remote --command "SELECT id, board_id, updated_at FROM brainstorm_sessions ORDER BY updated_at;"
```

预期是两条 `brainstorm_sessions`，其余六张表为零。若计数不符，停止发布并先检查导入文件，不要删除远端数据或本机源文件。

## 4. 配置 DeepSeek

模型和基础地址在 `wrangler.jsonc` 的 `vars` 中；密钥用交互式命令写入，不会出现在命令历史参数中：

```bash
wrangler secret put DEEPSEEK_API_KEY
```

按提示粘贴密钥后回车。不要把密钥写进 `wrangler.jsonc`、`.env`、`.dev.vars`、前端代码或 SQL 导出文件。

## 5. 发布和验收

```bash
pnpm build
pnpm deploy
```

记录 `wrangler deploy` 输出的公开 Worker 地址，然后执行：

```bash
SMOKE_URL=https://你的-worker-地址 pnpm smoke:worker
curl -sS https://你的-worker-地址/api/health
```

健康接口必须返回 `{"ok":true,"storage":"d1"}`。再用网页打开两个迁入讨论，确认内容和白板完整；最后在网页发起一次 AI 建议，确认返回的是严格的 `message + actions`，而不是替代文本。

## 6. 后续更新

以后新增表结构只追加新的 `migrations/` 文件，再执行：

```bash
pnpm db:migrate:local
pnpm test
pnpm build
pnpm db:migrate:remote
pnpm deploy
```

本机 `data/canvas-relay.sqlite`、`-wal`、`-shm` 持续保留，除非另行确认备份和删除方案。
