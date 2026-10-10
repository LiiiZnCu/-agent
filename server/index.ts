import express from 'express'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { BoardSnapshot, RecordingSession } from '../src/types.ts'
import { databasePath } from './db.ts'
import { toCsv, toMarkdown } from './export.ts'
import { deleteSession, getSession, getSessionByBoardId, saveSession } from './store.ts'
import { getBrainstorm, getBrainstormByBoardId, saveBrainstorm } from './brainstorm-store.ts'
import { validateBrainstormPayload, type StoredBrainstorm } from '../src/lib/brainstorm-validation.ts'
import { assertHostedWritable, authorizeHostedMural, createHostedInvites, createHostedMural, getHostedMural, redeemHostedInvite, rotateHostedUserShare, saveHostedMural, setHostedFocus, type HostedGuest } from './hosted.ts'

export const app = express()
const port = Number(process.env.CANVAS_RELAY_PORT || 5174)
const distPath = join(process.cwd(), 'dist')

app.disable('x-powered-by')
app.use(express.json({ limit: '3mb' }))

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, storage: 'drizzle-sqlite', databasePath })
})

app.get('/api/brainstorm/:id', (request, response) => {
  const stored = getBrainstorm(request.params.id)
  if (!stored) return response.status(404).json({ error: '讨论不存在。' })
  try {
    authorizeHostedMural(stored.board.id, bearer(request))
  } catch {
    return response.status(403).json({ error: '没有访问此讨论的权限。' })
  }
  return response.json(stored)
})

app.put('/api/brainstorm/:id', (request, response) => {
  let payload: StoredBrainstorm
  try {
    payload = validateBrainstormPayload(request.body, request.params.id)
  } catch (error) {
    return response.status(400).json({ error: error instanceof Error ? error.message : '讨论数据无效。' })
  }
  const existing = getBrainstorm(request.params.id)
  if (existing && existing.board.id !== payload.board.id) return response.status(409).json({ error: '讨论不能迁移到另一个白板。' })
  try {
    authorizeHostedMural(payload.board.id, bearer(request))
  } catch {
    return response.status(403).json({ error: '没有保存此讨论的权限。' })
  }
  saveBrainstorm(payload)
  return response.json({ ok: true, sessionId: payload.session.id })
})

function bearer(request: express.Request) {
  const header = request.header('authorization') ?? ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

function canAccessSession(request: express.Request, session: RecordingSession) {
  if (!session.boardId) return true
  return authorizeHostedMural(session.boardId, bearer(request)) !== null
}

function publicBase(request: express.Request) {
  const configured = process.env.CANVAS_RELAY_PUBLIC_URL?.replace(/\/$/, '')
  if (configured) return configured
  const scheme = request.header('x-forwarded-proto')?.split(',')[0] || request.protocol
  return `${scheme}://${request.get('host')}`
}

app.post('/api/murals', (request, response) => {
  try {
    response.status(201).json(createHostedMural(String(request.body?.name ?? ''), publicBase(request), request.body?.board as BoardSnapshot | undefined))
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : 'Could not create mural.' })
  }
})

app.post('/api/murals/:id/share', (request, response) => {
  try {
    const share = rotateHostedUserShare(request.params.id, bearer(request), publicBase(request))
    if (!share) return response.status(404).json({ error: 'Mural not found.' })
    return response.status(201).json(share)
  } catch (error) {
    return response.status(403).json({ error: error instanceof Error ? error.message : 'Could not create collaborator link.' })
  }
})

app.post('/api/murals/:id/focus', (request, response) => {
  try {
    const participant = request.body?.participant
    const focus = request.body?.focus ?? null
    if (!participant || typeof participant.id !== 'string' || typeof participant.name !== 'string') return response.status(400).json({ error: 'A participant is required.' })
    const claims = setHostedFocus(request.params.id, bearer(request), participant, focus)
    if (!claims) return response.status(404).json({ error: 'Mural not found.' })
    return response.json({ focusClaims: claims })
  } catch (error) {
    return response.status(409).json({ error: error instanceof Error ? error.message : 'Could not update focus.' })
  }
})

app.post('/api/murals/:id/focus/check', (request, response) => {
  try {
    const participantId = String(request.body?.participantId ?? '')
    const elementIds = Array.isArray(request.body?.elementIds) ? request.body.elementIds.filter((value: unknown): value is string => typeof value === 'string') : []
    if (!participantId) return response.status(400).json({ error: 'participantId is required.' })
    const writable = assertHostedWritable(request.params.id, bearer(request), participantId, elementIds)
    if (!writable) return response.status(404).json({ error: 'Mural not found.' })
    return response.json({ writable: true })
  } catch (error) {
    return response.status(409).json({ error: error instanceof Error ? error.message : 'The focused elements are busy.' })
  }
})

