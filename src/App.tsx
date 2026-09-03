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
  DownloadSimple,
  Moon,
  Record,
  Robot,
  Rows,
  SidebarSimple,
  Sun,
} from '@phosphor-icons/react'
import './index.css'
import { AgentPanel } from './components/AgentPanel'
import { BoardElement } from './components/BoardElement'
import { Inspector } from './components/Inspector'
import { ToolRail } from './components/ToolRail'
import { EMPTY_SNAPSHOT, INITIAL_SNAPSHOT } from './data'
import { createArtifactTemplate, validateArtifactSpec } from './lib/artifacts'
import { arrangeNodes, calculateClusterBounds, createBoardEdge, createBoardNode, createId, serializeSnapshot } from './lib/board'
import { loadBoard, saveBoard } from './lib/storage'
import { getBackendHealth, syncRecording } from './lib/api'
import { appendEvent, completeRecording, createRecordingSession, joinRecording, loadRecording, recordingToCsv, recordingToMarkdown, saveRecording } from './lib/recording'
import { registerWebMCP, TOOL_CATALOG } from './lib/webmcp'
import type {
  Activity,
  AddElementInput,
  ArtifactSpec,
  BoardActions,
  BoardEdge,
  BoardNode,
  BoardSnapshot,
  ElementKind,
  RecordingActions,
  RecordingSession,
} from './types'

const NODE_TYPES = { boardElement: BoardElement }

function copySnapshot(snapshot: BoardSnapshot): BoardSnapshot {
  return structuredClone(snapshot)
}

