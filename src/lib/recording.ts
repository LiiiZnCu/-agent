import type { BoardSnapshot, RecordingEvent, RecordingParticipant, RecordingSession } from '../types'
import { createId } from './board'

const RECORDING_KEY = 'canvas-relay-recording-v1'

export function loadRecording(): RecordingSession | null {
  try {
    const raw = window.localStorage.getItem(RECORDING_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as RecordingSession
    if (parsed.specVersion !== '1.0' || !Array.isArray(parsed.events) || !Array.isArray(parsed.participants)) return null
    return parsed
  } catch {
    return null
  }
}

export function saveRecording(session: RecordingSession | null) {
  if (!session) window.localStorage.removeItem(RECORDING_KEY)
  else window.localStorage.setItem(RECORDING_KEY, JSON.stringify(session))
}

export function createRecordingSession(title = 'Multi-agent brainstorm', actor?: RecordingParticipant): RecordingSession {
  const human = actor ?? { id: 'human-facilitator', name: 'Facilitator', role: 'human' as const }
  const startedAt = new Date().toISOString()
  return {
    specVersion: '1.0',
    id: createId('session'),
    title: title.trim().slice(0, 120) || 'Multi-agent brainstorm',
    status: 'recording',
    startedAt,
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
    }].slice(-1000),
  }
}

export function joinRecording(session: RecordingSession, participant: RecordingParticipant): RecordingSession {
  if (session.status !== 'recording') throw new Error('The recording is already complete.')
  if (!participant.id.trim() || !participant.name.trim()) throw new Error('Participant ID and name are required.')
  if (session.participants.some((item) => item.id === participant.id)) return session
  const clean = {
    ...participant,
    id: participant.id.trim().slice(0, 80),
    name: participant.name.trim().slice(0, 80),
    specialty: participant.specialty?.trim().slice(0, 120),
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

export function completeRecording(session: RecordingSession, finalOutput: string, actor?: RecordingParticipant): RecordingSession {
  const facilitator = actor ?? { id: 'human-facilitator', name: 'Facilitator', role: 'human' as const }
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
