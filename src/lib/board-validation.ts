import type { BoardSnapshot } from '../types'
import { validateArtifactSpec } from './artifacts.ts'

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isString(value: unknown, maxLength: number, allowEmpty = false): value is string {
  return typeof value === 'string' && value.length <= maxLength && (allowEmpty || Boolean(value.trim()))
}

function isTimestamp(value: unknown): value is string {
  return isString(value, 64) && Number.isFinite(Date.parse(value))
}

function isOptionalString(value: unknown, maxLength: number): value is string | undefined {
  return value === undefined || isString(value, maxLength, true)
}

function hasValidArtifact(value: unknown): boolean {
  try {
    validateArtifactSpec(value)
    return true
  } catch {
    return false
  }
}

export function isSnapshot(value: unknown): value is BoardSnapshot {
  if (!isRecord(value)) return false
  const board = value as Partial<BoardSnapshot>
  if (!isString(board.id, 200) || !isString(board.name, 1_000) || !isTimestamp(board.createdAt) || !isTimestamp(board.updatedAt)
    || !Array.isArray(board.nodes) || !Array.isArray(board.edges)) return false
  if (board.nodes.length > 2000 || board.edges.length > 5000) return false
  const validKinds = new Set(['idea', 'question', 'insight', 'action', 'frame', 'artifact'])
  const validColors = new Set(['paper', 'sun', 'mint', 'sky', 'rose'])
  const nodeIds = new Set<string>()
  const nodesAreValid = board.nodes.every((candidate) => {
    if (!isRecord(candidate)) return false
    const node = candidate
    const position = node.position
    const data = node.data
    if (!isString(node.id, 200) || nodeIds.has(node.id) || !isRecord(position) || !isRecord(data)) return false
    nodeIds.add(node.id)
    if (typeof position.x !== 'number' || !Number.isFinite(position.x)
      || typeof position.y !== 'number' || !Number.isFinite(position.y)
      || !isString(data.title, 10_000, true) || !isString(data.body, 100_000, true)
      || typeof data.votes !== 'number' || !Number.isFinite(data.votes) || data.votes < 0
      || !isOptionalString(data.cluster, 1_000)
      || (data.justCreated !== undefined && typeof data.justCreated !== 'boolean')) return false
    if (typeof data.kind !== 'string' || !validKinds.has(data.kind) || typeof data.color !== 'string' || !validColors.has(data.color)) return false
    if (node.type !== undefined && node.type !== 'boardElement') return false
    if (node.zIndex !== undefined && (typeof node.zIndex !== 'number' || !Number.isFinite(node.zIndex))) return false
    if (data.kind === 'artifact') return hasValidArtifact(data.artifact)
    return data.artifact === undefined
  })
  if (!nodesAreValid) return false
  const edgeIds = new Set<string>()
  return board.edges.every((candidate) => {
    if (!isRecord(candidate)) return false
    const edge = candidate
    if (!isString(edge.id, 200) || edgeIds.has(edge.id)) return false
    edgeIds.add(edge.id)
    return isString(edge.source, 200) && isString(edge.target, 200) && edge.source !== edge.target
      && nodeIds.has(edge.source) && nodeIds.has(edge.target)
      && isOptionalString(edge.label, 1_000)
      && (edge.type === undefined || isString(edge.type, 80))
      && (edge.animated === undefined || typeof edge.animated === 'boolean')
  })
}
