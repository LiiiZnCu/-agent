# Cloudflare Workers 与 D1 迁移实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 将现有 AI-Mural 完整迁移为一个 Cloudflare Worker 和 D1 数据库，并安全导入已有讨论数据。

**架构：** React 前端和 `/api` 接口由同一 Worker 提供；D1 代替本机 SQLite。Worker 路由调用按职责拆开的存储模块，所有存储模块只依赖显式传入的 D1 绑定。旧 `server/` 代码及本机数据暂时保留，不删除。

**技术栈：** React 19、Vite、Cloudflare Vite 插件、Workers、D1、Drizzle D1 驱动、Vitest Worker 运行环境。

**设计说明：** `docs/superpowers/specs/2026-10-12-cloudflare-workers-d1-migration-design.md`

## 全局约束

- 界面、现有 16 个 API 路径、请求体、访问能力令牌和业务行为保持不变。
- 生产 Worker 不得引用 Express、`better-sqlite3`、Node 文件系统、Node 加密或本机端口。
- DeepSeek 密钥只通过 Cloudflare secret 或未提交的本地 `.dev.vars` 传入；缺失或非法配置必须直接报错。
- 本机 `data/canvas-relay.sqlite`、`-wal`、`-shm` 不删除、不覆盖；当前 2 条 `brainstorm_sessions` 必须迁入 D1。
- 继续保留旧 `server/` 目录和旧测试，直到远端验证完成并得到单独的删除确认。
- 保留当前未跟踪的 `pnpm-lock.yaml` 和 `pnpm-workspace.yaml`；使用现有 pnpm 环境安装依赖时允许 pnpm 更新锁文件，但不删除或手工重写这些既有文件。

## 重点复核

- 旧版本讨论保存到 D1 时必须返回冲突，不能覆盖更新版本；由任务 3 的 API 测试覆盖。
- 错误或过期的访问令牌不得读取、修改或导出托管白板；由任务 4 的授权测试覆盖。
- DeepSeek 密钥缺失、上游 HTTP 失败和非法 JSON 必须明确失败，不能生成替代建议；由任务 5 的建议测试覆盖。
- 含引号、换行和 Unicode 的数据库文本必须完整导出为可执行 SQL；由任务 6 的导出测试覆盖。
- 从网页深层链接进入时必须返回 React 页面，`/api/*` 未知路径仍返回 JSON 404；由任务 5 的 Worker 路由测试覆盖。

---

## 文件结构

| 路径 | 责任 |
| --- | --- |
| `worker/index.ts` | Worker 默认导出，接收 Cloudflare 的 `fetch` 事件。 |
| `worker/app.ts` | 路由所有 API 并将非 API 请求交给静态资源绑定。 |
| `worker/env.ts` | 定义 D1、静态资源及 DeepSeek 环境契约。 |
| `worker/schema.ts` | 沿用现有七张 SQLite 表的 Drizzle 声明。 |
| `worker/db.ts` | 用 `env.DB` 构造 Drizzle D1 数据库。 |
| `worker/brainstorm-store.ts` | 异步保存、读取和版本检查讨论快照。 |
| `worker/recording-store.ts` | 原子保存、读取、列表及删除活动记录。 |
| `worker/hosted-store.ts` | 托管白板、令牌、邀请及焦点锁。 |
| `worker/crypto.ts` | 用 Web Crypto 生成、哈希和比较令牌。 |
| `worker/deepseek.ts`、`worker/agent-actions.ts`、`worker/export.ts` | 严格校验建议、请求 DeepSeek、导出记录。 |
| `migrations/0001_initial_schema.sql` | D1 的完整首版表和索引。 |
| `scripts/export-local-sqlite-data.mts` | 将本机 SQLite 的数据安全输出为 D1 导入 SQL。 |
| `wrangler.jsonc`、`vite.config.ts`、`tsconfig.worker.json` | Worker、D1、静态资源和类型配置。 |
| `vitest.worker.config.ts`、`worker/**/*.test.ts` | 在本地 Workers 运行环境中测试 D1 与 API。 |

### Task 1：Cloudflare 基础运行环境

**文件：**

- 新建：`wrangler.jsonc`、`worker/env.ts`、`worker/index.ts`、`worker/app.ts`、`tsconfig.worker.json`、`vitest.worker.config.ts`、`worker/index.test.ts`
- 修改：`package.json`、`package-lock.json`、`vite.config.ts`、`tsconfig.json`

**接口：**

