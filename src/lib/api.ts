import type { BoardSnapshot, RecordingSession } from '../types'

export async function getBackendHealth() {
  try {
    const response = await fetch('/api/health', { headers: { Accept: 'application/json' } })
    return response.ok
  } catch {
    return false
  }
}

export async function syncRecording(session: RecordingSession, finalBoard: BoardSnapshot) {
  const response = await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ session, finalBoard }),
  })
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { error?: string } | null
    throw new Error(detail?.error || `SQLite sync failed with ${response.status}.`)
  }
  return response.json() as Promise<{ ok: true; sessionId: string; eventCount: number }>
}
