# AI-Mural

AI-Mural 是一个通用的多人协作头脑风暴 Agent。成员在同一块白板上提出观点、整理关系、讨论方案并确认成果；AI 根据当前真实内容提出建议，成员确认后才会执行。

## 从空白讨论开始

首次打开时填写话题、目标、背景、限制条件和成员昵称。话题、目标和昵称必填，背景与限制可留空。创建后得到空白白板，成员和观点由参与者添加，不预置主题、案例或 AI 回复。

| 阶段 | 成员可以做什么 |
| --- | --- |
| 想法收集 | 添加观点、问题、风险、补充信息和候选方案 |
| 智能归类 | 选择观点，整理分类并保留原始来源 |
| 引导扩散 | 请求帮助，继续提问和补充不同思路 |
| 整合方案 | 选中至少两条观点，请求有来源的组合方案 |
| 协同优化 | 编辑候选方案，添加支持、反对、补充、风险和待验证意见 |
| 辅助决策 | 人工设置标准与权重，填写评分理由并投票 |
| 成果输出 | 编辑草稿、选择最终方案、人工确认后导出讨论成果 |

成员可以手动切换或返回任一阶段，已有内容会保留。观点记录作者、时间、版本和来源；少数意见和风险也会保留。

## AI 建议

通过“需要帮助”“智能归类选中观点”或“整合选中观点”主动请求建议。请求前会保存当前讨论，服务端读取真实讨论和白板内容，再调用 DeepSeek。

建议会进入待确认列表，可以接受、编辑、忽略、稍后处理，或暂停当前阶段。接受后可撤销 AI 动作；如果相关内容已被成员修改，系统会明确拒绝冲突撤销。当前阶段忽略的动作类型不会重复显示。

允许的建议只有分类、连线、提问、整合候选方案、创建比较矩阵和生成成果草稿。服务端严格检查字段和真实观点 ID；请求期间内容变化或访问能力失效时拒绝旧结果。AI 不直接写数据库、改白板、切换阶段或确认最终结果。

## 保留的功能

| 功能 | 内容 |
| --- | --- |
| 白板 | React Flow 无限画布，卡片、拖拽、缩放、连线、分类、图层、撤销与重做 |
| 协作 | 本地多标签同步、托管分享链接、独立访问能力和成员来源 |
| 结构化内容 | 表格、矩阵、卡片和清单，支持读取与编辑数据 |
| 讨论记录 | 参与者、公开发言、回复、画布动作、检查点和回放 |
| 导出 | 原始白板 JSON、记录 JSON/Markdown/CSV，以及人工确认后的讨论成果 |
| 保存 | 浏览器 localStorage 保存本地快照；服务端 SQLite 保存讨论、托管白板和记录 |
| 浏览器 Agent | 已有 WebMCP 工具继续共用白板动作层，在支持该接口的浏览器中使用 |

普通人工白板流程可在本地使用。AI 请求需要可用服务端及 DeepSeek 配置；未连接或未配置时会显示失败，不生成替代回复。

## 本地运行

使用 Node.js 24 和 pnpm。公开运行目标是 Cloudflare Worker + D1。

```bash
pnpm install
pnpm dev
```

`pnpm dev` 启动 Cloudflare Vite 开发环境，网页和 `/api` 使用同一个本地 Worker 地址。旧 Express 服务仍可用 `pnpm dev:server` 单独回归，但不是新的发布入口。

## DeepSeek 服务端配置

```bash
cp .env.example .env
```

本地 Worker 使用未提交的 `.dev.vars` 或 `.env`；在 Cloudflare 上使用 Worker secret。两个文件都已排除出 Git；示例文件没有真实密钥。

| 变量 | 要求 |
| --- | --- |
| `DEEPSEEK_API_KEY` | 必填，仅由服务端读取 |
| `DEEPSEEK_MODEL` | 必填，填写账户可用的模型名称；没有默认替代模型 |
| `DEEPSEEK_BASE_URL` | 可选，默认 `https://api.deepseek.com`；可使用兼容服务的基础地址 |

