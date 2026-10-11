import type { AgentColor, AgentFocus, BoardSnapshot, RecordingEvent, RecordingParticipant, RecordingSession } from '../types'
import { createId, createUUID } from './board'

const RECORDING_KEY = 'canvas-relay-recording-v1'
export const AGENT_COLORS: AgentColor[] = ['coral', 'blue', 'violet', 'green', 'amber', 'pink', 'cyan', 'lime']

export const AGENT_COLOR_HEX: Record<AgentColor, string> = {
  coral: '#f06449',
  blue: '#3f7ee8',
  violet: '#8b5cf6',
  green: '#2fa46f',
  amber: '#d99122',
  pink: '#db4f8a',
  cyan: '#1499ad',
  lime: '#73a62b',
}

function participantColor(participants: RecordingParticipant[], role: RecordingParticipant['role']) {
  if (role !== 'agent') return undefined
  const used = new Set(participants.map((participant) => participant.color).filter(Boolean))
  return AGENT_COLORS.find((color) => !used.has(color)) ?? AGENT_COLORS[participants.filter((participant) => participant.role === 'agent').length % AGENT_COLORS.length]
}

export function activeFocusParticipants(session: RecordingSession, now = Date.now()) {
  return session.participants.filter((participant) => participant.focus && new Date(participant.focus.leaseExpiresAt).getTime() > now)
}

