import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Server } from 'node:http'
import type { BoardSnapshot, BrainstormSession } from '../src/types'

const timestamp = '2026-10-10T10:00:00.000Z'
const session: BrainstormSession = {
  id: 'suggestions-local', boardId: 'local-board', topic: '社区活动', goal: '形成方案', background: '', constraints: '',
  stage: 'organizing', aiPaused: false, currentMemberId: 'member-a',
  members: [{ id: 'member-a', name: '小林', role: 'facilitator', joinedAt: timestamp }],
  proposals: [], suggestions: [], decision: null, outcome: null, createdAt: timestamp, updatedAt: timestamp,
}
const board: BoardSnapshot = {
  id: session.boardId, brainstormSessionId: session.id, name: '社区活动', edges: [], createdAt: timestamp, updatedAt: timestamp,
  nodes: [{ id: 'idea-a', type: 'boardElement', position: { x: 0, y: 0 },
    data: { title: '读书会', body: '成员提供的内容', kind: 'idea', color: 'paper', votes: 0,
      ideaMeta: { sessionId: session.id, authorId: 'member-a', type: 'idea', createdAt: timestamp, sourceIdeaIds: [], versions: [] } } }],
}
const suggestion = { message: '可以按活动类型归类。', actions: [{ type: 'create_cluster', label: '阅读', ideaIds: ['idea-a'] }] }
const httpFetch = globalThis.fetch
let store: typeof import('./brainstorm-store')
let hosted: typeof import('./hosted')
let db: typeof import('./db')['db']
let schema: typeof import('./schema')
let server: Server
let base: string

beforeAll(async () => {
  vi.stubEnv('CANVAS_RELAY_DB_PATH', ':memory:')
  store = await import('./brainstorm-store')
  hosted = await import('./hosted')
  db = (await import('./db')).db
  schema = await import('./schema')
  store.saveBrainstorm({ board, session })
  const { app } = await import('./index')
  server = app.listen(0, '127.0.0.1')
  await new Promise<void>((resolve, reject) => { server.once('listening', resolve); server.once('error', reject) })
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})

beforeEach(() => {
  vi.stubEnv('DEEPSEEK_API_KEY', 'test-server-only-key')
  vi.stubEnv('DEEPSEEK_MODEL', 'configured-model')
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })
afterAll(async () => {
  if (server?.listening) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
})

async function request(id = session.id, body: unknown = { purpose: '整理观点' }, token = '') {
  return httpFetch(`${base}/api/brainstorm/${id}/suggestions`, { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
}

function provideSuggestion(value: unknown = suggestion) {
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(value) }, finish_reason: 'stop' }] })))
}

function databaseSnapshot() {
  return [schema.brainstormSessions, schema.murals, schema.sessions, schema.participants, schema.events, schema.muralInvites, schema.muralFocusClaims]
    .map((table) => db.select().from(table).all())
}

function createHostedDiscussion(id: string) {
  const nodes = structuredClone(board.nodes)
  nodes[0].data.ideaMeta!.sessionId = id
  const mural = hosted.createHostedMural('托管讨论', 'http://localhost', { ...board, nodes })
  const payload = { session: { ...session, id, boardId: mural.board.id }, board: mural.board }
  store.saveBrainstorm(payload)
  return { mural, payload }
}