- 产出：`handleRequest(request: Request, env: Env): Promise<Response>`，由后续 API 路由复用。
- 产出：默认 Worker `fetch(request, env): Promise<Response>`。

- [ ] **步骤 1：配置 Workers 测试运行环境**

新增独立的 Worker Vitest 配置，使用 `@cloudflare/vitest-plugin` 和本地 D1 绑定；保留现有前端测试运行方式。新增 `test:worker`，将总测试脚本改为先跑前端测试、再跑 Worker 测试。

- [ ] **步骤 2：编写失败的健康检查测试**

在 `worker/index.test.ts` 中通过 `SELF.fetch('https://example.test/api/health')` 断言 HTTP 200 和 JSON `{ ok: true, storage: 'd1' }`。

- [ ] **步骤 3：运行测试并确认因 Worker 尚不存在而失败**

运行：`npm run test:worker -- worker/index.test.ts`

预期：失败原因是缺少 Worker 入口或健康检查路由，而不是测试环境错误。

- [ ] **步骤 4：实现最小 Worker 与构建配置**

安装 `@cloudflare/vite-plugin`、`wrangler` 和 `@cloudflare/vitest-plugin`。在 `wrangler.jsonc` 声明 `DB` D1 绑定、`ASSETS` 静态资源和 `migrations` 路径；使用不可部署的数据库 ID 占位符，并让部署命令在占位符未替换时失败。`vite.config.ts` 在 React 插件后加入 Cloudflare 插件。`handleRequest` 此时只实现健康检查及 JSON 响应，`worker/index.ts` 调用它。

- [ ] **步骤 5：运行健康检查和前端测试**

运行：`npm run test:worker -- worker/index.test.ts && npm run test:ui`

预期：通过；原有前端测试不受 Worker 配置影响。

- [ ] **步骤 6：提交本任务**

```bash
git add package.json package-lock.json vite.config.ts tsconfig.json tsconfig.worker.json wrangler.jsonc vitest.worker.config.ts worker
git commit -m "feat: add Cloudflare Worker runtime"
```

### Task 2：D1 表结构与讨论存储

**文件：**

- 新建：`migrations/0001_initial_schema.sql`、`worker/schema.ts`、`worker/db.ts`、`worker/brainstorm-store.ts`、`worker/brainstorm-store.test.ts`
- 修改：`worker/app.ts`、`worker/env.ts`

**接口：**

- 消费：任务 1 的 `Env` 与 `handleRequest`。
- 产出：`createDatabase(database: D1Database)`；`createBrainstormStore(db)`，其 `save(input)`、`get(id)`、`getByBoardId(boardId)` 全部返回 Promise。

- [ ] **步骤 1：编写讨论存储的失败测试**

使用测试 D1 和真实 `StoredBrainstorm` 样本，断言保存后可读取；以更早 `updatedAt` 再次保存断言返回 `BrainstormWriteConflictError`；改变同一讨论的 `boardId` 也必须返回同一错误。

- [ ] **步骤 2：运行测试并确认因迁移和存储实现缺失而失败**

运行：`npm run test:worker -- worker/brainstorm-store.test.ts`

预期：失败原因是表或 `createBrainstormStore` 不存在。

- [ ] **步骤 3：实现 D1 迁移与异步讨论存储**

把当前 `server/db.ts` 最终表结构和索引固化到 `0001_initial_schema.sql`，不保留运行时 `CREATE TABLE` 或 `ALTER TABLE`。用 `drizzle-orm/d1` 创建数据库；迁移 `server/schema.ts` 与 `server/brainstorm-store.ts`，将查询改为异步 D1 查询。公开保存路由调用新存储，并维持当前的 400、404、409 响应语义。

- [ ] **步骤 4：运行讨论存储和路由测试**

运行：`npm run test:worker -- worker/brainstorm-store.test.ts worker/index.test.ts`

预期：通过，D1 迁移在隔离测试数据库中自动生效。

- [ ] **步骤 5：提交本任务**

```bash
git add migrations worker/schema.ts worker/db.ts worker/brainstorm-store.ts worker/brainstorm-store.test.ts worker/app.ts worker/env.ts
git commit -m "feat: store brainstorm sessions in D1"
```

### Task 3：活动记录与托管白板 D1 存储

**文件：**

- 新建：`worker/recording-store.ts`、`worker/hosted-store.ts`、`worker/crypto.ts`、`worker/recording-store.test.ts`、`worker/hosted-store.test.ts`
- 修改：`worker/app.ts`

**接口：**