export function loadRecording(boardId?: string): RecordingSession | null {
  try {
    const raw = window.localStorage.getItem(boardId ? `${RECORDING_KEY}:${boardId}` : RECORDING_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as RecordingSession
    if (parsed.specVersion !== '1.0' || !Array.isArray(parsed.events) || !Array.isArray(parsed.participants)) return null
    if (!parsed.moderatorId || !parsed.participants.some((participant) => participant.id === parsed.moderatorId)) return null
    return {
      ...parsed,
      boardId: parsed.boardId ?? boardId,
      moderatorId: parsed.moderatorId,
      participants: parsed.participants.map((participant, index) => ({
        ...participant,
        status: participant.status ?? 'active',
        color: participant.color ?? (participant.role === 'agent' ? AGENT_COLORS[index % AGENT_COLORS.length] : undefined),
      })),
    }
  } catch {
    return null
  }
}

export function saveRecording(session: RecordingSession | null, boardId?: string) {
  const key = boardId ? `${RECORDING_KEY}:${boardId}` : RECORDING_KEY
  if (!session) window.localStorage.removeItem(key)
  else window.localStorage.setItem(key, JSON.stringify(session))
}

export function createRecordingSession(title: string, actor?: RecordingParticipant, boardId?: string): RecordingSession {
  const cleanTitle = title.trim().slice(0, 120)
  if (!cleanTitle) throw new Error('录制标题不能为空。')
  if (!actor?.id.trim() || !actor.name.trim()) throw new Error('录制需要明确成员。')
  const startedAt = new Date().toISOString()
  const human = {
    ...actor,
    status: 'active' as const,
    joinedAt: actor?.joinedAt ?? startedAt,
    lastSeenAt: startedAt,
  }
  return {
    specVersion: '1.0',
    id: createUUID(),
    title: cleanTitle,
    status: 'recording',
    startedAt,
    boardId,
    moderatorId: human.id,
    participants: [human],
    events: [{
      id: createId('event'),
      createdAt: startedAt,
      participantId: human.id,
      participantName: human.name,
      participantRole: human.role,
      kind: 'result',
      content: 'Recording started.',
    }],
  }
}

export function appendEvent(session: RecordingSession, event: Omit<RecordingEvent, 'id' | 'createdAt'>): RecordingSession {
  if (session.status !== 'recording') throw new Error('The recording is already complete.')
  const participant: RecordingParticipant = {
    id: event.participantId,
    name: event.participantName.slice(0, 80),
    role: event.participantRole,
    status: 'active',
    joinedAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    color: participantColor(session.participants, event.participantRole),
  }
  const participants = session.participants.some((item) => item.id === participant.id)
    ? session.participants
    : [...session.participants, participant]
  return {
    ...session,
    participants,
    events: [...session.events, {
      ...event,
      id: createId('event'),
      createdAt: new Date().toISOString(),
      content: event.content.trim().slice(0, 5000),
      relatedElementIds: event.relatedElementIds?.slice(0, 50),
    }],
  }
}

export function joinRecording(session: RecordingSession, participant: RecordingParticipant): RecordingSession {
  if (session.status !== 'recording') throw new Error('The recording is already complete.')
  if (!participant.id.trim() || !participant.name.trim()) throw new Error('Participant ID and name are required.')
  const now = new Date().toISOString()
  if (session.participants.some((item) => item.id === participant.id)) {
    return {
      ...session,
      participants: session.participants.map((item) => item.id === participant.id ? {
        ...item,
        name: participant.name.trim().slice(0, 80),
        specialty: participant.specialty?.trim().slice(0, 120) ?? item.specialty,
        status: item.status === 'muted' ? 'muted' : 'active',
        lastSeenAt: now,
        color: item.color ?? participant.color ?? participantColor(session.participants, item.role),
      } : item),
    }
  }
  const clean = {
    ...participant,
    id: participant.id.trim().slice(0, 80),
    name: participant.name.trim().slice(0, 80),
    specialty: participant.specialty?.trim().slice(0, 120),
    status: participant.status ?? 'active' as const,
    joinedAt: participant.joinedAt ?? now,
    lastSeenAt: now,
    color: participant.color ?? participantColor(session.participants, participant.role),
  }
  return {
    ...session,
    participants: [...session.participants, clean],
    events: [...session.events, {
      id: createId('event'),
      createdAt: new Date().toISOString(),
      participantId: clean.id,
      participantName: clean.name,
      participantRole: clean.role,
      kind: 'result' as const,
      content: `${clean.name} joined the session${clean.specialty ? ` as ${clean.specialty}` : ''}.`,
    }],
  }
}

export function watchRecording(session: RecordingSession, participantId: string, elementIds: string[] = [], renewFocus = false): RecordingSession {
  const participant = session.participants.find((candidate) => candidate.id === participantId)
  if (!participant) throw new Error(`Agent ${participantId} has not joined this mural.`)
  const now = new Date()
  const focus = participant.focus && renewFocus && new Date(participant.focus.leaseExpiresAt).getTime() > now.getTime()
    ? {
        ...participant.focus,
        leaseExpiresAt: new Date(now.getTime() + Math.max(10_000, new Date(participant.focus.leaseExpiresAt).getTime() - new Date(participant.focus.claimedAt).getTime())).toISOString(),
      }
    : participant.focus
  return {
    ...session,
    participants: session.participants.map((candidate) => candidate.id === participantId ? {
      ...candidate,
      status: candidate.status === 'muted' ? 'muted' : 'active',
      lastSeenAt: now.toISOString(),
      leaseExpiresAt: new Date(now.getTime() + 30_000).toISOString(),
      watchingElementIds: [...new Set(elementIds)].slice(0, 50),
      focus,
    } : candidate),
  }
}

export function setRecordingFocus(session: RecordingSession, participantId: string, focus: AgentFocus | null): RecordingSession {
  if (session.status !== 'recording') throw new Error('The mural session is closed.')
  const participant = session.participants.find((candidate) => candidate.id === participantId)
  if (!participant) throw new Error(`Agent ${participantId} has not joined this mural.`)
  if (participant.status === 'muted') throw new Error(`${participant.name} is muted by the session moderator.`)
  if (focus) {
    const now = Date.now()
    const conflict = activeFocusParticipants(session, now).find((candidate) => candidate.id !== participantId
      && candidate.focus!.state === 'editing'
      && focus.state === 'editing'
      && candidate.focus!.elementIds.some((id) => focus.elementIds.includes(id)))
    if (conflict) throw new Error(`${conflict.name} is already editing one of those elements until ${conflict.focus!.leaseExpiresAt}.`)
  }
  return {
    ...session,
    participants: session.participants.map((candidate) => candidate.id === participantId
      ? { ...candidate, focus: focus ?? undefined, lastSeenAt: new Date().toISOString() }
      : candidate),
  }
}

export function addRecordingCheckpoint(session: RecordingSession, label: string, board: BoardSnapshot, actor?: RecordingParticipant): RecordingSession {
  const participant = actor && session.participants.find((candidate) => candidate.id === actor.id && candidate.role === actor.role)
  if (!participant) throw new Error('保存检查点需要明确成员。')
  const cleanLabel = label.trim().slice(0, 120) || `Checkpoint ${session.events.filter((event) => event.kind === 'checkpoint').length + 1}`
  return appendEvent(session, {
    participantId: participant.id,
    participantName: participant.name,
    participantRole: participant.role,
    kind: 'checkpoint',
    content: `Checkpoint saved: ${cleanLabel}`,
    checkpoint: { label: cleanLabel, board: structuredClone(board) },
  })
}

export function renameRecordingCheckpoint(session: RecordingSession, eventId: string, label: string): RecordingSession {
  const event = session.events.find((candidate) => candidate.id === eventId && candidate.kind === 'checkpoint' && candidate.checkpoint)
  if (!event) throw new Error(`Checkpoint ${eventId} was not found.`)
  const cleanLabel = label.trim().slice(0, 120)
  if (!cleanLabel) throw new Error('Checkpoint label is required.')
  return {
    ...session,
    events: session.events.map((candidate) => candidate.id === eventId
      ? { ...candidate, content: `Checkpoint saved: ${cleanLabel}`, checkpoint: { ...candidate.checkpoint!, label: cleanLabel } }
      : candidate),
  }
}

export function deleteRecordingCheckpoint(session: RecordingSession, eventId: string): RecordingSession {
  if (!session.events.some((candidate) => candidate.id === eventId && candidate.kind === 'checkpoint')) throw new Error(`Checkpoint ${eventId} was not found.`)
  return { ...session, events: session.events.filter((candidate) => candidate.id !== eventId) }
}

export function moderateRecording(session: RecordingSession, participantId: string, muted: boolean, moderatorId: string): RecordingSession {
  if (session.status !== 'recording') throw new Error('No active recording is available to moderate.')
  if (session.moderatorId !== moderatorId) throw new Error('Only the session moderator can change participant access.')
  if (participantId === moderatorId) throw new Error('The moderator cannot mute itself.')
  const participant = session.participants.find((candidate) => candidate.id === participantId)
  if (!participant) throw new Error(`Participant ${participantId} was not found.`)
  const moderator = session.participants.find((candidate) => candidate.id === moderatorId)
  if (!moderator) throw new Error('The moderator is not present in this session.')
  const withStatus = {
    ...session,
    participants: session.participants.map((candidate) => candidate.id === participantId
      ? { ...candidate, status: muted ? 'muted' as const : 'active' as const }
      : candidate),
  }
  return appendEvent(withStatus, {
    participantId: moderator.id,
    participantName: moderator.name,
    participantRole: moderator.role,
    kind: 'result',
    content: `${participant.name} was ${muted ? 'muted' : 'reactivated'} by the moderator.`,
  })
}

export function completeRecording(session: RecordingSession, finalOutput: string, actor?: RecordingParticipant): RecordingSession {
  const facilitator = actor && session.participants.find((participant) => participant.id === actor.id && participant.role === actor.role)
  if (!facilitator) throw new Error('结束录制需要明确成员。')
  const withResult = appendEvent(session, {
    participantId: facilitator.id,
    participantName: facilitator.name,
    participantRole: facilitator.role,
    kind: 'result',
    content: finalOutput.trim().slice(0, 10000) || 'Session completed.',
  })
  return {
    ...withResult,
    status: 'complete',
    completedAt: new Date().toISOString(),
    finalOutput: finalOutput.trim().slice(0, 10000),
    participants: withResult.participants.map((participant) => ({ ...participant, focus: undefined })),
  }
}

function escapeCell(value: string) {
  return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
}

export function recordingToMarkdown(session: RecordingSession, board: BoardSnapshot) {
  const lines = [
    `# ${session.title}`,
    '',
    `Status: ${session.status}`,
    `Started: ${session.startedAt}`,
    session.completedAt ? `Completed: ${session.completedAt}` : '',
    `Participants: ${session.participants.map((participant) => `${participant.name} (${participant.role})`).join(', ')}`,
    '',
    '## Deliberation timeline',
    '',
    '| Time | Participant | Type | Contribution |',
    '| --- | --- | --- | --- |',
    ...session.events.map((event) => `| ${escapeCell(event.createdAt)} | ${escapeCell(event.participantName)} | ${event.kind} | ${escapeCell(event.content)} |`),
    '',
    '## Final output',
    '',
    session.finalOutput || 'Recording is still active.',
    '',
    '## Final board',
    '',
    `Board: ${board.name}`,
    `Elements: ${board.nodes.length}`,
    `Connections: ${board.edges.length}`,
    '',
    '```json',
    JSON.stringify(board, null, 2),
    '```',
    '',
  ]
  return lines.filter((line, index) => line || lines[index - 1] !== '').join('\n')
}

function csvCell(value: unknown) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return `"${text.replace(/"/g, '""')}"`
}

export function recordingToCsv(session: RecordingSession) {
  return [
    ['sequence', 'timestamp', 'participant_id', 'participant_name', 'role', 'kind', 'content', 'reply_to', 'element_ids'].map(csvCell).join(','),
    ...session.events.map((event, index) => [
      index + 1,
      event.createdAt,
      event.participantId,
      event.participantName,
      event.participantRole,
      event.kind,
      event.content,
      event.replyTo ?? '',
      event.relatedElementIds?.join(' ') ?? '',
    ].map(csvCell).join(',')),
  ].join('\n')
}