describe('只返回建议的讨论接口', () => {
  it('有效本地请求只返回已验证建议，数据库和白板完全不变', async () => {
    provideSuggestion()
    const before = databaseSnapshot()
    db.run('PRAGMA query_only = ON')
    try {
      const response = await request(session.id, { purpose: '整理观点', ideaIds: ['idea-a'] })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(suggestion)
      expect(databaseSnapshot()).toEqual(before)
      expect(store.getBrainstorm(session.id)).toEqual({ board, session })
    } finally { db.run('PRAGMA query_only = OFF') }
  })

  it('讨论不存在时返回 404', async () => {
    const response = await request('missing')
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({ error: '讨论不存在。' })
  })

  it.each([{}, { purpose: '' }, { purpose: '整理', ideaIds: [] }, { purpose: '整理', ideaIds: ['missing'] },
    { purpose: '整理', board: { ...board, id: 'forged-board' } }])('拒绝非法请求且不调用模型：%j', async (body) => {
    vi.stubGlobal('fetch', () => { throw new Error('不应调用模型') })
    const response = await request(session.id, body)
    expect(response.status).toBe(400)
    expect(await response.json()).toHaveProperty('error')
  })

  it('没有 Key 时返回明确失败，不返回替代建议', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', '')
    const response = await request()
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: '未配置 DEEPSEEK_API_KEY，无法请求 AI 建议。' })
  })

  it('上游 HTTP 失败返回 502', async () => {
    vi.stubGlobal('fetch', async () => new Response('private-upstream-details', { status: 500 }))
    const response = await request()
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'DeepSeek 请求失败（HTTP 500）。' })
  })

  it.each([
    '{broken', JSON.stringify({ message: '无动作' }), JSON.stringify({ message: '未知动作', actions: [{ type: 'delete_ideas' }] }),
    JSON.stringify({ message: '缺字段', actions: [{ type: 'create_cluster', ideaIds: ['idea-a'] }] }),
    JSON.stringify({ message: '不存在的观点', actions: [{ type: 'create_cluster', label: '阅读', ideaIds: ['missing'] }] }),
  ])('非法模型建议返回 422，任何数据都不保存：%s', async (content) => {
    const before = databaseSnapshot()
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ choices: [{ message: { content } }] })))
    const response = await request()
    expect(response.status).toBe(422)
    expect(await response.json()).toHaveProperty('error')
    expect(databaseSnapshot()).toEqual(before)
  })

  it('托管讨论必须携带有效能力，不能用请求体伪装本地讨论', async () => {
    const { mural, payload } = createHostedDiscussion('capability-hosted')
    vi.stubGlobal('fetch', () => { throw new Error('未授权不应调用模型') })
    expect((await request(payload.session.id)).status).toBe(403)
    expect((await request(payload.session.id, { purpose: '整理' }, 'wrong-token')).status).toBe(403)
    expect((await request(payload.session.id, { purpose: '整理', board, session })).status).toBe(403)
    provideSuggestion()
    expect((await request(payload.session.id, { purpose: '整理' }, mural.userToken)).status).toBe(200)
    expect((await request(payload.session.id, { purpose: '整理' }, mural.ownerToken)).status).toBe(200)
  })

  it('托管讨论使用当前真实白板，拒绝跨讨论观点，不清理焦点数据', async () => {
    const { mural, payload } = createHostedDiscussion('live-hosted')
    const current = structuredClone(mural.board)
    current.nodes[0].data.ideaMeta!.sessionId = 'foreign-discussion'
    hosted.saveHostedMural(mural.board.id, mural.ownerToken, current)
    db.insert(schema.muralFocusClaims).values({ muralId: mural.board.id, elementId: 'idea-a', participantId: 'agent-a', participantName: '测试成员',
      state: 'editing', intent: '编辑', claimedAt: timestamp, leaseExpiresAt: timestamp, releaseOnAction: 'manual' }).run()
    const before = databaseSnapshot()
    provideSuggestion()
    db.run('PRAGMA query_only = ON')
    try {
      const response = await request(payload.session.id, { purpose: '整理' }, mural.userToken)
      expect(response.status).toBe(422)
      expect(databaseSnapshot()).toEqual(before)
    } finally { db.run('PRAGMA query_only = OFF') }
  })

  it('托管有效建议取当前白板上下文，保留过期焦点记录且不保存结果', async () => {
    const { mural, payload } = createHostedDiscussion('readonly-hosted')
    hosted.saveHostedMural(mural.board.id, mural.ownerToken, { ...mural.board, name: '成员刚修改的白板名称' })
    db.insert(schema.muralFocusClaims).values({ muralId: mural.board.id, elementId: 'idea-a', participantId: 'agent-a', participantName: '测试成员',
      state: 'editing', intent: '编辑', claimedAt: timestamp, leaseExpiresAt: timestamp, releaseOnAction: 'manual' }).run()
    const before = databaseSnapshot()
    vi.stubGlobal('fetch', async (_url: string, options: RequestInit) => {
      const context = JSON.parse(JSON.parse(options.body as string).messages[1].content)
      expect(context.board.name).toBe('成员刚修改的白板名称')
      expect(context.session.id).toBe('readonly-hosted')
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(suggestion) } }] }))
    })
    db.run('PRAGMA query_only = ON')
    try {
      const response = await request(payload.session.id, { purpose: '整理' }, mural.userToken)
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual(suggestion)
      expect(databaseSnapshot()).toEqual(before)
    } finally { db.run('PRAGMA query_only = OFF') }
  })

  it('请求期间本地讨论发生变化时拒绝过时建议', async () => {
    const changingSession = { ...session, id: 'changing-local' }
    const changingBoard = structuredClone(board)
    changingBoard.brainstormSessionId = changingSession.id
    changingBoard.nodes[0].data.ideaMeta!.sessionId = changingSession.id
    store.saveBrainstorm({ session: changingSession, board: changingBoard })
    vi.stubGlobal('fetch', async () => {
      store.saveBrainstorm({ session: changingSession, board: { ...changingBoard, nodes: [], updatedAt: '2026-10-10T10:00:01.000Z' } })
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(suggestion) } }] }))
    })
    const response = await request(changingSession.id)
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: '讨论已变化，请重新请求建议。' })
    expect(store.getBrainstorm(changingSession.id)?.session.suggestions).toEqual([])
  })

  it('请求期间托管白板发生变化时拒绝过时建议', async () => {
    const { mural, payload } = createHostedDiscussion('changing-hosted')
    vi.stubGlobal('fetch', async () => {
      hosted.saveHostedMural(mural.board.id, mural.ownerToken, { ...mural.board, nodes: [], sync: { nodeTombstones: { 'idea-a': '2026-10-10T11:00:00.000Z' }, edgeTombstones: {} } })
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(suggestion) } }] }))
    })
    const response = await request(payload.session.id, { purpose: '整理' }, mural.userToken)
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: '讨论已变化，请重新请求建议。' })
  })

  it('模型请求期间能力被撤销后不向旧令牌返回讨论建议', async () => {
    const { mural, payload } = createHostedDiscussion('revoked-hosted')
    vi.stubGlobal('fetch', async () => {
      hosted.rotateHostedUserShare(mural.board.id, mural.ownerToken, 'http://localhost')
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(suggestion) } }] }))
    })
    const response = await request(payload.session.id, { purpose: '整理' }, mural.userToken)
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: '没有访问此讨论的权限。' })
  })
})
