import { afterEach, expect, it, vi } from 'vitest'
import type { BoardSnapshot, BrainstormSession } from '../types'
import * as api from './api'
const timestamp = '2026-10-10T10:00:00.000Z'
const board: BoardSnapshot = { id: 'board-a', name: '测试白板', nodes: [], edges: [], createdAt: timestamp, updatedAt: timestamp }
const session: BrainstormSession = { id: 'discussion-a', boardId: board.id, topic: '测试主题', goal: '测试目标', background: '', constraints: '', stage: 'collecting', aiPaused: false, currentMemberId: 'member-a', members: [{ id: 'member-a', name: '测试成员', role: 'facilitator', joinedAt: timestamp }], proposals: [], suggestions: [], decision: null, outcome: null, createdAt: timestamp, updatedAt: timestamp }
afterEach(() => vi.unstubAllGlobals())

it('客户端将讨论和白板一同提交并携带已有访问令牌', async () => {
  vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
    if (url !== '/api/brainstorm/discussion-a' || options.method !== 'PUT' || (options.headers as Record<string, string>).Authorization !== 'Bearer capability') return new Response('{}', { status: 403 })
    const body = JSON.parse(options.body as string)
    return new Response(JSON.stringify(body.session.aiPaused === false && body.board.id === 'board-a' ? { ok: true, sessionId: 'discussion-a', updatedAt: body.board.updatedAt } : {}), { status: 200 })
  })
  expect(await api.syncBrainstorm(session, board, 'capability')).toEqual({ ok: true, sessionId: 'discussion-a', updatedAt: board.updatedAt })
})
it('客户端读取时严格验证服务端 payload，保存失败不假装成功', async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ session: { ...session, stage: 'invalid' }, board }), { status: 200 }))
  await expect(api.loadBrainstormSession(session.id, 'capability')).rejects.toThrow()
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'SQLite 不可用' }), { status: 500 }))
  await expect(api.syncBrainstorm(session, board)).rejects.toThrow('SQLite 不可用')
})
it('保存回执必须对应同一个讨论和同一个写入版本', async () => {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ok: true, sessionId: session.id, updatedAt: '2026-10-10T09:00:00.000Z' })))
  await expect(api.syncBrainstorm(session, board)).rejects.toThrow()
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ ok: true, sessionId: 'other-session', updatedAt: board.updatedAt })))
  await expect(api.syncBrainstorm(session, board)).rejects.toThrow()
})