app.get('/api/murals/:id', (request, response) => {
  try {
    const hosted = getHostedMural(request.params.id, bearer(request))
    if (!hosted) return response.status(404).json({ error: 'Mural not found.' })
    return response.json({ ...hosted, session: getSessionByBoardId(request.params.id)?.session ?? null, brainstorm: getBrainstormByBoardId(request.params.id)?.session ?? null })
  } catch (error) {
    return response.status(403).json({ error: error instanceof Error ? error.message : 'Mural access denied.' })
  }
})

app.put('/api/murals/:id', (request, response) => {
  try {
    const saved = saveHostedMural(request.params.id, bearer(request), request.body?.board as BoardSnapshot)
    if (!saved) return response.status(404).json({ error: 'Mural not found.' })
    return response.json({ ok: true, ...saved })
  } catch (error) {
    return response.status(403).json({ error: error instanceof Error ? error.message : 'Mural access denied.' })
  }
})

app.post('/api/murals/:id/invites', (request, response) => {
  try {
    const invitations = createHostedInvites(request.params.id, bearer(request), request.body?.guests as HostedGuest[], publicBase(request))
    if (!invitations) return response.status(404).json({ error: 'Mural not found.' })
    return response.status(201).json({ muralId: request.params.id, invitations })
  } catch (error) {
    return response.status(403).json({ error: error instanceof Error ? error.message : 'Could not create invitations.' })
  }
})

app.post('/api/murals/:id/invites/redeem', (request, response) => {
  try {
    return response.json({ participant: redeemHostedInvite(request.params.id, String(request.body?.inviteToken ?? '')) })
  } catch (error) {
    return response.status(403).json({ error: error instanceof Error ? error.message : 'Could not redeem invitation.' })
  }
})

app.get('/api/sessions/:id', (request, response) => {
  const stored = getSession(request.params.id)
  if (!stored) return response.status(404).json({ error: 'Session not found.' })
  try {
    if (!canAccessSession(request, stored.session)) return response.status(403).json({ error: 'Session access denied.' })
  } catch {
    return response.status(403).json({ error: 'Session access denied.' })
  }
  return response.json(stored)
})

app.put('/api/sessions/:id', (request, response) => {
  const session = request.body?.session as RecordingSession | undefined
  const finalBoard = request.body?.finalBoard as BoardSnapshot | undefined
  if (!session || session.id !== request.params.id || session.specVersion !== '1.0') {
    return response.status(400).json({ error: 'A valid RecordingSession 1.0 is required.' })
  }
  if (!finalBoard || !Array.isArray(finalBoard.nodes) || !Array.isArray(finalBoard.edges)) {
    return response.status(400).json({ error: 'A valid board snapshot is required.' })
  }
  try {
    const existing = getSession(request.params.id)
    if (existing && existing.session.boardId !== session.boardId) return response.status(409).json({ error: 'A session cannot move between murals.' })
    if (!canAccessSession(request, existing?.session ?? session)) return response.status(403).json({ error: 'Session access denied.' })
  } catch {
    return response.status(403).json({ error: 'Session access denied.' })
  }
  saveSession({ session, finalBoard })
  return response.json({ ok: true, sessionId: session.id, eventCount: session.events.length })
})

app.delete('/api/sessions/:id', (request, response) => {
  const stored = getSession(request.params.id)
  if (!stored) return response.status(404).json({ error: 'Session not found.' })
  try {
    if (!canAccessSession(request, stored.session)) return response.status(403).json({ error: 'Session access denied.' })
  } catch {
    return response.status(403).json({ error: 'Session access denied.' })
  }
  deleteSession(request.params.id)
  return response.status(204).end()
})

app.get('/api/sessions/:id/export', (request, response) => {
  const stored = getSession(request.params.id)
  if (!stored) return response.status(404).json({ error: 'Session not found.' })
  try {
    if (!canAccessSession(request, stored.session)) return response.status(403).json({ error: 'Session access denied.' })
  } catch {
    return response.status(403).json({ error: 'Session access denied.' })
  }
  const safeName = stored.session.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'decision-trace'
  const format = request.query.format
  if (format === 'markdown') {
    response.type('text/markdown').attachment(`${safeName}.md`)
    return response.send(toMarkdown(stored))
  }
  if (format === 'csv') {
    response.type('text/csv').attachment(`${safeName}.csv`)
    return response.send(toCsv(stored))
  }
  response.type('application/json').attachment(`${safeName}.json`)
  return response.send(JSON.stringify({ schemaVersion: '1.0', ...stored }, null, 2))
})

app.use('/api', (_request, response) => {
  response.status(404).json({ error: 'API endpoint not found.' })
})

if (existsSync(distPath)) {
  app.use(express.static(distPath))
  app.get(/.*/, (_request, response) => response.sendFile(join(distPath, 'index.html')))
}

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : 'Unexpected server error.'
  response.status(500).json({ error: message })
})

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen(port, () => {
    process.stdout.write(`Canvas Relay API listening on http://localhost:${port}\n`)
  })
}
