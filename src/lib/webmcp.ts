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
  { name: 'canvas_create_mural', label: 'Create hosted mural', mode: 'write' },
  { name: 'canvas_get_board', label: 'Read board', mode: 'read' },
  { name: 'canvas_rename_mural', label: 'Rename mural', mode: 'write' },
  { name: 'canvas_add_element', label: 'Add element', mode: 'write' },
  { name: 'canvas_add_elements', label: 'Add many', mode: 'write' },
  { name: 'canvas_update_element', label: 'Update element', mode: 'write' },
  { name: 'canvas_connect_elements', label: 'Connect ideas', mode: 'write' },
  { name: 'canvas_remove_elements', label: 'Remove elements', mode: 'destructive' },
  { name: 'canvas_arrange_board', label: 'Arrange board', mode: 'write' },
  { name: 'canvas_create_cluster', label: 'Create cluster', mode: 'write' },
  { name: 'canvas_create_artifact', label: 'Create artifact', mode: 'write' },
  { name: 'canvas_get_artifact_spec', label: 'Read artifact spec', mode: 'read' },
  { name: 'canvas_update_artifact_records', label: 'Update artifact data', mode: 'write' },
  { name: 'canvas_focus_elements', label: 'Focus elements', mode: 'read' },
  { name: 'canvas_set_focus', label: 'Claim edit focus', mode: 'write' },
  { name: 'canvas_add_checkpoint', label: 'Add replay checkpoint', mode: 'write' },
  { name: 'canvas_set_element_layer', label: 'Change element layer', mode: 'write' },
  { name: 'canvas_start_recording', label: 'Start decision trace', mode: 'write' },
  { name: 'canvas_join_session', label: 'Join session', mode: 'write' },
  { name: 'canvas_invite_agents', label: 'Invite agent guests', mode: 'write' },
  { name: 'canvas_redeem_agent_invite', label: 'Redeem agent invite', mode: 'write' },
  { name: 'canvas_record_contribution', label: 'Share contribution', mode: 'write' },
  { name: 'canvas_comment_element', label: 'Comment on element', mode: 'write' },
  { name: 'canvas_moderate_participant', label: 'Moderate participant', mode: 'write' },
  { name: 'canvas_watch_mural', label: 'Watch mural changes', mode: 'write' },
  { name: 'canvas_get_recording', label: 'Read decision trace', mode: 'read' },
  { name: 'canvas_finalize_recording', label: 'Finalize decision trace', mode: 'write' },
] as const

function text(value: unknown, field: string, required = true): string | undefined {
  if (value === undefined && !required) return undefined
  if (typeof value !== 'string' || (required && !value.trim())) throw new Error(`${field} must be a non-empty string.`)
  return value.trim()
}

