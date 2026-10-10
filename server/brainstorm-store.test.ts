import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Server } from 'node:http'
import type { BoardSnapshot, BrainstormSession } from '../src/types'

const timestamp = '2026-10-10T10:00:00.000Z'
const board: BoardSnapshot = { id: 'local-board', name: '测试白板', nodes: [], edges: [], createdAt: timestamp, updatedAt: timestamp }
const session: BrainstormSession = { id: 'local-discussion', boardId: board.id, topic: '测试主题', goal: '测试目标', background: '', constraints: '', stage: 'collecting', aiPaused: true, currentMemberId: 'member-a', members: [{ id: 'member-a', name: '测试成员', role: 'facilitator', joinedAt: timestamp }], proposals: [], suggestions: [], decision: null, outcome: null, createdAt: timestamp, updatedAt: timestamp }
let store: typeof import('./brainstorm-store')
let db: typeof import('./db')['db']
let hosted: typeof import('./hosted')
let server: Server
let base: string

beforeAll(async () => {
  vi.stubEnv('CANVAS_RELAY_DB_PATH', ':memory:')
  store = await import('./brainstorm-store')
  db = (await import('./db')).db
  hosted = await import('./hosted')
  const { app } = await import('./index')
  server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
  const address = server.address() as { port: number }
  base = `http://127.0.0.1:${address.port}`
})
afterAll(async () => {
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  vi.unstubAllEnvs()
})

async function request(id: string, body?: unknown, token = '') {
  return fetch(`${base}/api/brainstorm/${id}`, { method: body === undefined ? 'GET' : 'PUT', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
}

describe('独立 SQLite 讨论存储', () => {
  it('可创建、更新、读取完整讨论且不写入原有记录表', async () => {
    const schema = await import('./schema')
    store.saveBrainstorm({ session, board })
    expect(store.getBrainstorm(session.id)).toEqual({ session, board })
    store.saveBrainstorm({ session: { ...session, topic: '修改后的主题', aiPaused: false }, board })
    expect(store.getBrainstorm(session.id)?.session.topic).toBe('修改后的主题')
    expect(store.getBrainstorm(session.id)?.session.aiPaused).toBe(false)
    expect(db.select().from(schema.sessions).all()).toHaveLength(0)
    expect(db.select().from(schema.murals).all()).toHaveLength(0)
    expect(store.getBrainstorm('missing')).toBeNull()
  })
  it('API 拒绝缺失字段、非法阶段、ID 不符与跨白板覆盖', async () => {
    expect((await request('local-discussion', { session: { id: session.id }, board })).status).toBe(400)
    expect((await request('other-id', { session, board })).status).toBe(400)
    expect((await request(session.id, { session: { ...session, stage: 'bad-stage' }, board })).status).toBe(400)
    const otherBoard = { ...board, id: 'another-board' }
    expect((await request(session.id, { session: { ...session, boardId: otherBoard.id }, board: otherBoard })).status).toBe(409)
  })
  it('本地讨论无需托管令牌，可通过 API 保存并读取', async () => {
    const payload = { session: { ...session, id: 'api-local' }, board }
    expect((await request(payload.session.id, payload)).status).toBe(200)
    expect(await (await request(payload.session.id)).json()).toEqual(payload)
  })
  it('托管讨论读写复用白板能力，不能伪装本地绕过授权', async () => {
    const mural = hosted.createHostedMural('测试托管白板', 'http://localhost')
    const payload = { session: { ...session, id: 'hosted-discussion', boardId: mural.board.id }, board: mural.board }
    expect((await request(payload.session.id, payload)).status).toBe(403)
    expect((await request(payload.session.id, payload, mural.ownerToken)).status).toBe(200)
    expect((await request(payload.session.id)).status).toBe(403)
    expect((await request(payload.session.id, undefined, 'wrong-token')).status).toBe(403)
    expect((await request(payload.session.id, undefined, mural.userToken)).status).toBe(200)
    expect((await request(payload.session.id, { ...payload, session: { ...payload.session, topic: '修改' } }, mural.userToken)).status).toBe(200)
    const opened = await fetch(`${base}/api/murals/${mural.board.id}`, { headers: { Authorization: `Bearer ${mural.userToken}` } })
    expect((await opened.json() as { brainstorm: BrainstormSession }).brainstorm.topic).toBe('修改')
  })
  it('SQLite 写入失败时 API 明确失败，不返回保存成功', async () => {
    const schema = await import('./schema')
    db.run('PRAGMA query_only = ON')
    try {
      expect((await request('failed-save', { session: { ...session, id: 'failed-save' }, board })).status).toBe(500)
      expect(db.select().from(schema.brainstormSessions).where((await import('drizzle-orm')).eq(schema.brainstormSessions.id, 'failed-save')).get()).toBeUndefined()
    } finally { db.run('PRAGMA query_only = OFF') }
  })
})
