import express from 'express'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { BoardSnapshot, RecordingSession } from '../src/types.ts'
import { databasePath } from './db.ts'
import { toCsv, toMarkdown } from './export.ts'
import { deleteSession, getSession, listSessions, saveSession } from './store.ts'

const app = express()
const port = Number(process.env.CANVAS_RELAY_PORT || 5174)
const distPath = join(process.cwd(), 'dist')

app.disable('x-powered-by')
app.use(express.json({ limit: '3mb' }))

app.get('/api/health', (_request, response) => {
  response.json({ ok: true, storage: 'drizzle-sqlite', databasePath })
})

app.get('/api/sessions', (_request, response) => {
  response.json({ sessions: listSessions() })
})

app.get('/api/sessions/:id', (request, response) => {
  const stored = getSession(request.params.id)
  if (!stored) return response.status(404).json({ error: 'Session not found.' })
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
  saveSession({ session, finalBoard })
  return response.json({ ok: true, sessionId: session.id, eventCount: session.events.length })
})

app.delete('/api/sessions/:id', (request, response) => {
  if (!deleteSession(request.params.id)) return response.status(404).json({ error: 'Session not found.' })
  return response.status(204).end()
})

app.get('/api/sessions/:id/export', (request, response) => {
  const stored = getSession(request.params.id)
  if (!stored) return response.status(404).json({ error: 'Session not found.' })
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

if (existsSync(distPath)) {
  app.use(express.static(distPath))
  app.get(/.*/, (_request, response) => response.sendFile(join(distPath, 'index.html')))
}

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : 'Unexpected server error.'
  response.status(500).json({ error: message })
})

app.listen(port, () => {
  process.stdout.write(`Canvas Relay API listening on http://localhost:${port}\n`)
})
