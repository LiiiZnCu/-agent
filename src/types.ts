import type { Edge, Node } from '@xyflow/react'

export type ElementKind = 'idea' | 'question' | 'insight' | 'action' | 'frame' | 'artifact'
export type ElementColor = 'paper' | 'sun' | 'mint' | 'sky' | 'rose'
export type BoardLayout = 'grid' | 'columns' | 'radial' | 'stacked'
export type GroupLayout = 'none' | 'grid' | 'columns' | 'stacked'
export type AgentColor = 'coral' | 'blue' | 'violet' | 'green' | 'amber' | 'pink' | 'cyan' | 'lime'

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
  ideaMeta?: IdeaMeta
  justCreated?: boolean
  [key: string]: unknown
}

export type BoardNode = Node<BoardNodeData, 'boardElement'>
export type BoardEdge = Edge

export type BoardSnapshot = {
  id: string
  name: string
  nodes: BoardNode[]
  edges: BoardEdge[]
  createdAt: string
  updatedAt: string
  sync?: {
    nodeTombstones: Record<string, string>
    edgeTombstones: Record<string, string>
  }
}

export type BrainstormStage = 'collecting' | 'organizing' | 'expanding' | 'integrating' | 'optimizing' | 'deciding' | 'output'
export type IdeaType = 'idea' | 'question' | 'risk' | 'supplement' | 'proposal'
export type BrainstormMember = { id: string; name: string; role: 'facilitator' | 'member'; joinedAt: string }
export type IdeaMeta = { sessionId: string; authorId: string; type: IdeaType; createdAt: string; sourceIdeaIds: string[]; versions: Array<{ authorId: string; createdAt: string }> }
export type AgentActionType = 'create_cluster' | 'connect_ideas' | 'ask_question' | 'suggest_merge' | 'create_matrix' | 'create_summary'
export type AgentSuggestion = { id: string; trigger: 'manual' | 'stage' | 'board_change'; message: string; actions: Array<{ type: AgentActionType; [key: string]: unknown }>; status: 'pending' | 'accepted' | 'rejected' | 'ignored'; ignoredActionTypes: AgentActionType[]; pausedForStage: boolean; boardBeforeAccept?: BoardSnapshot; createdAt: string }
export type Proposal = { id: string; title: string; description: string; sourceIdeaIds: string[]; authorId: string; integrationLogic: string; risks: string[]; openQuestions: string[]; status: 'draft' | 'accepted' | 'rejected'; comments: Array<{ id: string; authorId: string; kind: 'support' | 'oppose' | 'supplement' | 'risk' | 'verify'; content: string; createdAt: string }> }
export type DecisionMatrix = { criteria: Array<{ id: string; name: string; weight: number }>; scores: Array<{ proposalId: string; criterionId: string; memberId: string; score: number; reason: string }>; votes: Array<{ proposalId: string; memberId: string }>; finalProposalId?: string; confirmedBy?: string; confirmedAt?: string }
export type Outcome = { draft: string; finalProposalId?: string; actions: Array<{ title: string; ownerId?: string; dueAt?: string }>; updatedAt: string }
export type BrainstormSession = { id: string; boardId: string; topic: string; goal: string; background: string; constraints: string; stage: BrainstormStage; currentMemberId: string; members: BrainstormMember[]; suggestions: AgentSuggestion[]; proposals: Proposal[]; decision: DecisionMatrix | null; outcome: Outcome | null; createdAt: string; updatedAt: string }

export type Activity = {
  id: string
  label: string
  detail: string
  source: 'human' | 'agent' | 'system'
  actorName?: string
  createdAt: string
  relatedElementIds?: string[]
}

export type LayerAction = 'front' | 'forward' | 'backward' | 'back'

export type BoardSummary = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  elementCount: number
}

export type HostedInvitation = {
  inviteId: string
  agentId: string
  agentName: string
  specialty?: string
  inviteToken: string
  agentUrl: string
}

