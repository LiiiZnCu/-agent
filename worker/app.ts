import type { Env } from './env'
import type { BoardSnapshot, RecordingParticipant, RecordingSession } from '../src/types'
import { createDatabase } from './db'
import { createHostedStore, type HostedGuest } from './hosted-store'
import { createRecordingStore } from './recording-store'
import { BrainstormWriteConflictError, createBrainstormStore } from './brainstorm-store'
import { validateBrainstormPayload, type StoredBrainstorm } from '../src/lib/brainstorm-validation'
import { isSnapshot } from '../src/lib/board-validation'
import { AgentValidationError, validateSuggestionRequest } from './agent-actions'
import { DeepSeekError, requestDeepSeekSuggestions } from './deepseek'
import { toCsv, toMarkdown } from './export'

function bearer(request: Request): string {
  const header = request.headers.get('authorization') ?? ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  const body: unknown = await request.json()
  return body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
}

function errorResponse(error: unknown, fallback: string, status: number): Response {
  return Response.json({ error: error instanceof Error ? error.message : fallback }, { status })
}

export async function handleRequest(request: Request, env: Env): Promise<Response> {
  try {
    return await routeRequest(request, env)
  } catch (error) {
    if (new URL(request.url).pathname.startsWith('/api/')) return errorResponse(error, 'Unexpected server error.', 500)
    throw error
  }
}

