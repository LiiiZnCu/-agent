# 当前进度

- Cloudflare Worker + D1 迁移代码已完成：同源网页、API、D1 七张表、讨论/记录/托管白板存储、DeepSeek 严格校验和记录导出均已接入。
- 本机 SQLite 已只读导出到 `.work/aimural-d1-data.sql`：`brainstorm_sessions=2`，其余六张业务表为 `0`；源数据库及 WAL/SHM 未改动。
- 远端发布已完成：D1 ID 已写入 `wrangler.jsonc`，表结构和本机 2 条脑暴记录已导入，DeepSeek 密钥已写入 Cloudflare secret，Worker 已发布。
- 线上地址：`https://aimural-brainstorm.3414887923-35c.workers.dev`。当前网络对该 `workers.dev` 地址建立 HTTPS 连接失败，需换网络或配置自有域名复核访问。
- 已完成验证：Worker 测试 8 项通过；界面测试 195 项通过；导出工具测试 2 项通过；TypeScript 构建通过；本地 Worker 页面/API/深层链接冒烟通过。
- 关键决定：新讨论完全空白；成员身份来自真实输入；AI 只给待确认建议，不自动执行、切换阶段或决定结果。
- 关键决定：保留画布动作层、协作、记录与导出；白板和讨论共用历史及快照；线上讨论存入 D1 JSON 表。
- 关键决定：DeepSeek Key 和模型只在服务端显式配置；错误内容和配置直接报错；过时保存或建议回包必须拒绝。
- 关键决定：线上 Worker 不引用 Express、better-sqlite3 或 Node 文件系统；旧 `server/` 和 SQLite 只作迁移回归参考，不删除。
- 关键决定：DeepSeek Key 只通过 Cloudflare secret 注入；正式部署使用 D1 `441a8d75-3186-44a7-9448-052d37351d17`。
- 设计与实施状态见 `docs/superpowers/specs/2026-10-12-cloudflare-workers-d1-migration-design.md`、`docs/superpowers/plans/2026-10-12-cloudflare-workers-d1-migration.md` 和 `docs/cloudflare-deploy.md`。
