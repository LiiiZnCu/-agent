# 多人协作头脑风暴 Agent 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**目标：** 将 AI-Mural 改造为从空白讨论启动、由人确认 AI 建议的通用多人头脑风暴 Agent。

**架构：** 保留现有画布 action layer 和同步机制。新增独立的头脑风暴领域模型、本地/SQLite 持久化、DeepSeek 服务端适配及动作校验；前端以覆盖层和侧栏接入，不重写白板。

**技术栈：** React、TypeScript、React Flow、Express、Drizzle/SQLite、Vitest。

**设计：** `docs/superpowers/specs/2026-10-10-multiplayer-brainstorm-agent-design.md`

## 全局限制

- 产品必须从空白讨论开始，不得包含默认主题、观点、成员、AI 回复或演示入口。
- 仅服务端读取 DeepSeek 环境变量；无 Key 必须清楚报错，禁止模拟返回。
- AI 只能生成建议；校验、展示和用户确认后才可通过既有 action layer 修改画布。
- 保留冲突、未归类观点、少数意见和方案来源；AI 不得自动删除、合并、切换阶段或决定结果。
- 验证命令固定为 `pnpm test`、`pnpm build`。

## 审查重点

- 缺少 API Key 时，任何普通白板操作仍可完成且 AI 请求显式失败。
- 模型引用不存在、跨讨论或重复的观点 ID 时，服务端必须拒绝。
- 忽略或暂停的建议不能在当前阶段再次自动出现。
- 候选方案始终可回溯到人写的来源观点和作者。
- 未确认最终结果时，不得导出讨论成果。

---

### Task 1: 空白讨论和领域模型

**文件：** `src/types.ts`、`src/lib/brainstorm.ts`、`src/lib/brainstorm.test.ts`、`src/data.ts`、`src/App.tsx`

- [x] 写入空讨论、任意主题、阶段跳转、观点元数据和建议状态的失败测试。
- [x] 实现可序列化的 `BrainstormSession`、成员、观点、建议、候选方案、决策和成果类型，以及创建/更新纯函数。
- [x] 删除演示快照与演示恢复入口，首次加载改为未创建讨论状态。
- [x] 接入创建讨论表单、当前成员和阶段状态；创建后生成空白 board。
- [x] 运行 `pnpm test`，确认领域与现有测试均通过。

### Task 2: 前端工作区与人工控制

**文件：** `src/components/DiscussionSetup.tsx`、`src/components/BrainstormPanel.tsx`、`src/components/StageNavigator.tsx`、`src/components/ToolRail.tsx`、`src/components/Inspector.tsx`、`src/App.tsx`、`src/index.css`

- [x] 写入创建空白讨论、显示作者、手动添加观点/问题/风险/补充、七阶段导航、暂停/忽略/撤销建议的失败组件测试。
- [x] 在不改动画布的前提下增加创建表单、阶段导航和讨论/AI 侧栏。
- [x] 扩展工具栏和检查器，记录/显示观点作者、类型、时间、版本和来源。
- [x] 实现候选方案、评论分类、少数意见、决策标准/评分、可编辑输出和确认后导出控制。
- [x] 运行 `pnpm test`，确认界面与领域测试通过。

### Task 3: 讨论持久化与 SQLite

**文件：** `src/lib/brainstorm-storage.ts`、`src/lib/api.ts`、`server/schema.ts`、`server/brainstorm-store.ts`、`server/index.ts`、`src/lib/brainstorm-storage.test.ts`

- [x] 写入本地序列化、SQLite 读写和无效讨论 payload 拒绝的失败测试。
- [x] 实现本地讨论读写，并让 board 快照和讨论 ID 一起保存。
- [x] 增加 SQLite JSON 表和对应的读写模块，不触碰现有 mural/trace 数据结构。
- [x] 增加受现有 mural 能力保护的讨论读取/保存端点；离线时维持本地流程。
- [x] 运行 `pnpm test`，确认持久化相关测试通过。

### Task 4: DeepSeek 适配与严格动作校验

**文件：** `.env.example`、`server/deepseek.ts`、`server/agent-actions.ts`、`server/deepseek.test.ts`、`server/index.ts`

- [x] 写入无 Key、无效 JSON、未知动作、缺字段、错误观点 ID、跨讨论 ID 和有效动作的失败测试。
- [x] 实现环境变量读取和服务端 JSON 调用；不引入前端密钥或模拟回复。
- [x] 实现六种允许动作的判定、字段校验和讨论归属校验。
- [x] 实现“请求建议”端点，只返回验证后的建议，绝不执行动作。
- [x] 运行 `pnpm test`，确认服务端校验测试通过。

### Task 5: 建议确认闭环和复用画布动作

**文件：** `src/lib/brainstorm-actions.ts`、`src/lib/brainstorm-actions.test.ts`、`src/components/BrainstormPanel.tsx`、`src/App.tsx`

- [x] 写入“建议未确认不会改画布”“接受后只执行允许动作”“撤销恢复快照”的失败测试。
- [x] 将服务端建议放入待确认列表；实现接受、编辑、忽略、稍后、暂停阶段、撤销。
- [x] 将允许动作映射到既有 `createCluster`、`connectElements`、`createArtifact` 或候选方案创建，不复制画布逻辑。
- [x] 实现用户主动“需要帮助”和选中多个观点后的整合请求。
- [x] 运行 `pnpm test`，确认建议闭环通过。

### Task 6: 记录、文档和最终验证

**文件：** `README.md`、`ARCHITECTURE.md`、`CONTEXT.md`、`lessons.md`、新增测试文件

- [x] 清除 README 中演示默认内容与 demo 描述，说明空白讨论、DeepSeek 配置、运行与验证方式。
- [x] 增加架构说明和阶段进度记录。
- [ ] 运行 `pnpm test` 与 `pnpm build`。
- [ ] 复查产品默认状态及源码中没有预设案例或密钥。

### Task 7: 末轮修复 Docker 运行依赖与默认成员

**文件：** `Dockerfile`、`src/App.tsx`、`src/lib/recording.ts`、服务端共享源码依赖及相关测试。

- [ ] 写入生产镜像缺少共享校验源码和记录入口预填默认成员的失败测试。
- [ ] 补齐 Docker 运行所需共享源码依赖，核对服务端入口的完整引用链和 Node 运行路径。
- [ ] 移除记录入口默认昵称和默认主持人，使用用户明确输入的成员身份。
- [ ] 完成修复后的全量 `pnpm test`、`pnpm build` 与源码末轮核对。