function stringList(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${field} must be an array of element IDs.`)
  }
  return value
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback?: T): T {
  if (value === undefined && fallback) return fallback
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new Error(`Expected one of: ${allowed.join(', ')}.`)
  }
  return value as T
}

function optionalNumber(value: unknown) {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Position values must be finite numbers.')
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
    if (actions.getSnapshot().id !== muralId) throw new Error('This tool call targets a different mural UUID.')
    const session = recording.getRecording()
    if (!session || session.status !== 'recording' || session.boardId !== muralId) {
      throw new Error('Start or join the active decision trace for this mural before changing it.')
    }
    const participant = session.participants.find((candidate) => candidate.id === agentId)
    if (!participant) throw new Error(`Agent ${agentId} has not joined this mural.`)
    const capability = participantCapabilities.get(agentId)
    if (!capability || capability.sessionId !== session.id || capability.token !== agentToken) {
      throw new Error('The agent capability is invalid. Join the session to obtain a private capability token.')
    }
    if (participant.status === 'muted') throw new Error(`${participant.name} is muted by the session moderator.`)
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
        description: `${tool.description} Requires an active, unmuted agent participant and the mural UUID.`,
        inputSchema: {
          ...schema,
          properties: {
            ...properties,
            muralId: { type: 'string', description: 'UUID returned by canvas_get_board.' },
            agentId: { type: 'string', description: 'Stable ID used when joining the mural.' },
            agentToken: { type: 'string', description: 'Private capability returned by canvas_join_session or canvas_start_recording.' },
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
    title: 'Create a hosted mural and access links',
    description: 'Creates a new cloud-backed mural, makes the calling agent its session moderator, and returns separate owner and human-user access. Use this when the user asks for a new online mural.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Short mural name or challenge.' },
        creatorAgentId: { type: 'string', description: 'Stable unique ID for the creating GPT or agent.' },
        creatorAgentName: { type: 'string', description: 'Visible creator name.' },
        specialty: { type: 'string', description: 'Visible moderator specialty.' },
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
      return response('Created hosted mural with separate owner, user, and agent access', {
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
    title: 'Read brainstorming board',
    description: 'Returns every visual element and connector on the current board. Call this before modifying an existing board.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async () => {
      const snapshot = actions.getSnapshot()
      return response('Current board snapshot', { board: snapshot })
    },
  })

  register({
    name: 'canvas_rename_mural',
    title: 'Rename the mural',
    description: 'Changes the mural name shown beside the Canvas Relay logo and in exports.',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', maxLength: 80 } },
      required: ['name'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const board = actions.renameMural(text(input.name, 'name')!, 'agent')
      return response('Renamed mural', { muralId: board.id, name: board.name })
    },
  })

  register({
    name: 'canvas_add_element',
    title: 'Add a visual element',
    description: 'Adds one idea, question, insight, action, or frame to the board at an optional canvas position.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Concise title, maximum 120 characters.' },
        body: { type: 'string', description: 'Supporting detail, maximum 800 characters.' },
        kind: { type: 'string', enum: kinds },
        color: { type: 'string', enum: colors },
        x: { type: 'number' },
        y: { type: 'number' },
        cluster: { type: 'string', description: 'Optional semantic group name.' },
      },
      required: ['title'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const node = actions.addElement(elementInput(input), 'agent')
      return response('Added one visual element', { element: node })
    },
  })

  register({
    name: 'canvas_add_elements',
    title: 'Add multiple visual elements',
    description: 'Adds up to 30 brainstorm elements in one atomic board action. Useful for divergent ideation.',
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
        throw new Error('elements must contain between 1 and 30 items.')
      }
      const nodes = actions.addElements(input.elements.map((item) => elementInput(item as Record<string, unknown>)), 'agent')
      return response(`Added ${nodes.length} visual elements`, { elementIds: nodes.map((node) => node.id) })
    },
  })

  register({
    name: 'canvas_update_element',
    title: 'Update a visual element',
    description: 'Edits content, type, color, votes, cluster, or position of one existing element.',
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
      return response('Updated visual element', { element: node })
    },
  })

  register({
    name: 'canvas_connect_elements',
    title: 'Connect two elements',
    description: 'Draws a semantic connector from one existing element to another, with an optional label.',
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
      return response('Connected two elements', { connection: edge })
    },
  })

  register({
    name: 'canvas_remove_elements',
    title: 'Remove visual elements',
    description: 'Removes specified elements and their connectors. Only use when the user clearly asks to delete board content.',
    inputSchema: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'string' }, minItems: 1 } },
      required: ['ids'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const count = actions.removeElements(stringList(input.ids, 'ids'), 'agent')
      return response(`Removed ${count} elements`, { removedCount: count })
    },
  })

  register({
    name: 'canvas_arrange_board',
    title: 'Arrange the board',
    description: 'Repositions all non-frame elements into a grid, semantic columns, radial map, or compact stack.',
    inputSchema: {
      type: 'object',
      properties: { layout: { type: 'string', enum: layouts } },
      required: ['layout'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const layout = enumValue(input.layout, layouts)
      actions.arrange(layout, 'agent')
      return response(`Arranged board as ${layout}`)
    },
  })

  register({
    name: 'canvas_create_cluster',
    title: 'Create a visual cluster',
    description: 'Groups existing elements in a labeled container and optionally arranges its contents.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        elementIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
        layout: { type: 'string', enum: groupLayouts, description: 'Optional arrangement inside the new container.' },
      },
      required: ['name', 'elementIds'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const name = text(input.name, 'name')!
      const layout = enumValue(input.layout, groupLayouts, 'none')
      const frame = actions.createCluster(name, stringList(input.elementIds, 'elementIds'), layout, 'agent')
      return response('Created a visual cluster', { frameId: frame.id, name, layout })
    },
  })

  register({
    name: 'canvas_focus_elements',
    title: 'Focus visual elements',
    description: 'Selects and brings specified elements into view without changing board content.',
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
      return response(`Focused ${ids.length} elements`, { elementIds: ids })
    },
  })

  register({
    name: 'canvas_set_focus',
    title: 'Claim or release agent focus',
    description: 'Raises a visible editing or reviewing intent on selected elements. Editing claims block conflicting agent writes until released or expired.',
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string', enum: ['editing', 'reviewing', 'released'] },
        elementIds: { type: 'array', items: { type: 'string' }, maxItems: 50 },
        intent: { type: 'string', maxLength: 240, description: 'Short visible description of the work being done.' },
        leaseSeconds: { type: 'number', minimum: 10, maximum: 180, description: 'Lease duration. Default 45 seconds.' },
        releaseOnAction: { type: 'string', enum: ['after_write', 'manual'], description: 'Default after_write. Manual focus must be renewed or explicitly released.' },
      },
      required: ['state'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const agentId = text(input.agentId, 'agentId')!
      const participant = recording.getRecording()?.participants.find((candidate) => candidate.id === agentId)
      if (!participant) throw new Error(`Agent ${agentId} has not joined this mural.`)
      const state = enumValue(input.state, ['editing', 'reviewing', 'released'] as const)
      if (state === 'released') {
        const focusClaims = await actions.setAgentFocus(participant, null)
        return response('Released agent focus', { focusClaims })
      }
      const elementIds = stringList(input.elementIds, 'elementIds')
      if (!elementIds.length || elementIds.length > 50) throw new Error('elementIds must contain between 1 and 50 IDs.')
      const validIds = new Set(actions.getSnapshot().nodes.map((node) => node.id))
      if (elementIds.some((id) => !validIds.has(id))) throw new Error('One or more focus elements were not found.')
      const leaseSeconds = input.leaseSeconds === undefined ? 45 : Number(input.leaseSeconds)
      if (!Number.isFinite(leaseSeconds) || leaseSeconds < 10 || leaseSeconds > 180) throw new Error('leaseSeconds must be between 10 and 180.')
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
      return response(`Agent is ${state} ${focus.elementIds.length} elements`, { focus, focusClaims })
    },
  })

  register({
    name: 'canvas_set_element_layer',
    title: 'Change an element layer',
    description: 'Moves one visual element to the front, forward, backward, or to the back of the mural stack.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Element ID.' },
        action: { type: 'string', enum: ['front', 'forward', 'backward', 'back'] },
      },
      required: ['id', 'action'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const action = enumValue(input.action, ['front', 'forward', 'backward', 'back'] as const) as LayerAction
      const node = actions.setElementLayer(text(input.id, 'id')!, action, 'agent')
      return response('Changed element layer', { elementId: node.id, zIndex: node.zIndex, action })
    },
  })

  register({
    name: 'canvas_create_artifact',
    title: 'Create a reusable artifact',
    description: 'Creates a structured table, card collection, checklist, matrix, or custom artifact from the Canvas Relay Artifact Spec 1.0.',
    inputSchema: {
      type: 'object',
      properties: {
        spec: {
          type: 'object',
          description: 'Artifact Spec 1.0 with title, fields, primitive records, and presentation settings.',
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
      return response('Created reusable artifact', { elementId: node.id, artifact: spec })
    },
  })

  register({
    name: 'canvas_get_artifact_spec',
    title: 'Read artifact specification',
    description: 'Returns the complete reusable spec, field definitions, primitive data, and presentation for one artifact.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Artifact element ID.' } },
      required: ['id'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (input) => {
      const id = text(input.id, 'id')!
      const spec = actions.getArtifactSpec(id)
      return response('Artifact Spec 1.0', {
        elementId: id,
        schemaUrl: `${window.location.origin}/artifact-spec.schema.json`,
        artifact: spec,
      })
    },
  })

  register({
    name: 'canvas_update_artifact_records',
    title: 'Update artifact records',
    description: 'Replaces or appends primitive records in an existing structured artifact while preserving its field schema.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        mode: { type: 'string', enum: ['replace', 'append'] },
        records: {
          type: 'array', maxItems: 100,
          items: { type: 'object', description: 'Keys must match the artifact fields. Values must be string, number, boolean, or null.' },
        },
      },
      required: ['id', 'records'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const id = text(input.id, 'id')!
      if (!Array.isArray(input.records)) throw new Error('records must be an array.')
      const mode = enumValue(input.mode, ['replace', 'append'] as const, 'replace')
      const node = actions.updateArtifactRecords(
        id,
        input.records as Array<Record<string, ArtifactValue>>,
        mode,
        'agent',
      )
      return response('Updated artifact records', {
        elementId: id,
        recordCount: node.data.artifact?.records.length ?? 0,
      })
    },
  })

  register({
    name: 'canvas_start_recording',
    title: 'Start a multi-agent decision trace',
    description: 'Creates an append-only decision trace for this mural. The agent that starts it becomes the moderator.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        muralId: { type: 'string', description: 'UUID returned by canvas_get_board.' },
        moderatorAgentId: { type: 'string', description: 'Stable ID of the creating agent.' },
        moderatorAgentName: { type: 'string', description: 'Visible name of the creating agent.' },
        specialty: { type: 'string', description: 'The moderator agent role or specialty.' },
      },
      required: ['muralId', 'moderatorAgentId', 'moderatorAgentName'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const muralId = text(input.muralId, 'muralId')!
      if (actions.getSnapshot().id !== muralId) throw new Error('This tool call targets a different mural UUID.')
      if (recording.getRecording()?.status === 'recording') throw new Error('A decision trace already exists. Join it instead of replacing its moderator.')
      const title = text(input.title, 'title', false)
      const session = recording.startRecording(title, {
        id: text(input.moderatorAgentId, 'moderatorAgentId')!,
        name: text(input.moderatorAgentName, 'moderatorAgentName')!,
        role: 'agent',
        specialty: text(input.specialty, 'specialty', false) || 'Session moderator',
      })
      const agentToken = issueCapability(session.id, session.moderatorId)
      return response('Started multi-agent recording', { muralId, moderatorId: session.moderatorId, agentToken, moderatorToken: agentToken, session })
    },
  })

  register({
    name: 'canvas_invite_agents',
    title: 'Create access for agent guests',
    description: 'Creates one private invite capability and URL per named agent. Only the hosted mural owner can do this. Return each invite only to its intended agent.',
    inputSchema: {
      type: 'object',
      properties: {
        muralId: { type: 'string' },
        ownerToken: { type: 'string', description: 'Private owner capability returned by canvas_create_mural.' },
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
      if (actions.getSnapshot().id !== muralId) throw new Error('This tool call targets a different mural UUID.')
      if (!Array.isArray(input.guests)) throw new Error('guests must be an array.')
      const guests = input.guests.map((value) => {
        if (!value || typeof value !== 'object') throw new Error('Every guest must be an object.')
        const guest = value as Record<string, unknown>
        return {
          agentId: text(guest.agentId, 'agentId')!,
          agentName: text(guest.agentName, 'agentName')!,
          specialty: text(guest.specialty, 'specialty', false),
        }
      })
      const invitations = await actions.createAgentInvites(muralId, text(input.ownerToken, 'ownerToken')!, guests)
      return response(`Created ${invitations.length} private agent invitations`, { muralId, invitations })
    },
  })

  register({
    name: 'canvas_redeem_agent_invite',
    title: 'Join using an agent invitation',
    description: 'Redeems the private invitation in the current agent URL or supplied input, loads the hosted mural, and joins the visible decision trace.',
    inputSchema: {
      type: 'object',
      properties: {
        muralId: { type: 'string' },
        inviteToken: { type: 'string', description: 'Private token from the agent invitation URL. Omit when it is already in the current URL fragment.' },
      },
      required: ['muralId'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const muralId = text(input.muralId, 'muralId')!
      const fragmentToken = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('invite')
      const inviteToken = text(input.inviteToken, 'inviteToken', false) || fragmentToken
      if (!inviteToken) throw new Error('No agent invitation token was supplied or found in the current URL.')
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
      return response('Agent invitation redeemed and participant joined', { muralId, participant, agentToken, session })
    },
  })

  register({
    name: 'canvas_join_session',
    title: 'Join the brainstorming session',
    description: 'Registers an agent as a visible participant. Call this before contributing so the human and other agents know who is present.',
    inputSchema: {
      type: 'object',
      properties: {
        muralId: { type: 'string', description: 'UUID returned by canvas_get_board.' },
        agentId: { type: 'string', description: 'Stable declared participant ID.' },
        agentName: { type: 'string', description: 'Short human-readable agent name.' },
        specialty: { type: 'string', description: 'Role such as researcher, critic, strategist, or synthesizer.' },
        agentToken: { type: 'string', description: 'Required only to reclaim an existing participant ID in this page.' },
      },
      required: ['muralId', 'agentId', 'agentName'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const muralId = text(input.muralId, 'muralId')!
      if (actions.getSnapshot().id !== muralId) throw new Error('This tool call targets a different mural UUID.')
      const current = recording.getRecording()
      if (!current || current.status !== 'recording' || current.boardId !== muralId) throw new Error('No active decision trace exists for this mural.')
      const participantId = text(input.agentId, 'agentId')!
      if (current.participants.some((candidate) => candidate.id === participantId)) {
        const existing = participantCapabilities.get(participantId)
        if (!existing || existing.sessionId !== current.id || existing.token !== text(input.agentToken, 'agentToken')) {
          throw new Error('That participant ID is already claimed. Supply its private capability token or use a new ID.')
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
      return response('Agent is now visible in the session', { participant, agentToken, participants: session.participants })
    },
  })

  register({
    name: 'canvas_moderate_participant',
    title: 'Mute or reactivate an agent',
    description: 'Lets the agent that created the session mute or reactivate another participant. Muted agents cannot mutate the mural or add contributions.',
    inputSchema: {
      type: 'object',
      properties: {
        muralId: { type: 'string', description: 'UUID returned by canvas_get_board.' },
        moderatorId: { type: 'string', description: 'ID of the agent that created the session.' },
        moderatorToken: { type: 'string', description: 'Private moderator capability returned when the session was created.' },
        participantId: { type: 'string', description: 'Participant to mute or reactivate.' },
        muted: { type: 'boolean' },
      },
      required: ['muralId', 'moderatorId', 'moderatorToken', 'participantId', 'muted'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const muralId = text(input.muralId, 'muralId')!
      if (actions.getSnapshot().id !== muralId) throw new Error('This tool call targets a different mural UUID.')
      if (typeof input.muted !== 'boolean') throw new Error('muted must be a boolean.')
      const moderatorId = text(input.moderatorId, 'moderatorId')!
      const current = recording.getRecording()
      const capability = participantCapabilities.get(moderatorId)
      if (!current || !capability || capability.sessionId !== current.id || capability.token !== text(input.moderatorToken, 'moderatorToken')) {
        throw new Error('The moderator capability is invalid.')
      }
      const session = recording.moderateParticipant(
        text(input.participantId, 'participantId')!,
        input.muted,
        moderatorId,
      )
      return response(input.muted ? 'Participant muted' : 'Participant reactivated', { muralId, participants: session.participants })
    },
  })

  register({
    name: 'canvas_record_contribution',
    title: 'Share an agent contribution',
    description: 'Appends a visible proposal, question, critique, evidence, decision, reasoning summary, or result to the shared decision trace.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string' },
        agentName: { type: 'string' },
        kind: { type: 'string', enum: ['proposal', 'question', 'critique', 'evidence', 'decision', 'note', 'reasoning_summary', 'result'] },
        content: { type: 'string', description: 'Explicitly shared contribution. Never include hidden chain-of-thought, secrets, or credentials.' },
        replyTo: { type: 'string', description: 'Optional earlier event ID.' },
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
      return response('Contribution added to the shared trace', { event })
    },
  })

  register({
    name: 'canvas_comment_element',
    title: 'Comment on a mural element',
    description: 'Adds a visible agent note anchored to one element or artifact. The note is reviewable in the element inspector and the global conversation.',
    inputSchema: {
      type: 'object',
      properties: {
        elementId: { type: 'string', description: 'Element or artifact ID to comment on.' },
        content: { type: 'string', description: 'Visible note or review comment.' },
        agentName: { type: 'string', description: 'Visible participant name. Defaults to the joined participant name.' },
        replyTo: { type: 'string', description: 'Optional conversation event ID being answered.' },
      },
      required: ['elementId', 'content'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const elementId = text(input.elementId, 'elementId')!
      const node = actions.getSnapshot().nodes.find((candidate) => candidate.id === elementId)
      if (!node) throw new Error(`Element ${elementId} was not found.`)
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
      return response('Added an anchored comment', { event, elementId })
    },
  })

  register({
    name: 'canvas_get_recording',
    title: 'Read participants and decision trace',
    description: 'Returns the visible participants and explicitly shared session timeline so agents can understand the human and other collaborators.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async () => {
      const session = recording.getRecording()
      if (!session) return response('No recording is active', { session: null })
      return response('Current multi-agent decision trace', { session })
    },
  })

  register({
    name: 'canvas_add_checkpoint',
    title: 'Save a replay checkpoint',
    description: 'Lets the session moderator capture the current mural as an immutable point in the visible timeline for later replay.',
    inputSchema: {
      type: 'object',
      properties: { label: { type: 'string', maxLength: 120, description: 'Short milestone name visible to users.' } },
      required: ['label'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const agentId = text(input.agentId, 'agentId')!
      const session = recording.getRecording()
      if (!session || session.moderatorId !== agentId) throw new Error('Only the session moderator can add replay checkpoints.')
      const participant = session.participants.find((candidate) => candidate.id === agentId)!
      const event = recording.createCheckpoint(text(input.label, 'label')!, actions.getSnapshot(), participant)
      return response('Saved replay checkpoint', { eventId: event.id, label: event.checkpoint?.label, boardUpdatedAt: event.checkpoint?.board.updatedAt })
    },
  })

  register({
    name: 'canvas_watch_mural',
    title: 'Watch a mural with a renewable lease',
    description: 'Renews an agent presence lease and returns new shared events since a cursor. Agents should repeat at the recommended interval until shouldContinue is false.',
    inputSchema: {
      type: 'object',
      properties: {
        muralId: { type: 'string', description: 'UUID returned by canvas_get_board.' },
        agentId: { type: 'string', description: 'Stable ID used when joining the mural.' },
        afterEventId: { type: 'string', description: 'Last cursor returned by this tool. Omit on the first poll.' },
        watchingElementIds: { type: 'array', items: { type: 'string' }, maxItems: 50, description: 'Optional components to observe. Omit for the global stream.' },
        triggers: { type: 'array', items: { type: 'string', enum: watchTriggers }, uniqueItems: true, description: 'Conditions that permit intervention. Defaults to mentions, replies, comments on authored elements, watched changes, and open questions.' },
        quietPeriodSeconds: { type: 'number', minimum: 0, maximum: 60, description: 'Wait this long after the newest event before responding. Default 4.' },
        cooldownSeconds: { type: 'number', minimum: 0, maximum: 300, description: 'Minimum time between this agent contributions. Default 12.' },
        ignoreOwnEvents: { type: 'boolean', description: 'Ignore events authored by this agent. Default true.' },
        renewFocus: { type: 'boolean', description: 'Renew this agent’s active manual focus lease while watching. Default false.' },
      },
      required: ['muralId', 'agentId'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const muralId = text(input.muralId, 'muralId')!
      const agentId = text(input.agentId, 'agentId')!
      const board = actions.getSnapshot()
      if (board.id !== muralId) throw new Error('This tool call targets a different mural UUID.')
      const current = recording.getRecording()
      if (!current || current.boardId !== muralId) throw new Error('No decision trace exists for this mural.')
      const participant = current.participants.find((candidate) => candidate.id === agentId)
      if (!participant) throw new Error(`Agent ${agentId} has not joined this mural.`)
      if (current.status === 'complete') {
        return response('The mural session is closed', {
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
        if (!board.nodes.some((node) => node.id === id)) throw new Error(`Watched element ${id} was not found.`)
      })
      if (input.renewFocus !== undefined && typeof input.renewFocus !== 'boolean') throw new Error('renewFocus must be a boolean.')
      const session = recording.watchParticipant(agentId, watchedIds, input.renewFocus === true)
      const renewedParticipant = session.participants.find((candidate) => candidate.id === agentId)!
      if (input.renewFocus === true && renewedParticipant.focus) await actions.setAgentFocus(renewedParticipant, renewedParticipant.focus)
      const afterEventId = text(input.afterEventId, 'afterEventId', false)
      const cursorIndex = afterEventId ? session.events.findIndex((event) => event.id === afterEventId) : Math.max(-1, session.events.length - 21)
      const ignoreOwnEvents = input.ignoreOwnEvents === undefined ? true : input.ignoreOwnEvents
      if (typeof ignoreOwnEvents !== 'boolean') throw new Error('ignoreOwnEvents must be a boolean.')
      const quietPeriodSeconds = input.quietPeriodSeconds === undefined ? 4 : Number(input.quietPeriodSeconds)
      const cooldownSeconds = input.cooldownSeconds === undefined ? 12 : Number(input.cooldownSeconds)
      if (!Number.isFinite(quietPeriodSeconds) || quietPeriodSeconds < 0 || quietPeriodSeconds > 60) throw new Error('quietPeriodSeconds must be between 0 and 60.')
      if (!Number.isFinite(cooldownSeconds) || cooldownSeconds < 0 || cooldownSeconds > 300) throw new Error('cooldownSeconds must be between 0 and 300.')
      const triggers = input.triggers === undefined
        ? ['mentioned', 'reply_to_me', 'authored_element_commented', 'watched_element_changed', 'decision_needed'] as Array<typeof watchTriggers[number]>
        : Array.isArray(input.triggers)
          ? [...new Set(input.triggers.map((trigger) => enumValue(trigger, watchTriggers)))]
          : (() => { throw new Error('triggers must be an array.') })()
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
      return response(matchedChanges.length ? `Matched ${matchedChanges.length} review events` : 'No review condition matched since the last cursor', {
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
    title: 'Finalize the decision trace',
    description: 'Closes the recording with an explicitly agreed output. This does not infer consensus or expose private model reasoning.',
    inputSchema: {
      type: 'object',
      properties: {
        finalOutput: { type: 'string', description: 'Agreed summary, decisions, open questions, and next steps.' },
        agentId: { type: 'string' },
        agentName: { type: 'string' },
      },
      required: ['finalOutput'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const current = recording.getRecording()
      const agentId = text(input.agentId, 'agentId')!
      if (!current || current.moderatorId !== agentId) throw new Error('Only the session moderator can finalize this decision trace.')
      const participant = current.participants.find((candidate) => candidate.id === agentId)
      const actor = { id: agentId, name: text(input.agentName, 'agentName', false) || participant?.name || 'Moderator', role: 'agent' as const }
      const session = recording.finalizeRecording(text(input.finalOutput, 'finalOutput')!, actor)
      return response('Finalized multi-agent recording', { session })
    },
  })

  return {
    supported: true,
    count: registeredNames.length,
    cleanup: () => controller.abort(),
  }
}
