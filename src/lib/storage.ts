import type { BoardSnapshot, BoardSummary, RecordingSession } from '../types'
import { isSnapshot } from './board-validation'
import { createUUID } from './board'

const LEGACY_KEY = 'canvas-relay-board-v1'
const LIBRARY_KEY = 'canvas-relay-boards-v2'
const BOARD_KEY_PREFIX = 'canvas-relay-board-v2:'
const CURRENT_KEY = 'canvas-relay-current-board-v2'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_IMPORT_LENGTH = 10_000_000
const CONTRIBUTION_KINDS = new Set(['proposal', 'question', 'critique', 'evidence', 'decision', 'note', 'reasoning_summary', 'result', 'board_action', 'checkpoint'])
const PARTICIPANT_ROLES = new Set(['human', 'agent', 'system'])
const PARTICIPANT_STATUSES = new Set(['connecting', 'active', 'muted', 'offline'])
const AGENT_COLORS = new Set(['coral', 'blue', 'violet', 'green', 'amber', 'pink', 'cyan', 'lime'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isString(value: unknown, maxLength: number, allowEmpty = false): value is string {
  return typeof value === 'string' && value.length <= maxLength && (allowEmpty || Boolean(value.trim()))
}

function isTimestamp(value: unknown): value is string {
  return isString(value, 64) && Number.isFinite(Date.parse(value))
}

function isOptionalString(value: unknown, maxLength: number): value is string | undefined {
  return value === undefined || isString(value, maxLength, true)
}

function isStringList(value: unknown, maximum: number): value is string[] {
  return Array.isArray(value) && value.length <= maximum
    && value.every((item) => isString(item, 200))
}

function hasValidMetadata(value: unknown): value is Record<string, string | number | boolean | null> {
  if (!isRecord(value) || Object.keys(value).length > 100) return false
  return Object.entries(value).every(([key, item]) => isString(key, 120)
    && (item === null || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item)) || isString(item, 10_000, true)))
}

function isRecording(value: unknown): value is RecordingSession {
  if (!isRecord(value)) return false
  const session = value as Partial<RecordingSession>
  if (session.specVersion !== '1.0' || !isString(session.id, 200) || !isString(session.title, 1_000)
    || (session.status !== 'recording' && session.status !== 'complete') || !isTimestamp(session.startedAt)
    || !isOptionalString(session.boardId, 200) || !isString(session.moderatorId, 200)
    || !isOptionalString(session.finalOutput, 100_000)
    || (session.completedAt !== undefined && !isTimestamp(session.completedAt))
    || !Array.isArray(session.participants) || !Array.isArray(session.events)
    || session.participants.length < 1 || session.participants.length > 200 || session.events.length > 10000) return false

  const participants = new Map<string, { role: string }>()
  const participantsAreValid = session.participants.every((candidate) => {
    const focus = isRecord(candidate) && candidate.focus
    const focusIsValid = focus === undefined || (isRecord(focus)
      && (focus.state === 'editing' || focus.state === 'reviewing')
      && isString(focus.intent, 1_000, true)
      && isStringList(focus.elementIds, 50)
      && isTimestamp(focus.claimedAt)
      && isTimestamp(focus.leaseExpiresAt)
      && (focus.releaseOnAction === 'after_write' || focus.releaseOnAction === 'manual'))
    if (!isRecord(candidate) || !isString(candidate.id, 200) || participants.has(candidate.id)
      || !isString(candidate.name, 1_000) || !PARTICIPANT_ROLES.has(String(candidate.role))
      || !isOptionalString(candidate.specialty, 1_000)
      || (candidate.status !== undefined && !PARTICIPANT_STATUSES.has(String(candidate.status)))
      || (candidate.joinedAt !== undefined && !isTimestamp(candidate.joinedAt))
      || (candidate.lastSeenAt !== undefined && !isTimestamp(candidate.lastSeenAt))
      || (candidate.leaseExpiresAt !== undefined && !isTimestamp(candidate.leaseExpiresAt))
      || (candidate.watchingElementIds !== undefined && !isStringList(candidate.watchingElementIds, 50))
      || (candidate.color !== undefined && !AGENT_COLORS.has(String(candidate.color)))
      || !focusIsValid) return false
    participants.set(candidate.id, { role: String(candidate.role) })
    return true
  })
  if (!participantsAreValid || !participants.has(session.moderatorId)) return false

  const eventIds = new Set<string>()
  const replyTargets: string[] = []
  const eventsAreValid = session.events.every((candidate) => {
    const checkpoint = isRecord(candidate) ? candidate.checkpoint : undefined
    const checkpointIsValid = checkpoint === undefined || (isRecord(checkpoint)
      && isString(checkpoint.label, 1_000)
      && isSnapshot(checkpoint.board)
      && checkpoint.board.id === session.boardId)
    if (!isRecord(candidate) || !isString(candidate.id, 200) || eventIds.has(candidate.id)
      || !isTimestamp(candidate.createdAt) || !isString(candidate.participantId, 200)
      || !isString(candidate.participantName, 1_000) || !PARTICIPANT_ROLES.has(String(candidate.participantRole))
      || !CONTRIBUTION_KINDS.has(String(candidate.kind)) || !isString(candidate.content, 100_000, true)
      || !isOptionalString(candidate.replyTo, 200)
      || (candidate.relatedElementIds !== undefined && !isStringList(candidate.relatedElementIds, 50))
      || (candidate.metadata !== undefined && !hasValidMetadata(candidate.metadata))
      || !checkpointIsValid
      || (candidate.kind === 'checkpoint' && checkpoint === undefined)
      || (candidate.kind !== 'checkpoint' && checkpoint !== undefined)) return false
    const participant = participants.get(candidate.participantId)
    if (!participant || participant.role !== candidate.participantRole) return false
    eventIds.add(candidate.id)
    if (candidate.replyTo) replyTargets.push(candidate.replyTo)
    return true
  })
  return eventsAreValid && replyTargets.every((id) => eventIds.has(id))
}

