import { desc, eq } from 'drizzle-orm'

import { deserializeBrainstorm, validateBrainstormPayload, type StoredBrainstorm } from '../src/lib/brainstorm-validation'
import type { Database } from './db'
import { brainstormSessions } from './schema'

export class BrainstormWriteConflictError extends Error {
  constructor(message = '该保存版本已过期，请读取最新讨论。') {
    super(message)
    this.name = 'BrainstormWriteConflictError'
  }
}

export function createBrainstormStore(db: Database) {
  async function get(id: string): Promise<StoredBrainstorm | null> {
    const stored = await db.select().from(brainstormSessions).where(eq(brainstormSessions.id, id)).get()
    if (!stored) return null
    const payload = deserializeBrainstorm(stored.payloadJson)
    if (payload.session.id !== stored.id || payload.board.id !== stored.boardId) throw new Error('已保存的讨论所属关系无效。')
    return payload
  }

  async function save(input: StoredBrainstorm): Promise<void> {
    const payload = validateBrainstormPayload(input)
    const existing = await get(payload.session.id)
    if (existing && existing.board.id !== payload.board.id) throw new BrainstormWriteConflictError('讨论不能迁移到另一个白板。')

    const serialized = JSON.stringify(payload)
    const incomingUpdatedAt = Date.parse(payload.board.updatedAt)
    if (existing) {
      const existingUpdatedAt = Date.parse(existing.board.updatedAt)
      if (incomingUpdatedAt < existingUpdatedAt) throw new BrainstormWriteConflictError()
      if (incomingUpdatedAt === existingUpdatedAt && serialized !== JSON.stringify(existing)) throw new BrainstormWriteConflictError()
      if (incomingUpdatedAt === existingUpdatedAt) return
    }

    const values = {
      id: payload.session.id,
      boardId: payload.board.id,
      payloadJson: serialized,
      updatedAt: new Date(payload.board.updatedAt).toISOString(),
    }
    await db.insert(brainstormSessions).values(values).onConflictDoUpdate({ target: brainstormSessions.id, set: values }).run()
  }

  async function getByBoardId(boardId: string): Promise<StoredBrainstorm | null> {
    const stored = await db.select({ id: brainstormSessions.id })
      .from(brainstormSessions)
      .where(eq(brainstormSessions.boardId, boardId))
      .orderBy(desc(brainstormSessions.updatedAt))
      .limit(1)
      .get()
    return stored ? get(stored.id) : null
  }

  return { save, get, getByBoardId }
}
