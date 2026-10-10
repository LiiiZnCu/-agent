import type { AgentFocus, BoardSnapshot, BrainstormSession, HostedInvitation, HostedMuralAccess, MuralFocusClaim, RecordingParticipant, RecordingSession } from '../types'
import { validateBrainstormPayload } from './brainstorm-validation'

async function jsonResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as (T & { error?: string }) | null
  if (!response.ok) throw new Error(body?.error || `Request failed with ${response.status}.`)
  return body as T
}

export async function getBackendHealth() {
  try {
    const response = await fetch('/api/health', { headers: { Accept: 'application/json' } })
    return response.ok
  } catch {
    return false
  }
}

export async function syncRecording(session: RecordingSession, finalBoard: BoardSnapshot, accessToken = '') {
  const response = await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: JSON.stringify({ session, finalBoard }),
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(detail?.error || `SQLite sync failed with ${response.status}.`)
  }
  return response.json() as Promise<{ ok: true; sessionId: string; eventCount: number }>
}

export async function syncBrainstorm(session: BrainstormSession, board: BoardSnapshot, accessToken = '') {
  const payload = validateBrainstormPayload({ session, board })
  const saved = await jsonResponse<{ ok: true; sessionId: string; updatedAt: string }>(await fetch(`/api/brainstorm/${encodeURIComponent(session.id)}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    body: JSON.stringify(payload),
  }))
  if (saved?.ok !== true || saved.sessionId !== session.id || saved.updatedAt !== board.updatedAt) throw new Error('讨论保存回执与当前版本不匹配。')
  return saved
}

export async function loadBrainstormSession(id: string, accessToken = '') {
  const payload = await jsonResponse<unknown>(await fetch(`/api/brainstorm/${encodeURIComponent(id)}`, {
    headers: { Accept: 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
  }))
  return validateBrainstormPayload(payload, id)
}

export async function requestBrainstormSuggestions(id: string, purpose: string, ideaIds: string[], accessToken = ''): Promise<unknown> {
  return jsonResponse<unknown>(await fetch(`/api/brainstorm/${encodeURIComponent(id)}/suggestions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    body: JSON.stringify({ purpose, ...(ideaIds.length ? { ideaIds } : {}) }),
  }))
}

export async function createHostedMural(name: string, board?: BoardSnapshot) {
  return jsonResponse<HostedMuralAccess>(await fetch('/api/murals', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ name, board }),
  }))
}

export async function createUserShare(muralId: string, ownerToken: string) {
  return jsonResponse<{ userToken: string; userUrl: string }>(await fetch(`/api/murals/${encodeURIComponent(muralId)}/share`, {
    method: 'POST',
    headers: { Accept: 'application/json', Authorization: `Bearer ${ownerToken}` },
  }))
}

export async function loadHostedMural(id: string, accessToken: string) {
  const hosted = await jsonResponse<{ board: BoardSnapshot; revision: number; role: 'owner' | 'user' | 'agent'; session: RecordingSession | null; brainstorm: BrainstormSession | null; focusClaims: MuralFocusClaim[] }>(await fetch(`/api/murals/${encodeURIComponent(id)}`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
  }))
  if (hosted.brainstorm) validateBrainstormPayload({ board: hosted.board, session: hosted.brainstorm })
  return hosted
}

export async function setHostedFocus(muralId: string, accessToken: string, participant: Pick<RecordingParticipant, 'id' | 'name' | 'color'>, focus: AgentFocus | null) {
  return jsonResponse<{ focusClaims: MuralFocusClaim[] }>(await fetch(`/api/murals/${encodeURIComponent(muralId)}/focus`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ participant, focus }),
  }))
}

export async function assertHostedWritable(muralId: string, accessToken: string, participantId: string, elementIds: string[]) {
  await jsonResponse<{ writable: true }>(await fetch(`/api/murals/${encodeURIComponent(muralId)}/focus/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ participantId, elementIds }),
  }))
}

export async function saveHostedMural(board: BoardSnapshot, accessToken: string) {
  return jsonResponse<{ ok: true; board: BoardSnapshot; revision: number }>(await fetch(`/api/murals/${encodeURIComponent(board.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ board }),
  }))
}

export async function createAgentInvites(muralId: string, ownerToken: string, guests: Array<{ agentId: string; agentName: string; specialty?: string }>) {
  const result = await jsonResponse<{ muralId: string; invitations: HostedInvitation[] }>(await fetch(`/api/murals/${encodeURIComponent(muralId)}/invites`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ guests }),
  }))
  return result.invitations
}

export async function redeemAgentInvite(muralId: string, inviteToken: string) {
  const result = await jsonResponse<{ participant: Omit<HostedInvitation, 'inviteToken' | 'agentUrl'> & { muralId: string; redeemedAt: string } }>(await fetch(`/api/murals/${encodeURIComponent(muralId)}/invites/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ inviteToken }),
  }))
  return result.participant
}
