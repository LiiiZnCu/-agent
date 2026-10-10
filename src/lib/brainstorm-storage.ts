import type { BoardSnapshot, BrainstormSession } from '../types'
import { saveBoard } from './storage'
import { validateBrainstormPayload } from './brainstorm-validation'
export { validateBrainstormPayload, deserializeBrainstorm } from './brainstorm-validation'
export type { StoredBrainstorm } from './brainstorm-validation'

export function saveBrainstormBoard(board: BoardSnapshot, session: BrainstormSession | null) {
  if (session) validateBrainstormPayload({ board, session })
  const { brainstormSession: _previous, ...snapshot } = board as BoardSnapshot & { brainstormSession?: unknown }
  // 一个 localStorage 项同时保存白板与讨论，避免两次写入留下半个快照。
  saveBoard({ ...snapshot, brainstormSessionId: session?.id, brainstormSession: session } as BoardSnapshot)
}

export function loadBrainstorm(board: BoardSnapshot): BrainstormSession | null {
  const stored = board as BoardSnapshot & { brainstormSession?: unknown }
  if (stored.brainstormSession == null && stored.brainstormSessionId === undefined) return null
  return validateBrainstormPayload({ board, session: stored.brainstormSession }, stored.brainstormSessionId).session
}