旧 Express 的 `pnpm dev:server` 和 `pnpm start` 会读取 `.env`；Cloudflare Worker 的发布密钥通过 `wrangler secret put DEEPSEEK_API_KEY` 写入。不要将密钥写进浏览器代码或以 `VITE_` 命名。没有 Key、缺少或错误的模型配置、上游 HTTP 错误、非 JSON 内容和非法动作都会明确报错。

## 构建与部署

> 当前正在迁移至 Cloudflare Workers + D1，设计见 `docs/superpowers/specs/2026-10-12-cloudflare-workers-d1-migration-design.md`。以下腾讯云步骤仅适用于迁移前的 Express + SQLite 版本，不作为新的上线方案。

当前部署方式、迁移顺序和远端核对命令见 [Cloudflare 部署手册](./docs/cloudflare-deploy.md)。核心命令：

```bash
pnpm build
pnpm db:migrate:remote
pnpm deploy
```

部署前必须把 `wrangler.jsonc` 中的 D1 占位 ID 换成真实 ID，并先完成 Cloudflare 登录、数据导入和 Worker secret 配置。旧 Express 配置只用于迁移前回归，不作为线上方案。

| 变量 | 作用 |
| --- | --- |
| `CANVAS_RELAY_PORT` | API 和生产网页的监听端口，默认 5174 |
| `CANVAS_RELAY_DB_PATH` | SQLite 文件位置，默认 `data/canvas-relay.sqlite` |
| `CANVAS_RELAY_PUBLIC_URL` | 对外访问域名，用于生成协作链接 |

通过反向代理把访问域名转发到应用端口，并保留 SQLite 数据目录。容器配置在 `Dockerfile` 和 `deploy/docker-compose.host.yml`。

### 腾讯云单机部署（迁移前留档）

以下步骤只保留给仍需运行旧 Express + SQLite 的场景；新部署不要再按此方案开服务器。

使用一台 Ubuntu 22.04/24.04 的腾讯云 Lighthouse 或 CVM（建议至少 2 核、4GB 内存、40GB 磁盘）。SQLite 只支持单实例运行；不要用多个容器或多台服务器同时访问同一数据卷。

1. 在腾讯云安全组中仅开放公网 `80`、`443`；将 `22` 限制为自己的固定 IP。
2. 将域名 A 记录指向服务器公网 IP。
3. 在服务器的 `/opt/aimural` 克隆仓库，将 `deploy/.env.example` 复制为 `.env`，填写真实的 DeepSeek 配置与最终 HTTPS 域名，再执行 `chmod 600 .env`。不要将本机 `.env` 上传或提交到 Git。
4. 在 `/opt/aimural` 执行：

   ```bash
   docker compose --env-file .env -f deploy/docker-compose.host.yml up -d --build
   ```

5. 将 `deploy/nginx/aimural.conf.example` 复制到 Nginx 站点目录，替换示例域名并启用站点；先确认 HTTP 代理可用，再执行 `certbot --nginx -d 你的域名 --redirect` 签发证书并启用 HTTPS。
6. 通过 `https://你的域名/api/health` 检查服务；返回 `{"ok":true}` 后，再从网页请求一次 AI 建议。

应用容器只绑定服务器本机的 `46731` 端口，公网请求必须经 Nginx 的 80/443 端口进入。SQLite 数据保存在 Docker 命名卷 `aimural_data` 中；迁移或备份时必须一并处理数据库的 `-wal` 和 `-shm` 文件，不能只复制主数据库文件。

## 测试与常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm test` | 运行界面测试和 Worker/D1 测试 |
| `pnpm run test:node` | 运行旧 Express/SQLite 与导出工具测试 |
| `pnpm build` | 检查 TypeScript 并构建 Worker 与前端 |
| `pnpm smoke:worker` | 检查本地或远端 Worker 的健康接口、首页和深层链接 |
| `pnpm export:d1-data data/canvas-relay.sqlite .work/aimural-d1-data.sql` | 只读导出本机 SQLite 数据 |
| `pnpm db:migrate:local` | 应用本地 D1 迁移 |
| `pnpm db:migrate:remote` | 应用远端 D1 迁移 |
| `pnpm deploy` | 发布 Worker 和静态资源 |
| `pnpm lint` | 检查源码 |
| `pnpm dev:server` | 单独启动旧 Express API，迁移回归用 |
| `pnpm preview` | 预览构建后的 Worker 与静态资源 |

