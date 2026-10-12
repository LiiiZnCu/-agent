import { env, SELF } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'

import type { BoardSnapshot, BrainstormSession, RecordingSession } from '../src/types'
import { requestDeepSeekSuggestions, DeepSeekError } from './deepseek'
import { migrateTestDatabase } from './test-utils'

const timestamp = '2026-10-10T10:00:00.000Z'
const board: BoardSnapshot = { id: 'api-board', name: 'API 白板', nodes: [], edges: [], createdAt: timestamp, updatedAt: timestamp }
const brainstorm: BrainstormSession = {
  id: 'api-discussion', boardId: board.id, topic: 'API 讨论', goal: '测试路由', background: '', constraints: '', stage: 'collecting', aiPaused: true,
  currentMemberId: 'member-a', members: [{ id: 'member-a', name: '成员', role: 'facilitator', joinedAt: timestamp }], proposals: [], suggestions: [], decision: null, outcome: null, createdAt: timestamp, updatedAt: timestamp,
}
const recording: RecordingSession = {
  specVersion: '1.0', id: 'api-recording', title: 'API 导出', status: 'complete', startedAt: timestamp, completedAt: timestamp, moderatorId: 'member-a',
  participants: [{ id: 'member-a', name: '成员', role: 'human', status: 'active', joinedAt: timestamp }],
  events: [{ id: 'api-event', createdAt: timestamp, participantId: 'member-a', participantName: '成员', participantRole: 'human', kind: 'note', content: '记录内容' }],
}

beforeAll(() => migrateTestDatabase())

async function request(path: string, init?: RequestInit) {
  return SELF.fetch(`https://example.test${path}`, init)
}

describe('Worker API', () => {
  it('保留健康检查、未知 API JSON 404 和本地讨论读写', async () => {
    await expect((await request('/api/health')).json()).resolves.toEqual({ ok: true, storage: 'd1' })
    const unknown = await request('/api/unknown')
    expect(unknown.status).toBe(404)
    await expect(unknown.json()).resolves.toEqual({ error: 'API endpoint not found.' })

    const save = await request(`/api/brainstorm/${brainstorm.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ board, session: brainstorm }) })
    expect(save.status).toBe(200)
    const opened = await request(`/api/brainstorm/${brainstorm.id}`)
    expect(opened.status).toBe(200)
    await expect(opened.json()).resolves.toEqual({ board, session: brainstorm })
  })

  it('托管白板拒绝错误令牌，并能创建、保存和读取会话导出', async () => {
    const created = await request('/api/murals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'API 托管' }) })
    expect(created.status).toBe(201)
    const mural = await created.json() as { board: BoardSnapshot; ownerToken: string }
    const denied = await request(`/api/murals/${mural.board.id}`, { headers: { Authorization: 'Bearer wrong' } })
    expect(denied.status).toBe(403)

    const saved = await request(`/api/sessions/${recording.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session: recording, finalBoard: board }) })
    expect(saved.status).toBe(200)
    const exported = await request(`/api/sessions/${recording.id}/export?format=csv`)
    expect(exported.status).toBe(200)
    expect(exported.headers.get('content-disposition')).toContain('api.csv')
    expect(await exported.text()).toContain('记录内容')
    const loaded = await request(`/api/sessions/${recording.id}`)
    expect(loaded.status).toBe(200)
  })

  it('缺少 DeepSeek 密钥时直接报错，不生成替代建议', async () => {
    await expect(requestDeepSeekSuggestions({ board, session: brainstorm }, { purpose: '整理' }, { ...env, DEEPSEEK_API_KEY: undefined })).rejects.toMatchObject<DeepSeekError>({ status: 503 })
  })
})
