import { env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'

import type { BoardSnapshot, RecordingSession } from '../src/types'
import { createDatabase } from './db'
import { createRecordingStore } from './recording-store'
import { migrateTestDatabase } from './test-utils'

const timestamp = '2026-10-10T10:00:00.000Z'
const board: BoardSnapshot = { id: 'recording-board', name: '记录白板', nodes: [], edges: [], createdAt: timestamp, updatedAt: timestamp }
const session: RecordingSession = {
  specVersion: '1.0', id: 'recording-session', title: '记录测试', status: 'complete', startedAt: timestamp,
  completedAt: timestamp, boardId: board.id, moderatorId: 'agent-a', finalOutput: '完成',
  participants: [{ id: 'agent-a', name: '代理 A', role: 'agent', status: 'active', joinedAt: timestamp }],
  events: [{ id: 'event-a', createdAt: timestamp, participantId: 'agent-a', participantName: '代理 A', participantRole: 'agent', kind: 'note', content: '第一条记录' }],
}

const store = createRecordingStore(createDatabase(env.DB))

beforeAll(() => migrateTestDatabase())

describe('D1 活动记录存储', () => {
  it('按顺序保存、读取并删除会话、成员和事件', async () => {
    await store.save({ session, finalBoard: board })
    await expect(store.get(session.id)).resolves.toEqual({ session, finalBoard: board })
    await expect(store.getByBoardId(board.id)).resolves.toEqual({ session, finalBoard: board })
    await expect(store.delete(session.id)).resolves.toBe(true)
    await expect(store.get(session.id)).resolves.toBeNull()
  })
})
