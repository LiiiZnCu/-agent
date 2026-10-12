import { env } from 'cloudflare:test'
import { beforeAll, describe, expect, it } from 'vitest'

import type { BoardSnapshot, BrainstormSession } from '../src/types'
import { createDatabase } from './db'
import { BrainstormWriteConflictError, createBrainstormStore } from './brainstorm-store'
import { migrateTestDatabase } from './test-utils'

const timestamp = '2026-10-10T10:00:00.000Z'
const board: BoardSnapshot = { id: 'd1-board', name: 'D1 白板', nodes: [], edges: [], createdAt: timestamp, updatedAt: timestamp }
const session: BrainstormSession = {
  id: 'd1-discussion', boardId: board.id, topic: 'D1 讨论', goal: '验证存储', background: '', constraints: '', stage: 'collecting',
  aiPaused: true, currentMemberId: 'member-a', members: [{ id: 'member-a', name: '成员', role: 'facilitator', joinedAt: timestamp }],
  proposals: [], suggestions: [], decision: null, outcome: null, createdAt: timestamp, updatedAt: timestamp,
}

const store = createBrainstormStore(createDatabase(env.DB))

beforeAll(async () => {
  await migrateTestDatabase()
})

describe('D1 讨论存储', () => {
  it('保存后可读取，并拒绝过期版本与跨白板覆盖', async () => {
    await store.save({ board, session })
    await expect(store.get(session.id)).resolves.toEqual({ board, session })

    await expect(store.save({
      board: { ...board, updatedAt: '2026-10-10T09:59:59.000Z' },
      session: { ...session, topic: '旧版本' },
    })).rejects.toBeInstanceOf(BrainstormWriteConflictError)

    await expect(store.save({
      board: { ...board, id: 'other-board', updatedAt: '2026-10-10T10:00:01.000Z' },
      session: { ...session, boardId: 'other-board' },
    })).rejects.toBeInstanceOf(BrainstormWriteConflictError)
  })

  it('按白板读取最新讨论，找不到时返回 null', async () => {
    await expect(store.getByBoardId(board.id)).resolves.toEqual({ board, session })
    await expect(store.get('missing-discussion')).resolves.toBeNull()
    await expect(store.getByBoardId('missing-board')).resolves.toBeNull()
  })
})
