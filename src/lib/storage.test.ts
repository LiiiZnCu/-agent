// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import type { BoardSnapshot, RecordingSession } from '../types'
import { importBoard, importCanvasRelay, listBoards, loadBoard, loadBoardById, saveBoard } from './storage'

const fallback: BoardSnapshot = {
  id: '84571348-85fd-4d40-8b9e-fac16fac2ecf',
  name: 'First mural',
  nodes: [],
  edges: [],
  createdAt: '2026-09-03T10:00:00.000Z',
  updatedAt: '2026-09-03T10:00:00.000Z',
}

describe('local mural library', () => {
  beforeEach(() => window.localStorage.clear())

  it('keeps multiple UUID murals and reloads them independently', () => {
    expect(loadBoard(fallback).id).toBe(fallback.id)
    const second = { ...fallback, id: '24aacdaa-53ec-4d20-b0ea-835dbb7c5f6c', name: 'Second mural', updatedAt: '2026-09-03T11:00:00.000Z' }
    saveBoard(second)
    expect(listBoards()).toHaveLength(2)
    expect(loadBoardById(fallback.id)?.name).toBe('First mural')
    expect(loadBoardById(second.id)?.name).toBe('Second mural')
  })

  it('imports exported boards without overwriting an existing UUID', () => {
    saveBoard(fallback)
    const imported = importBoard(JSON.stringify(fallback))
    expect(imported.id).not.toBe(fallback.id)
    expect(imported.name).toBe('First mural (imported)')
    expect(listBoards()).toHaveLength(2)
  })

  it('rejects malformed nodes before they reach the renderer', () => {
    expect(() => importBoard(JSON.stringify({ ...fallback, nodes: [{}] }))).toThrow('not a valid')
  })

  it('deeply validates graph references and structured artifacts', () => {
    const artifact = {
      specVersion: '1.0', artifactType: 'table', title: 'Options',
      fields: [{ key: 'option', label: 'Option', type: 'text', required: true }],
      records: [{ option: 'Async buddy' }],
      presentation: { layout: 'table' },
    }
    const nodes = [
      { id: 'artifact-1', type: 'boardElement', position: { x: 10, y: 20 }, data: { title: 'Options', body: '', kind: 'artifact', color: 'paper', votes: 0, artifact } },
      { id: 'idea-1', type: 'boardElement', position: { x: 40, y: 50 }, data: { title: 'Idea', body: '', kind: 'idea', color: 'sun', votes: 1 } },
    ]
    const edges = [{ id: 'edge-1', source: 'artifact-1', target: 'idea-1', type: 'smoothstep' }]

    expect(() => importBoard(JSON.stringify({ ...fallback, nodes: [{ ...nodes[0], position: { x: '10', y: 20 } }], edges: [] }))).toThrow('not a valid')
    expect(() => importBoard(JSON.stringify({ ...fallback, nodes, edges: [{ ...edges[0], target: 'missing' }] }))).toThrow('not a valid')
    expect(() => importBoard(JSON.stringify({ ...fallback, nodes, edges: [edges[0], { ...edges[0] }] }))).toThrow('not a valid')
    expect(() => importBoard(JSON.stringify({
      ...fallback,
      nodes: [{ ...nodes[0], data: { ...nodes[0].data, artifact: { ...artifact, records: [{ option: { unsafe: true } }] } } }],
      edges: [],
    }))).toThrow('not a valid')
  })

  it('preserves a bundled decision trace and remaps it to the imported mural', () => {
    const session = {
      specVersion: '1.0', id: 'session-1', title: 'Trace', status: 'recording', startedAt: fallback.createdAt,
      moderatorId: 'human', participants: [{ id: 'human', name: 'You', role: 'human' }],
      events: [{ id: 'event-1', createdAt: fallback.createdAt, participantId: 'human', participantName: 'You', participantRole: 'human', kind: 'note', content: 'Keep me' }],
    }
    const imported = importCanvasRelay(JSON.stringify({ finalBoard: fallback, session }))
    expect(imported.recording?.events[0].content).toBe('Keep me')
    expect(imported.recording?.boardId).toBe(imported.board.id)
  })

  it('round-trips every portable recording field from an exported package', () => {
    const finalBoard: BoardSnapshot = {
      ...fallback,
      nodes: [
        { id: 'idea-1', type: 'boardElement', position: { x: 10, y: 20 }, data: { title: 'Async buddy', body: 'Pair across time zones', kind: 'idea', color: 'sun', votes: 3 } },
        { id: 'action-1', type: 'boardElement', position: { x: 300, y: 20 }, data: { title: 'Pilot', body: 'Test with five hires', kind: 'action', color: 'mint', votes: 1 } },
      ],
      edges: [{ id: 'edge-1', source: 'idea-1', target: 'action-1', label: 'leads to', type: 'smoothstep', animated: true }],
    }
    const session: RecordingSession = {
      specVersion: '1.0',
      id: 'session-complete',
      title: 'Remote onboarding trace',
      status: 'complete',
      startedAt: '2026-09-03T10:01:00.000Z',
      completedAt: '2026-09-03T10:12:00.000Z',
      boardId: finalBoard.id,
      moderatorId: 'human',
      participants: [
        { id: 'human', name: 'Facilitator', role: 'human', status: 'active', joinedAt: '2026-09-03T10:01:00.000Z' },
        { id: 'critic', name: 'Critic', role: 'agent', specialty: 'Risk', status: 'offline', joinedAt: '2026-09-03T10:02:00.000Z', lastSeenAt: '2026-09-03T10:11:00.000Z', leaseExpiresAt: '2026-09-03T10:11:30.000Z', watchingElementIds: ['idea-1'] },
      ],
      events: [
        { id: 'event-1', createdAt: '2026-09-03T10:03:00.000Z', participantId: 'human', participantName: 'Facilitator', participantRole: 'human', kind: 'proposal', content: 'Use an async buddy.', relatedElementIds: ['idea-1'], metadata: { confidence: 0.8, approved: true, note: null } },
        { id: 'event-2', createdAt: '2026-09-03T10:04:00.000Z', participantId: 'critic', participantName: 'Critic', participantRole: 'agent', kind: 'critique', content: 'Account for time zones.', replyTo: 'event-1', relatedElementIds: ['idea-1'] },
      ],
      finalOutput: 'Pilot the async buddy flow with five hires.',
    }

    const imported = importCanvasRelay(JSON.stringify({ schemaVersion: '1.0', session, finalBoard }))

    expect(imported.board.nodes).toEqual(finalBoard.nodes)
    expect(imported.board.edges).toEqual(finalBoard.edges)
    expect(imported.recording).toEqual({ ...session, boardId: imported.board.id })
  })

  it('keeps additive focus and replay fields while accepting legacy sessions without them', () => {
    const now = fallback.createdAt
    const session: RecordingSession = {
      specVersion: '1.0', id: 'session-replay', title: 'Replay', status: 'recording', startedAt: now,
      boardId: fallback.id, moderatorId: 'human',
      participants: [
        { id: 'human', name: 'You', role: 'human' },
        { id: 'agent', name: 'Architect', role: 'agent', color: 'violet', focus: { state: 'reviewing', intent: 'Reviewing evidence', elementIds: [], claimedAt: now, leaseExpiresAt: '2026-09-03T10:01:00.000Z', releaseOnAction: 'manual' } },
      ],
      events: [
        { id: 'checkpoint-1', createdAt: now, participantId: 'human', participantName: 'You', participantRole: 'human', kind: 'checkpoint', content: 'Checkpoint saved: Start', checkpoint: { label: 'Start', board: fallback } },
      ],
    }
    const imported = importCanvasRelay(JSON.stringify({ schemaVersion: '1.0', finalBoard: fallback, session }))
    expect(imported.recording?.participants[1].color).toBe('violet')
    expect(imported.recording?.participants[1].focus?.intent).toBe('Reviewing evidence')
    expect(imported.recording?.events[0].checkpoint?.board.id).toBe(imported.board.id)
  })

  it('rejects an invalid bundled recording instead of silently dropping it', () => {
    const malformedSession = {
      specVersion: '1.0', id: 'session-1', title: 'Trace', status: 'recording', startedAt: fallback.createdAt,
      moderatorId: 'human', participants: [{ id: 'human', name: 'You', role: 'owner' }],
      events: [],
    }

    expect(() => importCanvasRelay(JSON.stringify({ schemaVersion: '1.0', finalBoard: fallback, session: malformedSession })))
      .toThrow('invalid Canvas Relay recording')
    expect(listBoards()).toHaveLength(0)
  })
})