async function routeRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname

  if (path === '/api/health' && request.method === 'GET') {
    return Response.json({ ok: true, storage: 'd1' })
  }

  if (!path.startsWith('/api/')) return env.ASSETS.fetch(request)

  const db = createDatabase(env.DB)
  const hosted = createHostedStore(db)
  const recordings = createRecordingStore(db)
  const brainstorms = createBrainstormStore(db)
  const segments = path.split('/').filter(Boolean)

  if (segments[1] === 'brainstorm' && segments[2]) {
    const discussionId = segments[2]
    if (segments.length === 3 && request.method === 'GET') {
      const stored = await brainstorms.get(discussionId)
      if (!stored) return Response.json({ error: '讨论不存在。' }, { status: 404 })
      try { await hosted.authorize(stored.board.id, bearer(request)) }
      catch { return Response.json({ error: '没有访问此讨论的权限。' }, { status: 403 }) }
      return Response.json(stored)
    }
    if (segments.length === 3 && request.method === 'PUT') {
      let payload: StoredBrainstorm
      try { payload = validateBrainstormPayload(await request.json(), discussionId) }
      catch (error) { return errorResponse(error, '讨论数据无效。', 400) }
      const existing = await brainstorms.get(discussionId)
      if (existing && existing.board.id !== payload.board.id) return Response.json({ error: '讨论不能迁移到另一个白板。' }, { status: 409 })
      try { await hosted.authorize(payload.board.id, bearer(request)) }
      catch { return Response.json({ error: '没有保存此讨论的权限。' }, { status: 403 }) }
      try {
        await brainstorms.save(payload)
        return Response.json({ ok: true, sessionId: payload.session.id, updatedAt: payload.board.updatedAt })
      } catch (error) {
        if (error instanceof BrainstormWriteConflictError) return Response.json({ error: error.message }, { status: 409 })
        throw error
      }
    }
    if (segments.length === 4 && segments[3] === 'suggestions' && request.method === 'POST') {
      const stored = await brainstorms.get(discussionId)
      if (!stored) return Response.json({ error: '讨论不存在。' }, { status: 404 })
      try { await hosted.authorize(stored.board.id, bearer(request)) }
      catch { return Response.json({ error: '没有访问此讨论的权限。' }, { status: 403 }) }
      let context: StoredBrainstorm = stored
      const mural = await hosted.getMural(stored.board.id, bearer(request))
      if (mural) {
        if (!isSnapshot(mural.board) || mural.board.id !== stored.session.boardId) return errorResponse(new AgentValidationError('当前讨论的白板数据无效。'), '', 422)
        context = { session: stored.session, board: mural.board }
      }
      let intent
      try { intent = validateSuggestionRequest(await request.json(), context.board, stored.session) }
      catch (error) { return errorResponse(error, '建议请求无效。', 400) }
      try {
        const suggestion = await requestDeepSeekSuggestions(context, intent, env)
        try { await hosted.authorize(stored.board.id, bearer(request)) }
        catch { return Response.json({ error: '没有访问此讨论的权限。' }, { status: 403 }) }
        const current = await brainstorms.get(discussionId)
        if (!current) return Response.json({ error: '讨论已变化，请重新请求建议。' }, { status: 409 })
        const currentMural = await hosted.getMural(current.board.id, bearer(request))
        const currentContext = currentMural ? { session: current.session, board: currentMural.board } : current
        if (JSON.stringify(currentContext) !== JSON.stringify(context)) return Response.json({ error: '讨论已变化，请重新请求建议。' }, { status: 409 })
        return Response.json(suggestion)
      } catch (error) {
        if (error instanceof DeepSeekError) return errorResponse(error, error.message, error.status)
        if (error instanceof AgentValidationError) return errorResponse(error, error.message, 422)
        throw error
      }
    }
  }

  if (segments[1] === 'murals' && segments.length === 2 && request.method === 'POST') {
    try {
      const body = await jsonBody(request)
      return Response.json(await hosted.createMural(String(body.name ?? ''), url.origin, body.board as BoardSnapshot | undefined), { status: 201 })
    } catch (error) {
      return errorResponse(error, 'Could not create mural.', 400)
    }
  }

  if (segments[1] === 'murals' && segments[2]) {
    const muralId = segments[2]
    if (segments.length === 3 && request.method === 'GET') {
      try {
        const mural = await hosted.getMural(muralId, bearer(request))
        if (!mural) return Response.json({ error: 'Mural not found.' }, { status: 404 })
        const session = await recordings.getByBoardId(muralId)
        return Response.json({ ...mural, session: session?.session ?? null, brainstorm: null })
      } catch (error) {
        return errorResponse(error, 'Mural access denied.', 403)
      }
    }
    if (segments.length === 3 && request.method === 'PUT') {
      try {
        const body = await jsonBody(request)
        const saved = await hosted.saveMural(muralId, bearer(request), body.board as BoardSnapshot)
        return saved ? Response.json({ ok: true, ...saved }) : Response.json({ error: 'Mural not found.' }, { status: 404 })
      } catch (error) {
        return errorResponse(error, 'Mural access denied.', 403)
      }
    }
    if (segments.length === 4 && segments[3] === 'share' && request.method === 'POST') {
      try {
        const share = await hosted.rotateUserShare(muralId, bearer(request), url.origin)
        return share ? Response.json(share, { status: 201 }) : Response.json({ error: 'Mural not found.' }, { status: 404 })
      } catch (error) {
        return errorResponse(error, 'Could not create collaborator link.', 403)
      }
    }
    if (segments.length === 4 && segments[3] === 'focus' && request.method === 'POST') {
      try {
        const body = await jsonBody(request)
        const participant = body.participant
        if (!participant || typeof participant !== 'object' || Array.isArray(participant) || typeof (participant as Record<string, unknown>).id !== 'string' || typeof (participant as Record<string, unknown>).name !== 'string') return Response.json({ error: 'A participant is required.' }, { status: 400 })
        const claims = await hosted.setFocus(muralId, bearer(request), participant as Pick<RecordingParticipant, 'id' | 'name' | 'color'>, (body.focus ?? null) as Parameters<typeof hosted.setFocus>[3])
        return claims ? Response.json({ focusClaims: claims }) : Response.json({ error: 'Mural not found.' }, { status: 404 })
      } catch (error) {
        return errorResponse(error, 'Could not update focus.', 409)
      }
    }
    if (segments.length === 5 && segments[3] === 'focus' && segments[4] === 'check' && request.method === 'POST') {
      try {
        const body = await jsonBody(request)
        const participantId = String(body.participantId ?? '')
        const elementIds = Array.isArray(body.elementIds) ? body.elementIds.filter((value): value is string => typeof value === 'string') : []
        if (!participantId) return Response.json({ error: 'participantId is required.' }, { status: 400 })
        const writable = await hosted.assertWritable(muralId, bearer(request), participantId, elementIds)
        return writable ? Response.json({ writable: true }) : Response.json({ error: 'Mural not found.' }, { status: 404 })
      } catch (error) {
        return errorResponse(error, 'The focused elements are busy.', 409)
      }
    }
    if (segments.length === 4 && segments[3] === 'invites' && request.method === 'POST') {
      try {
        const body = await jsonBody(request)
        const invitations = await hosted.createInvites(muralId, bearer(request), body.guests as HostedGuest[], url.origin)
        return invitations ? Response.json({ muralId, invitations }, { status: 201 }) : Response.json({ error: 'Mural not found.' }, { status: 404 })
      } catch (error) {
        return errorResponse(error, 'Could not create invitations.', 403)
      }
    }
    if (segments.length === 5 && segments[3] === 'invites' && segments[4] === 'redeem' && request.method === 'POST') {
      try {
        const body = await jsonBody(request)
        return Response.json({ participant: await hosted.redeemInvite(muralId, String(body.inviteToken ?? '')) })
      } catch (error) {
        return errorResponse(error, 'Could not redeem invitation.', 403)
      }
    }
  }

  if (segments[1] === 'sessions' && segments[2]) {
    const sessionId = segments[2]
    if (segments.length === 3 && request.method === 'GET') {
      const stored = await recordings.get(sessionId)
      if (!stored) return Response.json({ error: 'Session not found.' }, { status: 404 })
      try {
        if (stored.session.boardId && !(await hosted.authorize(stored.session.boardId, bearer(request)))) return Response.json({ error: 'Session access denied.' }, { status: 403 })
      } catch {
        return Response.json({ error: 'Session access denied.' }, { status: 403 })
      }
      return Response.json(stored)
    }
    if (segments.length === 3 && request.method === 'PUT') {
      try {
        const body = await jsonBody(request)
        const session = body.session as RecordingSession | undefined
        const finalBoard = body.finalBoard as BoardSnapshot | undefined
        if (!session || session.id !== sessionId || session.specVersion !== '1.0') return Response.json({ error: 'A valid RecordingSession 1.0 is required.' }, { status: 400 })
        if (!finalBoard || !Array.isArray(finalBoard.nodes) || !Array.isArray(finalBoard.edges)) return Response.json({ error: 'A valid board snapshot is required.' }, { status: 400 })
        const existing = await recordings.get(sessionId)
        if (existing && existing.session.boardId !== session.boardId) return Response.json({ error: 'A session cannot move between murals.' }, { status: 409 })
        const access = existing?.session ?? session
        if (access.boardId && !(await hosted.authorize(access.boardId, bearer(request)))) return Response.json({ error: 'Session access denied.' }, { status: 403 })
        await recordings.save({ session, finalBoard })
        return Response.json({ ok: true, sessionId: session.id, eventCount: session.events.length })
      } catch (error) {
        return errorResponse(error, 'Session access denied.', 403)
      }
    }
    if (segments.length === 3 && request.method === 'DELETE') {
      const stored = await recordings.get(sessionId)
      if (!stored) return Response.json({ error: 'Session not found.' }, { status: 404 })
      try {
        if (stored.session.boardId && !(await hosted.authorize(stored.session.boardId, bearer(request)))) return Response.json({ error: 'Session access denied.' }, { status: 403 })
      } catch {
        return Response.json({ error: 'Session access denied.' }, { status: 403 })
      }
      await recordings.delete(sessionId)
      return new Response(null, { status: 204 })
    }
    if (segments.length === 4 && segments[3] === 'export' && request.method === 'GET') {
      const stored = await recordings.get(sessionId)
      if (!stored) return Response.json({ error: 'Session not found.' }, { status: 404 })
      try {
        if (stored.session.boardId && !(await hosted.authorize(stored.session.boardId, bearer(request)))) return Response.json({ error: 'Session access denied.' }, { status: 403 })
      } catch {
        return Response.json({ error: 'Session access denied.' }, { status: 403 })
      }
      const safeName = stored.session.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'decision-trace'
      const format = url.searchParams.get('format')
      if (format === 'markdown') return new Response(toMarkdown(stored), { headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': `attachment; filename="${safeName}.md"` } })
      if (format === 'csv') return new Response(toCsv(stored), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${safeName}.csv"` } })
      return new Response(JSON.stringify({ schemaVersion: '1.0', ...stored }, null, 2), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${safeName}.json"` } })
    }
  }

  if (path.startsWith('/api/')) {
    return Response.json({ error: 'API endpoint not found.' }, { status: 404 })
  }

  return env.ASSETS.fetch(request)
}