function Workspace() {
  const initial = useMemo(() => loadBoard(INITIAL_SNAPSHOT), [])
  const [name, setName] = useState(initial.name)
  const [nodes, setNodes] = useState<BoardNode[]>(initial.nodes)
  const [edges, setEdges] = useState<BoardEdge[]>(initial.edges)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [agentOpen, setAgentOpen] = useState(true)
  const [activities, setActivities] = useState<Activity[]>([])
  const [recording, setRecording] = useState<RecordingSession | null>(() => loadRecording())
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
  const flowRef = useRef<ReactFlowInstance<BoardNode, BoardEdge> | null>(null)
  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)
  const nameRef = useRef(name)
  const historyRef = useRef<BoardSnapshot[]>([])
  const futureRef = useRef<BoardSnapshot[]>([])
  const recordingRef = useRef(recording)
  const [historyStatus, setHistoryStatus] = useState({ canUndo: false, canRedo: false })

  useEffect(() => { nodesRef.current = nodes }, [nodes])
  useEffect(() => { edgesRef.current = edges }, [edges])
  useEffect(() => { nameRef.current = name }, [name])
  useEffect(() => { recordingRef.current = recording }, [recording])

  const snapshotNow = useCallback((): BoardSnapshot => ({
    name: nameRef.current,
    nodes: structuredClone(nodesRef.current),
    edges: structuredClone(edgesRef.current),
    updatedAt: new Date().toISOString(),
  }), [])

  const reportActivity = useCallback((label: string, detail: string, source: Activity['source'] = 'system') => {
    const activity: Activity = {
      id: createId('activity'),
      label,
      detail,
      source,
      createdAt: new Date().toISOString(),
    }
    setActivities((current) => [activity, ...current].slice(0, 30))
    const activeRecording = recordingRef.current
    if (activeRecording?.status === 'recording') {
      const participant = source === 'agent'
        ? { id: 'agent-webmcp', name: 'Connected agent', role: 'agent' as const }
        : source === 'human'
          ? { id: 'human-facilitator', name: 'You', role: 'human' as const }
          : { id: 'canvas-relay', name: 'Canvas Relay', role: 'system' as const }
      const next = appendEvent(activeRecording, {
        participantId: participant.id,
        participantName: participant.name,
        participantRole: participant.role,
        kind: 'board_action',
        content: `${label}: ${detail}`,
      })
      recordingRef.current = next
      setRecording(next)
    }
  }, [])

  const announce = useCallback((message: string) => {
    setToast(message)
    window.setTimeout(() => setToast((current) => current === message ? null : current), 2400)
  }, [])

  const recordHistory = useCallback(() => {
    historyRef.current = [...historyRef.current.slice(-39), copySnapshot(snapshotNow())]
    futureRef.current = []
    setHistoryStatus({ canUndo: true, canRedo: false })
  }, [snapshotNow])

  const applySnapshot = useCallback((snapshot: BoardSnapshot) => {
    const copy = copySnapshot(snapshot)
    nameRef.current = copy.name
    nodesRef.current = copy.nodes
    edgesRef.current = copy.edges
    setName(copy.name)
    setNodes(copy.nodes)
    setEdges(copy.edges)
    setSelectedId(null)
  }, [])

  const undo = useCallback(() => {
    const previous = historyRef.current.pop()
    if (!previous) return
    futureRef.current = [copySnapshot(snapshotNow()), ...futureRef.current.slice(0, 39)]
    applySnapshot(previous)
    setHistoryStatus({ canUndo: historyRef.current.length > 0, canRedo: true })
    reportActivity('Undo', 'Restored the previous board state', 'human')
  }, [applySnapshot, reportActivity, snapshotNow])

  const redo = useCallback(() => {
    const next = futureRef.current.shift()
    if (!next) return
    historyRef.current.push(copySnapshot(snapshotNow()))
    applySnapshot(next)
    setHistoryStatus({ canUndo: true, canRedo: futureRef.current.length > 0 })
    reportActivity('Redo', 'Reapplied the board change', 'human')
  }, [applySnapshot, reportActivity, snapshotNow])

  const commitNodes = useCallback((next: BoardNode[]) => {
    nodesRef.current = next
    setNodes(next)
    setSaveState('saving')
  }, [])

  const commitEdges = useCallback((next: BoardEdge[]) => {
    edgesRef.current = next
    setEdges(next)
    setSaveState('saving')
  }, [])

  const getCenterPosition = useCallback((offset = 0) => {
    const flow = flowRef.current
    if (!flow) return { x: 180 + offset, y: 140 + offset }
    return flow.screenToFlowPosition({
      x: Math.max(280, window.innerWidth / 2) + offset,
      y: window.innerHeight / 2 + offset,
    })
  }, [])

  const addElement = useCallback((input: AddElementInput, source: Activity['source'] = 'human') => {
    recordHistory()
    const fallback = getCenterPosition(nodesRef.current.length % 5 * 24)
    const node = createBoardNode(input, fallback)
    const next = [...nodesRef.current, node]
    commitNodes(next)
    setSelectedId(node.id)
    reportActivity('Element added', node.data.title, source)
    return node
  }, [commitNodes, getCenterPosition, recordHistory, reportActivity])

  const addElements = useCallback((items: AddElementInput[], source: Activity['source'] = 'agent') => {
    if (!items.length) throw new Error('At least one element is required.')
    recordHistory()
    const origin = getCenterPosition()
    const created = items.map((item, index) => createBoardNode(item, {
      x: origin.x + (index % 3) * 270,
      y: origin.y + Math.floor(index / 3) * 190,
    }))
    commitNodes([...nodesRef.current, ...created])
    reportActivity('Idea set added', `${created.length} elements created`, source)
    return created
  }, [commitNodes, getCenterPosition, recordHistory, reportActivity])

  const updateElement = useCallback<BoardActions['updateElement']>((id, patch, source = 'human') => {
    const existing = nodesRef.current.find((node) => node.id === id)
    if (!existing) throw new Error(`Element ${id} was not found.`)
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
    commitNodes(nodesRef.current.map((node) => node.id === id ? updated : node))
    reportActivity('Element updated', updated.data.title, source)
    return updated
  }, [commitNodes, recordHistory, reportActivity])

  const removeElements = useCallback((ids: string[], source: Activity['source'] = 'human') => {
    const validIds = new Set(nodesRef.current.filter((node) => ids.includes(node.id)).map((node) => node.id))
    if (!validIds.size) return 0
    recordHistory()
    commitNodes(nodesRef.current.filter((node) => !validIds.has(node.id)))
    commitEdges(edgesRef.current.filter((edge) => !validIds.has(edge.source) && !validIds.has(edge.target)))
    setSelectedId((current) => current && validIds.has(current) ? null : current)
    reportActivity('Elements removed', `${validIds.size} deleted`, source)
    return validIds.size
  }, [commitEdges, commitNodes, recordHistory, reportActivity])

  const connectElements = useCallback<BoardActions['connectElements']>((sourceId, targetId, label, source = 'human') => {
    if (!nodesRef.current.some((node) => node.id === sourceId)) throw new Error(`Source element ${sourceId} was not found.`)
    if (!nodesRef.current.some((node) => node.id === targetId)) throw new Error(`Target element ${targetId} was not found.`)
    recordHistory()
    const edge = createBoardEdge(sourceId, targetId, label)
    commitEdges(addEdge(edge, edgesRef.current))
    reportActivity('Elements connected', label || 'New relationship', source)
    return edge
  }, [commitEdges, recordHistory, reportActivity])

  const arrange = useCallback<BoardActions['arrange']>((layout, source = 'human') => {
    recordHistory()
    const next = arrangeNodes(nodesRef.current, layout)
    commitNodes(next)
    reportActivity('Board arranged', `${layout} layout applied`, source)
    window.setTimeout(() => flowRef.current?.fitView({ padding: 0.18, duration: 450 }), 30)
  }, [commitNodes, recordHistory, reportActivity])

  const createCluster = useCallback<BoardActions['createCluster']>((clusterName, elementIds, source = 'agent') => {
    const uniqueIds = [...new Set(elementIds)]
    const bounds = calculateClusterBounds(nodesRef.current, uniqueIds)
    recordHistory()
    const frame = createBoardNode({ title: clusterName, body: `${uniqueIds.length} related elements`, kind: 'frame', color: 'paper', x: bounds.x, y: bounds.y })
    frame.style = { width: bounds.width, height: bounds.height }
    const members = nodesRef.current.map((node) => uniqueIds.includes(node.id)
      ? { ...node, data: { ...node.data, cluster: clusterName } }
      : node)
    commitNodes([frame, ...members])
    reportActivity('Cluster created', clusterName, source)
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
    reportActivity('Artifact created', `${spec.title}, ${spec.records.length} records`, source)
    return node
  }, [commitNodes, getCenterPosition, recordHistory, reportActivity])

  const getArtifactSpec = useCallback((id: string): ArtifactSpec => {
    const node = nodesRef.current.find((candidate) => candidate.id === id)
    if (!node?.data.artifact) throw new Error(`Artifact ${id} was not found.`)
    return structuredClone(node.data.artifact)
  }, [])

  const updateArtifactRecords = useCallback<BoardActions['updateArtifactRecords']>((id, records, mode = 'replace', source = 'agent') => {
    const existing = nodesRef.current.find((node) => node.id === id)
    if (!existing?.data.artifact) throw new Error(`Artifact ${id} was not found.`)
    const nextRecords = mode === 'append' ? [...existing.data.artifact.records, ...records] : records
    const artifact = validateArtifactSpec({ ...existing.data.artifact, records: nextRecords })
    recordHistory()
    const updated = { ...existing, data: { ...existing.data, artifact, title: artifact.title, justCreated: source === 'agent' } }
    commitNodes(nodesRef.current.map((node) => node.id === id ? updated : node))
    reportActivity('Artifact data updated', `${artifact.records.length} total records`, source)
    return updated
  }, [commitNodes, recordHistory, reportActivity])

  const focusElements = useCallback((ids: string[]) => {
    const valid = nodesRef.current.filter((node) => ids.includes(node.id))
    if (!valid.length) throw new Error('None of the requested elements were found.')
    commitNodes(nodesRef.current.map((node) => ({ ...node, selected: ids.includes(node.id) })))
    setSelectedId(valid[0].id)
    flowRef.current?.fitView({ nodes: valid, padding: 0.35, duration: 450 })
  }, [commitNodes])

  const clear = useCallback((source: Activity['source'] = 'human') => {
    recordHistory()
    commitNodes([])
    commitEdges([])
    setSelectedId(null)
    reportActivity('Board cleared', 'All elements removed', source)
  }, [commitEdges, commitNodes, recordHistory, reportActivity])

  const actions = useMemo<BoardActions>(() => ({
    getSnapshot: snapshotNow,
    addElement,
    addElements,
    updateElement,
    removeElements,
    connectElements,
    arrange,
    createCluster,
    createArtifact,
    getArtifactSpec,
    updateArtifactRecords,
    focusElements,
    clear,
  }), [addElement, addElements, arrange, clear, connectElements, createArtifact, createCluster, focusElements, getArtifactSpec, removeElements, snapshotNow, updateArtifactRecords, updateElement])

  const getRecording = useCallback(() => recordingRef.current ? structuredClone(recordingRef.current) : null, [])

  const startRecording = useCallback<RecordingActions['startRecording']>((title, actor) => {
    if (recordingRef.current?.status === 'recording') return recordingRef.current
    const session = createRecordingSession(title || `${nameRef.current} decision trace`, actor)
    recordingRef.current = session
    setRecording(session)
    const activity: Activity = {
      id: createId('activity'), label: 'Recording started', detail: session.title, source: 'human', createdAt: new Date().toISOString(),
    }
    setActivities((current) => [activity, ...current].slice(0, 30))
    return session
  }, [])

  const joinParticipant = useCallback<RecordingActions['joinParticipant']>((participant) => {
    const current = recordingRef.current
    if (!current) throw new Error('Start a recording before joining the session.')
    const next = joinRecording(current, participant)
    recordingRef.current = next
    setRecording(next)
    return next
  }, [])

  const recordContribution = useCallback<RecordingActions['recordContribution']>((input) => {
    let current = recordingRef.current
    if (!current) throw new Error('Start a recording before adding contributions.')
    if (!current.participants.some((participant) => participant.id === input.agentId)) {
      current = joinRecording(current, { id: input.agentId, name: input.agentName, role: 'agent', specialty: 'Agent contributor' })
    }
    if (input.replyTo && !current.events.some((event) => event.id === input.replyTo)) {
      throw new Error(`Reply target ${input.replyTo} was not found in this session.`)
    }
    const next = appendEvent(current, {
      participantId: input.agentId,
      participantName: input.agentName,
      participantRole: 'agent',
      kind: input.kind,
      content: input.content,
      replyTo: input.replyTo,
      relatedElementIds: input.relatedElementIds,
    })
    const event = next.events.at(-1)!
    recordingRef.current = next
    setRecording(next)
    const activity: Activity = {
      id: createId('activity'), label: `${input.agentName}: ${input.kind}`, detail: input.content.slice(0, 120), source: 'agent', createdAt: event.createdAt,
    }
    setActivities((activities) => [activity, ...activities].slice(0, 30))
    return event
  }, [])

  const recordUserMessage = useCallback<RecordingActions['recordUserMessage']>((content, kind = 'question') => {
    const current = recordingRef.current
    if (!current) throw new Error('Start a recording before adding your contribution.')
    const next = appendEvent(current, {
      participantId: 'human-facilitator',
      participantName: 'You',
      participantRole: 'human',
      kind,
      content,
    })
    const event = next.events.at(-1)!
    recordingRef.current = next
    setRecording(next)
    const activity: Activity = {
      id: createId('activity'), label: `You: ${kind}`, detail: content.slice(0, 120), source: 'human', createdAt: event.createdAt,
    }
    setActivities((activities) => [activity, ...activities].slice(0, 30))
    return event
  }, [])

  const finalizeRecording = useCallback<RecordingActions['finalizeRecording']>((finalOutput, actor) => {
    const current = recordingRef.current
    if (!current) throw new Error('No recording is active.')
    if (current.status === 'complete') return current
    const next = completeRecording(current, finalOutput, actor)
    recordingRef.current = next
    setRecording(next)
    const activity: Activity = {
      id: createId('activity'), label: 'Recording finalized', detail: `${next.events.length} events preserved`, source: actor?.role === 'agent' ? 'agent' : 'human', createdAt: next.completedAt!,
    }
    setActivities((activities) => [activity, ...activities].slice(0, 30))
    return next
  }, [])

  const recordingActions = useMemo<RecordingActions>(() => ({
    getRecording,
    startRecording,
    joinParticipant,
    recordContribution,
    recordUserMessage,
    finalizeRecording,
  }), [finalizeRecording, getRecording, joinParticipant, recordContribution, recordUserMessage, startRecording])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        saveBoard(snapshotNow())
        setSaveState('saved')
      } catch {
        setSaveState('error')
      }
    }, 180)
    return () => window.clearTimeout(timer)
  }, [edges, name, nodes, snapshotNow])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    window.localStorage.setItem('canvas-relay-theme', theme)
  }, [theme])

  useEffect(() => {
    saveRecording(recording)
  }, [recording])

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
        await syncRecording(recording, snapshotNow())
        setBackendState('synced')
      } catch {
        setBackendState('offline')
      }
    }, 320)
    return () => window.clearTimeout(timer)
  }, [edges, name, nodes, recording, snapshotNow])

  useEffect(() => {
    const registration = registerWebMCP(actions, recordingActions, (label, detail) => reportActivity(label, detail, 'agent'))
    return registration.cleanup
  }, [actions, recordingActions, reportActivity])

  const onNodesChange = useCallback((changes: NodeChange<BoardNode>[]) => {
    const next = applyNodeChanges(changes, nodesRef.current)
    commitNodes(next)
  }, [commitNodes])

  const onEdgesChange = useCallback((changes: EdgeChange<BoardEdge>[]) => {
    const next = applyEdgeChanges(changes, edgesRef.current)
    commitEdges(next)
  }, [commitEdges])

  const onConnect = useCallback((connection: Connection) => {
    if (connection.source && connection.target) connectElements(connection.source, connection.target, undefined, 'human')
  }, [connectElements])

  const addKind = useCallback((kind: ElementKind) => {
    const names: Record<ElementKind, string> = {
      idea: 'New idea', question: 'What should we explore?', insight: 'New insight', action: 'Next action', frame: 'New cluster', artifact: 'New artifact',
    }
    addElement({ title: names[kind], kind })
  }, [addElement])

  const addArtifact = useCallback((template: 'decision' | 'cards' | 'checklist') => {
    createArtifact(createArtifactTemplate(template), undefined, undefined, 'human')
  }, [createArtifact])

  const updateFromInspector = useCallback((id: string, patch: Partial<BoardNode['data']>) => {
    const next = nodesRef.current.map((node) => node.id === id ? { ...node, data: { ...node.data, ...patch } } : node)
    commitNodes(next)
  }, [commitNodes])

  const duplicateElement = useCallback((id: string) => {
    const existing = nodesRef.current.find((node) => node.id === id)
    if (!existing) return
    recordHistory()
    const duplicate: BoardNode = {
      ...structuredClone(existing),
      id: createId(existing.data.kind),
      position: { x: existing.position.x + 36, y: existing.position.y + 36 },
      selected: true,
      data: { ...structuredClone(existing.data), title: `${existing.data.title} copy`, justCreated: true },
    }
    commitNodes([...nodesRef.current.map((node): BoardNode => ({ ...node, selected: false })), duplicate])
    setSelectedId(duplicate.id)
    reportActivity('Element duplicated', duplicate.data.title, 'human')
  }, [commitNodes, recordHistory, reportActivity])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
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
      } else if ((event.key === 'Backspace' || event.key === 'Delete') && selectedId) {
        event.preventDefault()
        removeElements([selectedId], 'human')
      } else if (event.key.toLowerCase() === 'n') addElement({ title: 'New idea', kind: 'idea' })
      else if (event.key.toLowerCase() === 'q') addElement({ title: 'New question', kind: 'question' })
      else if (event.key === '+' || event.key === '=') flowRef.current?.zoomIn({ duration: 180 })
      else if (event.key === '-') flowRef.current?.zoomOut({ duration: 180 })
      else if (event.key === '0') flowRef.current?.fitView({ padding: 0.2, duration: 300 })
      else if (event.key === 'Escape') setSelectedId(null)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [addElement, duplicateElement, redo, removeElements, selectedId, undo])

  const copyArtifactSpec = useCallback(async (id: string) => {
    const spec = getArtifactSpec(id)
    await navigator.clipboard.writeText(JSON.stringify(spec, null, 2))
    announce('Artifact spec copied')
  }, [announce, getArtifactSpec])

  const runDemoRecipe = useCallback((recipe: 'diverge' | 'cluster' | 'artifact') => {
    if (recipe === 'artifact') {
      const strongest = nodesRef.current.filter((node) => node.data.kind !== 'frame' && node.data.kind !== 'artifact').sort((a, b) => b.data.votes - a.data.votes).slice(0, 4)
      const template = createArtifactTemplate('decision')
      template.records = strongest.length ? strongest.map((node) => ({
        option: node.data.title,
        impact: node.data.votes >= 6 ? 'High' : 'Medium',
        effort: node.data.kind === 'action' ? 'Low' : 'Medium',
        owner: 'Unassigned',
      })) : template.records
      createArtifact(template, undefined, undefined, 'agent')
      announce('Agent recipe created a structured matrix')
      return
    }

    if (recipe === 'diverge') {
      const created = addElements([
        { title: 'Five-minute pairing', body: 'Match teammates for one focused question.', kind: 'idea', color: 'sun', cluster: 'Connection' },
        { title: 'Async gratitude wall', body: 'Capture specific appreciation while work happens.', kind: 'idea', color: 'rose', cluster: 'Connection' },
        { title: 'No-camera planning', body: 'Run low-pressure sessions around a shared board.', kind: 'idea', color: 'sky', cluster: 'Focus' },
        { title: 'Weekly energy budget', body: 'Make workload tradeoffs visible before they become stress.', kind: 'insight', color: 'mint', cluster: 'Signals' },
        { title: 'Meeting exit ticket', body: 'Ask one question before everyone leaves.', kind: 'question', color: 'rose', cluster: 'Signals' },
        { title: 'Protect one quiet hour', body: 'Create a team-wide block with no messages.', kind: 'action', color: 'paper', cluster: 'Focus' },
      ], 'agent')
      window.setTimeout(() => flowRef.current?.fitView({ nodes: created, padding: 0.18, duration: 600 }), 50)
      announce('Agent recipe added six ideas')
      return
    }

    const eligible = nodesRef.current.filter((node) => node.data.kind !== 'frame' && node.data.kind !== 'artifact')
    if (eligible.length < 2) {
      announce('Add at least two ideas before grouping')
      return
    }
    arrange('columns', 'agent')
    announce('Agent recipe arranged ideas by their cluster field')
  }, [addElements, arrange, createArtifact, announce])

  const resetDemo = useCallback(() => {
    if (!window.confirm('Replace the current board with the demo board? You can undo this action.')) return
    recordHistory()
    applySnapshot(INITIAL_SNAPSHOT)
    reportActivity('Demo restored', 'Loaded the hybrid rituals example', 'human')
  }, [applySnapshot, recordHistory, reportActivity])

  const newBoard = useCallback(() => {
    if (nodesRef.current.length && !window.confirm('Clear the canvas and start a new board? You can undo this action.')) return
    recordHistory()
    applySnapshot(EMPTY_SNAPSHOT)
    reportActivity('New board', 'Started with an empty canvas', 'human')
  }, [applySnapshot, recordHistory, reportActivity])

  const exportBoard = useCallback(() => {
    const content = serializeSnapshot(snapshotNow())
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${nameRef.current.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'canvas-relay'}.json`
    anchor.click()
    URL.revokeObjectURL(url)
    reportActivity('Board exported', 'Downloaded a portable JSON snapshot', 'human')
  }, [reportActivity, snapshotNow])

  const finishRecordingFromUI = useCallback(() => {
    const current = recordingRef.current
    if (!current || current.status !== 'recording') return
    const artifactCount = nodesRef.current.filter((node) => node.data.kind === 'artifact').length
    const decisions = current.events.filter((event) => event.kind === 'decision').length
    finalizeRecording(
      `Session completed with ${nodesRef.current.length} visual elements, ${edgesRef.current.length} connections, ${artifactCount} structured artifacts, and ${decisions} explicit decisions.`,
    )
    announce('Decision trace finalized and ready to export')
  }, [announce, finalizeRecording])

  const exportRecording = useCallback((format: 'json' | 'markdown' | 'csv') => {
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
    announce(`Decision trace exported as ${extension.toUpperCase()}`)
  }, [announce, snapshotNow])

  const loadMultiAgentDemo = useCallback(() => {
    if (recordingRef.current?.status === 'recording' && !window.confirm('Replace the active recording with a multi-agent demo?')) return
    let session = createRecordingSession('Remote onboarding decision trace', {
      id: 'human-facilitator', name: 'You', role: 'human', specialty: 'Facilitator',
    })
    const participants = [
      { id: 'agent-explorer', name: 'Explorer', role: 'agent' as const, specialty: 'Divergent ideation' },
      { id: 'agent-critic', name: 'Critic', role: 'agent' as const, specialty: 'Risks and constraints' },
      { id: 'agent-synth', name: 'Synthesizer', role: 'agent' as const, specialty: 'Decisions and next steps' },
    ]
    participants.forEach((participant) => { session = joinRecording(session, participant) })
    session = appendEvent(session, {
      participantId: 'human-facilitator', participantName: 'You', participantRole: 'human', kind: 'question',
      content: 'How might we make remote onboarding useful from the first day without adding more meetings?',
    })
    const questionId = session.events.at(-1)!.id
    session = appendEvent(session, {
      participantId: 'agent-explorer', participantName: 'Explorer', participantRole: 'agent', kind: 'proposal', replyTo: questionId,
      content: 'Create a role-based canvas with permissions for day zero, an async buddy card, and a first deliverable by day three.',
      relatedElementIds: ['idea-map', 'idea-room'],
    })
    const proposalId = session.events.at(-1)!.id
    session = appendEvent(session, {
      participantId: 'agent-critic', participantName: 'Critic', participantRole: 'agent', kind: 'critique', replyTo: proposalId,
      content: 'A single checklist can hide timezone and role differences. Keep the primitives reusable and let each role generate its own artifact.',
      relatedElementIds: ['artifact-decision'],
    })
    session = appendEvent(session, {
      participantId: 'agent-synth', participantName: 'Synthesizer', participantRole: 'agent', kind: 'decision',
      content: 'Adopt role-based artifact templates and test them with five new hires. Measure time to first meaningful contribution.',
      relatedElementIds: ['artifact-decision', 'action-prototype'],
    })
    recordingRef.current = session
    setRecording(session)
    setAgentOpen(true)
    announce('Loaded a live trace with three agent participants')
  }, [announce])

  const selectedNode = nodes.find((node) => node.id === selectedId) ?? null

  return (
    <main className="app-shell">
      <header className="top-bar">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true"><span /><span /><span /></div>
          <div className="board-title-wrap">
            <span className="product-name">Canvas Relay</span>
            <input
              aria-label="Board name"
              value={name}
              maxLength={80}
              onChange={(event) => {
                nameRef.current = event.target.value
                setName(event.target.value)
                setSaveState('saving')
              }}
            />
          </div>
        </div>

        <div className="top-actions">
          <div className="history-controls" aria-label="History controls">
            <button type="button" className="icon-button" onClick={undo} disabled={!historyStatus.canUndo} aria-label="Undo"><ArrowCounterClockwise size={18} /></button>
            <button type="button" className="icon-button" onClick={redo} disabled={!historyStatus.canRedo} aria-label="Redo"><ArrowClockwise size={18} /></button>
          </div>
          <details className="top-menu">
            <summary className="secondary-button"><Rows size={17} />Arrange<CaretDown size={13} /></summary>
            <div className="top-menu-popover">
              <button type="button" onClick={() => arrange('grid')}>Grid</button>
              <button type="button" onClick={() => arrange('columns')}>Columns by cluster</button>
              <button type="button" onClick={() => arrange('radial')}>Radial map</button>
              <span />
              <button type="button" onClick={newBoard}>New blank board</button>
              <button type="button" onClick={resetDemo}>Restore demo</button>
            </div>
          </details>
          <button type="button" className="icon-button theme-button" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')} aria-label={`Use ${theme === 'light' ? 'dark' : 'light'} theme`}>
            {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
          </button>
          <button type="button" className="secondary-button export-button" onClick={exportBoard}><DownloadSimple size={17} />Export</button>
          <button
            type="button"
            className={`record-top-button ${recording?.status === 'recording' ? 'is-recording' : ''}`}
            onClick={() => {
              setAgentOpen(true)
              if (!recording) startRecording()
            }}
          >
            <Record size={13} weight="fill" />{recording?.status === 'recording' ? 'REC' : recording ? 'Trace' : 'Record'}
          </button>
          <button type="button" className={`agent-toggle ${agentOpen ? 'is-active' : ''}`} onClick={() => setAgentOpen((open) => !open)}>
            <Robot size={18} weight="fill" />Agent
            <span className={webMCPState.supported ? 'connection-light ready' : 'connection-light'} aria-hidden="true" />
          </button>
        </div>
      </header>

      <section className="workspace">
        <ToolRail onAdd={addKind} onArtifact={addArtifact} />
        <div className="canvas-wrap">
          <ReactFlow<BoardNode, BoardEdge>
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onInit={(instance) => { flowRef.current = instance }}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onSelectionChange={({ nodes: selected }) => setSelectedId(selected.length === 1 ? selected[0].id : null)}
            onNodeDragStart={recordHistory}
            onDoubleClick={(event) => {
              if ((event.target as Element).classList.contains('react-flow__pane')) {
                const position = flowRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY })
                addElement({ title: 'New idea', kind: 'idea', x: position?.x, y: position?.y })
              }
            }}
            deleteKeyCode={null}
            selectionOnDrag
            panOnScroll
            fitView
            fitViewOptions={{ padding: 0.16 }}
            minZoom={0.2}
            maxZoom={2.2}
            colorMode={theme}
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

          {!nodes.length && (
            <div className="empty-board">
              <div className="empty-icon"><BracketsCurly size={25} weight="bold" /></div>
              <h2>Start with one thought</h2>
              <p>Double-click anywhere, add a structured artifact, or let an agent build the first map.</p>
              <div>
                <button type="button" className="primary-button" onClick={() => addKind('idea')}>Create first idea</button>
                <button type="button" className="secondary-button" onClick={() => setAgentOpen(true)}>Open agent tools</button>
              </div>
            </div>
          )}

          <div className="canvas-status">
            <span className={`save-indicator state-${saveState}`} />
            {saveState === 'saved' ? 'Saved locally' : saveState === 'saving' ? 'Saving' : 'Could not save'}
            <span className="status-divider" />
            {nodes.filter((node) => node.data.kind !== 'frame').length} elements
            <span className="shortcut-hint">Double-click canvas to add</span>
          </div>
        </div>

        {selectedNode && (
          <Inspector
            node={selectedNode}
            onUpdate={updateFromInspector}
            onDelete={(id) => removeElements([id], 'human')}
            onDuplicate={duplicateElement}
            onClose={() => setSelectedId(null)}
            onCopySpec={copyArtifactSpec}
          />
        )}

        <AgentPanel
          isOpen={agentOpen && !selectedNode}
          supported={webMCPState.supported}
          toolCount={webMCPState.count}
          activities={activities}
          recording={recording}
          backendState={backendState}
          onClose={() => setAgentOpen(false)}
          onRunDemo={runDemoRecipe}
          onStartRecording={() => startRecording()}
          onFinalizeRecording={finishRecordingFromUI}
          onExportRecording={exportRecording}
          onRecordUserMessage={(content) => recordUserMessage(content, 'question')}
          onLoadMultiAgentDemo={loadMultiAgentDemo}
        />
      </section>

      {toast && <div className="toast" role="status">{toast}</div>}
      <button type="button" className="mobile-panel-toggle" onClick={() => setAgentOpen((open) => !open)} aria-label="Toggle agent panel"><SidebarSimple size={20} /></button>
    </main>
  )
}

export default function App() {
  return <ReactFlowProvider><Workspace /></ReactFlowProvider>
}
