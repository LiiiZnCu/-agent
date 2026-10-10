import { deserializeBrainstorm, validateBrainstormPayload, type StoredBrainstorm } from '../src/lib/brainstorm-validation.ts'
import { desc, eq } from 'drizzle-orm'
import { db } from './db.ts'
import { brainstormSessions } from './schema.ts'

export function saveBrainstorm(input: StoredBrainstorm) {
  const payload = validateBrainstormPayload(input)
  const existing = getBrainstorm(payload.session.id)
  if (existing && existing.board.id !== payload.board.id) throw new Error('讨论不能迁移到另一个白板。')
  const values = { id: payload.session.id, boardId: payload.board.id, payloadJson: JSON.stringify(payload), updatedAt: new Date().toISOString() }
  db.insert(brainstormSessions).values(values).onConflictDoUpdate({ target: brainstormSessions.id, set: values }).run()
}

export function getBrainstorm(id: string): StoredBrainstorm | null {
  const stored = db.select().from(brainstormSessions).where(eq(brainstormSessions.id, id)).get()
  if (!stored) return null
  const payload = deserializeBrainstorm(stored.payloadJson)
  if (payload.session.id !== stored.id || payload.board.id !== stored.boardId) throw new Error('已保存的讨论所属关系无效。')
  return payload
}

export function getBrainstormByBoardId(boardId: string): StoredBrainstorm | null {
  const stored = db.select({ id: brainstormSessions.id }).from(brainstormSessions).where(eq(brainstormSessions.boardId, boardId)).orderBy(desc(brainstormSessions.updatedAt)).limit(1).get()
  return stored ? getBrainstorm(stored.id) : null
}
