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

使用 Node.js 24 和 pnpm。

```bash
pnpm install
pnpm dev
```

`pnpm dev` 同时启动前端和 API。打开 Vite 输出的地址，通常为 `http://localhost:5173`；API 默认在 `http://localhost:5174`，开发环境将 `/api` 转发到该地址。

## DeepSeek 服务端配置

```bash
cp .env.example .env
```

在 `.env` 中填写自己的密钥和模型名称。该文件已排除出 Git；示例文件没有真实密钥。

| 变量 | 要求 |
| --- | --- |
| `DEEPSEEK_API_KEY` | 必填，仅由服务端读取 |
| `DEEPSEEK_MODEL` | 必填，填写账户可用的模型名称；没有默认替代模型 |
| `DEEPSEEK_BASE_URL` | 可选，默认 `https://api.deepseek.com`；可使用兼容服务的基础地址 |

`pnpm dev`、`pnpm dev:server` 和 `pnpm start` 会在本地自动读取 `.env`。部署环境请通过进程管理器或容器环境变量提供同名变量。不要将密钥写进浏览器代码或以 `VITE_` 命名。没有 Key、缺少或错误的模型配置、上游 HTTP 错误、非 JSON 内容和非法动作都会明确报错。

## 构建与部署

```bash
pnpm build
pnpm start
```

启动前将服务端环境变量加载到进程。Express 同时提供 `dist/` 中的前端页面和 `/api` 接口，默认监听 5174 端口；部署需保留服务端及其引用的 `src/lib` 共享校验源码，不能只上传 `dist/`。

| 变量 | 作用 |
| --- | --- |
| `CANVAS_RELAY_PORT` | API 和生产网页的监听端口，默认 5174 |
| `CANVAS_RELAY_DB_PATH` | SQLite 文件位置，默认 `data/canvas-relay.sqlite` |
| `CANVAS_RELAY_PUBLIC_URL` | 对外访问域名，用于生成协作链接 |

通过反向代理把访问域名转发到应用端口，并保留 SQLite 数据目录。容器配置在 `Dockerfile` 和 `deploy/docker-compose.host.yml`。

### 腾讯云单机部署

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
| `pnpm test` | 运行领域、组件、持久化、建议校验和 HTTP 接口测试 |
| `pnpm build` | 检查 TypeScript 并构建前端 |
| `pnpm lint` | 检查源码 |
| `pnpm dev:web` | 单独启动前端 |
| `pnpm dev:server` | 单独启动 API |
| `pnpm preview` | 预览构建后的前端，API 需单独运行 |

HTTP 接口测试需要绑定本机端口。测试样本只放在测试文件中；测试不会使用真实 DeepSeek Key。

## 技术架构

React 和 TypeScript 管理讨论界面，React Flow 显示白板。`src/App.tsx` 统一画布与讨论操作及历史；`src/lib` 提供领域模型、校验、建议执行和本地保存。Express 提供 API，通过 Drizzle 读写 SQLite，并用服务端原生 fetch 调用 DeepSeek。模块职责和调用关系见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

浏览器先保存本地快照，托管协作通过 API 同步。讨论使用独立的 `brainstorm_sessions` 表，保留原有白板和记录表。分享链接携带访问能力，托管讨论读写和 AI 请求都必须通过同一能力检查。

## 搜索记录

| 来源 | 借鉴 | 不采纳 |
| --- | --- | --- |
| [skills.sh：brainstorm](https://www.skills.sh/shhac/skills/brainstorm) | 明确目标和限制，先发散再收敛，由参与者选择方案 | 不把通用提问流程变成强制阶段锁定或自动决策 |
| [Iamwangli/agent-canvas](https://github.com/Iamwangli/agent-canvas) | React Flow 的关系表达、来源追溯和多成员思考上下文 | 不迁移整套产品，不采用模型自动分支或自动创建节点 |
| [nicklyuu/ai-whiteboard](https://github.com/nicklyuu/ai-whiteboard) | 白板与侧栏共同工作，使用当前画布构成 AI 上下文 | 不采用自动清空白板、跳过人工确认执行或清洗猜测错误 JSON |

## 已完成与待办

| 项目 | 当前状态 |
| --- | --- |
| Task 1：空白讨论和领域模型 | 已完成 |
| Task 2：人工工作区、阶段、成员、方案、决策与成果 | 已完成 |
| Task 3：localStorage 与 SQLite 讨论持久化 | 已完成 |
| Task 4：DeepSeek 服务端适配与严格校验 | 已完成 |
| Task 5：建议展示、确认、编辑、忽略、暂停和撤销 | 已完成 |
| Task 6：文档 | 已完成 |
| Task 7：末轮修复 | 已完成：Docker 运行依赖、默认成员、中文界面与本地环境加载均已核验 |

进度与关键决定见 [CONTEXT.md](./CONTEXT.md)，实施步骤见 [实施计划](./docs/superpowers/plans/2026-10-10-multiplayer-brainstorm-agent.md)。

## 许可

MIT，见 [LICENSE](./LICENSE)。
