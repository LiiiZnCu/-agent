# 多人协作头脑风暴 Agent 设计

## 目标

在现有 AI-Mural 白板、协作、记录、导出和 SQLite 能力上，提供从空白讨论到可确认结果的通用多人头脑风暴流程。任何主题都由成员输入；AI 只提出可撤销建议，不能代替人作决定。

## 不变边界

- 继续使用 React Flow 白板、现有卡片/连线/聚类/撤销、localStorage、SQLite 和现有协作链接；不重写画布，也不新建项目。
- 首屏没有主题、成员、观点、AI 回复或演示按钮。测试样本只出现在测试文件。
- 讨论在一个工作区完成。七阶段只是当前状态和导航，用户可跳转、返回或重新整理。
- DeepSeek 仅由 Express 服务端调用。没有 API Key 时，普通白板可用，AI 请求明确失败，不生成替代内容。
- 模型输出始终是建议：服务端验证 → 前端显示 → 成员确认 → 复用现有 action layer 执行；模型不能写数据库或直接改画布。

## 体验结构

首次打开时显示“创建讨论”表单：主题、目标、背景、限制条件、成员昵称。提交后建立空白 board 和 `BrainstormSession`，第一个成员是 facilitator。页面形成三部分：顶部阶段导航和讨论标题，中间原有白板，左侧讨论与 Agent 面板。

阶段固定为：`collecting`、`organizing`、`expanding`、`integrating`、`optimizing`、`deciding`、`output`，对应中文名称“想法收集、智能归类、引导扩散、整合方案、协同优化、辅助决策、成果输出”。阶段切换只更新讨论状态；不清除内容，也不会由 AI 自动触发。

观点仍是现有白板节点，但节点数据新增 `ideaMeta`：讨论 ID、作者 ID、类型、创建时间、来源观点 ID、版本记录。工具栏支持观点、问题、风险、补充信息和候选方案。用户通过当前成员身份创建内容；检查器显示作者、类型、来源与修改记录。

## 数据与持久化

`BrainstormSession`、`BrainstormMember`、`IdeaMeta`、`AgentSuggestion`、`Proposal`、`DecisionMatrix` 和 `Outcome` 组成前端领域模型。它们随板面快照保存在 localStorage，并通过一个独立的 SQLite `brainstorm_sessions` 表存储为 JSON，以避免复制或破坏已有 mural/recording 表。服务端提供按 ID 读取和保存的讨论端点；本地模式仍可工作。

`AgentSuggestion` 记录触发类型、说明、结构化动作、状态、忽略动作类型、是否暂停当前阶段，以及确认后可撤销的 board snapshot。这样能做到忽略后不重复相同建议、暂停提醒和撤销已接受的 AI 建议。

## DeepSeek 与动作校验

服务端新增 `server/deepseek.ts`，使用原生 `fetch` 调 DeepSeek OpenAI 兼容接口，不将 SDK 或密钥带入浏览器。环境变量为 `DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`。请求使用当前讨论、成员、观点、候选方案和操作目的构成上下文，并要求只返回 JSON。

`server/agent-actions.ts` 是唯一的校验入口。它接受解析后的 JSON、讨论和真实白板节点，严格验证 `message`、动作类型和动作字段。支持 `create_cluster`、`connect_ideas`、`ask_question`、`suggest_merge`、`create_matrix`、`create_summary`。所有引用的观点 ID 必须存在且属于当前讨论；不允许空数组、自连接、跨讨论引用、未知字段替代或未确认执行。无效返回直接以 422 错误返回，不猜测或补全。

前端只调用 `POST /api/brainstorm/:id/suggestions` 获得校验后的建议。接受时调用已有 `createCluster`、`connectElements`、`createArtifact` 等 action layer，或创建候选方案；不把“建议”误写成“已执行”。

## 协作、整合、决策和输出

选中两条以上观点可请求 `suggest_merge`。候选方案卡保留来源观点、作者、组合逻辑、风险和待确认事项；可编辑、拆回、接受或拒绝。评论分为支持、反对、补充、风险、待验证；所有意见并列保留。

决策区域允许建立/编辑标准，给候选方案评分和理由并投票。最终方案由成员显式确认。输出区域从当前讨论生成可编辑草稿，包含主题、目标、原始观点、分类、关系、候选方案、最终选择、理由、分歧、风险、待验证问题、行动、负责人和时间安排。没有确认最终结果时禁用讨论成果的导出；原有原始 board 导出保持可用。

## 测试策略

为领域模型、动作验证与输出编写纯函数测试；为创建讨论、空白首屏、作者标记、建议状态与无 Key 错误补充 React/API 测试。全量验证使用 `pnpm test` 与 `pnpm build`。测试数据只在测试文件中出现。