export type HostedMuralAccess = {
  board: BoardSnapshot
  revision: number
  ownerToken: string
  userToken: string
  ownerUrl: string
  userUrl: string
}

export type ContributionKind = 'proposal' | 'question' | 'critique' | 'evidence' | 'decision' | 'note' | 'reasoning_summary' | 'result' | 'board_action' | 'checkpoint'

export type RecordingParticipant = {
  id: string
  name: string
  role: 'human' | 'agent' | 'system'
  specialty?: string
  status?: 'connecting' | 'active' | 'muted' | 'offline'
  joinedAt?: string
  lastSeenAt?: string
  leaseExpiresAt?: string
  watchingElementIds?: string[]
  color?: AgentColor
  focus?: AgentFocus
}

export type AgentFocus = {
  state: 'editing' | 'reviewing'
  intent: string
  elementIds: string[]
  claimedAt: string
  leaseExpiresAt: string
  releaseOnAction: 'after_write' | 'manual'
}

export type MuralFocusClaim = AgentFocus & {
  participantId: string
  participantName: string
  color?: AgentColor
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
  checkpoint?: {
    label: string
    board: BoardSnapshot
  }
}

export type RecordingSession = {
  specVersion: '1.0'
  id: string
  title: string
  status: 'recording' | 'complete'
  startedAt: string
  completedAt?: string
  boardId?: string
  moderatorId: string
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
    kind: ContributionKind
    content: string
    replyTo?: string
    relatedElementIds?: string[]
    metadata?: Record<string, ArtifactValue>
  }) => RecordingEvent
  recordUserMessage: (content: string, kind?: 'proposal' | 'question' | 'decision' | 'note', relatedElementIds?: string[]) => RecordingEvent
  moderateParticipant: (participantId: string, muted: boolean, moderatorId: string) => RecordingSession
  watchParticipant: (participantId: string, elementIds?: string[], renewFocus?: boolean) => RecordingSession
  setParticipantFocus: (participantId: string, focus: AgentFocus | null) => RecordingSession
  createCheckpoint: (label: string, board: BoardSnapshot, actor?: RecordingParticipant) => RecordingEvent
  updateCheckpoint: (eventId: string, label: string) => RecordingSession
  removeCheckpoint: (eventId: string) => RecordingSession
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
  renameMural: (name: string, source?: Activity['source']) => BoardSnapshot
  arrange: (layout: BoardLayout, source?: Activity['source']) => void
  createCluster: (name: string, elementIds: string[], layout?: GroupLayout, source?: Activity['source']) => BoardNode
  createArtifact: (spec: ArtifactSpec, x?: number, y?: number, source?: Activity['source']) => BoardNode
  getArtifactSpec: (id: string) => ArtifactSpec
  updateArtifactRecords: (
    id: string,
    records: Array<Record<string, ArtifactValue>>,
    mode?: 'replace' | 'append',
    source?: Activity['source'],
  ) => BoardNode
  focusElements: (ids: string[]) => void
  setElementLayer: (id: string, action: LayerAction, source?: Activity['source']) => BoardNode
  clear: (source?: Activity['source']) => void
  createHostedMural: (name: string, initialBoard?: BoardSnapshot) => Promise<HostedMuralAccess>
  createUserShare: (muralId: string, ownerToken: string) => Promise<{ userToken: string; userUrl: string }>
  getAgentFocus: () => MuralFocusClaim[]
  setAgentFocus: (participant: RecordingParticipant, focus: AgentFocus | null) => Promise<MuralFocusClaim[]>
  assertAgentWritable: (participantId: string, elementIds: string[]) => Promise<void>
  createAgentInvites: (muralId: string, ownerToken: string, guests: Array<{ agentId: string; agentName: string; specialty?: string }>) => Promise<HostedInvitation[]>
  redeemAgentInvite: (muralId: string, inviteToken: string) => Promise<Omit<HostedInvitation, 'inviteToken' | 'agentUrl'> & { muralId: string; redeemedAt: string }>
}
