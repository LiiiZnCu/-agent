import type { AddElementInput, ArtifactValue, BoardActions, ElementColor, ElementKind, RecordingActions, RecordingParticipant } from '../types'
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
const layouts = ['grid', 'columns', 'radial'] as const

export const TOOL_CATALOG = [
  { name: 'canvas_get_board', label: 'Read board', mode: 'read' },
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
  { name: 'canvas_start_recording', label: 'Start decision trace', mode: 'write' },
  { name: 'canvas_join_session', label: 'Join session', mode: 'write' },
  { name: 'canvas_record_contribution', label: 'Share contribution', mode: 'write' },
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

export function registerWebMCP(actions: BoardActions, recording: RecordingActions, report: ActivityReporter) {
  const context = document.modelContext ?? navigator.modelContext
  if (!context?.registerTool) return { supported: false, count: 0, cleanup: () => undefined }

  const controller = new AbortController()
  const registeredNames: string[] = []
  const register = (tool: WebMCPTool) => {
    context.registerTool(tool, { signal: controller.signal })
    registeredNames.push(tool.name)
  }

  register({
    name: 'canvas_get_board',
    title: 'Read brainstorming board',
    description: 'Returns every visual element and connector on the current board. Call this before modifying an existing board.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async () => {
      const snapshot = actions.getSnapshot()
      report('Board read', `${snapshot.nodes.length} elements and ${snapshot.edges.length} connections`)
      return response('Current board snapshot', { board: snapshot })
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
      report('Element added', node.data.title)
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
      report('Idea set added', `${nodes.length} elements created`)
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
      report('Element updated', node.data.title)
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
      report('Ideas connected', edge.label ? String(edge.label) : 'New relationship')
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
      report('Elements removed', `${count} elements deleted`)
      return response(`Removed ${count} elements`, { removedCount: count })
    },
  })

  register({
    name: 'canvas_arrange_board',
    title: 'Arrange the board',
    description: 'Repositions all non-frame elements into a grid, semantic columns, or a radial map.',
    inputSchema: {
      type: 'object',
      properties: { layout: { type: 'string', enum: layouts } },
      required: ['layout'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const layout = enumValue(input.layout, layouts)
      actions.arrange(layout, 'agent')
      report('Board arranged', `${layout} layout applied`)
      return response(`Arranged board as ${layout}`)
    },
  })

  register({
    name: 'canvas_create_cluster',
    title: 'Create a visual cluster',
    description: 'Groups existing elements semantically and draws a labeled frame around them.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        elementIds: { type: 'array', items: { type: 'string' }, minItems: 1 },
      },
      required: ['name', 'elementIds'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const name = text(input.name, 'name')!
      const frame = actions.createCluster(name, stringList(input.elementIds, 'elementIds'), 'agent')
      report('Cluster created', name)
      return response('Created a visual cluster', { frameId: frame.id, name })
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
      report('Elements focused', `${ids.length} elements brought into view`)
      return response(`Focused ${ids.length} elements`, { elementIds: ids })
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
      report('Artifact created', `${spec.title}, ${spec.records.length} records`)
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
      report('Artifact spec read', spec.title)
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
      report('Artifact data updated', `${node.data.artifact?.records.length ?? 0} total records`)
      return response('Updated artifact records', {
        elementId: id,
        recordCount: node.data.artifact?.records.length ?? 0,
      })
    },
  })

  register({
    name: 'canvas_start_recording',
    title: 'Start a multi-agent decision trace',
    description: 'Starts an append-only local record of shared human messages, agent contributions, canvas actions, decisions, and final output.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        userName: { type: 'string', description: 'Visible name of the human facilitator.' },
      },
      additionalProperties: false,
    },
    execute: async (input) => {
      const title = text(input.title, 'title', false)
      const userName = text(input.userName, 'userName', false) || 'Facilitator'
      const session = recording.startRecording(title, { id: 'human-facilitator', name: userName, role: 'human', specialty: 'Facilitator' })
      report('Decision trace started', session.title)
      return response('Started multi-agent recording', { session })
    },
  })

  register({
    name: 'canvas_join_session',
    title: 'Join the brainstorming session',
    description: 'Registers an agent as a visible participant. Call this before contributing so the human and other agents know who is present.',
    inputSchema: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Stable declared participant ID.' },
        agentName: { type: 'string', description: 'Short human-readable agent name.' },
        specialty: { type: 'string', description: 'Role such as researcher, critic, strategist, or synthesizer.' },
      },
      required: ['agentId', 'agentName'],
      additionalProperties: false,
    },
    execute: async (input) => {
      const participant: RecordingParticipant = {
        id: text(input.agentId, 'agentId')!,
        name: text(input.agentName, 'agentName')!,
        role: 'agent',
        specialty: text(input.specialty, 'specialty', false),
      }
      const session = recording.joinParticipant(participant)
      report('Agent joined', `${participant.name}${participant.specialty ? `, ${participant.specialty}` : ''}`)
      return response('Agent is now visible in the session', { participant, participants: session.participants })
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
        kind: { type: 'string', enum: ['proposal', 'question', 'critique', 'evidence', 'decision', 'reasoning_summary', 'result'] },
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
        kind: enumValue(input.kind, ['proposal', 'question', 'critique', 'evidence', 'decision', 'reasoning_summary', 'result'] as const),
        content: text(input.content, 'content')!,
        replyTo: text(input.replyTo, 'replyTo', false),
        relatedElementIds: input.relatedElementIds === undefined ? undefined : stringList(input.relatedElementIds, 'relatedElementIds'),
      })
      report('Contribution shared', `${event.participantName}: ${event.kind}`)
      return response('Contribution added to the shared trace', { event })
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
      const actor = input.agentId && input.agentName ? {
        id: text(input.agentId, 'agentId')!, name: text(input.agentName, 'agentName')!, role: 'agent' as const,
      } : undefined
      const session = recording.finalizeRecording(text(input.finalOutput, 'finalOutput')!, actor)
      report('Decision trace finalized', `${session.events.length} events preserved`)
      return response('Finalized multi-agent recording', { session })
    },
  })

  return {
    supported: true,
    count: registeredNames.length,
    cleanup: () => controller.abort(),
  }
}