- 消费：任务 2 的 `createDatabase` 和 D1 表结构。
- 产出：`createRecordingStore(db)` 与 `createHostedStore(db, crypto)`；二者的所有 I/O 均为 Promise。
- 产出：`createToken(): string`、`hashToken(value: string): Promise<string>`、`sameTokenHash(left: string, right: string): boolean`。

- [ ] **步骤 1：编写记录和托管白板的失败测试**

记录测试保存一个含两位成员和两条事件的会话，断言按序读取、删除后不存在。托管测试创建白板、用所有者令牌生成用户分享、创建及兑换邀请；用错误令牌读取或写入应返回拒绝。焦点锁冲突与释放也必须覆盖。

- [ ] **步骤 2：运行测试并确认因存储模块缺失而失败**

运行：`npm run test:worker -- worker/recording-store.test.ts worker/hosted-store.test.ts`

预期：失败原因是新存储或 Web Crypto 模块不存在。

- [ ] **步骤 3：实现异步 D1 存储与 Web Crypto**

移植 `server/store.ts` 和 `server/hosted.ts` 的业务规则。保存记录时将会话、成员和事件写入一个 Drizzle D1 `batch()`；邀请、焦点锁、权限和修订检查保持同样的数据约束。以 Worker `crypto` 取代 `node:crypto` 和 `Buffer`，不得引入 `nodejs_compat`。

- [ ] **步骤 4：接入全部托管及记录路由并运行测试**

在 `worker/app.ts` 接入 `/api/murals*` 与 `/api/sessions*` 的现有接口，运行：`npm run test:worker -- worker/recording-store.test.ts worker/hosted-store.test.ts worker/index.test.ts`

预期：通过；错误令牌、焦点冲突及事件顺序都被保留。

- [ ] **步骤 5：提交本任务**

```bash
git add worker/recording-store.ts worker/hosted-store.ts worker/crypto.ts worker/recording-store.test.ts worker/hosted-store.test.ts worker/app.ts
git commit -m "feat: migrate hosted collaboration storage to D1"
```

### Task 4：建议、导出与完整 API 路由

**文件：**

- 新建：`worker/agent-actions.ts`、`worker/deepseek.ts`、`worker/export.ts`、`worker/api.test.ts`
- 修改：`worker/app.ts`、`worker/env.ts`

**接口：**

- 消费：任务 2 的讨论存储、任务 3 的记录和托管存储。
- 产出：`requestDeepSeekSuggestions(context, request, env, fetcher = fetch)`；`toMarkdown(stored)` 和 `toCsv(stored)`。

- [ ] **步骤 1：编写失败的 API 回归测试**

测试 PUT/GET 讨论、过期版本冲突、三种记录导出格式、未知 `/api` 路径的 JSON 404、深层网页路径的静态资源响应。对 DeepSeek 的真实外部请求注入唯一的测试 `fetcher`，分别断言缺密钥 503、上游 502、非法 JSON 校验错误，以及有效建议被严格校验后返回。

- [ ] **步骤 2：运行测试并确认因建议、导出和完整路由缺失而失败**

运行：`npm run test:worker -- worker/api.test.ts`

预期：失败原因是路由或模块尚未实现。

- [ ] **步骤 3：实现 Worker 版建议、导出与路由**

移植现有严格动作校验、DeepSeek 请求和三种导出。`worker/app.ts` 匹配全部现有 `/api` 路径，先处理 API，再将非 API 请求交给 `env.ASSETS.fetch(request)`；API 异常统一输出 JSON，保留既有状态码和中文错误语义。DeepSeek 只从 `env` 读取配置。

- [ ] **步骤 4：运行完整 Worker API 测试**

运行：`npm run test:worker`

预期：通过；每个 API 类别、AI 失败路径和 SPA 深层路由均可验证。

- [ ] **步骤 5：提交本任务**

```bash
git add worker/agent-actions.ts worker/deepseek.ts worker/export.ts worker/api.test.ts worker/app.ts worker/env.ts
git commit -m "feat: serve collaboration API from Cloudflare Worker"
```

### Task 5：本机 SQLite 数据导出工具

**文件：**

- 新建：`scripts/export-local-sqlite-data.mts`、`scripts/export-local-sqlite-data.test.ts`
- 修改：`.gitignore`、`package.json`、`package-lock.json`

**接口：**

- 消费：现有只读 SQLite 文件路径和可选输出 SQL 文件路径。
- 产出：`exportD1Data(sourcePath: string, outputPath: string): Promise<ExportSummary>`，其中 `ExportSummary.counts` 是七张业务表的记录数。

