import type { BoardSnapshot } from '../types'

const STORAGE_KEY = 'canvas-relay-board-v1'

export function loadBoard(fallback: BoardSnapshot): BoardSnapshot {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return fallback
    const parsed = JSON.parse(raw) as BoardSnapshot
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges) || typeof parsed.name !== 'string') {
      return fallback
    }
    return parsed
  } catch {
    return fallback
  }
}

export function saveBoard(snapshot: BoardSnapshot) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot))
}
