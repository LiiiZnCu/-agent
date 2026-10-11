import type { AddElementInput, ArtifactValue, BoardActions, ElementColor, ElementKind, LayerAction, RecordingActions, RecordingParticipant } from '../types'
import { validateArtifactSpec } from './artifacts'

type ActivityReporter = (label: string, detail: string) => void

type WebMCPTool = {
  name: string
  title?: string
  description: string
  inputSchema?: Record<string, unknown>
  execute: (input: Record<string, unknown>, options?: { signal?: AbortSignal }) => Promise<unknown> | unknown
  annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean }
}

const kinds: ElementKind[] = ['idea', 'question', 'insight', 'action', 'frame', 'artifact']
const colors: ElementColor[] = ['paper', 'sun', 'mint', 'sky', 'rose']
const layouts = ['grid', 'columns', 'radial', 'stacked'] as const
const groupLayouts = ['none', 'grid', 'columns', 'stacked'] as const
const watchTriggers = ['mentioned', 'reply_to_me', 'authored_element_commented', 'watched_element_changed', 'decision_needed', 'any_change'] as const

export const TOOL_CATALOG = [
  { name: 'canvas_create_mural', label: '创建托管白板', mode: 'write' },
  { name: 'canvas_get_board', label: '读取白板', mode: 'read' },
  { name: 'canvas_rename_mural', label: '重命名白板', mode: 'write' },
  { name: 'canvas_add_element', label: '添加元素', mode: 'write' },
  { name: 'canvas_add_elements', label: '批量添加元素', mode: 'write' },
  { name: 'canvas_update_element', label: '更新元素', mode: 'write' },
  { name: 'canvas_connect_elements', label: '连接想法', mode: 'write' },
  { name: 'canvas_remove_elements', label: '删除元素', mode: 'destructive' },
  { name: 'canvas_arrange_board', label: '排列白板', mode: 'write' },
  { name: 'canvas_create_cluster', label: '创建分类', mode: 'write' },
  { name: 'canvas_create_artifact', label: '创建结构化内容', mode: 'write' },
  { name: 'canvas_get_artifact_spec', label: '读取结构化内容规格', mode: 'read' },
  { name: 'canvas_update_artifact_records', label: '更新结构化内容数据', mode: 'write' },
  { name: 'canvas_focus_elements', label: '聚焦元素', mode: 'read' },
  { name: 'canvas_set_focus', label: '声明编辑焦点', mode: 'write' },
  { name: 'canvas_add_checkpoint', label: '添加回放检查点', mode: 'write' },
  { name: 'canvas_set_element_layer', label: '调整元素图层', mode: 'write' },
  { name: 'canvas_start_recording', label: '开始讨论记录', mode: 'write' },
  { name: 'canvas_join_session', label: '加入讨论', mode: 'write' },
  { name: 'canvas_invite_agents', label: '邀请代理', mode: 'write' },
  { name: 'canvas_redeem_agent_invite', label: '兑换代理邀请', mode: 'write' },
  { name: 'canvas_record_contribution', label: '共享内容', mode: 'write' },
  { name: 'canvas_comment_element', label: '评论元素', mode: 'write' },
  { name: 'canvas_moderate_participant', label: '管理参与者', mode: 'write' },
  { name: 'canvas_watch_mural', label: '查看白板动态', mode: 'write' },
  { name: 'canvas_get_recording', label: '读取讨论记录', mode: 'read' },
  { name: 'canvas_finalize_recording', label: '结束讨论记录', mode: 'write' },
] as const