- [ ] **步骤 1：编写失败的导出工具测试**

在临时 SQLite 数据库写入包含单引号、换行和中文的讨论内容，运行 `exportD1Data` 后断言 SQL 只有按外键顺序的 `INSERT`，没有 `CREATE`、`BEGIN`、`COMMIT` 或密钥，且记录计数正确。为缺少业务表与非法参数各写一个明确失败测试。

- [ ] **步骤 2：运行测试并确认因导出函数不存在而失败**

运行：`npm run test:node -- scripts/export-local-sqlite-data.test.ts`

预期：失败原因是缺少 `exportD1Data`。

- [ ] **步骤 3：实现只读导出工具**

将 `better-sqlite3` 移入开发依赖，只允许该脚本以只读方式打开数据库，并按 `sessions → participants → events → murals → mural_invites → mural_focus_claims → brainstorm_sessions` 输出 UTF-8 数据 SQL。字符串使用 SQLite 单引号转义，表名和字段名固定在代码中；输出目录加入 `.gitignore`，脚本绝不删除、覆盖源数据库或写出秘密。

- [ ] **步骤 4：运行导出工具测试并生成待核对的导入文件**

运行：`npm run test:node -- scripts/export-local-sqlite-data.test.ts && npm run export:d1-data -- data/canvas-relay.sqlite .work/aimural-d1-data.sql`

预期：测试通过；命令显示 `brainstorm_sessions: 2`，其余业务表为 `0`。

- [ ] **步骤 5：提交本任务**

```bash
git add scripts .gitignore package.json package-lock.json
git commit -m "feat: add safe D1 data export"
```

### Task 6：发布准备、文档与最终验证

**文件：**

- 修改：`README.md`、`ARCHITECTURE.md`、`CONTEXT.md`、`docs/superpowers/specs/2026-10-12-cloudflare-workers-d1-migration-design.md`
- 新建：`docs/cloudflare-deploy.md`

**接口：**

- 消费：任务 1 至 5 的 Worker、迁移、导出工具和测试结果。
- 产出：可逐条执行的 Cloudflare 登录、创建 D1、迁移、导入、密钥配置、发布和核对说明。

- [ ] **步骤 1：编写失败的构建和静态资源冒烟检查**

新增构建后检查：使用 `wrangler dev --local` 启动 Worker，访问 `/api/health`、`/` 和任意深层网页地址；断言 API 返回 JSON、页面请求返回 HTML。

- [ ] **步骤 2：运行检查并确认当前未完成的静态资源整合会失败**

运行：`npm run build && npm run smoke:worker`

预期：若静态资源绑定或 SPA 回退没有接好，检查明确失败。

- [ ] **步骤 3：补齐发布命令和中文文档**

新增 `db:migrate:local`、`db:migrate:remote`、`deploy` 和 `smoke:worker` 命令。文档要求先由用户登录 Cloudflare，再创建名为 `aimural-brainstorm` 的 D1 数据库，把实际 ID 填入 `wrangler.jsonc`，执行远端迁移、导入 `.work/aimural-d1-data.sql`、通过交互式 `wrangler secret put DEEPSEEK_API_KEY` 设置密钥、设置模型配置并发布。文档明确列出远端表计数与两条讨论读取核对步骤。

- [ ] **步骤 4：运行所有本地验证**

运行：`npm test && npm run build && npm run smoke:worker`

预期：全部通过；旧 `server/` 测试可作为独立回归参考，但不参与新 Worker 发布判断。

- [ ] **步骤 5：完成 Cloudflare 远端发布与验收**

在用户登录授权后依次执行 D1 创建、远端迁移、数据导入、DeepSeek 密钥设置和 `npm run deploy`。检查公开 Worker 地址的 `/api/health`，读取迁入的两条讨论，再请求一次真实 AI 建议。

- [ ] **步骤 6：提交本任务**

```bash
git add README.md ARCHITECTURE.md CONTEXT.md docs/cloudflare-deploy.md docs/superpowers/specs/2026-10-12-cloudflare-workers-d1-migration-design.md package.json package-lock.json
git commit -m "docs: prepare Cloudflare deployment"
```

## 自查结果

- 设计中的 Worker、D1、静态资源、令牌安全、DeepSeek、数据导入和远端验收均有对应任务；无遗漏。
- 所有后续任务只使用前序任务已定义的 `Env`、`handleRequest`、存储工厂和导出函数；接口名称一致。
- 五项高风险输入均有明确的归属测试。
- 未包含代码实现正文；每个步骤均可单独验证。
