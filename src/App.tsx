import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  type Connection,
  type EdgeChange,
  type NodeChange,
  type ReactFlowInstance,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  ArrowClockwise,
  ArrowCounterClockwise,
  BracketsCurly,
  CaretDown,
  ClockCounterClockwise,
  DownloadSimple,
  Moon,
  Record,
  Rows,
  ShareNetwork,
  SidebarSimple,
  Sun,
} from '@phosphor-icons/react'
import './index.css'
import { AgentPanel, type AgentPanelView } from './components/AgentPanel'
import { BoardLibraryMenu } from './components/BoardLibraryMenu'
import { BoardElement } from './components/BoardElement'
import { CollaborationDock } from './components/CollaborationDock'
import { ConfirmModal } from './components/ConfirmModal'
import { Inspector } from './components/Inspector'
import { LayerMenu } from './components/LayerMenu'
import { ShareModal } from './components/ShareModal'
import { ToolRail } from './components/ToolRail'
import { createBrainstormSession, createIdeaMeta, isOutcomeConfirmed, removeDiscussionReferences, updateIdeaMeta } from './lib/brainstorm'
import { StageNavigator } from './components/StageNavigator'
import { BrainstormPanel } from './components/BrainstormPanel'
import { createArtifactTemplate, validateArtifactSpec } from './lib/artifacts'
import { arrangeGroupNodes, arrangeNodes, calculateClusterBounds, createBoardEdge, createBoardNode, createEmptyBoard, createId, createUUID, moveNodeLayer, serializeSnapshot } from './lib/board'
import { importCanvasRelay, listBoards, loadBoard, loadBoardById } from './lib/storage'
import { loadBrainstorm, saveBrainstormBoard } from './lib/brainstorm-storage'
import { acceptSuggestion, receiveSuggestion, suggestionContext, undoSuggestion, visibleSuggestions } from './lib/brainstorm-actions'
import { validateBrainstormPayload } from './lib/brainstorm-validation'
import { assertHostedWritable, createAgentInvites as createHostedAgentInvites, createHostedMural as createHostedMuralApi, createUserShare as createHostedUserShare, getBackendHealth, loadHostedMural, redeemAgentInvite as redeemHostedAgentInvite, requestBrainstormSuggestions, saveHostedMural, setHostedFocus, syncBrainstorm, syncRecording } from './lib/api'
import { activeFocusParticipants, addRecordingCheckpoint, appendEvent, completeRecording, createRecordingSession, deleteRecordingCheckpoint, joinRecording, loadRecording, moderateRecording, recordingToCsv, recordingToMarkdown, renameRecordingCheckpoint, saveRecording, setRecordingFocus, watchRecording } from './lib/recording'
import { registerWebMCP, TOOL_CATALOG } from './lib/webmcp'
import type {
  Activity,
  AddElementInput,
  ArtifactSpec,
  BoardActions,
  BoardEdge,
  BoardNode,
  BoardSnapshot,
  BoardSummary,
  BrainstormSession,
  ElementKind,
  IdeaType,
  LayerAction,
  MuralFocusClaim,
  RecordingActions,
  RecordingSession,
  SuggestionReason,
} from './types'

const NODE_TYPES = { boardElement: BoardElement }
type HistoryEntry = { board: BoardSnapshot; discussion: BrainstormSession | null; aiSuggestionId?: string }

function copySnapshot(snapshot: BoardSnapshot): BoardSnapshot {
  return structuredClone(snapshot)
}

function nodeSyncVersion(node: BoardNode) {
  return typeof node.data._syncVersion === 'string' ? node.data._syncVersion : ''
}

function edgeSyncVersion(edge: BoardEdge) {
  const data = edge.data as Record<string, unknown> | undefined
  return typeof data?._syncVersion === 'string' ? data._syncVersion : ''
}

function comparableNode(node: BoardNode) {
  const { selected: _selected, dragging: _dragging, measured: _measured, ...stable } = node
  const { _syncVersion, justCreated: _justCreated, ...data } = stable.data
  return { ...stable, data }
}