function text(value: unknown, field: string, required = true): string | undefined {
  if (value === undefined && !required) return undefined
  if (typeof value !== 'string' || (required && !value.trim())) throw new Error(`${field} 必须是非空字符串。`)
  return value.trim()
}

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${field} 必须是元素 ID 数组。`)
  }
  return value
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback?: T): T {
  if (value === undefined && fallback) return fallback
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`必须是以下值之一：${allowed.join(', ')}。`)
  }
  return value as T
}

function optionalNumber(value: unknown) {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('位置值必须是有限数字。')
  return value
}

function response(summary: string, data: Record<string, unknown> = {}) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ summary, ...data }) }],
    structuredContent: { summary, ...data },
  }
}

function elementInput(input: Record<string, unknown>): AddElementInput {
  return {
    title: text(input.title, 'title')!,
    body: text(input.body, 'body', false),
    kind: enumValue(input.kind, kinds, 'idea'),
    color: enumValue(input.color, colors, 'sun'),
    x: optionalNumber(input.x),
    y: optionalNumber(input.y),
    cluster: text(input.cluster, 'cluster', false),
  }
}

export function registerWebMCP(actions: BoardActions, recording: RecordingActions, _report: ActivityReporter) {
  const context = document.modelContext ?? navigator.modelContext
  if (!context?.registerTool) return { supported: false, count: 0, cleanup: () => undefined }

  const controller = new AbortController()
  const registeredNames: string[] = []
  const participantCapabilities = new Map<string, { sessionId: string; token: string }>()
  const currentFocusClaims = () => typeof actions.getAgentFocus === 'function' ? actions.getAgentFocus() : []
  const issueCapability = (sessionId: string, participantId: string) => {
    const token = globalThis.crypto.randomUUID()
    participantCapabilities.set(participantId, { sessionId, token })
    return token
  }
  const unprotectedWrites = new Set<string>(['canvas_create_mural', 'canvas_start_recording', 'canvas_join_session', 'canvas_invite_agents', 'canvas_redeem_agent_invite', 'canvas_moderate_participant'])
  const protectedWrites = new Set<string>(TOOL_CATALOG
    .filter((tool) => tool.mode !== 'read' && !unprotectedWrites.has(tool.name))
    .map((tool) => tool.name))

  const assertAgentAccess = (input: Record<string, unknown>) => {
    const muralId = text(input.muralId, 'muralId')!
    const agentId = text(input.agentId, 'agentId')!
    const agentToken = text(input.agentToken, 'agentToken')!
    if (actions.getSnapshot().id !== muralId) throw new Error('此工具请求使用了另一个白板的 UUID。')
    const session = recording.getRecording()
    if (!session || session.status !== 'recording' || session.boardId !== muralId) {
      throw new Error('修改白板前，请先开始或加入此白板的有效决策记录。')
    }
    const participant = session.participants.find((candidate) => candidate.id === agentId)
    if (!participant) throw new Error(`智能体 ${agentId} 尚未加入此白板。`)
    const capability = participantCapabilities.get(agentId)
    if (!capability || capability.sessionId !== session.id || capability.token !== agentToken) {
      throw new Error('智能体权限无效。请加入讨论以获取私密权限令牌。')
    }
    if (participant.status === 'muted') throw new Error(`${participant.name} 已被讨论主持人静音。`)
    return participant
  }

  const createdTools = new Set(['canvas_add_element', 'canvas_add_elements', 'canvas_create_cluster', 'canvas_create_artifact'])
  const attributedTools = new Set([...protectedWrites].filter((name) => !['canvas_record_contribution', 'canvas_comment_element', 'canvas_finalize_recording', 'canvas_watch_mural', 'canvas_set_focus', 'canvas_add_checkpoint'].includes(name)))

  const writeTargetIds = (toolName: string, input: Record<string, unknown>) => {
    if (toolName === 'canvas_arrange_board' || toolName === 'canvas_clear_board') return actions.getSnapshot().nodes.map((node) => node.id)
    if (['canvas_add_element', 'canvas_add_elements', 'canvas_create_artifact', 'canvas_rename_mural', 'canvas_record_contribution', 'canvas_comment_element', 'canvas_finalize_recording', 'canvas_watch_mural', 'canvas_set_focus'].includes(toolName)) return []
    const values = [
      input.id,
      input.elementId,
      input.sourceId,
      input.targetId,
      ...(Array.isArray(input.ids) ? input.ids : []),
      ...(Array.isArray(input.elementIds) ? input.elementIds : []),
    ]
    return [...new Set(values.filter((value): value is string => typeof value === 'string'))]
  }

  const relatedIdsFor = (input: Record<string, unknown>, output: unknown) => {
    const structured = output && typeof output === 'object' && 'structuredContent' in output
      ? (output as { structuredContent?: Record<string, unknown> }).structuredContent
      : undefined
    const element = structured?.element as { id?: unknown } | undefined
    const values = [
      input.id,
      input.elementId,
      input.sourceId,
      input.targetId,
      ...(Array.isArray(input.ids) ? input.ids : []),
      ...(Array.isArray(input.elementIds) ? input.elementIds : []),
      element?.id,
      structured?.elementId,
      structured?.frameId,
      ...(Array.isArray(structured?.elementIds) ? structured.elementIds : []),
    ]
    const validIds = new Set(actions.getSnapshot().nodes.map((node) => node.id))
    return [...new Set(values.filter((value): value is string => typeof value === 'string' && validIds.has(value)))]
  }

  const register = (tool: WebMCPTool) => {
    if (protectedWrites.has(tool.name)) {
      const schema = tool.inputSchema ?? { type: 'object' }
      const properties = (schema.properties as Record<string, unknown> | undefined) ?? {}
      const required = Array.isArray(schema.required) ? schema.required as string[] : []
      const execute = tool.execute
      context.registerTool({
        ...tool,
        description: `${tool.description} 需要已加入讨论且未被静音的智能体，并提供白板 UUID。`,
        inputSchema: {
          ...schema,
          properties: {
            ...properties,
            muralId: { type: 'string', description: '由 canvas_get_board 返回的 UUID。' },
            agentId: { type: 'string', description: '加入白板时使用的稳定 ID。' },
            agentToken: { type: 'string', description: '由 canvas_join_session 或 canvas_start_recording 返回的私密权限令牌。' },
          },
          required: [...new Set([...required, 'muralId', 'agentId', 'agentToken'])],
        },
        execute: async (input, options) => {
          const participant = assertAgentAccess(input)
          const targetIds = writeTargetIds(tool.name, input)
          if (targetIds.length) await actions.assertAgentWritable(participant.id, targetIds)
          const output = await execute(input, options)
          if (attributedTools.has(tool.name)) {
            const relatedElementIds = relatedIdsFor(input, output)
            const summary = output && typeof output === 'object' && 'structuredContent' in output
              ? String((output as { structuredContent?: { summary?: unknown } }).structuredContent?.summary ?? tool.title ?? tool.name)
              : tool.title ?? tool.name
            recording.recordContribution({
              agentId: participant.id,
              agentName: participant.name,
              kind: 'board_action',
              content: summary,
              relatedElementIds,
              metadata: { tool: tool.name, authored: createdTools.has(tool.name) },
            })
          }
          const ownFocus = currentFocusClaims().find((claim) => claim.participantId === participant.id)
          if (ownFocus?.releaseOnAction === 'after_write' && targetIds.some((id) => ownFocus.elementIds.includes(id))) {
            await actions.setAgentFocus(participant, null)
          }
          return output
        },
      }, { signal: controller.signal })
    } else {
      context.registerTool(tool, { signal: controller.signal })
    }
    registeredNames.push(tool.name)
  }

  register({
    name: 'canvas_create_mural',
    title: '创建托管白板和访问链接',
    description: '创建云端白板，将调用智能体设为讨论主持人，并分别返回所有者和用户访问方式。用户要求新建在线白板时使用。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '简短的白板名称或讨论题目。' },
        creatorAgentId: { type: 'string', description: '创建者 GPT 或智能体的稳定唯一 ID。' },
        creatorAgentName: { type: 'string', description: '显示给其他成员的创建者名称。' },
        specialty: { type: 'string', description: '显示给其他成员的主持人专长。' },
      },
      required: ['name', 'creatorAgentId', 'creatorAgentName'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const creator = {
        id: text(input.creatorAgentId, 'creatorAgentId')!,
        name: text(input.creatorAgentName, 'creatorAgentName')!,
        role: 'agent' as const,
        specialty: text(input.specialty, 'specialty', false) || 'Mural moderator',
      }
      const hosted = await actions.createHostedMural(text(input.name, 'name')!)
      const session = recording.startRecording(`${hosted.board.name} decision trace`, creator)
      const agentToken = issueCapability(session.id, creator.id)
      return response('已创建托管白板，并分别提供所有者、用户和智能体访问方式', {
        muralId: hosted.board.id,
        ownerToken: hosted.ownerToken,
        moderatorToken: agentToken,
        agentToken,
        ownerUrl: hosted.ownerUrl,
        userUrl: hosted.userUrl,
        session,
      })
    },
  })

  register({
    name: 'canvas_get_board',
    title: '读取讨论白板',
    description: '返回当前白板的全部可视元素和连线。修改现有白板前应先调用。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async () => {
      const snapshot = actions.getSnapshot()
      return response('当前白板快照', { board: snapshot })
    },
  })

  register({
    name: 'canvas_rename_mural',
    title: '重命名白板',
    description: '修改品牌标志旁和导出内容中的白板名称。',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', maxLength: 80 } },
      required: ['name'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const board = actions.renameMural(text(input.name, 'name')!, 'agent')
      return response('已重命名白板', { muralId: board.id, name: board.name })
    },
  })

  register({
    name: 'canvas_add_element',
    title: '添加可视元素',
    description: '在白板上添加一条观点、问题、洞察、行动或分类框，可指定画布位置。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '简短标题，最多 120 个字符。' },
        body: { type: 'string', description: '补充说明，最多 800 个字符。' },
        kind: { type: 'string', enum: kinds },
        color: { type: 'string', enum: colors },
        x: { type: 'number' },
        y: { type: 'number' },
        cluster: { type: 'string', description: '可选的语义分组名称。' },
      },
      required: ['title'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const node = actions.addElement(elementInput(input), 'agent')
      return response('已添加一个可视元素', { element: node })
    },
  })

  register({
    name: 'canvas_add_elements',
    title: '批量添加可视元素',
    description: '在一次白板操作中添加最多 30 个讨论元素，适合发散想法。',
    inputSchema: {
      type: 'object',
      properties: {
        elements: {
          type: 'array',
          minItems: 1,
          maxItems: 30,
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              body: { type: 'string' },
              kind: { type: 'string', enum: kinds },
              color: { type: 'string', enum: colors },
              x: { type: 'number' },
              y: { type: 'number' },
              cluster: { type: 'string' },
            },
            required: ['title'],
            additionalProperties: false,
          },
        },
      },
      required: ['elements'],
      additionalProperties: false,
    },
    execute: async (input) => {
      if (!Array.isArray(input.elements) || input.elements.length < 1 || input.elements.length > 30) {
        throw new Error('elements 必须包含 1 至 30 项。')
      }
      const nodes = actions.addElements(input.elements.map((item) => elementInput(item as Record<string, unknown>)), 'agent')
      return response(`已添加 ${nodes.length} 个可视元素`, { elementIds: nodes.map((node) => node.id) })
    },
  })

  register({
    name: 'canvas_update_element',
    title: '更新可视元素',
    description: '修改现有元素的内容、类型、颜色、票数、分组或位置。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        title: { type: 'string' },
        body: { type: 'string' },
        kind: { type: 'string', enum: kinds },
        color: { type: 'string', enum: colors },
        votes: { type: 'number', minimum: 0 },
        cluster: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
      },
      required: ['id'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const id = text(input.id, 'id')!
      const patch = {
        title: text(input.title, 'title', false),
        body: text(input.body, 'body', false),
        kind: input.kind === undefined ? undefined : enumValue(input.kind, kinds),
        color: input.color === undefined ? undefined : enumValue(input.color, colors),
        votes: input.votes === undefined ? undefined : Math.max(0, Number(input.votes)),
        cluster: text(input.cluster, 'cluster', false),
        x: optionalNumber(input.x),
        y: optionalNumber(input.y),
      }
      const node = actions.updateElement(id, patch, 'agent')
      return response('已更新可视元素', { element: node })
    },
  })

  register({
    name: 'canvas_connect_elements',
    title: '连接两个元素',
    description: '在两个现有元素之间建立语义连线，可添加标签。',
    inputSchema: {
      type: 'object',
      properties: {
        sourceId: { type: 'string' },
        targetId: { type: 'string' },
        label: { type: 'string' },
      },
      required: ['sourceId', 'targetId'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const edge = actions.connectElements(
        text(input.sourceId, 'sourceId')!,
        text(input.targetId, 'targetId')!,
        text(input.label, 'label', false),
        'agent',
      )
      return response('已连接两个元素', { connection: edge })
    },
  })

  register({
    name: 'canvas_remove_elements',
    title: '删除可视元素',
    description: '删除指定元素及其连线。仅在用户明确要求删除白板内容时使用。',
    inputSchema: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'string' }, minItems: 1 } },
      required: ['ids'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const count = actions.removeElements(stringList(input.ids, 'ids'), 'agent')
      return response(`已删除 ${count} 个元素`, { removedCount: count })
    },
  })

  register({
    name: 'canvas_arrange_board',
    title: '排列白板',
    description: '将所有非分类框元素重新排列为网格、语义分栏、放射布局或紧凑堆叠。',
    inputSchema: {
      type: 'object',
      properties: { layout: { type: 'string', enum: layouts } },
      required: ['layout'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const layout = enumValue(input.layout, layouts)
      actions.arrange(layout, 'agent')
      return response(`已按 ${layout} 布局排列白板`)
    },
  })

  register({
    name: 'canvas_create_cluster',
    title: '创建可视分类',
    description: '将现有元素放入带名称的分类框，并可选择排列框内内容。',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        elementIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
        layout: { type: 'string', enum: groupLayouts, description: '新分类框中的可选排列方式。' },
      },
      required: ['name', 'elementIds'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const name = text(input.name, 'name')!
      const layout = enumValue(input.layout, groupLayouts, 'none')
      const frame = actions.createCluster(name, stringList(input.elementIds, 'elementIds'), layout, 'agent')
      return response('已创建可视分类', { frameId: frame.id, name, layout })
    },
  })

  register({
    name: 'canvas_focus_elements',
    title: '聚焦可视元素',
    description: '选中指定元素并将其移入视野，不改变白板内容。',
    inputSchema: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'string' }, minItems: 1 } },
      required: ['ids'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true },
    execute: async (input) => {
      const ids = stringList(input.ids, 'ids')
      actions.focusElements(ids)
      return response(`已聚焦 ${ids.length} 个元素`, { elementIds: ids })
    },
  })

  register({
    name: 'canvas_set_focus',
    title: '声明或释放智能体焦点',
    description: '在选中元素上显示编辑或查看意图。编辑声明在释放或过期前会阻止其他智能体的冲突写入。',
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string', enum: ['editing', 'reviewing', 'released'] },
        elementIds: { type: 'array', items: { type: 'string' }, maxItems: 50 },
        intent: { type: 'string', maxLength: 240, description: '显示给其他成员的简短工作说明。' },
        leaseSeconds: { type: 'number', minimum: 10, maximum: 180, description: '焦点有效期，默认 45 秒。' },
        releaseOnAction: { type: 'string', enum: ['after_write', 'manual'], description: '默认为 after_write。manual 焦点需要续期或明确释放。' },
      },
      required: ['state'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const agentId = text(input.agentId, 'agentId')!
      const participant = recording.getRecording()?.participants.find((candidate) => candidate.id === agentId)
      if (!participant) throw new Error(`智能体 ${agentId} 尚未加入此白板。`)
      const state = enumValue(input.state, ['editing', 'reviewing', 'released'] as const)
      if (state === 'released') {
        const focusClaims = await actions.setAgentFocus(participant, null)
        return response('已释放智能体焦点', { focusClaims })
      }
      const elementIds = stringList(input.elementIds, 'elementIds')
      if (!elementIds.length || elementIds.length > 50) throw new Error('elementIds 必须包含 1 至 50 个 ID。')
      const validIds = new Set(actions.getSnapshot().nodes.map((node) => node.id))
      if (elementIds.some((id) => !validIds.has(id))) throw new Error('部分焦点元素不存在。')
      const leaseSeconds = input.leaseSeconds === undefined ? 45 : Number(input.leaseSeconds)
      if (!Number.isFinite(leaseSeconds) || leaseSeconds < 10 || leaseSeconds > 180) throw new Error('leaseSeconds 必须在 10 至 180 之间。')
      const now = new Date()
      const focus = {
        state,
        intent: text(input.intent, 'intent', false)?.slice(0, 240) || (state === 'editing' ? 'Editing selected elements' : 'Reviewing selected elements'),
        elementIds: [...new Set(elementIds)],
        claimedAt: now.toISOString(),
        leaseExpiresAt: new Date(now.getTime() + leaseSeconds * 1000).toISOString(),
        releaseOnAction: enumValue(input.releaseOnAction, ['after_write', 'manual'] as const, 'after_write'),
      }
      const focusClaims = await actions.setAgentFocus(participant, focus)
      return response(`智能体正在${state === 'editing' ? '编辑' : '查看'} ${focus.elementIds.length} 个元素`, { focus, focusClaims })
    },
  })

  register({
    name: 'canvas_set_element_layer',
    title: '调整元素图层',
    description: '将元素置于最前、上移、下移或置于最后。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '元素 ID。' },
        action: { type: 'string', enum: ['front', 'forward', 'backward', 'back'] },
      },
      required: ['id', 'action'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const action = enumValue(input.action, ['front', 'forward', 'backward', 'back'] as const) as LayerAction
      const node = actions.setElementLayer(text(input.id, 'id')!, action, 'agent')
      return response('已调整元素图层', { elementId: node.id, zIndex: node.zIndex, action })
    },
  })

  register({
    name: 'canvas_create_artifact',
    title: '创建可复用的结构化内容',
    description: '根据结构化内容规格 1.0 创建表格、卡片集、检查清单、矩阵或自定义成果。',
    inputSchema: {
      type: 'object',
      properties: {
        spec: {
          type: 'object',
          description: '结构化内容规格 1.0，包含标题、字段、基本类型记录和呈现设置。',
          required: ['specVersion', 'artifactType', 'title', 'fields', 'records', 'presentation'],
          properties: {
            specVersion: { const: '1.0' },
            artifactType: { type: 'string', enum: ['table', 'cards', 'checklist', 'matrix', 'custom'] },
            title: { type: 'string' },
            description: { type: 'string' },
            fields: {
              type: 'array', minItems: 1, maxItems: 12,
              items: {
                type: 'object', required: ['key', 'label', 'type'],
                properties: {
                  key: { type: 'string' }, label: { type: 'string' },
                  type: { type: 'string', enum: ['text', 'number', 'status', 'tag', 'boolean', 'date', 'url'] },
                  required: { type: 'boolean' }, options: { type: 'array', items: { type: 'string' } },
                },
              },
            },
            records: { type: 'array', maxItems: 100, items: { type: 'object' } },
            presentation: {
              type: 'object', required: ['layout'],
              properties: {
                layout: { type: 'string', enum: ['table', 'grid', 'list'] },
                density: { type: 'string', enum: ['compact', 'comfortable'] },
                visibleFields: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
        x: { type: 'number' },
        y: { type: 'number' },
      },
      required: ['spec'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const spec = validateArtifactSpec(input.spec)
      const node = actions.createArtifact(spec, optionalNumber(input.x), optionalNumber(input.y), 'agent')
      return response('已创建可复用的结构化内容', { elementId: node.id, artifact: spec })
    },
  })

  register({
    name: 'canvas_get_artifact_spec',
    title: '读取结构化内容规格',
    description: '返回指定成果的完整可复用规格、字段定义、基础数据和呈现设置。',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '结构化内容元素 ID。' } },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input) => {
      const id = text(input.id, 'id')!
      const spec = actions.getArtifactSpec(id)
      return response('结构化内容规格 1.0', {
        elementId: id,
        schemaUrl: `${window.location.origin}/artifact-spec.schema.json`,
        artifact: spec,
      })
    },
  })

  register({
    name: 'canvas_update_artifact_records',
    title: '更新结构化内容记录',
    description: '替换或追加现有成果中的基础类型记录，同时保留字段结构。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        mode: { type: 'string', enum: ['replace', 'append'] },
        records: {
          type: 'array', maxItems: 100,
          items: { type: 'object', description: '键必须与成果字段匹配；值只能是字符串、数字、布尔值或 null。' },
        },
      },
      required: ['id', 'records'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const id = text(input.id, 'id')!
      if (!Array.isArray(input.records)) throw new Error('records 必须是数组。')
      const mode = enumValue(input.mode, ['replace', 'append'] as const, 'replace')
      const node = actions.updateArtifactRecords(
        id,
        input.records as Array<Record<string, ArtifactValue>>,
        mode,
        'agent',
      )
      return response('已更新结构化内容记录', {
        elementId: id,
        recordCount: node.data.artifact?.records.length ?? 0,
      })
    },
  })

  register({
    name: 'canvas_start_recording',
    title: '开始多智能体决策记录',
    description: '为此白板创建只追加的决策记录，发起的智能体成为主持人。',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        muralId: { type: 'string', description: '由 canvas_get_board 返回的 UUID。' },
        moderatorAgentId: { type: 'string', description: '创建智能体的稳定 ID。' },
        moderatorAgentName: { type: 'string', description: '显示给其他成员的创建者名称。' },
        specialty: { type: 'string', description: '主持智能体的角色或专长。' },
      },
      required: ['muralId', 'moderatorAgentId', 'moderatorAgentName'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const muralId = text(input.muralId, 'muralId')!
      if (actions.getSnapshot().id !== muralId) throw new Error('此工具请求使用了另一个白板的 UUID。')
      if (recording.getRecording()?.status === 'recording') throw new Error('决策记录已存在，请加入现有记录，不要替换主持人。')
      const title = text(input.title, 'title', false)
      const session = recording.startRecording(title, {
        id: text(input.moderatorAgentId, 'moderatorAgentId')!,
        name: text(input.moderatorAgentName, 'moderatorAgentName')!,
        role: 'agent',
        specialty: text(input.specialty, 'specialty', false) || 'Session moderator',
      })
      const agentToken = issueCapability(session.id, session.moderatorId)
      return response('已开始多智能体讨论记录', { muralId, moderatorId: session.moderatorId, agentToken, moderatorToken: agentToken, session })
    },
  })

  register({
    name: 'canvas_invite_agents',
    title: '创建智能体访客邀请',
    description: '为每个指定智能体创建私密邀请权限和链接。仅托管白板所有者可操作；每条邀请只应交给对应智能体。',
    inputSchema: {
      type: 'object',
      properties: {
        muralId: { type: 'string' },
        ownerToken: { type: 'string', description: '由 canvas_create_mural 返回的所有者私密权限令牌。' },
        guests: {
          type: 'array', minItems: 1, maxItems: 20,
          items: {
            type: 'object', required: ['agentId', 'agentName'],
            properties: {
              agentId: { type: 'string' },
              agentName: { type: 'string' },
              specialty: { type: 'string' },
            },
            additionalProperties: false,
          },
        },
      },
      required: ['muralId', 'ownerToken', 'guests'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const muralId = text(input.muralId, 'muralId')!
      if (actions.getSnapshot().id !== muralId) throw new Error('此工具请求使用了另一个白板的 UUID。')
      if (!Array.isArray(input.guests)) throw new Error('guests 必须是数组。')
      const guests = input.guests.map((value) => {
        if (!value || typeof value !== 'object') throw new Error('每位访客都必须是对象。')
        const guest = value as Record<string, unknown>
        return {
          agentId: text(guest.agentId, 'agentId')!,
          agentName: text(guest.agentName, 'agentName')!,
          specialty: text(guest.specialty, 'specialty', false),
        }
      })
      const invitations = await actions.createAgentInvites(muralId, text(input.ownerToken, 'ownerToken')!, guests)
      return response(`已创建 ${invitations.length} 条智能体私密邀请`, { muralId, invitations })
    },
  })

  register({
    name: 'canvas_redeem_agent_invite',
    title: '通过智能体邀请加入',
    description: '使用当前智能体链接或输入中的私密邀请，加载托管白板并加入可见的决策记录。',
    inputSchema: {
      type: 'object',
      properties: {
        muralId: { type: 'string' },
        inviteToken: { type: 'string', description: '来自智能体邀请链接的私密令牌。若当前链接片段中已有，可省略。' },
      },
      required: ['muralId'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const muralId = text(input.muralId, 'muralId')!
      const fragmentToken = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('invite')
      const inviteToken = text(input.inviteToken, 'inviteToken', false) || fragmentToken
      if (!inviteToken) throw new Error('未提供智能体邀请令牌，当前链接中也未找到。')
      const invited = await actions.redeemAgentInvite(muralId, inviteToken)
      const participant: RecordingParticipant = {
        id: invited.agentId,
        name: invited.agentName,
        role: 'agent',
        specialty: invited.specialty,
        status: 'active',
      }
      const session = recording.joinParticipant(participant)
      const agentToken = issueCapability(session.id, participant.id)
      return response('已使用智能体邀请并加入讨论', { muralId, participant, agentToken, session })
    },
  })

  register({
    name: 'canvas_join_session',
    title: '加入头脑风暴讨论',
    description: '将智能体登记为可见成员。贡献内容前应先加入，让人类和其他智能体知道参与者身份。',
    inputSchema: {
      type: 'object',
      properties: {
        muralId: { type: 'string', description: '由 canvas_get_board 返回的 UUID。' },
        agentId: { type: 'string', description: '声明的稳定成员 ID。' },
        agentName: { type: 'string', description: '简短、易识别的智能体名称。' },
        specialty: { type: 'string', description: '角色，例如研究员、评论员、策略师或整合员。' },
        agentToken: { type: 'string', description: '仅在此页面重新认领已有成员 ID 时需要。' },
      },
      required: ['muralId', 'agentId', 'agentName'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const muralId = text(input.muralId, 'muralId')!
      if (actions.getSnapshot().id !== muralId) throw new Error('此工具请求使用了另一个白板的 UUID。')
      const current = recording.getRecording()
      if (!current || current.status !== 'recording' || current.boardId !== muralId) throw new Error('此白板没有有效的决策记录。')
      const participantId = text(input.agentId, 'agentId')!
      if (current.participants.some((candidate) => candidate.id === participantId)) {
        const existing = participantCapabilities.get(participantId)
        if (!existing || existing.sessionId !== current.id || existing.token !== text(input.agentToken, 'agentToken')) {
          throw new Error('该成员 ID 已被占用。请提供对应私密权限令牌或使用新 ID。')
        }
      }
      const participant: RecordingParticipant = {
        id: participantId,
        name: text(input.agentName, 'agentName')!,
        role: 'agent',
        specialty: text(input.specialty, 'specialty', false),
        status: 'active',
      }
      const session = recording.joinParticipant(participant)
      const agentToken = participantCapabilities.get(participant.id)?.token ?? issueCapability(session.id, participant.id)
      return response('智能体现已作为可见成员加入讨论', { participant, agentToken, participants: session.participants })
    },
  })

  register({
    name: 'canvas_moderate_participant',
    title: '静音或恢复智能体',
    description: '允许创建讨论的智能体静音或恢复其他成员。被静音的智能体不能修改白板或添加贡献。',
    inputSchema: {
      type: 'object',
      properties: {
        muralId: { type: 'string', description: '由 canvas_get_board 返回的 UUID。' },
        moderatorId: { type: 'string', description: '创建讨论的智能体 ID。' },
        moderatorToken: { type: 'string', description: '创建讨论时返回的主持人私密权限令牌。' },
        participantId: { type: 'string', description: '需要静音或恢复的成员 ID。' },
        muted: { type: 'boolean' },
      },
      required: ['muralId', 'moderatorId', 'moderatorToken', 'participantId', 'muted'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const muralId = text(input.muralId, 'muralId')!
      if (actions.getSnapshot().id !== muralId) throw new Error('此工具请求使用了另一个白板的 UUID。')
      if (typeof input.muted !== 'boolean') throw new Error('muted 必须是布尔值。')
      const moderatorId = text(input.moderatorId, 'moderatorId')!
      const current = recording.getRecording()
      const capability = participantCapabilities.get(moderatorId)
      if (!current || !capability || capability.sessionId !== current.id || capability.token !== text(input.moderatorToken, 'moderatorToken')) {
        throw new Error('主持人权限无效。')
      }
      const session = recording.moderateParticipant(
        text(input.participantId, 'participantId')!,
        input.muted,
        moderatorId,
      )
      return response(input.muted ? '已将成员静音' : '已恢复成员发言', { muralId, participants: session.participants })
    },
  })

  register({
    name: 'canvas_record_contribution',
    title: '共享智能体贡献',
    description: '向共享决策记录添加可见的方案、问题、评议、依据、决定、推理摘要或结果。',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        agentName: { type: 'string' },
        kind: { type: 'string', enum: ['proposal', 'question', 'critique', 'evidence', 'decision', 'note', 'reasoning_summary', 'result'] },
        content: { type: 'string', description: '明确共享的贡献内容。不得包含隐藏的推理过程、秘密或凭据。' },
        replyTo: { type: 'string', description: '可选的早期事件 ID。' },
        relatedElementIds: { type: 'array', items: { type: 'string' }, maxItems: 50 },
      },
      required: ['agentId', 'agentName', 'kind', 'content'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const event = recording.recordContribution({
        agentId: text(input.agentId, 'agentId')!,
        agentName: text(input.agentName, 'agentName')!,
        kind: enumValue(input.kind, ['proposal', 'question', 'critique', 'evidence', 'decision', 'note', 'reasoning_summary', 'result'] as const),
        content: text(input.content, 'content')!,
        replyTo: text(input.replyTo, 'replyTo', false),
        relatedElementIds: input.relatedElementIds === undefined ? undefined : stringList(input.relatedElementIds, 'relatedElementIds'),
      })
      return response('已将贡献加入共享记录', { event })
    },
  })

  register({
    name: 'canvas_comment_element',
    title: '评论白板元素',
    description: '为元素或结构化成果添加可见的智能体评论，可在元素检查器和共享讨论中查看。',
    inputSchema: {
      type: 'object',
      properties: {
        elementId: { type: 'string', description: '要评论的元素或成果 ID。' },
        content: { type: 'string', description: '可见的备注或评议。' },
        agentName: { type: 'string', description: '可见的成员名称，默认为已加入成员的名称。' },
        replyTo: { type: 'string', description: '可选的回复目标事件 ID。' },
      },
      required: ['elementId', 'content'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const elementId = text(input.elementId, 'elementId')!
      const node = actions.getSnapshot().nodes.find((candidate) => candidate.id === elementId)
      if (!node) throw new Error(`未找到元素 ${elementId}。`)
      const agentId = text(input.agentId, 'agentId')!
      const participant = recording.getRecording()?.participants.find((candidate) => candidate.id === agentId)
      const event = recording.recordContribution({
        agentId,
        agentName: text(input.agentName, 'agentName', false) || participant?.name || 'Agent',
        kind: 'note',
        content: text(input.content, 'content')!,
        replyTo: text(input.replyTo, 'replyTo', false),
        relatedElementIds: [elementId],
      })
      return response('已添加元素评论', { event, elementId })
    },
  })

  register({
    name: 'canvas_get_recording',
    title: '读取成员与决策记录',
    description: '返回可见成员和明确共享的讨论时间线，供智能体了解人类及其他协作者。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async () => {
      const session = recording.getRecording()
      if (!session) return response('当前没有进行中的记录', { session: null })
      return response('当前多智能体决策记录', { session })
    },
  })

  register({
    name: 'canvas_add_checkpoint',
    title: '保存回放检查点',
    description: '允许讨论主持人将当前白板保存为时间线中的不可变检查点，以便稍后回放。',
    inputSchema: {
      type: 'object',
      properties: { label: { type: 'string', maxLength: 120, description: '显示给用户的简短里程碑名称。' } },
      required: ['label'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const agentId = text(input.agentId, 'agentId')!
      const session = recording.getRecording()
      if (!session || session.moderatorId !== agentId) throw new Error('只有讨论主持人可以添加回放检查点。')
      const participant = session.participants.find((candidate) => candidate.id === agentId)!
      const event = recording.createCheckpoint(text(input.label, 'label')!, actions.getSnapshot(), participant)
      return response('已保存回放检查点', { eventId: event.id, label: event.checkpoint?.label, boardUpdatedAt: event.checkpoint?.board.updatedAt })
    },
  })

  register({
    name: 'canvas_watch_mural',
    title: '持续关注白板动态',
    description: '续期智能体在线状态，并返回游标之后新增的共享事件。智能体应按建议间隔重复调用，直到 shouldContinue 为 false。',
    inputSchema: {
      type: 'object',
      properties: {
        muralId: { type: 'string', description: '由 canvas_get_board 返回的 UUID。' },
        agentId: { type: 'string', description: '加入白板时使用的稳定 ID。' },
        afterEventId: { type: 'string', description: '此工具上次返回的游标；首次轮询时省略。' },
        watchingElementIds: { type: 'array', items: { type: 'string' }, maxItems: 50, description: '可选的关注元素；省略时关注全部动态。' },
        triggers: { type: 'array', items: { type: 'string', enum: watchTriggers }, uniqueItems: true, description: '允许介入的条件；默认包括提及、回复、对自己创建元素的评论、关注元素的变化和待处理问题。' },
        quietPeriodSeconds: { type: 'number', minimum: 0, maximum: 60, description: '最新事件发生后等待多久再回复，默认 4 秒。' },
        cooldownSeconds: { type: 'number', minimum: 0, maximum: 300, description: '该智能体两次贡献之间的最短间隔，默认 12 秒。' },
        ignoreOwnEvents: { type: 'boolean', description: '忽略该智能体自己创建的事件，默认 true。' },
        renewFocus: { type: 'boolean', description: '关注动态时为该智能体的手动焦点续期，默认 false。' },
      },
      required: ['muralId', 'agentId'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const muralId = text(input.muralId, 'muralId')!
      const agentId = text(input.agentId, 'agentId')!
      const board = actions.getSnapshot()
      if (board.id !== muralId) throw new Error('此工具请求使用了另一个白板的 UUID。')
      const current = recording.getRecording()
      if (!current || current.boardId !== muralId) throw new Error('此白板没有决策记录。')
      const participant = current.participants.find((candidate) => candidate.id === agentId)
      if (!participant) throw new Error(`智能体 ${agentId} 尚未加入此白板。`)
      if (current.status === 'complete') {
        return response('白板讨论已结束', {
          muralId,
          shouldContinue: false,
          canWrite: false,
          reason: 'session_complete',
          cursor: current.events.at(-1)?.id ?? null,
          changes: [],
        })
      }

      const watchedIds = input.watchingElementIds === undefined ? [] : stringList(input.watchingElementIds, 'watchingElementIds').slice(0, 50)
      watchedIds.forEach((id) => {
        if (!board.nodes.some((node) => node.id === id)) throw new Error(`未找到关注的元素 ${id}。`)
      })
      if (input.renewFocus !== undefined && typeof input.renewFocus !== 'boolean') throw new Error('renewFocus 必须是布尔值。')
      const session = recording.watchParticipant(agentId, watchedIds, input.renewFocus === true)
      const renewedParticipant = session.participants.find((candidate) => candidate.id === agentId)!
      if (input.renewFocus === true && renewedParticipant.focus) await actions.setAgentFocus(renewedParticipant, renewedParticipant.focus)
      const afterEventId = text(input.afterEventId, 'afterEventId', false)
      const cursorIndex = afterEventId ? session.events.findIndex((event) => event.id === afterEventId) : Math.max(-1, session.events.length - 21)
      const ignoreOwnEvents = input.ignoreOwnEvents === undefined ? true : input.ignoreOwnEvents
      if (typeof ignoreOwnEvents !== 'boolean') throw new Error('ignoreOwnEvents 必须是布尔值。')
      const quietPeriodSeconds = input.quietPeriodSeconds === undefined ? 4 : Number(input.quietPeriodSeconds)
      const cooldownSeconds = input.cooldownSeconds === undefined ? 12 : Number(input.cooldownSeconds)
      if (!Number.isFinite(quietPeriodSeconds) || quietPeriodSeconds < 0 || quietPeriodSeconds > 60) throw new Error('quietPeriodSeconds 必须在 0 至 60 之间。')
      if (!Number.isFinite(cooldownSeconds) || cooldownSeconds < 0 || cooldownSeconds > 300) throw new Error('cooldownSeconds 必须在 0 至 300 之间。')
      const triggers = input.triggers === undefined
        ? ['mentioned', 'reply_to_me', 'authored_element_commented', 'watched_element_changed', 'decision_needed'] as Array<typeof watchTriggers[number]>
        : Array.isArray(input.triggers)
          ? [...new Set(input.triggers.map((trigger) => enumValue(trigger, watchTriggers)))]
          : (() => { throw new Error('triggers 必须是数组。') })()
      const changes = session.events.slice(cursorIndex + 1).filter((event) => !ignoreOwnEvents || event.participantId !== agentId)
      const authoredElementIds = new Set(session.events
        .filter((event) => event.participantId === agentId && event.metadata?.authored === true)
        .flatMap((event) => event.relatedElementIds ?? []))
      const ownEventIds = new Set(session.events.filter((event) => event.participantId === agentId).map((event) => event.id))
      const mentionTokens = [`@${participant.name}`.toLowerCase(), `@${participant.id}`.toLowerCase()]
      const matchingTriggers = (event: typeof session.events[number]) => {
        const matched: Array<typeof watchTriggers[number]> = []
        if (triggers.includes('any_change')) matched.push('any_change')
        if (triggers.includes('mentioned') && mentionTokens.some((token) => event.content.toLowerCase().includes(token))) matched.push('mentioned')
        if (triggers.includes('reply_to_me') && event.replyTo && ownEventIds.has(event.replyTo)) matched.push('reply_to_me')
        if (triggers.includes('authored_element_commented') && event.kind === 'note' && event.relatedElementIds?.some((id) => authoredElementIds.has(id))) matched.push('authored_element_commented')
        if (triggers.includes('watched_element_changed') && event.relatedElementIds?.some((id) => watchedIds.includes(id))) matched.push('watched_element_changed')
        if (triggers.includes('decision_needed') && event.kind === 'question') matched.push('decision_needed')
        return matched
      }
      const matchedChanges = changes.map((event) => ({ event, triggers: matchingTriggers(event) })).filter((item) => item.triggers.length > 0)
      const updatedParticipant = session.participants.find((candidate) => candidate.id === agentId)!
      const now = Date.now()
      const lastEventAt = session.events.length ? new Date(session.events.at(-1)!.createdAt).getTime() : 0
      const quietUntil = lastEventAt + quietPeriodSeconds * 1000
      const lastOwnEvent = [...session.events].reverse().find((event) => event.participantId === agentId && event.kind !== 'board_action')
      const cooldownUntil = lastOwnEvent ? new Date(lastOwnEvent.createdAt).getTime() + cooldownSeconds * 1000 : 0
      const canWrite = updatedParticipant.status !== 'muted'
      const waitingForQuiet = quietUntil > now
      const coolingDown = cooldownUntil > now
      const shouldRespond = canWrite && matchedChanges.length > 0 && !waitingForQuiet && !coolingDown
      const reviewReason = !canWrite ? 'muted' : matchedChanges.length === 0 ? 'no_trigger' : waitingForQuiet ? 'quiet_period' : coolingDown ? 'cooldown' : 'trigger_matched'
      const reviewPending = canWrite && matchedChanges.length > 0 && (waitingForQuiet || coolingDown)
      return response(matchedChanges.length ? `匹配到 ${matchedChanges.length} 条需要查看的事件` : '自上次游标以来没有匹配的查看条件', {
        muralId,
        shouldContinue: true,
        shouldRespond,
        reviewReason,
        canWrite,
        nextPollInSeconds: waitingForQuiet ? Math.max(1, Math.ceil((quietUntil - now) / 1000)) : updatedParticipant.status === 'muted' ? 10 : 5,
        nextEligibleAt: new Date(Math.max(now, quietUntil, cooldownUntil)).toISOString(),
        leaseExpiresAt: updatedParticipant.leaseExpiresAt,
        cursor: reviewPending ? afterEventId ?? null : session.events.at(-1)?.id ?? null,
        watchingElementIds: watchedIds,
        activeTriggers: triggers,
        boardUpdatedAt: board.updatedAt,
        changes,
        matchedChanges,
        focusClaims: currentFocusClaims(),
      })
    },
  })

  register({
    name: 'canvas_finalize_recording',
    title: '结束决策记录',
    description: '以明确达成一致的结果结束记录；不会推断共识或公开模型私有推理。',
    inputSchema: {
      type: 'object',
      properties: {
        finalOutput: { type: 'string', description: '达成一致的摘要、决定、待解决问题和后续行动。' },
        agentId: { type: 'string' },
        agentName: { type: 'string' },
      },
      required: ['finalOutput'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const current = recording.getRecording()
      const agentId = text(input.agentId, 'agentId')!
      if (!current || current.moderatorId !== agentId) throw new Error('只有讨论主持人可以结束此决策记录。')
      const participant = current.participants.find((candidate) => candidate.id === agentId)
      const actor = { id: agentId, name: text(input.agentName, 'agentName', false) || participant?.name || 'Moderator', role: 'agent' as const }
      const session = recording.finalizeRecording(text(input.finalOutput, 'finalOutput')!, actor)
      return response('已结束多智能体讨论记录', { session })
    },
  })

  return {
    supported: true,
    count: registeredNames.length,
    cleanup: () => controller.abort(),
  }
}