function normalizeBoard(value: BoardSnapshot, forceNewId = false): BoardSnapshot {
  const now = new Date().toISOString()
  return {
    ...structuredClone(value),
    id: !forceNewId && UUID_PATTERN.test(value.id ?? '') ? value.id : createUUID(),
    name: value.name.trim().slice(0, 80) || 'Untitled brainstorm',
    createdAt: value.createdAt || now,
    updatedAt: value.updatedAt || now,
  }
}

function readLibrary(): BoardSnapshot[] {
  const boards = new Map<string, BoardSnapshot>()
  try {
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (!key?.startsWith(BOARD_KEY_PREFIX)) continue
      const parsed = JSON.parse(window.localStorage.getItem(key) || 'null') as unknown
      if (isSnapshot(parsed)) {
        const board = normalizeBoard(parsed)
        boards.set(board.id, board)
      }
    }
    const legacyLibrary = JSON.parse(window.localStorage.getItem(LIBRARY_KEY) || '[]') as unknown
    if (Array.isArray(legacyLibrary)) {
      legacyLibrary.filter(isSnapshot).forEach((candidate) => {
        const board = normalizeBoard(candidate)
        if (!boards.has(board.id)) boards.set(board.id, board)
      })
    }
    return [...boards.values()]
  } catch {
    return [...boards.values()]
  }
}

function writeLibrary(boards: BoardSnapshot[]) {
  boards.slice(0, 50).forEach((board) => window.localStorage.setItem(`${BOARD_KEY_PREFIX}${board.id}`, JSON.stringify(board)))
  window.localStorage.removeItem(LIBRARY_KEY)
}

export function loadBoard(fallback: BoardSnapshot): BoardSnapshot {
  const boards = readLibrary()
  const currentId = window.localStorage.getItem(CURRENT_KEY)
  const current = boards.find((board) => board.id === currentId) ?? boards[0]
  if (current) return current

  try {
    const legacy = JSON.parse(window.localStorage.getItem(LEGACY_KEY) || 'null') as unknown
    const board = normalizeBoard(isSnapshot(legacy) ? legacy : fallback)
    writeLibrary([board])
    window.localStorage.setItem(CURRENT_KEY, board.id)
    return board
  } catch {
    const board = normalizeBoard(fallback)
    writeLibrary([board])
    window.localStorage.setItem(CURRENT_KEY, board.id)
    return board
  }
}

export function saveBoard(snapshot: BoardSnapshot) {
  const board = normalizeBoard(snapshot)
  window.localStorage.setItem(`${BOARD_KEY_PREFIX}${board.id}`, JSON.stringify(board))
  window.localStorage.setItem(CURRENT_KEY, board.id)
}

export function listBoards(): BoardSummary[] {
  return readLibrary()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map((board) => ({
      id: board.id,
      name: board.name,
      createdAt: board.createdAt,
      updatedAt: board.updatedAt,
      elementCount: board.nodes.filter((node) => node.data.kind !== 'frame').length,
    }))
}

export function loadBoardById(id: string): BoardSnapshot | null {
  const board = readLibrary().find((candidate) => candidate.id === id)
  if (!board) return null
  window.localStorage.setItem(CURRENT_KEY, board.id)
  return structuredClone(board)
}

export function importBoard(serialized: string): BoardSnapshot {
  return importCanvasRelay(serialized).board
}

export function importCanvasRelay(serialized: string): { board: BoardSnapshot; recording: RecordingSession | null } {
  if (serialized.length > MAX_IMPORT_LENGTH) throw new Error('The Canvas Relay file is too large to import.')
  const parsed = JSON.parse(serialized) as unknown
  const isBundle = isRecord(parsed) && Object.prototype.hasOwnProperty.call(parsed, 'finalBoard')
  const candidate = isBundle
    ? parsed.finalBoard
    : parsed
  if (!isSnapshot(candidate)) throw new Error('The file is not a valid Canvas Relay board.')
  if (isBundle && parsed.schemaVersion !== undefined && parsed.schemaVersion !== '1.0') {
    throw new Error('The Canvas Relay package uses an unsupported schema version.')
  }
  const hasBundledSession = isBundle && Object.prototype.hasOwnProperty.call(parsed, 'session')
  const bundledSession = hasBundledSession ? parsed.session : null
  if (bundledSession !== null && !isRecording(bundledSession)) {
    throw new Error('The file contains an invalid Canvas Relay recording.')
  }

  const existingIds = new Set(readLibrary().map((board) => board.id))
  const normalized = normalizeBoard(candidate, !UUID_PATTERN.test(candidate.id ?? '') || existingIds.has(candidate.id))
  const { brainstormSessionId: _discussionId, brainstormSession: _discussion, ...plainBoard } = normalized as BoardSnapshot & { brainstormSession?: unknown }
  const imported = { ...plainBoard, nodes: plainBoard.nodes.map((node) => {
    const { ideaMeta: _meta, ...data } = node.data
    return { ...node, data }
  }), name: `${normalized.name} (imported)`, updatedAt: new Date().toISOString() }
  saveBoard(imported)
  const recording = bundledSession ? {
    ...structuredClone(bundledSession),
    boardId: imported.id,
    events: bundledSession.events.map((event) => event.checkpoint ? {
      ...structuredClone(event),
      checkpoint: { ...structuredClone(event.checkpoint), board: { ...structuredClone(event.checkpoint.board), id: imported.id } },
    } : structuredClone(event)),
  } : null
  return { board: imported, recording }
}
