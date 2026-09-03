import type { Edge, Node } from '@xyflow/react'

export type ElementKind = 'idea' | 'question' | 'insight' | 'action' | 'frame' | 'artifact'
export type ElementColor = 'paper' | 'sun' | 'mint' | 'sky' | 'rose'

export type ArtifactValue = string | number | boolean | null
export type ArtifactFieldType = 'text' | 'number' | 'status' | 'tag' | 'boolean' | 'date' | 'url'
export type ArtifactKind = 'table' | 'cards' | 'checklist' | 'matrix' | 'custom'

export type ArtifactField = {
  key: string
  label: string
  type: ArtifactFieldType
  required?: boolean
  options?: string[]
}

export type ArtifactSpec = {
  specVersion: '1.0'
  artifactType: ArtifactKind
  title: string
  description?: string
  fields: ArtifactField[]
  records: Array<Record<string, ArtifactValue>>
  presentation: {
    layout: 'table' | 'grid' | 'list'
    density?: 'compact' | 'comfortable'
    visibleFields?: string[]
  }
}

export type BoardNodeData = {
  title: string
  body: string
  kind: ElementKind
  color: ElementColor
  votes: number
  cluster?: string
  artifact?: ArtifactSpec
  justCreated?: boolean
  [key: string]: unknown
}

export type BoardNode = Node<BoardNodeData, 'boardElement'>
export type BoardEdge = Edge

export type BoardSnapshot = {
  name: string
  nodes: BoardNode[]
  edges: BoardEdge[]
  updatedAt: string
}

export type Activity = {
  id: string
  label: string
  detail: string
  source: 'human' | 'agent' | 'system'
  createdAt: string
}

export type ContributionKind = 'proposal' | 'question' | 'critique' | 'evidence' | 'decision' | 'reasoning_summary' | 'result' | 'board_action'

export type RecordingParticipant = {
  id: string
  name: string
  role: 'human' | 'agent' | 'system'
  specialty?: string
}

export type RecordingEvent = {
  id: string
  createdAt: string
  participantId: string
  participantName: string
  participantRole: RecordingParticipant['role']
  kind: ContributionKind
  content: string
  replyTo?: string
  relatedElementIds?: string[]
  metadata?: Record<string, ArtifactValue>
}

export type RecordingSession = {
  specVersion: '1.0'
  id: string
  title: string
  status: 'recording' | 'complete'
  startedAt: string
  completedAt?: string
  participants: RecordingParticipant[]
  events: RecordingEvent[]
  finalOutput?: string
}

export type RecordingActions = {
  getRecording: () => RecordingSession | null
  startRecording: (title?: string, actor?: RecordingParticipant) => RecordingSession
  joinParticipant: (participant: RecordingParticipant) => RecordingSession
  recordContribution: (input: {
    agentId: string
    agentName: string
    kind: Exclude<ContributionKind, 'board_action'>
    content: string
    replyTo?: string
    relatedElementIds?: string[]
  }) => RecordingEvent
  recordUserMessage: (content: string, kind?: 'proposal' | 'question' | 'decision') => RecordingEvent
  finalizeRecording: (finalOutput: string, actor?: RecordingParticipant) => RecordingSession
}

export type AddElementInput = {
  title: string
  body?: string
  kind?: ElementKind
  color?: ElementColor
  x?: number
  y?: number
  cluster?: string
}

export type BoardActions = {
  getSnapshot: () => BoardSnapshot
  addElement: (input: AddElementInput, source?: Activity['source']) => BoardNode
  addElements: (items: AddElementInput[], source?: Activity['source']) => BoardNode[]
  updateElement: (
    id: string,
    patch: Partial<Pick<BoardNodeData, 'title' | 'body' | 'kind' | 'color' | 'votes' | 'cluster'>> & {
      x?: number
      y?: number
    },
    source?: Activity['source'],
  ) => BoardNode
  removeElements: (ids: string[], source?: Activity['source']) => number
  connectElements: (
    sourceId: string,
    targetId: string,
    label?: string,
    source?: Activity['source'],
  ) => BoardEdge
  arrange: (layout: 'grid' | 'columns' | 'radial', source?: Activity['source']) => void
  createCluster: (name: string, elementIds: string[], source?: Activity['source']) => BoardNode
  createArtifact: (spec: ArtifactSpec, x?: number, y?: number, source?: Activity['source']) => BoardNode
  getArtifactSpec: (id: string) => ArtifactSpec
  updateArtifactRecords: (
    id: string,
    records: Array<Record<string, ArtifactValue>>,
    mode?: 'replace' | 'append',
    source?: Activity['source'],
  ) => BoardNode
  focusElements: (ids: string[]) => void
  clear: (source?: Activity['source']) => void
}