function Workspace() {
  const [fresh] = useState(() => !new URLSearchParams(window.location.search).has('mural') && listBoards().length === 0)
  const [initial] = useState<BoardSnapshot>(() => {
    const requestedId = new URLSearchParams(window.location.search).get('mural')
    if (!requestedId && fresh) return createEmptyBoard()
    if (!requestedId) return loadBoard(createEmptyBoard())
    const local = loadBoardById(requestedId)
    if (local) return local
    const placeholder = createEmptyBoard('正在打开共享白板')
    return { ...placeholder, id: requestedId }
  })
  const [showCreation, setShowCreation] = useState(fresh)
  const [session, setSession] = useState<BrainstormSession | null>(() => loadBrainstorm(initial))
  const [discussionDraft, setDiscussionDraft] = useState({ topic: '', goal: '', background: '', constraints: '', memberName: '' })
  const [boardId, setBoardId] = useState(initial.id)
  const [boardCreatedAt, setBoardCreatedAt] = useState(initial.createdAt)
  const [name, setName] = useState(initial.name)
  const [nameDraft, setNameDraft] = useState(initial.name)
  const [nodes, setNodes] = useState<BoardNode[]>(initial.nodes)
  const [edges, setEdges] = useState<BoardEdge[]>(initial.edges)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [agentOpen, setAgentOpen] = useState(true)
  const [panelView, setPanelView] = useState<AgentPanelView>('stream')
  const [inspectorMinimized, setInspectorMinimized] = useState(() => window.localStorage.getItem('canvas-relay-inspector-minimized') === 'true')
  const [boardList, setBoardList] = useState<BoardSummary[]>(() => listBoards())
  const [layerMenu, setLayerMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null)
  const [activities, setActivities] = useState<Activity[]>([])
  const [recording, setRecording] = useState<RecordingSession | null>(() => loadRecording(initial.id))
  const [replayCheckpointId, setReplayCheckpointId] = useState<string | null>(null)
  const [hostedAccessToken, setHostedAccessToken] = useState(() => {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    return fragment.get('owner') || fragment.get('access') || fragment.get('invite') || ''
  })
  const [hostedRole, setHostedRole] = useState<'owner' | 'user' | 'agent' | null>(() => {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    return fragment.has('owner') ? 'owner' : fragment.has('access') ? 'user' : fragment.has('invite') ? 'agent' : null
  })
  const [hostedFocusClaims, setHostedFocusClaims] = useState<MuralFocusClaim[]>([])
  const [presenceNow, setPresenceNow] = useState(() => Date.now())
  const [shareOpen, setShareOpen] = useState(false)
  const [shareUrl, setShareUrl] = useState('')
  const [shareLoading, setShareLoading] = useState(false)
  const [shareCopied, setShareCopied] = useState(false)
  const [shareError, setShareError] = useState('')
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [backendState, setBackendState] = useState<'checking' | 'offline' | 'syncing' | 'synced'>('checking')
  const webMCPState = useMemo(() => {
    const supported = Boolean(document.modelContext?.registerTool ?? navigator.modelContext?.registerTool)
    return { supported, count: supported ? TOOL_CATALOG.length : 0 }
  }, [])
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    const stored = window.localStorage.getItem('canvas-relay-theme')
    if (stored === 'light' || stored === 'dark') return stored
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const [toast, setToast] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<{ title: string; description: string; confirmLabel: string; onConfirm: () => void } | null>(null)
  const [instanceId] = useState(() => createUUID())
  const flowRef = useRef<ReactFlowInstance<BoardNode, BoardEdge> | null>(null)
  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)
  const nameRef = useRef(name)
  const boardIdRef = useRef(boardId)
  const boardCreatedAtRef = useRef(boardCreatedAt)
  const historyRef = useRef<HistoryEntry[]>([])
  const futureRef = useRef<HistoryEntry[]>([])
  const sessionRef = useRef(session)
  const aiTransactionRef = useRef(false)
  const suggestionRequestRef = useRef(false)
  const recordingRef = useRef(recording)
  const broadcastRef = useRef<BroadcastChannel | null>(null)
  const remoteSyncRef = useRef(false)
  const syncCounterRef = useRef(0)
  const nodeTombstonesRef = useRef<Record<string, string>>({})
  const edgeTombstonesRef = useRef<Record<string, string>>({})
  const hostedRevisionRef = useRef(0)
  const hostedReadyRef = useRef(false)
  const hostedPullRef = useRef(false)
  const syncedDiscussionRef = useRef('')
  const contentVersionRef = useRef(0)
  const saveRequestRef = useRef(0)
  const snapshotClockRef = useRef(Date.parse(initial.updatedAt))
  const [historyStatus, setHistoryStatus] = useState({ canUndo: false, canRedo: false })

  const reviseDiscussionNode = useCallback((node: BoardNode) => {
    setSession((current) => current ? {
      ...current,
      proposals: current.proposals.map((proposal) => proposal.id === node.id ? { ...proposal, title: node.data.title, description: node.data.body } : proposal),
      decision: current.decision ? { ...current.decision, confirmedAt: undefined, confirmedBy: undefined } : null,
      updatedAt: new Date().toISOString(),
    } : null)
  }, [])

  useEffect(() => { nodesRef.current = nodes }, [nodes])
  useEffect(() => { sessionRef.current = session }, [session])
  useEffect(() => { edgesRef.current = edges }, [edges])
  useEffect(() => { nameRef.current = name }, [name])
  useEffect(() => { boardIdRef.current = boardId }, [boardId])
  useEffect(() => { boardCreatedAtRef.current = boardCreatedAt }, [boardCreatedAt])
  useEffect(() => { recordingRef.current = recording }, [recording])
  useEffect(() => { contentVersionRef.current += 1 }, [boardId, name, nodes, edges, session])

  useEffect(() => {
    if (!recording || recording.status !== 'recording') return
    const timer = window.setInterval(() => setPresenceNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [recording])

  useEffect(() => {
    if (showCreation) return
    const url = new URL(window.location.href)
    url.searchParams.set('mural', boardId)
    window.history.replaceState({}, '', url)
  }, [boardId, showCreation])

  const snapshotNow = useCallback((): BoardSnapshot => {
    // 同一毫秒内的连续快照也必须有严格递增的保存版本。
    snapshotClockRef.current = Math.max(Date.now(), snapshotClockRef.current + 1)
    return {
      id: boardIdRef.current,
      brainstormSessionId: sessionRef.current?.id,
      name: nameRef.current,
      nodes: structuredClone(nodesRef.current.map(({ selected: _selected, dragging: _dragging, ...node }) => node)),
      edges: structuredClone(edgesRef.current),
      createdAt: boardCreatedAtRef.current,
      updatedAt: new Date(snapshotClockRef.current).toISOString(),
      sync: {
        nodeTombstones: structuredClone(nodeTombstonesRef.current),
        edgeTombstones: structuredClone(edgeTombstonesRef.current),
      },
    }
  }, [])

  useEffect(() => {
    if (!('BroadcastChannel' in window)) return
    const channel = new BroadcastChannel(`canvas-relay-mural:${boardId}`)
    broadcastRef.current = channel
    channel.onmessage = (event: MessageEvent<{ type: 'hello' | 'sync'; sender: string; board?: BoardSnapshot; recording?: RecordingSession | null; nodeTombstones?: Record<string, string>; edgeTombstones?: Record<string, string> }>) => {
      const message = event.data
      if (!message || message.sender === instanceId) return
      if (message.type === 'hello') {
        channel.postMessage({ type: 'sync', sender: instanceId, board: snapshotNow(), recording: recordingRef.current, nodeTombstones: nodeTombstonesRef.current, edgeTombstones: edgeTombstonesRef.current })
        return
      }
      if (message.type !== 'sync' || !message.board || message.board.id !== boardIdRef.current) return
      remoteSyncRef.current = true
      const board = copySnapshot(message.board)
      const incomingNodeTombstones = message.nodeTombstones ?? {}
      const incomingEdgeTombstones = message.edgeTombstones ?? {}
      nodeTombstonesRef.current = { ...nodeTombstonesRef.current, ...incomingNodeTombstones }
      edgeTombstonesRef.current = { ...edgeTombstonesRef.current, ...incomingEdgeTombstones }
      const localNodes = new Map(nodesRef.current.map((node) => [node.id, node]))
      board.nodes.forEach((remoteNode) => {
        const tombstone = nodeTombstonesRef.current[remoteNode.id] ?? ''
        const local = localNodes.get(remoteNode.id)
        const currentVersion = [nodeSyncVersion(local ?? remoteNode), tombstone].sort().at(-1) ?? ''
        if (nodeSyncVersion(remoteNode) > currentVersion || !local && nodeSyncVersion(remoteNode) >= tombstone) {
          localNodes.set(remoteNode.id, remoteNode)
        }
      })
      Object.entries(incomingNodeTombstones).forEach(([id, version]) => {
        const local = localNodes.get(id)
        if (!local || version >= nodeSyncVersion(local)) localNodes.delete(id)
      })
      const localEdges = new Map(edgesRef.current.map((edge) => [edge.id, edge]))
      board.edges.forEach((remoteEdge) => {
        const tombstone = edgeTombstonesRef.current[remoteEdge.id] ?? ''
        const local = localEdges.get(remoteEdge.id)
        const currentVersion = [edgeSyncVersion(local ?? remoteEdge), tombstone].sort().at(-1) ?? ''
        if (edgeSyncVersion(remoteEdge) > currentVersion || !local && edgeSyncVersion(remoteEdge) >= tombstone) {
          localEdges.set(remoteEdge.id, remoteEdge)
        }
      })
      Object.entries(incomingEdgeTombstones).forEach(([id, version]) => {
        const local = localEdges.get(id)
        if (!local || version >= edgeSyncVersion(local)) localEdges.delete(id)
      })
      board.nodes = [...localNodes.values()]
      board.edges = [...localEdges.values()].filter((edge) => localNodes.has(edge.source) && localNodes.has(edge.target))
      nameRef.current = board.name
      setNameDraft(board.name)
      nodesRef.current = board.nodes
      edgesRef.current = board.edges
      setName(board.name)
      setNodes(board.nodes)
      setEdges(board.edges)
      const localRecording = recordingRef.current
      const remoteRecording = message.recording ?? null
      const nextRecording = localRecording && remoteRecording && localRecording.id === remoteRecording.id
        ? {
            ...(remoteRecording.status === 'complete' ? remoteRecording : localRecording),
            participants: [...new Map([...localRecording.participants, ...remoteRecording.participants].map((participant) => [participant.id, participant])).values()],
            events: [...new Map([...localRecording.events, ...remoteRecording.events].map((item) => [item.id, item])).values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)),
          }
        : remoteRecording ?? localRecording
      recordingRef.current = nextRecording
      setRecording(nextRecording)
      setSaveState('saving')
    }
    channel.postMessage({ type: 'hello', sender: instanceId })
    return () => {
      channel.close()
      if (broadcastRef.current === channel) broadcastRef.current = null
    }
  }, [boardId, instanceId, snapshotNow])

  useEffect(() => {
    if (remoteSyncRef.current) {
      remoteSyncRef.current = false
      return
    }
    broadcastRef.current?.postMessage({ type: 'sync', sender: instanceId, board: snapshotNow(), recording, nodeTombstones: nodeTombstonesRef.current, edgeTombstones: edgeTombstonesRef.current })
  }, [boardId, edges, instanceId, name, nodes, recording, snapshotNow])

  const currentHuman = useCallback((memberId?: string) => {
    const discussion = sessionRef.current
    const member = discussion?.boardId === boardIdRef.current
      ? discussion.members.find((candidate) => candidate.id === (memberId ?? discussion.currentMemberId))
      : undefined
    if (!member) throw new Error('请先添加明确成员。')
    return { id: member.id, name: member.name, role: 'human' as const }
  }, [])

  const reportActivity = useCallback((label: string, detail: string, source: Activity['source'] = 'system', relatedElementIds?: string[], recordInTrace = true) => {
    const discussion = sessionRef.current
    const member = discussion?.boardId === boardIdRef.current
      ? discussion.members.find((candidate) => candidate.id === discussion.currentMemberId)
      : undefined
    const activity: Activity = {
      id: createId('activity'),
      label,
      detail,
      source,
      actorName: source === 'agent' ? '代理' : source === 'human' ? member?.name : '系统',
      createdAt: new Date().toISOString(),
      relatedElementIds,
    }
    setActivities((current) => [activity, ...current].slice(0, 30))
    const activeRecording = recordingRef.current
    if (recordInTrace && source !== 'agent' && activeRecording?.status === 'recording' && (source !== 'human' || member)) {
      const participant = source === 'human'
          ? currentHuman()
          : { id: 'canvas-relay', name: '系统', role: 'system' as const }
      const next = appendEvent(activeRecording, {
        participantId: participant.id,
        participantName: participant.name,
        participantRole: participant.role,
        kind: 'board_action',
        content: `${label}: ${detail}`,
        relatedElementIds,
      })
      recordingRef.current = next
      setRecording(next)
    }
  }, [currentHuman])

  const announce = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast((current) => current === message ? null : current), 2400)
  }, [])

  const clearHostedAccess = useCallback(() => {
    hostedReadyRef.current = false
    hostedRevisionRef.current = 0
    hostedPullRef.current = false
    setHostedAccessToken('')
    setHostedRole(null)
    setHostedFocusClaims([])
    setShareUrl('')
    const url = new URL(window.location.href)
    url.hash = ''
    window.history.replaceState({}, '', url)
  }, [])

  const recordHistory = useCallback(() => {
    if (aiTransactionRef.current) return
    historyRef.current = [...historyRef.current.slice(-39), { board: copySnapshot(snapshotNow()), discussion: structuredClone(sessionRef.current) }]
    futureRef.current = []
    setHistoryStatus({ canUndo: true, canRedo: false })
  }, [snapshotNow])

  const applySnapshot = useCallback((snapshot: BoardSnapshot, preserveSelection = false) => {
    const copy = copySnapshot(snapshot)
    snapshotClockRef.current = Math.max(snapshotClockRef.current, Date.parse(copy.updatedAt))
    if (copy.sync) {
      nodeTombstonesRef.current = { ...nodeTombstonesRef.current, ...copy.sync.nodeTombstones }
      edgeTombstonesRef.current = { ...edgeTombstonesRef.current, ...copy.sync.edgeTombstones }
    }
    if (copy.id !== boardIdRef.current) {
      sessionRef.current = null
      setSession(null)
      nodeTombstonesRef.current = { ...(copy.sync?.nodeTombstones ?? {}) }
      edgeTombstonesRef.current = { ...(copy.sync?.edgeTombstones ?? {}) }
    } else {
      const version = `${Date.now().toString().padStart(13, '0')}:${instanceId}:${String(++syncCounterRef.current).padStart(6, '0')}`
      const nextNodeIds = new Set(copy.nodes.map((node) => node.id))
      nodesRef.current.forEach((node) => {
        if (!nextNodeIds.has(node.id)) nodeTombstonesRef.current[node.id] = version
      })
      const previousNodes = new Map(nodesRef.current.map((node) => [node.id, node]))
      copy.nodes = copy.nodes.map((node) => {
        const previous = previousNodes.get(node.id)
        return !previous || JSON.stringify(comparableNode(previous)) !== JSON.stringify(comparableNode(node))
          ? { ...node, data: { ...node.data, _syncVersion: version } }
          : node
      })
      const nextEdgeIds = new Set(copy.edges.map((edge) => edge.id))
      edgesRef.current.forEach((edge) => {
        if (!nextEdgeIds.has(edge.id)) edgeTombstonesRef.current[edge.id] = version
      })
      const previousEdges = new Map(edgesRef.current.map((edge) => [edge.id, edge]))
      copy.edges = copy.edges.map((edge) => previousEdges.has(edge.id) ? edge : { ...edge, data: { ...(edge.data ?? {}), _syncVersion: version } })
    }
    if (preserveSelection) {
      const selectedIds = new Set(nodesRef.current.filter((node) => node.selected).map((node) => node.id))
      copy.nodes = copy.nodes.map((node) => selectedIds.has(node.id) ? { ...node, selected: true } : node)
    }
    boardIdRef.current = copy.id
    boardCreatedAtRef.current = copy.createdAt
    nameRef.current = copy.name
    nodesRef.current = copy.nodes
    edgesRef.current = copy.edges
    setBoardId(copy.id)
    setBoardCreatedAt(copy.createdAt)
    setName(copy.name)
    setNameDraft(copy.name)
    setNodes(copy.nodes)
    setEdges(copy.edges)
    if (!preserveSelection) {
      setSelectedId(null)
      setLayerMenu(null)
    } else {
      setSelectedId((current) => current && copy.nodes.some((node) => node.id === current) ? current : null)
    }
  }, [instanceId])

  const undo = useCallback(() => {
    const previous = historyRef.current.pop()
    if (!previous) return
    futureRef.current = [{ board: copySnapshot(snapshotNow()), discussion: structuredClone(sessionRef.current), aiSuggestionId: previous.aiSuggestionId }, ...futureRef.current.slice(0, 39)]
    applySnapshot(previous.board, true)
    sessionRef.current = previous.discussion
    setSession(previous.discussion)
    setHistoryStatus({ canUndo: historyRef.current.length > 0, canRedo: true })
    reportActivity('撤销', '已恢复到上一个白板状态', 'human')
  }, [applySnapshot, reportActivity, snapshotNow])

  const redo = useCallback(() => {
    const next = futureRef.current.shift()
    if (!next) return
    historyRef.current.push({ board: copySnapshot(snapshotNow()), discussion: structuredClone(sessionRef.current), aiSuggestionId: next.aiSuggestionId })
    applySnapshot(next.board, true)
    sessionRef.current = next.discussion
    setSession(next.discussion)
    setHistoryStatus({ canUndo: true, canRedo: futureRef.current.length > 0 })
    reportActivity('重做', '已重新应用白板更改', 'human')
  }, [applySnapshot, reportActivity, snapshotNow])

  const commitNodes = useCallback((next: BoardNode[]) => {
    const version = `${Date.now().toString().padStart(13, '0')}:${instanceId}:${String(++syncCounterRef.current).padStart(6, '0')}`
    const previous = new Map(nodesRef.current.map((node) => [node.id, node]))
    const nextIds = new Set(next.map((node) => node.id))
    previous.forEach((_node, id) => {
      if (!nextIds.has(id)) nodeTombstonesRef.current[id] = version
    })
    const stamped = next.map((node) => {
      const before = previous.get(node.id)
      const changed = !before || JSON.stringify(comparableNode(before)) !== JSON.stringify(comparableNode(node))
      if (!changed) return node
      delete nodeTombstonesRef.current[node.id]
      return { ...node, data: { ...node.data, _syncVersion: version } }
    })
    nodesRef.current = stamped
    setNodes(stamped)
    setSaveState('saving')
  }, [instanceId])

  const commitEdges = useCallback((next: BoardEdge[]) => {
    const version = `${Date.now().toString().padStart(13, '0')}:${instanceId}:${String(++syncCounterRef.current).padStart(6, '0')}`
    const previous = new Map(edgesRef.current.map((edge) => [edge.id, edge]))
    const nextIds = new Set(next.map((edge) => edge.id))
    previous.forEach((_edge, id) => {
      if (!nextIds.has(id)) edgeTombstonesRef.current[id] = version
    })
    const stamped = next.map((edge) => {
      const before = previous.get(edge.id)
      if (before && JSON.stringify({ ...before, data: undefined }) === JSON.stringify({ ...edge, data: undefined })) return edge
      delete edgeTombstonesRef.current[edge.id]
      return { ...edge, data: { ...(edge.data ?? {}), _syncVersion: version } }
    })
    edgesRef.current = stamped
    setEdges(stamped)
    setSaveState('saving')
  }, [instanceId])

  const changeDiscussion = useCallback((next: BrainstormSession) => {
    const current = sessionRef.current
    if (!current || JSON.stringify(current) === JSON.stringify(next)) return
    recordHistory()
    const nextNodes = nodesRef.current.map((node) => {
      const proposal = next.proposals.find((item) => item.id === node.id)
      const previous = current.proposals.find((item) => item.id === node.id)
      if (!proposal || !previous || JSON.stringify([proposal.title, proposal.description, proposal.integrationLogic, proposal.risks, proposal.openQuestions, proposal.sourceIdeaIds]) === JSON.stringify([previous.title, previous.description, previous.integrationLogic, previous.risks, previous.openQuestions, previous.sourceIdeaIds])) return node
      return { ...node, data: { ...node.data, title: proposal.title, body: proposal.description, ideaMeta: node.data.ideaMeta ? updateIdeaMeta({ ...node.data.ideaMeta, sourceIdeaIds: proposal.sourceIdeaIds }, next.currentMemberId, new Date().toISOString()) : undefined } }
    })
    if (nextNodes.some((node, index) => node !== nodesRef.current[index])) commitNodes(nextNodes)
    sessionRef.current = next
    setSession(next)
  }, [commitNodes, recordHistory])

  const getCenterPosition = useCallback((offset = 0) => {
    const flow = flowRef.current
    if (!flow) return { x: 180 + offset, y: 140 + offset }
    return flow.screenToFlowPosition({
      x: Math.max(280, window.innerWidth / 2) + offset,
      y: window.innerHeight / 2 + offset,
    })
  }, [])

  const addElement = useCallback((input: AddElementInput, source: Activity['source'] = 'human') => {
    const discussion = sessionRef.current
    recordHistory()
    const fallback = getCenterPosition(nodesRef.current.length % 5 * 24)
    const node = createBoardNode(input, fallback)
    if (discussion && node.data.kind !== 'frame') {
      node.data.ideaMeta = createIdeaMeta({ sessionId: discussion.id, authorId: discussion.currentMemberId, type: input.ideaType ?? (node.data.kind === 'question' ? 'question' : node.data.kind === 'insight' ? 'evidence' : 'idea'), createdAt: new Date().toISOString() })
    }
    if (!input.title.trim()) node.data.title = ''
    node.selected = true
    const next = [...nodesRef.current.map((existing) => ({ ...existing, selected: false })), node]
    commitNodes(next)
    if (discussion && input.ideaType === 'proposal') {
      const nextDiscussion: BrainstormSession = { ...discussion, proposals: [...discussion.proposals, { id: node.id, title: node.data.title, description: node.data.body, sourceIdeaIds: [], authorId: discussion.currentMemberId, integrationLogic: '', risks: [], openQuestions: [], status: 'draft', comments: [] }], decision: discussion.decision ? { ...discussion.decision, confirmedAt: undefined, confirmedBy: undefined } : null, updatedAt: new Date().toISOString() }
      sessionRef.current = nextDiscussion
      setSession(nextDiscussion)
    }
    setSelectedId(node.id)
    reportActivity('已添加元素', node.data.title, source, [node.id])
    return node
  }, [commitNodes, getCenterPosition, recordHistory, reportActivity])

  const addElements = useCallback((items: AddElementInput[], source: Activity['source'] = 'agent') => {
    if (!items.length) throw new Error('至少需要一个元素。')
    recordHistory()
    const origin = getCenterPosition()
    const created = items.map((item, index) => createBoardNode(item, {
      x: origin.x + (index % 3) * 270,
      y: origin.y + Math.floor(index / 3) * 190,
    }))
    commitNodes([...nodesRef.current, ...created])
    reportActivity('已添加一组想法', `已创建 ${created.length} 个元素`, source, created.map((node) => node.id))
    return created
  }, [commitNodes, getCenterPosition, recordHistory, reportActivity])

  const updateElement = useCallback<BoardActions['updateElement']>((id, patch, source = 'human') => {
    const existing = nodesRef.current.find((node) => node.id === id)
    if (!existing) throw new Error(`未找到元素 ${id}。`)
    recordHistory()
    const cleanData = Object.fromEntries(Object.entries(patch).filter(([key, value]) => value !== undefined && key !== 'x' && key !== 'y'))
    const updated: BoardNode = {
      ...existing,
      position: {
        x: patch.x ?? existing.position.x,
        y: patch.y ?? existing.position.y,
      },
      data: { ...existing.data, ...cleanData, justCreated: source === 'agent' },
    }
    const contentChanged = (patch.title !== undefined && patch.title !== existing.data.title)
      || (patch.body !== undefined && patch.body !== existing.data.body)
      || (patch.ideaMeta !== undefined && JSON.stringify(patch.ideaMeta.sourceIdeaIds) !== JSON.stringify(existing.data.ideaMeta?.sourceIdeaIds))
    if (contentChanged && updated.data.ideaMeta && sessionRef.current) updated.data.ideaMeta = updateIdeaMeta(updated.data.ideaMeta, sessionRef.current.currentMemberId, new Date().toISOString())
    commitNodes(nodesRef.current.map((node) => node.id === id ? updated : node))
    reviseDiscussionNode(updated)
    reportActivity('已更新元素', updated.data.title, source, [updated.id])
    return updated
  }, [commitNodes, recordHistory, reportActivity, reviseDiscussionNode])

  const removeElements = useCallback((ids: string[], source: Activity['source'] = 'human') => {
    const validIds = new Set(nodesRef.current.filter((node) => ids.includes(node.id)).map((node) => node.id))
    if (!validIds.size) return 0
    recordHistory()
    const remaining = removeDiscussionReferences(sessionRef.current, nodesRef.current, validIds)
    commitNodes(remaining.nodes)
    commitEdges(edgesRef.current.filter((edge) => !validIds.has(edge.source) && !validIds.has(edge.target)))
    sessionRef.current = remaining.session
    setSession(remaining.session)
    setSelectedId((current) => current && validIds.has(current) ? null : current)
    reportActivity('已删除元素', `已删除 ${validIds.size} 个`, source)
    return validIds.size
  }, [commitEdges, commitNodes, recordHistory, reportActivity])

  const connectElements = useCallback<BoardActions['connectElements']>((sourceId, targetId, label, source = 'human') => {
    if (!nodesRef.current.some((node) => node.id === sourceId)) throw new Error(`未找到来源元素 ${sourceId}。`)
    if (!nodesRef.current.some((node) => node.id === targetId)) throw new Error(`未找到目标元素 ${targetId}。`)
    recordHistory()
    const edge = createBoardEdge(sourceId, targetId, label)
    commitEdges(addEdge(edge, edgesRef.current))
    reportActivity('已连接元素', label || '新关系', source, [sourceId, targetId])
    return edge
  }, [commitEdges, recordHistory, reportActivity])

  const renameMural = useCallback<BoardActions['renameMural']>((nextName, source = 'human') => {
    const clean = nextName.trim().slice(0, 80) || '未命名讨论'
    if (clean === nameRef.current) {
      setNameDraft(clean)
      return snapshotNow()
    }
    recordHistory()
    const previous = nameRef.current
    nameRef.current = clean
    setName(clean)
    setNameDraft(clean)
    setSaveState('saving')
    reportActivity('已重命名白板', `${previous} → ${clean}`, source)
    return { ...snapshotNow(), name: clean }
  }, [recordHistory, reportActivity, snapshotNow])

  const arrange = useCallback<BoardActions['arrange']>((layout, source = 'human') => {
    recordHistory()
    const next = arrangeNodes(nodesRef.current, layout)
    commitNodes(next)
    reportActivity('已排列白板', `已应用${layout}布局`, source, next.filter((node) => node.data.kind !== 'frame').slice(0, 12).map((node) => node.id))
    window.setTimeout(() => flowRef.current?.fitView({ padding: 0.18, duration: 450 }), 30)
  }, [commitNodes, recordHistory, reportActivity])

  const createCluster = useCallback<BoardActions['createCluster']>((clusterName, elementIds, layout = 'none', source = 'agent') => {
    const uniqueIds = [...new Set(elementIds)]
    recordHistory()
    const arranged = arrangeGroupNodes(nodesRef.current, uniqueIds, layout)
    const bounds = calculateClusterBounds(arranged, uniqueIds)
    const frame = createBoardNode({ title: clusterName, body: `${uniqueIds.length} 个关联元素`, kind: 'frame', color: 'paper', x: bounds.x, y: bounds.y })
    frame.style = { width: bounds.width, height: bounds.height }
    const members = arranged.map((node) => uniqueIds.includes(node.id)
      ? { ...node, data: { ...node.data, cluster: clusterName } }
      : node)
    commitNodes([frame, ...members])
    reportActivity('已创建分类', `${clusterName}，${layout === 'none' ? '保留原位置' : `已应用${layout}布局`}`, source, [frame.id, ...uniqueIds])
    return frame
  }, [commitNodes, recordHistory, reportActivity])

  const createArtifact = useCallback<BoardActions['createArtifact']>((candidate, x, y, source = 'human') => {
    const spec = validateArtifactSpec(candidate)
    recordHistory()
    const fallback = getCenterPosition()
    const node = createBoardNode({ title: spec.title, body: spec.description, kind: 'artifact', color: 'paper', x: x ?? fallback.x, y: y ?? fallback.y }, fallback)
    node.data.artifact = spec
    node.style = { width: spec.presentation.layout === 'grid' ? 560 : 620 }
    const next = [...nodesRef.current, node]
    commitNodes(next)
    setSelectedId(node.id)
    reportActivity('已创建结构化内容', `${spec.title}，${spec.records.length} 条记录`, source, [node.id])
    return node
  }, [commitNodes, getCenterPosition, recordHistory, reportActivity])

  const getArtifactSpec = useCallback((id: string): ArtifactSpec => {
    const node = nodesRef.current.find((candidate) => candidate.id === id)
    if (!node?.data.artifact) throw new Error(`未找到结构化内容 ${id}。`)
    return structuredClone(node.data.artifact)
  }, [])

  const updateArtifactRecords = useCallback<BoardActions['updateArtifactRecords']>((id, records, mode = 'replace', source = 'agent') => {
    const existing = nodesRef.current.find((node) => node.id === id)
    if (!existing?.data.artifact) throw new Error(`未找到结构化内容 ${id}。`)
    const nextRecords = mode === 'append' ? [...existing.data.artifact.records, ...records] : records
    const artifact = validateArtifactSpec({ ...existing.data.artifact, records: nextRecords })
    recordHistory()
    const updated = { ...existing, data: { ...existing.data, artifact, title: artifact.title, justCreated: source === 'agent' } }
    commitNodes(nodesRef.current.map((node) => node.id === id ? updated : node))
    reportActivity('已更新结构化内容', `共 ${artifact.records.length} 条记录`, source, [updated.id])
    return updated
  }, [commitNodes, recordHistory, reportActivity])

  const focusElements = useCallback((ids: string[]) => {
    const valid = nodesRef.current.filter((node) => ids.includes(node.id))
    if (!valid.length) throw new Error('未找到请求的元素。')
    commitNodes(nodesRef.current.map((node) => ({ ...node, selected: ids.includes(node.id) })))
    setSelectedId(valid[0].id)
    flowRef.current?.fitView({ nodes: valid, padding: 0.35, duration: 450 })
  }, [commitNodes])

  const clearSelection = useCallback(() => {
    const next = nodesRef.current.map((node) => node.selected ? { ...node, selected: false } : node)
    nodesRef.current = next
    setNodes(next)
    setSelectedId(null)
  }, [])

  const setElementLayer = useCallback<BoardActions['setElementLayer']>((id, action, source = 'human') => {
    const existing = nodesRef.current.find((node) => node.id === id)
    if (!existing) throw new Error(`未找到元素 ${id}。`)
    recordHistory()
    const next = moveNodeLayer(nodesRef.current, id, action)
    commitNodes(next)
    const updated = next.find((node) => node.id === id)!
    const labels: Record<LayerAction, string> = { front: '已置于顶层', forward: '已上移一层', backward: '已下移一层', back: '已置于底层' }
    reportActivity(labels[action], existing.data.title, source, [id])
    setLayerMenu(null)
    return updated
  }, [commitNodes, recordHistory, reportActivity])

  const clear = useCallback((source: Activity['source'] = 'human') => {
    recordHistory()
    commitNodes([])
    commitEdges([])
    setSelectedId(null)
    reportActivity('已清空白板', '已删除全部元素', source)
  }, [commitEdges, commitNodes, recordHistory, reportActivity])

  const createHostedMural = useCallback<BoardActions['createHostedMural']>(async (title, initialBoard) => {
    const discussion = sessionRef.current
    saveBrainstormBoard(snapshotNow(), discussion)
    const hosted = await createHostedMuralApi(title, initialBoard)
    let hostedDiscussion: BrainstormSession | null = null
    if (discussion && initialBoard?.id === discussion.boardId) {
      const nextId = createUUID()
      const remapBoard = (board: BoardSnapshot): BoardSnapshot => ({ ...board, id: hosted.board.id, brainstormSessionId: nextId, nodes: board.nodes.map((node) => node.data.ideaMeta ? { ...node, data: { ...node.data, ideaMeta: { ...node.data.ideaMeta, sessionId: nextId } } } : node) })
      const remapDiscussion = (snapshot: Omit<BrainstormSession, 'suggestions'>) => ({ ...structuredClone(snapshot), id: nextId, boardId: hosted.board.id })
      hosted.board = remapBoard(hosted.board)
      hostedDiscussion = { ...structuredClone(discussion), id: nextId, boardId: hosted.board.id, suggestions: discussion.suggestions.map((suggestion) => {
        const context = suggestion.context ? JSON.parse(suggestion.context) as { board: BoardSnapshot; session: BrainstormSession } : null
        return { ...suggestion,
          context: context ? suggestionContext(remapBoard(context.board), { ...remapDiscussion(context.session), suggestions: [] }) : undefined,
          boardAtRequest: suggestion.boardAtRequest ? remapBoard(suggestion.boardAtRequest) : undefined,
          boardBeforeAccept: suggestion.boardBeforeAccept ? remapBoard(suggestion.boardBeforeAccept) : undefined,
          boardAfterAccept: suggestion.boardAfterAccept ? remapBoard(suggestion.boardAfterAccept) : undefined,
          sessionBeforeAccept: suggestion.sessionBeforeAccept ? remapDiscussion(suggestion.sessionBeforeAccept) : undefined,
          sessionAfterAccept: suggestion.sessionAfterAccept ? remapDiscussion(suggestion.sessionAfterAccept) : undefined,
        }
      }), updatedAt: new Date().toISOString() }
      const saved = await saveHostedMural(hosted.board, hosted.ownerToken)
      hosted.board = saved.board
      hosted.revision = saved.revision
      await syncBrainstorm(hostedDiscussion, hosted.board, hosted.ownerToken)
      syncedDiscussionRef.current = JSON.stringify(hostedDiscussion)
    }
    hostedRevisionRef.current = hosted.revision
    hostedReadyRef.current = true
    setHostedAccessToken(hosted.ownerToken)
    setHostedRole('owner')
    setHostedFocusClaims([])
    setShareUrl(hosted.userUrl)
    const url = new URL(window.location.href)
    url.searchParams.set('mural', hosted.board.id)
    url.hash = `owner=${encodeURIComponent(hosted.ownerToken)}`
    window.history.replaceState({}, '', url)
    applySnapshot(hosted.board)
    sessionRef.current = hostedDiscussion
    setSession(hostedDiscussion)
    saveBrainstormBoard(hosted.board, hostedDiscussion)
    setBoardList(listBoards())
    announce('已创建托管白板，并分别生成用户和代理访问方式。')
    return hosted
  }, [announce, applySnapshot, snapshotNow])

  const createUserShare = useCallback<BoardActions['createUserShare']>(async (muralId, ownerToken) => {
    const share = await createHostedUserShare(muralId, ownerToken)
    setShareUrl(share.userUrl)
    return share
  }, [])

  const getAgentFocus = useCallback((): MuralFocusClaim[] => {
    if (hostedRole) return hostedFocusClaims.filter((claim) => new Date(claim.leaseExpiresAt).getTime() > Date.now())
    const current = recordingRef.current
    if (!current) return []
    return activeFocusParticipants(current).map((participant) => ({
      ...participant.focus!,
      participantId: participant.id,
      participantName: participant.name,
      color: participant.color,
    }))
  }, [hostedFocusClaims, hostedRole])

  const setAgentFocus = useCallback<BoardActions['setAgentFocus']>(async (participant, focus) => {
    let claims: MuralFocusClaim[]
    if (hostedAccessToken && hostedReadyRef.current) {
      const result = await setHostedFocus(boardIdRef.current, hostedAccessToken, participant, focus)
      claims = result.focusClaims
      setHostedFocusClaims(claims)
      const current = recordingRef.current
      if (current?.participants.some((candidate) => candidate.id === participant.id)) {
        const next = setRecordingFocus(current, participant.id, focus)
        recordingRef.current = next
        setRecording(next)
      }
    } else {
      const current = recordingRef.current
      if (!current) throw new Error('当前没有进行中的讨论记录。')
      const next = setRecordingFocus(current, participant.id, focus)
      recordingRef.current = next
      setRecording(next)
      claims = activeFocusParticipants(next).map((candidate) => ({ ...candidate.focus!, participantId: candidate.id, participantName: candidate.name, color: candidate.color }))
    }
    return claims
  }, [hostedAccessToken])

  const assertAgentWritableAction = useCallback<BoardActions['assertAgentWritable']>(async (participantId, elementIds) => {
    const localConflict = getAgentFocus().find((claim) => claim.participantId !== participantId && claim.state === 'editing' && claim.elementIds.some((id) => elementIds.includes(id)))
    if (localConflict) throw new Error(`${localConflict.participantName} 正在编辑其中一个元素，锁定将持续到 ${localConflict.leaseExpiresAt}。`)
    if (hostedAccessToken && hostedReadyRef.current) await assertHostedWritable(boardIdRef.current, hostedAccessToken, participantId, elementIds)
  }, [getAgentFocus, hostedAccessToken])

  const createAgentInvites = useCallback<BoardActions['createAgentInvites']>(async (muralId, ownerToken, guests) => {
    const invitations = await createHostedAgentInvites(muralId, ownerToken, guests)
    announce(`已创建 ${invitations.length} 个代理邀请。`)
    return invitations
  }, [announce])

  const redeemAgentInvite = useCallback<BoardActions['redeemAgentInvite']>(async (muralId, inviteToken) => {
    const participant = await redeemHostedAgentInvite(muralId, inviteToken)
    setHostedAccessToken(inviteToken)
    setHostedRole('agent')
    const url = new URL(window.location.href)
    url.searchParams.set('mural', muralId)
    url.hash = `invite=${encodeURIComponent(inviteToken)}`
    window.history.replaceState({}, '', url)
    const hosted = await loadHostedMural(muralId, inviteToken)
    hostedRevisionRef.current = hosted.revision
    hostedReadyRef.current = true
    hostedPullRef.current = true
    setHostedFocusClaims(hosted.focusClaims)
    applySnapshot(hosted.board)
    syncedDiscussionRef.current = JSON.stringify(hosted.brainstorm ?? null)
    sessionRef.current = hosted.brainstorm ?? null
    setSession(hosted.brainstorm ?? null)
    recordingRef.current = hosted.session
    setRecording(hosted.session)
    return participant
  }, [applySnapshot])

  const actions = useMemo<BoardActions>(() => ({
    getSnapshot: snapshotNow,
    addElement,
    addElements,
    updateElement,
    removeElements,
    connectElements,
    renameMural,
    arrange,
    createCluster,
    createArtifact,
    getArtifactSpec,
    updateArtifactRecords,
    focusElements,
    setElementLayer,
    clear,
    createHostedMural,
    createUserShare,
    getAgentFocus,
    setAgentFocus,
    assertAgentWritable: assertAgentWritableAction,
    createAgentInvites,
    redeemAgentInvite,
  }), [addElement, addElements, arrange, assertAgentWritableAction, clear, connectElements, createAgentInvites, createArtifact, createCluster, createHostedMural, createUserShare, focusElements, getAgentFocus, getArtifactSpec, redeemAgentInvite, removeElements, renameMural, setAgentFocus, setElementLayer, snapshotNow, updateArtifactRecords, updateElement])

  const getRecording = useCallback(() => recordingRef.current ? structuredClone(recordingRef.current) : null, [])

  const startRecording = useCallback<RecordingActions['startRecording']>((title, actor) => {
    const recordingActor = actor?.role === 'agent' ? actor : currentHuman(actor?.id)
    if (recordingRef.current?.status === 'recording' && recordingRef.current.boardId === boardIdRef.current) return recordingRef.current
    const session = createRecordingSession(title || `${nameRef.current} 讨论记录`, recordingActor, boardIdRef.current)
    recordingRef.current = session
    setRecording(session)
    const activity: Activity = {
      id: createId('activity'), label: '已开始记录', detail: session.title, source: recordingActor.role === 'agent' ? 'agent' : 'human', createdAt: new Date().toISOString(),
    }
    setActivities((current) => [activity, ...current].slice(0, 30))
    return session
  }, [currentHuman])

  const joinParticipant = useCallback<RecordingActions['joinParticipant']>((participant) => {
    const current = recordingRef.current
    if (!current) throw new Error('请先开始记录，再加入讨论。')
    const next = joinRecording(current, participant)
    recordingRef.current = next
    setRecording(next)
    return next
  }, [])

  const recordContribution = useCallback<RecordingActions['recordContribution']>((input) => {
    let current = recordingRef.current
    if (!current) throw new Error('请先开始记录，再添加内容。')
    if (!current.participants.some((participant) => participant.id === input.agentId)) {
      current = joinRecording(current, { id: input.agentId, name: input.agentName, role: 'agent', specialty: '代理贡献者' })
    }
    if (current.participants.find((participant) => participant.id === input.agentId)?.status === 'muted') {
      throw new Error(`${input.agentName} 已被讨论主持人静音。`)
    }
    if (input.replyTo && !current.events.some((event) => event.id === input.replyTo)) {
      throw new Error(`当前讨论中未找到要回复的目标 ${input.replyTo}。`)
    }
    const next = appendEvent(current, {
      participantId: input.agentId,
      participantName: input.agentName,
      participantRole: 'agent',
      kind: input.kind,
      content: input.content,
      replyTo: input.replyTo,
      relatedElementIds: input.relatedElementIds,
      metadata: input.metadata,
    })
    const event = next.events.at(-1)!
    recordingRef.current = next
    setRecording(next)
    const activity: Activity = {
      id: createId('activity'), label: `${input.agentName}: ${input.kind}`, detail: input.content.slice(0, 120), source: 'agent', createdAt: event.createdAt, relatedElementIds: input.relatedElementIds,
    }
    setActivities((activities) => [activity, ...activities].slice(0, 30))
    return event
  }, [])

  const recordUserMessage = useCallback<RecordingActions['recordUserMessage']>((content, kind = 'question', relatedElementIds) => {
    const current = recordingRef.current
    if (!current) throw new Error('请先开始记录，再添加你的内容。')
    const member = currentHuman()
    const next = appendEvent(current, {
      participantId: member.id,
      participantName: member.name,
      participantRole: 'human',
      kind,
      content,
      relatedElementIds,
    })
    const event = next.events.at(-1)!
    recordingRef.current = next
    setRecording(next)
    const activity: Activity = {
      id: createId('activity'), label: `${member.name}: ${kind}`, detail: content.slice(0, 120), source: 'human', createdAt: event.createdAt, relatedElementIds,
    }
    setActivities((activities) => [activity, ...activities].slice(0, 30))
    return event
  }, [currentHuman])

  const moderateParticipant = useCallback<RecordingActions['moderateParticipant']>((participantId, muted, moderatorId) => {
    const current = recordingRef.current
    if (!current) throw new Error('当前没有可管理的进行中记录。')
    const next = moderateRecording(current, participantId, muted, moderatorId)
    recordingRef.current = next
    setRecording(next)
    return next
  }, [])

  const watchParticipant = useCallback<RecordingActions['watchParticipant']>((participantId, elementIds = [], renewFocus = false) => {
    const current = recordingRef.current
    if (!current) throw new Error('当前没有可查看的讨论记录。')
    const next = watchRecording(current, participantId, elementIds, renewFocus)
    recordingRef.current = next
    setRecording(next)
    return next
  }, [])

  const setParticipantFocus = useCallback<RecordingActions['setParticipantFocus']>((participantId, focus) => {
    const current = recordingRef.current
    if (!current) throw new Error('当前没有进行中的讨论记录。')
    const next = setRecordingFocus(current, participantId, focus)
    recordingRef.current = next
    setRecording(next)
    return next
  }, [])

  const createCheckpoint = useCallback<RecordingActions['createCheckpoint']>((label, board, actor) => {
    const current = recordingRef.current
    if (!current) throw new Error('当前没有进行中的讨论记录。')
    const member = actor?.role === 'human' ? currentHuman(actor.id) : actor
    const withMember = member?.role === 'human' && !current.participants.some((participant) => participant.id === member.id)
      ? joinRecording(current, member)
      : current
    const next = addRecordingCheckpoint(withMember, label, board, member)
    const event = next.events.at(-1)!
    recordingRef.current = next
    setRecording(next)
    return event
  }, [currentHuman])

  const updateCheckpoint = useCallback<RecordingActions['updateCheckpoint']>((eventId, label) => {
    const current = recordingRef.current
    if (!current) throw new Error('当前没有进行中的讨论记录。')
    const next = renameRecordingCheckpoint(current, eventId, label)
    recordingRef.current = next
    setRecording(next)
    return next
  }, [])

  const removeCheckpoint = useCallback<RecordingActions['removeCheckpoint']>((eventId) => {
    const current = recordingRef.current
    if (!current) throw new Error('当前没有进行中的讨论记录。')
    const next = deleteRecordingCheckpoint(current, eventId)
    recordingRef.current = next
    setRecording(next)
    setReplayCheckpointId((active) => active === eventId ? null : active)
    return next
  }, [])

  const finalizeRecording = useCallback<RecordingActions['finalizeRecording']>((finalOutput, actor) => {
    const current = recordingRef.current
    if (!current) throw new Error('当前没有进行中的记录。')
    if (current.status === 'complete') return current
    const member = actor?.role === 'agent' ? actor : currentHuman(actor?.id)
    const withMember = member.role === 'human' && !current.participants.some((participant) => participant.id === member.id)
      ? joinRecording(current, member)
      : current
    const next = completeRecording(withMember, finalOutput, member)
    recordingRef.current = next
    setRecording(next)
    const activity: Activity = {
      id: createId('activity'), label: '已结束记录', detail: `已保留 ${next.events.length} 条事件`, source: actor?.role === 'agent' ? 'agent' : 'human', createdAt: next.completedAt!,
    }
    setActivities((activities) => [activity, ...activities].slice(0, 30))
    return next
  }, [currentHuman])

  const recordingActions = useMemo<RecordingActions>(() => ({
    getRecording,
    startRecording,
    joinParticipant,
    recordContribution,
    recordUserMessage,
    moderateParticipant,
    watchParticipant,
    setParticipantFocus,
    createCheckpoint,
    updateCheckpoint,
    removeCheckpoint,
    finalizeRecording,
  }), [createCheckpoint, finalizeRecording, getRecording, joinParticipant, moderateParticipant, recordContribution, recordUserMessage, removeCheckpoint, setParticipantFocus, startRecording, updateCheckpoint, watchParticipant])

  useEffect(() => {
    if (showCreation) return
    const timer = window.setTimeout(() => {
      try {
        saveBrainstormBoard(snapshotNow(), sessionRef.current)
        setBoardList(listBoards())
        setSaveState('saved')
      } catch {
        setSaveState('error')
      }
    }, 180)
    return () => window.clearTimeout(timer)
  }, [boardId, edges, name, nodes, session, showCreation, snapshotNow])

  useEffect(() => {
    const requestedId = new URLSearchParams(window.location.search).get('mural')
    if (!requestedId || !hostedAccessToken || hostedReadyRef.current && requestedId === boardIdRef.current) return
    let active = true
    const requestedVersion = contentVersionRef.current
    loadHostedMural(requestedId, hostedAccessToken).then((hosted) => {
      if (!active || requestedId !== boardIdRef.current || requestedVersion !== contentVersionRef.current || hosted.board.id !== requestedId) return
      hostedRevisionRef.current = hosted.revision
      hostedReadyRef.current = true
      hostedPullRef.current = true
      setHostedRole(hosted.role)
      setHostedFocusClaims(hosted.focusClaims)
      applySnapshot(hosted.board)
      syncedDiscussionRef.current = JSON.stringify(hosted.brainstorm ?? null)
      sessionRef.current = hosted.brainstorm ?? null
      setSession(hosted.brainstorm ?? null)
      saveBrainstormBoard(hosted.board, hosted.brainstorm ?? null)
      setBoardList(listBoards())
      recordingRef.current = hosted.session
      setRecording(hosted.session)
      const role = hosted.role === 'owner' ? '所有者' : hosted.role === 'agent' ? '代理' : '协作者'
      announce(`已连接到托管白板，身份：${role}`)
    }).catch((error) => {
      if (active) announce(error instanceof Error ? error.message : '无法打开托管白板。')
    })
    return () => { active = false }
  }, [announce, applySnapshot, hostedAccessToken])

  useEffect(() => {
    if (!hostedAccessToken || !hostedReadyRef.current) return
    if (hostedPullRef.current) {
      hostedPullRef.current = false
      return
    }
    const timer = window.setTimeout(() => {
      const pending = snapshotNow()
      const pendingDiscussion = structuredClone(sessionRef.current)
      const sentVersion = contentVersionRef.current
      const sentRevision = hostedRevisionRef.current
      const requestId = ++saveRequestRef.current
      const current = () => boardIdRef.current === pending.id && contentVersionRef.current === sentVersion && saveRequestRef.current === requestId && hostedRevisionRef.current === sentRevision
      setBackendState('syncing')
      saveHostedMural(pending, hostedAccessToken).then(async (saved) => {
        if (!current()) return
        if (saved.board.id !== pending.id || !Number.isSafeInteger(saved.revision) || saved.revision <= sentRevision) throw new Error('托管保存回执无效。')
        const canonicalChanged = saved.board.name !== pending.name
          || JSON.stringify(saved.board.nodes) !== JSON.stringify(pending.nodes)
          || JSON.stringify(saved.board.edges) !== JSON.stringify(pending.edges)
        if (pendingDiscussion) {
          await syncBrainstorm(pendingDiscussion, { ...saved.board, updatedAt: pending.updatedAt }, hostedAccessToken)
        }
        if (!current()) return
        hostedRevisionRef.current = saved.revision
        if (pendingDiscussion) syncedDiscussionRef.current = JSON.stringify(pendingDiscussion)
        if (canonicalChanged) {
          hostedPullRef.current = true
          applySnapshot(saved.board, true)
        }
        setBackendState('synced')
      }).catch(() => { if (current()) setBackendState('offline') })
    }, 420)
    return () => window.clearTimeout(timer)
  }, [applySnapshot, boardId, edges, hostedAccessToken, name, nodes, session, snapshotNow])

  useEffect(() => {
    if (!hostedAccessToken || !hostedReadyRef.current) return
    let active = true
    let busy = false
    const poll = async () => {
      if (busy) return
      busy = true
      try {
        const requestedId = boardIdRef.current
        const requestedVersion = contentVersionRef.current
        const requestedRevision = hostedRevisionRef.current
        const hosted = await loadHostedMural(requestedId, hostedAccessToken)
        if (!active || requestedId !== boardIdRef.current || requestedVersion !== contentVersionRef.current || requestedRevision !== hostedRevisionRef.current || hosted.board.id !== requestedId) return
        if (hosted.revision > hostedRevisionRef.current) {
          hostedRevisionRef.current = hosted.revision
          hostedPullRef.current = true
          applySnapshot(hosted.board, true)
        }
        setHostedRole(hosted.role)
        setHostedFocusClaims(hosted.focusClaims)
        const incomingDiscussion = JSON.stringify(hosted.brainstorm ?? null)
        if (JSON.stringify(sessionRef.current) === syncedDiscussionRef.current && incomingDiscussion !== syncedDiscussionRef.current) {
          hostedPullRef.current = true
          syncedDiscussionRef.current = incomingDiscussion
          sessionRef.current = hosted.brainstorm ?? null
          setSession(hosted.brainstorm ?? null)
        }
        const localLastEvent = recordingRef.current?.events.at(-1)?.id
        const remoteLastEvent = hosted.session?.events.at(-1)?.id
        if (hosted.session && remoteLastEvent !== localLastEvent) {
          recordingRef.current = hosted.session
          setRecording(hosted.session)
        }
      } catch {
        if (active) setBackendState('offline')
      } finally {
        busy = false
      }
    }
    const timer = window.setInterval(poll, 1500)
    return () => { active = false; window.clearInterval(timer) }
  }, [applySnapshot, hostedAccessToken])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem('canvas-relay-theme', theme)
  }, [theme])

  useEffect(() => {
    window.localStorage.setItem('canvas-relay-inspector-minimized', String(inspectorMinimized))
  }, [inspectorMinimized])

  useEffect(() => {
    saveRecording(recording, boardId)
  }, [boardId, recording])

  useEffect(() => {
    let active = true
    getBackendHealth().then((online) => {
      if (active) setBackendState(online ? 'synced' : 'offline')
    })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!recording) return
    const timer = window.setTimeout(async () => {
      setBackendState('syncing')
      try {
        await syncRecording(recording, snapshotNow(), hostedAccessToken)
        setBackendState('synced')
      } catch {
        setBackendState('offline')
      }
    }, 320)
    return () => window.clearTimeout(timer)
  }, [edges, hostedAccessToken, name, nodes, recording, snapshotNow])

  useEffect(() => {
    if (!session || showCreation || hostedAccessToken) return
    const timer = window.setTimeout(async () => {
      const pending = sessionRef.current
      if (!pending || pending.boardId !== boardIdRef.current) return
      const serialized = JSON.stringify(pending)
      const board = snapshotNow()
      const sentVersion = contentVersionRef.current
      const requestId = ++saveRequestRef.current
      const current = () => boardIdRef.current === board.id && contentVersionRef.current === sentVersion && saveRequestRef.current === requestId && JSON.stringify(sessionRef.current) === serialized
      setBackendState('syncing')
      try {
        await syncBrainstorm(pending, board, hostedAccessToken)
        if (current()) {
          syncedDiscussionRef.current = serialized
          setBackendState('synced')
        }
      } catch {
        if (current()) setBackendState('offline')
      }
    }, 320)
    return () => window.clearTimeout(timer)
  }, [boardId, edges, hostedAccessToken, name, nodes, session, showCreation, snapshotNow])

  useEffect(() => {
    const registration = registerWebMCP(actions, recordingActions, () => undefined)
    return registration.cleanup
  }, [actions, recordingActions])

  const requestSuggestions = useCallback(async (reason: SuggestionReason, ids: string[]) => {
    if (suggestionRequestRef.current) throw new Error('已有建议请求正在进行。')
    const discussion = sessionRef.current
    if (!discussion) throw new Error('当前白板没有讨论。')
    if (visibleSuggestions(discussion).length) throw new Error('请先处理当前建议。')
    const board = snapshotNow()
    const version = contentVersionRef.current
    const context = suggestionContext(board, discussion)
    const assertCurrent = () => {
      if (boardIdRef.current !== board.id || contentVersionRef.current !== version || !sessionRef.current || suggestionContext(snapshotNow(), sessionRef.current) !== context) throw new Error('讨论已变化，请重新请求建议。')
    }
    const purposes: Record<SuggestionReason, string> = { quiet_period: '讨论遇到停滞，请提出一个帮助成员继续思考的建议', similar_ideas: '分析选中观点是否重复或相似并提出分类建议', complementary_ideas: '分析选中观点的互补关系并提出有来源的整合方案' }
    if ((reason === 'similar_ideas' && ids.length < 1) || (reason === 'complementary_ideas' && ids.length < 2)) throw new Error('请先选择需要分析的观点。')
    suggestionRequestRef.current = true
    try {
      // 建议端点读取服务端已保存内容，主动请求前先保存当前真实讨论。
      if (hostedAccessToken) { await saveHostedMural(board, hostedAccessToken); assertCurrent() }
      await syncBrainstorm(discussion, board, hostedAccessToken)
      assertCurrent()
      const response = await requestBrainstormSuggestions(discussion.id, purposes[reason], ids, hostedAccessToken)
      assertCurrent()
      const next = receiveSuggestion(sessionRef.current!, snapshotNow(), response, reason, ids)
      const shown = next !== sessionRef.current
      if (shown) changeDiscussion(next)
      return shown
    } finally { suggestionRequestRef.current = false }
  }, [changeDiscussion, hostedAccessToken, snapshotNow])

  const acceptAgentSuggestion = useCallback((id: string) => {
    const discussion = sessionRef.current
    if (!discussion || suggestionRequestRef.current) throw new Error('当前不能确认建议。')
    const board = snapshotNow()
    const oldHistory = historyRef.current
    const oldFuture = futureRef.current
    recordHistory()
    historyRef.current[historyRef.current.length - 1].aiSuggestionId = id
    aiTransactionRef.current = true
    try {
      const next = acceptSuggestion(discussion, id, actions)
      validateBrainstormPayload({ board: snapshotNow(), session: next })
      sessionRef.current = next
      setSession(next)
    } catch (error) {
      applySnapshot(board, true)
      sessionRef.current = discussion
      setSession(discussion)
      historyRef.current = oldHistory
      futureRef.current = oldFuture
      setHistoryStatus({ canUndo: oldHistory.length > 0, canRedo: oldFuture.length > 0 })
      throw error
    } finally { aiTransactionRef.current = false }
  }, [actions, applySnapshot, recordHistory, snapshotNow])

  const undoAgentSuggestion = useCallback((id: string) => {
    const discussion = sessionRef.current
    if (!discussion || suggestionRequestRef.current) throw new Error('当前不能撤销建议。')
    const restored = undoSuggestion(discussion, snapshotNow(), id)
    validateBrainstormPayload(restored)
    const retired = restored.session.suggestions.find((item) => item.id === id)!
    // 同时移除这一笔接受历史并更新后续快照，普通撤销不会重新带回 AI 内容。
    const rebase = (entry: HistoryEntry): HistoryEntry => {
      if (entry.board.id !== restored.board.id || entry.discussion?.id !== discussion.id || !entry.discussion.suggestions.some((item) => item.id === id)) return entry
      const next = entry.discussion.suggestions.some((item) => item.id === id && item.status === 'accepted')
        ? undoSuggestion(entry.discussion, entry.board, id)
        : { board: entry.board, session: { ...entry.discussion, suggestions: entry.discussion.suggestions.map((item) => item.id === id ? structuredClone(retired) : item) } }
      validateBrainstormPayload(next)
      return { ...entry, board: next.board, discussion: next.session }
    }
    const history = historyRef.current.filter((entry) => entry.aiSuggestionId !== id).map(rebase)
    const future = futureRef.current.filter((entry) => entry.aiSuggestionId !== id).map(rebase)
    applySnapshot(restored.board, true)
    sessionRef.current = restored.session
    setSession(restored.session)
    historyRef.current = history
    futureRef.current = future
    setHistoryStatus({ canUndo: history.length > 0, canRedo: future.length > 0 })
  }, [applySnapshot, snapshotNow])

  const onNodesChange = useCallback((changes: NodeChange<BoardNode>[]) => {
    const next = applyNodeChanges(changes, nodesRef.current)
    commitNodes(next)
    changes.forEach((change) => {
      if (change.type === 'dimensions' && change.resizing === false) {
        const node = next.find((candidate) => candidate.id === change.id)
        if (node) reportActivity('已调整元素大小', node.data.title, 'human', [node.id])
      }
    })
  }, [commitNodes, reportActivity])

  const onEdgesChange = useCallback((changes: EdgeChange<BoardEdge>[]) => {
    const next = applyEdgeChanges(changes, edgesRef.current)
    commitEdges(next)
  }, [commitEdges])

  const onConnect = useCallback((connection: Connection) => {
    if (connection.source && connection.target) connectElements(connection.source, connection.target, undefined, 'human')
  }, [connectElements])

  const addKind = useCallback((kind: ElementKind) => {
    addElement({ title: '', kind })
  }, [addElement])

  const addIdea = useCallback((type: IdeaType) => {
    addElement({ title: '', kind: type === 'question' ? 'question' : type === 'evidence' ? 'insight' : 'idea', ideaType: type })
  }, [addElement])

  const addArtifact = useCallback((template: 'decision' | 'cards' | 'checklist') => {
    createArtifact(createArtifactTemplate(template), undefined, undefined, 'human')
  }, [createArtifact])

  const updateFromInspector = useCallback((id: string, patch: Partial<BoardNode['data']>) => {
    const existing = nodesRef.current.find((node) => node.id === id)
    if (!existing || !Object.entries(patch).some(([key, value]) => JSON.stringify(value) !== JSON.stringify(existing.data[key]))) return
    recordHistory()
    const contentChanged = (patch.title !== undefined && patch.title !== existing.data.title) || (patch.body !== undefined && patch.body !== existing.data.body)
    const ideaMeta = contentChanged && existing.data.ideaMeta && sessionRef.current ? updateIdeaMeta(existing.data.ideaMeta, sessionRef.current.currentMemberId, new Date().toISOString()) : existing.data.ideaMeta
    const next = nodesRef.current.map((node) => node.id === id ? { ...node, data: { ...node.data, ...patch, ideaMeta } } : node)
    commitNodes(next)
    const node = next.find((item) => item.id === id)
    if (node) reviseDiscussionNode(node)
  }, [commitNodes, recordHistory, reviseDiscussionNode])

  const commitInspectorChange = useCallback((id: string, field: string) => {
    const node = nodesRef.current.find((candidate) => candidate.id === id)
    if (!node) return
    reportActivity('已更新元素', `${node.data.title}：${field}`, 'human', [id])
  }, [reportActivity])

  const duplicateElement = useCallback((id: string) => {
    const existing = nodesRef.current.find((node) => node.id === id)
    if (!existing) return
    recordHistory()
    const duplicate: BoardNode = {
      ...structuredClone(existing),
      id: createId(existing.data.kind),
      position: { x: existing.position.x + 36, y: existing.position.y + 36 },
      selected: true,
      data: { ...structuredClone(existing.data), title: `${existing.data.title}（副本）`, justCreated: true },
    }
    if (session && existing.data.ideaMeta) duplicate.data.ideaMeta = createIdeaMeta({ sessionId: session.id, authorId: session.currentMemberId, type: existing.data.ideaMeta.type, sourceIdeaIds: [id], createdAt: new Date().toISOString() })
    commitNodes([...nodesRef.current.map((node): BoardNode => ({ ...node, selected: false })), duplicate])
    const proposal = sessionRef.current?.proposals.find((item) => item.id === id)
    if (proposal && sessionRef.current) {
      const nextDiscussion: BrainstormSession = { ...sessionRef.current, proposals: [...sessionRef.current.proposals, { ...structuredClone(proposal), id: duplicate.id, title: duplicate.data.title, authorId: sessionRef.current.currentMemberId, sourceIdeaIds: [...(duplicate.data.ideaMeta?.sourceIdeaIds ?? [])], status: 'draft', comments: [] }], decision: sessionRef.current.decision ? { ...sessionRef.current.decision, confirmedAt: undefined, confirmedBy: undefined } : null, updatedAt: new Date().toISOString() }
      sessionRef.current = nextDiscussion
      setSession(nextDiscussion)
    }
    setSelectedId(duplicate.id)
    reportActivity('已复制元素', duplicate.data.title, 'human', [duplicate.id])
  }, [commitNodes, recordHistory, reportActivity, session])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (confirmation) {
        if (event.key === 'Escape') setConfirmation(null)
        return
      }
      const target = event.target as HTMLElement
      if (target.matches('input, textarea, [contenteditable="true"]')) return
      const mod = event.metaKey || event.ctrlKey
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo()
        else undo()
      } else if (mod && event.key.toLowerCase() === 'd' && selectedId) {
        event.preventDefault()
        duplicateElement(selectedId)
      } else if (mod && event.key === ']' && selectedId) {
        event.preventDefault()
        setElementLayer(selectedId, event.altKey ? 'front' : 'forward', 'human')
      } else if (mod && event.key === '[' && selectedId) {
        event.preventDefault()
        setElementLayer(selectedId, event.altKey ? 'back' : 'backward', 'human')
      } else if ((event.key === 'Backspace' || event.key === 'Delete') && selectedId) {
        event.preventDefault()
        removeElements([selectedId], 'human')
      } else if (event.key.toLowerCase() === 'n') addElement({ title: '', kind: 'idea' })
      else if (event.key.toLowerCase() === 'q') addElement({ title: '', kind: 'question' })
      else if (event.key === '+' || event.key === '=') flowRef.current?.zoomIn({ duration: 180 })
      else if (event.key === '-') flowRef.current?.zoomOut({ duration: 180 })
      else if (event.key === '0') flowRef.current?.fitView({ padding: 0.2, duration: 300 })
      else if (event.key === 'Escape') {
        clearSelection()
        setLayerMenu(null)
        document.querySelectorAll<HTMLDetailsElement>('details[open]').forEach((details) => details.removeAttribute('open'))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [addElement, clearSelection, confirmation, duplicateElement, redo, removeElements, selectedId, setElementLayer, undo])

  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node
      document.querySelectorAll<HTMLDetailsElement>('details[open]').forEach((details) => {
        if (!details.contains(target)) details.removeAttribute('open')
      })
      if (layerMenu && !(target as Element).closest?.('.layer-context-menu')) setLayerMenu(null)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [layerMenu])

  const copyArtifactSpec = useCallback(async (id: string) => {
    const spec = getArtifactSpec(id)
    await navigator.clipboard.writeText(JSON.stringify(spec, null, 2))
    announce('已复制结构化内容规格。')
  }, [announce, getArtifactSpec])

  const newBoard = useCallback(() => {
    clearHostedAccess()
    saveBrainstormBoard(snapshotNow(), sessionRef.current)
    const board = createEmptyBoard()
    applySnapshot(board)
    recordingRef.current = null
    setRecording(null)
    setActivities([])
    historyRef.current = []
    futureRef.current = []
    setHistoryStatus({ canUndo: false, canRedo: false })
    saveBrainstormBoard(board, null)
    setBoardList(listBoards())
    reportActivity('新建白板', '已从空白画布开始', 'human')
    announce('已创建新白板。')
  }, [announce, applySnapshot, clearHostedAccess, reportActivity, snapshotNow])

  const switchBoard = useCallback((id: string) => {
    if (id === boardIdRef.current) return
    saveBrainstormBoard(snapshotNow(), sessionRef.current)
    const board = loadBoardById(id)
    if (!board) return announce('该白板已不可用。')
    clearHostedAccess()
    applySnapshot(board)
    sessionRef.current = loadBrainstorm(board)
    setSession(sessionRef.current)
    const nextRecording = loadRecording(board.id)
    recordingRef.current = nextRecording
    setRecording(nextRecording)
    setActivities([])
    historyRef.current = []
    futureRef.current = []
    setHistoryStatus({ canUndo: false, canRedo: false })
    announce(`已打开「${board.name}」。`)
  }, [announce, applySnapshot, clearHostedAccess, snapshotNow])

  const openBoardInstance = useCallback((id: string) => {
    const url = new URL(window.location.href)
    url.searchParams.set('mural', id)
    if (id !== boardIdRef.current) url.hash = ''
    window.open(url, '_blank', 'noopener,noreferrer')
  }, [])

  const handleBoardImport = useCallback(async (file: File) => {
    try {
      clearHostedAccess()
      saveBrainstormBoard(snapshotNow(), sessionRef.current)
      const imported = importCanvasRelay(await file.text())
      const { board } = imported
      applySnapshot(board)
      recordingRef.current = imported.recording
      setRecording(imported.recording)
      saveRecording(imported.recording, board.id)
      setActivities([])
      setBoardList(listBoards())
      announce(`已导入「${board.name}」。`)
    } catch (error) {
      announce(error instanceof Error ? error.message : '无法导入该白板。')
    }
  }, [announce, applySnapshot, clearHostedAccess, snapshotNow])

  const exportBoard = useCallback(() => {
    const content = serializeSnapshot(snapshotNow())
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${nameRef.current.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'ai-mural'}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    reportActivity('已导出白板', '已下载可移植的 JSON 快照', 'human')
  }, [reportActivity, snapshotNow])

  const openPanel = useCallback((view: AgentPanelView) => {
    setPanelView(view)
    setAgentOpen(true)
    clearSelection()
  }, [clearSelection])

  const sendUserMessage = useCallback((content: string) => {
    try {
      currentHuman()
      if (recordingRef.current?.status !== 'recording') startRecording(`${nameRef.current} 讨论记录`)
      recordUserMessage(content, 'question')
      openPanel('stream')
      announce('消息已发送到共享对话。')
    } catch (error) { if (!(error instanceof Error)) throw error; announce(error.message) }
  }, [announce, currentHuman, openPanel, recordUserMessage, startRecording])

  const commentOnElement = useCallback((id: string, content: string) => {
    try {
      currentHuman()
      if (recordingRef.current?.status !== 'recording') startRecording(`${nameRef.current} 讨论记录`)
      recordUserMessage(content, 'note', [id])
      announce('评论已添加到该元素和共享对话。')
    } catch (error) { if (!(error instanceof Error)) throw error; announce(error.message) }
  }, [announce, currentHuman, recordUserMessage, startRecording])

  const finishRecordingFromUI = useCallback(() => {
    const current = recordingRef.current
    if (!current || current.status !== 'recording') return
    try {
      currentHuman()
      const artifactCount = nodesRef.current.filter((node) => node.data.kind === 'artifact').length
      const decisions = current.events.filter((event) => event.kind === 'decision').length
      finalizeRecording(
        `讨论已结束：${nodesRef.current.length} 个画布元素、${edgesRef.current.length} 条连线、${artifactCount} 个结构化内容和 ${decisions} 项明确决策。`,
      )
      announce('讨论记录已结束，可以导出。')
    } catch (error) { if (!(error instanceof Error)) throw error; announce(error.message) }
  }, [announce, currentHuman, finalizeRecording])

  const exportRecording = useCallback((format: 'json' | 'markdown' | 'csv') => {
    if (sessionRef.current && !isOutcomeConfirmed(sessionRef.current)) {
      announce('请先确认讨论成果，再导出讨论记录。')
      return
    }
    const current = recordingRef.current
    if (!current) return
    const board = snapshotNow()
    const content = format === 'json'
      ? JSON.stringify({ schemaVersion: '1.0', session: current, finalBoard: board }, null, 2)
      : format === 'markdown' ? recordingToMarkdown(current, board) : recordingToCsv(current)
    const extension = format === 'markdown' ? 'md' : format
    const mime = format === 'json' ? 'application/json' : format === 'markdown' ? 'text/markdown' : 'text/csv'
    const url = URL.createObjectURL(new Blob([content], { type: mime }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${current.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'decision-trace'}.${extension}`
    anchor.click()
    URL.revokeObjectURL(url)
    announce(`讨论记录已导出为 ${extension.toUpperCase()}。`)
  }, [announce, snapshotNow])

  const openShare = useCallback(() => {
    setShareCopied(false)
    setShareError('')
    if (hostedRole === 'user') setShareUrl(window.location.href)
    if (hostedRole === 'agent') setShareUrl('')
    setShareOpen(true)
  }, [hostedRole])

  const publishAndShare = useCallback(async () => {
    setShareLoading(true)
    setShareError('')
    try {
      const hosted = await createHostedMural(nameRef.current, snapshotNow())
      setShareUrl(hosted.userUrl)
      announce('白板已发布，协作者链接已准备好。')
    } catch (error) {
      setShareError(error instanceof Error ? error.message : '无法发布此白板。')
    } finally {
      setShareLoading(false)
    }
  }, [announce, createHostedMural, snapshotNow])

  const generateShare = useCallback(async () => {
    setShareLoading(true)
    setShareError('')
    try {
      const share = await createUserShare(boardIdRef.current, hostedAccessToken)
      setShareUrl(share.userUrl)
      setShareCopied(false)
      announce('已生成新的协作者链接。')
    } catch (error) {
      setShareError(error instanceof Error ? error.message : '无法创建协作者链接。')
    } finally {
      setShareLoading(false)
    }
  }, [announce, createUserShare, hostedAccessToken])

  const copyShareLink = useCallback(async () => {
    if (!shareUrl) return
    try {
      await navigator.clipboard.writeText(shareUrl)
      setShareCopied(true)
      announce('已复制协作者链接。')
    } catch {
      setShareError('无法访问剪贴板，请手动选择并复制链接。')
    }
  }, [announce, shareUrl])

  const saveCurrentCheckpoint = useCallback(() => {
    try {
      const member = currentHuman()
      if (recordingRef.current?.status !== 'recording') startRecording(`${nameRef.current} 讨论记录`)
      const current = recordingRef.current!
      const index = current.events.filter((event) => event.kind === 'checkpoint').length + 1
      createCheckpoint(`检查点 ${index}`, snapshotNow(), member)
      announce(`检查点 ${index} 已保存。`)
    } catch (error) { if (!(error instanceof Error)) throw error; announce(error.message) }
  }, [announce, createCheckpoint, currentHuman, snapshotNow, startRecording])

  const renameCheckpointFromUI = useCallback((eventId: string, label: string) => {
    updateCheckpoint(eventId, label)
    announce('检查点已重命名。')
  }, [announce, updateCheckpoint])

  const deleteCheckpointFromUI = useCallback((eventId: string) => {
    const label = recordingRef.current?.events.find((event) => event.id === eventId)?.checkpoint?.label ?? '该检查点'
    setConfirmation({
      title: '删除回放检查点？',
      description: `从时间线中移除“${label}”。不会更改当前白板。`,
      confirmLabel: '删除检查点',
      onConfirm: () => {
        removeCheckpoint(eventId)
        setConfirmation(null)
        announce('检查点已删除。')
      },
    })
  }, [announce, removeCheckpoint])

  const openReplayCheckpoint = useCallback((eventId: string | null) => {
    setReplayCheckpointId(eventId)
    clearSelection()
  }, [clearSelection])

  const replayBoard = replayCheckpointId
    ? recording?.events.find((event) => event.id === replayCheckpointId)?.checkpoint?.board ?? null
    : null
  const selectedNode = !replayBoard ? nodes.find((node) => node.id === selectedId) ?? null : null
  const activeFocusClaims = useMemo(() => {
    if (hostedRole) return hostedFocusClaims.filter((claim) => new Date(claim.leaseExpiresAt).getTime() > presenceNow)
    if (!recording) return []
    return activeFocusParticipants(recording, presenceNow).map((participant) => ({
      ...participant.focus!, participantId: participant.id, participantName: participant.name, color: participant.color,
    }))
  }, [hostedFocusClaims, hostedRole, presenceNow, recording])
  const renderedNodes = useMemo(() => nodes.map((node) => {
    const claim = activeFocusClaims.find((candidate) => candidate.elementIds.includes(node.id))
    return {
      ...node,
      data: {
        ...node.data,
        _focusPresence: claim ? {
          participantName: claim.participantName,
          intent: claim.intent,
          color: claim.color ?? 'coral',
          state: claim.state,
        } : undefined,
      },
    }
  }), [activeFocusClaims, nodes])

  if (showCreation) return (
    <main className="discussion-create" style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24 }}>
      <form style={{ display: 'grid', gap: 16, width: 'min(100%, 480px)' }} onSubmit={(event) => {
        event.preventDefault()
        const board = createEmptyBoard(discussionDraft.topic.trim())
        const next = createBrainstormSession({
          id: createUUID(), boardId: board.id, ...discussionDraft,
          memberId: createUUID(), createdAt: new Date().toISOString(),
        })
        applySnapshot(board)
        saveBrainstormBoard(board, next)
        setBoardList(listBoards())
        setSession(next)
        sessionRef.current = next
        setShowCreation(false)
      }}>
        <h1>创建讨论</h1>
        <label>主题<input required value={discussionDraft.topic} onChange={(event) => setDiscussionDraft({ ...discussionDraft, topic: event.target.value })} /></label>
        <label>目标<input required value={discussionDraft.goal} onChange={(event) => setDiscussionDraft({ ...discussionDraft, goal: event.target.value })} /></label>
        <label>背景<textarea value={discussionDraft.background} onChange={(event) => setDiscussionDraft({ ...discussionDraft, background: event.target.value })} /></label>
        <label>限制条件<textarea value={discussionDraft.constraints} onChange={(event) => setDiscussionDraft({ ...discussionDraft, constraints: event.target.value })} /></label>
        <label>成员昵称<input required value={discussionDraft.memberName} onChange={(event) => setDiscussionDraft({ ...discussionDraft, memberName: event.target.value })} /></label>
        <button type="submit" className="primary-button">开始讨论</button>
      </form>
    </main>
  )

  return (
    <main className="app-shell">
      {session && <StageNavigator key={session.id} session={session} onChange={changeDiscussion} />}
      <header className="top-bar">
        <div className="brand-lockup">
          <div className="brand-mark header-mark" role="img" aria-label="AI-Mural 标志"><span /><span /><span /></div>
          <div className="board-title-wrap">
            <input
              value={nameDraft}
              maxLength={80}
              aria-label="白板名称"
              onChange={(event) => setNameDraft(event.target.value)}
              onBlur={() => renameMural(nameDraft, 'human')}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur()
                if (event.key === 'Escape') { setNameDraft(name); event.currentTarget.blur() }
              }}
            />
          </div>
        </div>

        <div className="top-actions">
          <BoardLibraryMenu
            boards={boardList}
            currentId={boardId}
            onNew={newBoard}
            onSelect={switchBoard}
            onOpenInstance={openBoardInstance}
            onImport={handleBoardImport}
          />
          <div className="history-controls" aria-label="历史记录控制">
            <button type="button" className="icon-button" onClick={undo} disabled={!historyStatus.canUndo} aria-label="撤销"><ArrowCounterClockwise size={18} /></button>
            <button type="button" className="icon-button" onClick={redo} disabled={!historyStatus.canRedo} aria-label="重做"><ArrowClockwise size={18} /></button>
          </div>
          <details className="top-menu">
            <summary className="secondary-button"><Rows size={17} />排列<CaretDown size={13} /></summary>
            <div className="top-menu-popover">
              <button type="button" onClick={(event) => { arrange('grid'); event.currentTarget.closest('details')?.removeAttribute('open') }}>网格</button>
              <button type="button" onClick={(event) => { arrange('columns'); event.currentTarget.closest('details')?.removeAttribute('open') }}>按分类分列</button>
              <button type="button" onClick={(event) => { arrange('radial'); event.currentTarget.closest('details')?.removeAttribute('open') }}>放射图</button>
              <button type="button" onClick={(event) => { arrange('stacked'); event.currentTarget.closest('details')?.removeAttribute('open') }}>堆叠</button>
              <span />
              <button type="button" onClick={(event) => { newBoard(); event.currentTarget.closest('details')?.removeAttribute('open') }}>新建空白白板</button>
            </div>
          </details>
          <button type="button" className="icon-button theme-button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={`切换到${theme === 'light' ? '深色' : '浅色'}主题`}>
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <button type="button" className="secondary-button export-button" onClick={exportBoard}><DownloadSimple size={17} />导出</button>
          <button type="button" className="secondary-button share-button" onClick={openShare}><ShareNetwork size={17} />分享</button>
          <button
            type="button"
            className={`record-top-button ${recording?.status === 'recording' ? 'is-recording' : ''} ${agentOpen && panelView === 'session' ? 'is-active' : ''}`}
            onClick={() => openPanel('session')}
          >
            <Record size={13} weight="fill" />{recording?.status === 'recording' ? '录制中' : '记录'}
          </button>
          <button
            type="button"
            className={`agent-toggle ${agentOpen && panelView === 'activity' ? 'is-active' : ''}`}
            onClick={() => agentOpen && panelView === 'activity' ? setAgentOpen(false) : openPanel('activity')}
          >
            <ClockCounterClockwise size={18} weight="bold" />动态
            <span className={webMCPState.supported ? 'connection-light ready' : 'connection-light'} aria-hidden="true" />
          </button>
        </div>
      </header>

      <section className={`workspace ${replayBoard ? 'is-replaying' : ''}`}>
        {session && <BrainstormPanel key={session.id} session={session} nodes={nodes} actions={actions} onChange={changeDiscussion} onRequest={requestSuggestions} onAccept={acceptAgentSuggestion} onUndo={undoAgentSuggestion} />}
        <ToolRail onAdd={addKind} onArtifact={addArtifact} onIdea={session ? addIdea : undefined} />
        <div className="canvas-wrap" data-focus-count={activeFocusClaims.length}>
          <ReactFlow<BoardNode, BoardEdge>
            nodes={replayBoard?.nodes ?? renderedNodes}
            edges={replayBoard?.edges ?? edges}
            nodeTypes={NODE_TYPES}
            onInit={(instance) => { flowRef.current = instance }}
            onNodesChange={(changes) => { if (!replayBoard) onNodesChange(changes) }}
            onEdgesChange={(changes) => { if (!replayBoard) onEdgesChange(changes) }}
            onConnect={(connection) => { if (!replayBoard) onConnect(connection) }}
            onSelectionChange={({ nodes: selected }) => setSelectedId(selected.length === 1 ? selected[0].id : null)}
            onNodeContextMenu={(event, node) => {
              event.preventDefault()
              setSelectedId(node.id)
              setLayerMenu({
                nodeId: node.id,
                x: Math.min(event.clientX, window.innerWidth - 248),
                y: Math.min(event.clientY, window.innerHeight - 290),
              })
            }}
            onPaneClick={() => {
              clearSelection()
              setLayerMenu(null)
            }}
            onNodeDragStart={recordHistory}
            onNodeDragStop={(_event, node) => reportActivity('已移动元素', node.data.title, 'human', [node.id])}
            onDoubleClickCapture={(event) => {
              if (replayBoard) return
              if ((event.target as Element).classList.contains('react-flow__pane')) {
                const position = flowRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY })
                addElement({ title: '', kind: 'idea', x: position?.x, y: position?.y })
              }
            }}
            deleteKeyCode={null}
            zoomOnDoubleClick={false}
            nodesDraggable={!replayBoard}
            nodesConnectable={!replayBoard}
            selectionOnDrag
            panOnScroll
            fitView
            fitViewOptions={{ padding: 0.16 }}
            minZoom={0.2}
            maxZoom={2.2}
            colorMode={theme}
            elevateNodesOnSelect={false}
          >
            <Background variant={BackgroundVariant.Dots} gap={22} size={1.25} />
            <Controls showInteractive={false} position="bottom-left" />
            <MiniMap
              position="bottom-right"
              pannable
              zoomable
              nodeColor={(node) => node.data.kind === 'frame' ? 'transparent' : '#f06449'}
              maskColor={theme === 'dark' ? 'rgba(17,18,20,.72)' : 'rgba(246,245,241,.72)'}
            />
          </ReactFlow>

          {replayBoard && <div className="replay-banner" role="status"><span>回放</span><strong>{recording?.events.find((event) => event.id === replayCheckpointId)?.checkpoint?.label}</strong><small>{new Date(replayBoard.updatedAt).toLocaleString('zh-CN')}</small><button type="button" onClick={() => openReplayCheckpoint(null)}>退出回放</button></div>}

          <CollaborationDock
            recording={recording}
            members={session?.members ?? []}
            onSend={sendUserMessage}
            onOpenTrace={() => openPanel('stream')}
          />

          {layerMenu && selectedNode && layerMenu.nodeId === selectedNode.id && (
            <LayerMenu
              x={layerMenu.x}
              y={layerMenu.y}
              title={selectedNode.data.title}
              onLayer={(action) => setElementLayer(selectedNode.id, action, 'human')}
              onDuplicate={() => { duplicateElement(selectedNode.id); setLayerMenu(null) }}
              onDelete={() => { removeElements([selectedNode.id], 'human'); setLayerMenu(null) }}
            />
          )}

          {!nodes.length && (
            <div className="empty-board">
              <div className="empty-icon"><BracketsCurly size={25} weight="bold" /></div>
              <h2>从一个想法开始</h2>
              <p>双击画布、添加结构化内容，或让代理搭建第一张思维图。</p>
              <div>
                <button type="button" className="primary-button" onClick={() => addKind('idea')}>创建第一个想法</button>
                <button type="button" className="secondary-button" onClick={() => openPanel('agent')}>打开代理工具</button>
              </div>
            </div>
          )}

          <div className="canvas-status">
            <span className={`save-indicator state-${saveState}`} />
            {saveState === 'saved' ? '已保存到本地' : saveState === 'saving' ? '保存中' : '保存失败'}
            <span className="status-divider" />
            {nodes.filter((node) => node.data.kind !== 'frame').length} 个元素
            <span className="shortcut-hint">双击画布添加</span>
          </div>
        </div>

        {selectedNode && (
          <Inspector
            key={selectedNode.id}
            node={selectedNode}
            members={session?.members}
            minimized={inspectorMinimized}
            onToggleMinimized={() => setInspectorMinimized((current) => !current)}
            onUpdate={updateFromInspector}
            onCommit={commitInspectorChange}
            onDelete={(id) => removeElements([id], 'human')}
            onDuplicate={duplicateElement}
            onClose={clearSelection}
            onCopySpec={copyArtifactSpec}
            onLayer={(action) => setElementLayer(selectedNode.id, action, 'human')}
            comments={(recording?.events ?? []).filter((event) => event.kind !== 'board_action' && event.kind !== 'result' && event.relatedElementIds?.includes(selectedNode.id))}
            onComment={(content) => commentOnElement(selectedNode.id, content)}
          />
        )}

        <AgentPanel
          isOpen={agentOpen && !selectedNode}
          view={panelView}
          supported={webMCPState.supported}
          toolCount={webMCPState.count}
          activities={activities}
          nodes={nodes}
          recording={recording}
          backendState={backendState}
          onViewChange={setPanelView}
          onClose={() => setAgentOpen(false)}
          onStartRecording={() => { try { startRecording() } catch (error) { if (!(error instanceof Error)) throw error; announce(error.message) } }}
          onFinalizeRecording={finishRecordingFromUI}
          onExportRecording={exportRecording}
          exportBlockedReason={session && !isOutcomeConfirmed(session) ? '请先确认讨论成果，再导出讨论记录。' : undefined}
          onFocusElement={(id) => focusElements([id])}
          replayCheckpointId={replayCheckpointId}
          onAddCheckpoint={saveCurrentCheckpoint}
          onUpdateCheckpoint={renameCheckpointFromUI}
          onDeleteCheckpoint={deleteCheckpointFromUI}
          onReplayCheckpoint={openReplayCheckpoint}
        />
      </section>

      {toast && <div className="toast" role="status">{toast}</div>}
      {confirmation && <ConfirmModal {...confirmation} onCancel={() => setConfirmation(null)} />}
      {shareOpen && <ShareModal
        role={hostedRole}
        isHosted={hostedRole !== null}
        shareUrl={shareUrl}
        loading={shareLoading}
        copied={shareCopied}
        error={shareError}
        onPublish={publishAndShare}
        onGenerate={generateShare}
        onCopy={copyShareLink}
        onClose={() => setShareOpen(false)}
      />}
      <button type="button" className="mobile-panel-toggle" onClick={() => setAgentOpen((open) => !open)} aria-label="切换代理面板"><SidebarSimple size={20} /></button>
    </main>
  )
}

export default function App() {
  return <ReactFlowProvider><Workspace /></ReactFlowProvider>
}