Worker 测试使用本地隔离 D1；旧 Node 测试仍使用临时 SQLite。迁移前的 Docker/Express 运行布局测试保留在 `server/runtime-layout.test.ts`，不纳入新的 Worker 发布回归。测试样本只放在测试文件中；测试不会请求真实 DeepSeek。

## 技术架构

React 和 TypeScript 管理讨论界面，React Flow 显示白板。`src/App.tsx` 统一画布与讨论操作及历史；`src/lib` 提供领域模型、校验、建议执行和本地保存。Cloudflare Worker 提供同源 API，通过 Drizzle D1 读写七张业务表，并用 Worker 原生 fetch 调用 DeepSeek；旧 Express + SQLite 只作迁移回归。模块职责和调用关系见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

浏览器先保存本地快照，托管协作通过 Worker API 同步。D1 的 `brainstorm_sessions` 表保留两条本机已有讨论，其他白板和记录表继续使用原协议。分享链接携带访问能力，托管讨论读写和 AI 请求都必须通过同一能力检查。

## 搜索记录

| 来源 | 借鉴 | 不采纳 |
| --- | --- | --- |
| [skills.sh：brainstorm](https://www.skills.sh/shhac/skills/brainstorm) | 明确目标和限制，先发散再收敛，由参与者选择方案 | 不把通用提问流程变成强制阶段锁定或自动决策 |
| [Iamwangli/agent-canvas](https://github.com/Iamwangli/agent-canvas) | React Flow 的关系表达、来源追溯和多成员思考上下文 | 不迁移整套产品，不采用模型自动分支或自动创建节点 |
| [nicklyuu/ai-whiteboard](https://github.com/nicklyuu/ai-whiteboard) | 白板与侧栏共同工作，使用当前画布构成 AI 上下文 | 不采用自动清空白板、跳过人工确认执行或清洗猜测错误 JSON |
| [Cloudflare React + Vite 官方模板](https://github.com/cloudflare/templates/tree/main/templates/react-starter-template) 与 [Workers Vite 插件](https://developers.cloudflare.com/workers/vite-plugin/tutorial/) | 单个 Worker 同时提供 React 静态资源和同源 API，适配现有 Vite 项目 | 不拆分为 Pages 前端和独立 API，避免跨域与双部署 |
| [Cloudflare D1 导入导出](https://developers.cloudflare.com/d1/best-practices/import-export-data/) | 本机 SQLite 先转 SQL 再导入 D1，并在迁移后核对数据 | 不直接上传原始 SQLite 文件，也不删除本机数据库 |

## 已完成与待办

| 项目 | 当前状态 |
| --- | --- |
| 原有头脑风暴、协作和记录功能 | 已完成并保留 |
| Cloudflare Worker 基础运行环境 | 已完成，本地健康检查和 SPA 回退通过 |
| D1 七张表与讨论/记录/托管存储 | 已完成，Worker 测试通过 |
| Worker API、DeepSeek 严格校验与导出 | 已完成，Worker 测试通过 |
| 本机 SQLite 只读导出 | 已完成，当前导出 2 条讨论、其余表 0 条 |
| Cloudflare 远端发布 | 已完成，地址为 `https://aimural-brainstorm.3414887923-35c.workers.dev`；当前网络对 workers.dev 的 HTTPS 检查失败 |

进度与关键决定见 [CONTEXT.md](./CONTEXT.md)，实施步骤见 [Cloudflare 实施计划](./docs/superpowers/plans/2026-10-12-cloudflare-workers-d1-migration.md)。

## 许可

MIT，见 [LICENSE](./LICENSE)。
