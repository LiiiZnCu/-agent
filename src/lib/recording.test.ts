import { describe, expect, it } from 'vitest'
import { addRecordingCheckpoint, appendEvent, completeRecording, createRecordingSession, deleteRecordingCheckpoint, joinRecording, moderateRecording, recordingToCsv, recordingToMarkdown, renameRecordingCheckpoint, setRecordingFocus, watchRecording } from './recording'

describe('multi-agent recording', () => {
  it('没有明确操作者时拒绝建立或结束记录', () => {
    expect(() => createRecordingSession('空记录')).toThrow('明确成员')
    expect(() => createRecordingSession('', { id: 'm1', name: '小林', role: 'human' })).toThrow('标题')
    const session = createRecordingSession('记录', { id: 'm1', name: '小林', role: 'human' })
    expect(() => completeRecording(session, '完成')).toThrow('明确成员')
    expect(completeRecording(session, '完成', { id: 'm1', name: '小林', role: 'human' }).events.at(-1)).toMatchObject({ participantId: 'm1', participantName: '小林' })
  })
  it('assigns moderation to the agent that creates the session', () => {
    const session = createRecordingSession('Moderated', { id: 'agent-moderator', name: 'Moderator', role: 'agent' }, 'mural-uuid')
    expect(session.moderatorId).toBe('agent-moderator')
    expect(session.boardId).toBe('mural-uuid')
    expect(session.participants[0].status).toBe('active')
  })

  it('lets only the creator mute and reactivate another participant', () => {
    let session = createRecordingSession('Moderated', { id: 'agent-moderator', name: 'Moderator', role: 'agent' }, 'mural-uuid')
    session = joinRecording(session, { id: 'agent-risky', name: 'Risky', role: 'agent' })
    expect(() => moderateRecording(session, 'agent-risky', true, 'agent-risky')).toThrow('Only the session moderator')
    session = moderateRecording(session, 'agent-risky', true, 'agent-moderator')
    expect(session.participants.find((participant) => participant.id === 'agent-risky')?.status).toBe('muted')
    expect(session.events.at(-1)?.content).toContain('muted by the moderator')
    session = moderateRecording(session, 'agent-risky', false, 'agent-moderator')
    expect(session.participants.find((participant) => participant.id === 'agent-risky')?.status).toBe('active')
  })

  it('renews a scoped watch lease without reactivating a muted agent', () => {
    let session = createRecordingSession('Watch', { id: 'agent-moderator', name: 'Moderator', role: 'agent' }, 'mural-uuid')
    session = joinRecording(session, { id: 'agent-watcher', name: 'Watcher', role: 'agent' })
    session = moderateRecording(session, 'agent-watcher', true, 'agent-moderator')
    session = watchRecording(session, 'agent-watcher', ['element-a'])
    const watcher = session.participants.find((participant) => participant.id === 'agent-watcher')!
    expect(watcher.status).toBe('muted')
    expect(watcher.watchingElementIds).toEqual(['element-a'])
    expect(new Date(watcher.leaseExpiresAt!).getTime()).toBeGreaterThan(new Date(watcher.lastSeenAt!).getTime())
  })

  it('assigns distinct agent colors and prevents conflicting edit focus', () => {
    let session = createRecordingSession('Focus', { id: 'm1', name: '小林', role: 'human' }, 'mural-uuid')
    session = joinRecording(session, { id: 'one', name: 'One', role: 'agent' })
    session = joinRecording(session, { id: 'two', name: 'Two', role: 'agent' })
    expect(session.participants.find((participant) => participant.id === 'one')?.color).not.toBe(session.participants.find((participant) => participant.id === 'two')?.color)
    const now = new Date()
    session = setRecordingFocus(session, 'one', {
      state: 'editing', intent: 'Rewrite', elementIds: ['idea-1'], claimedAt: now.toISOString(),
      leaseExpiresAt: new Date(now.getTime() + 30_000).toISOString(), releaseOnAction: 'after_write',
    })
    expect(() => setRecordingFocus(session, 'two', {
      state: 'editing', intent: 'Also rewrite', elementIds: ['idea-1'], claimedAt: now.toISOString(),
      leaseExpiresAt: new Date(now.getTime() + 30_000).toISOString(), releaseOnAction: 'manual',
    })).toThrow('already editing')
  })

  it('stores editable replay checkpoints without changing the live board', () => {
    const board = { id: 'mural-uuid', name: 'Replay', nodes: [], edges: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
    const member = { id: 'm1', name: '小林', role: 'human' as const }
    const original = createRecordingSession('Replay', member, board.id)
    expect(() => addRecordingCheckpoint(original, 'First pass', board)).toThrow('明确成员')
    let session = addRecordingCheckpoint(original, 'First pass', board, member)
    const checkpointId = session.events.at(-1)!.id
    expect(session.events.at(-1)?.checkpoint?.board).toEqual(board)
    session = renameRecordingCheckpoint(session, checkpointId, 'Research complete')
    expect(session.events.at(-1)?.checkpoint?.label).toBe('Research complete')
    session = deleteRecordingCheckpoint(session, checkpointId)
    expect(session.events.some((event) => event.id === checkpointId)).toBe(false)
  })

  it('tracks participants, replies, and decisions in order', () => {
    let session = createRecordingSession('Launch brainstorm', { id: 'm1', name: '小林', role: 'human' })
    session = appendEvent(session, {
      participantId: 'agent-research',
      participantName: 'Research agent',
      participantRole: 'agent',
      kind: 'proposal',
      content: 'Interview current users before choosing a launch channel.',
    })
    const proposalId = session.events.at(-1)!.id
    session = appendEvent(session, {
      participantId: 'agent-critic',
      participantName: 'Critic agent',
      participantRole: 'agent',
      kind: 'critique',
      content: 'Interviews alone may miss actual behavior.',
      replyTo: proposalId,
    })
    expect(session.participants).toHaveLength(3)
    expect(session.events.at(-1)?.replyTo).toBe(proposalId)
  })

  it('finalizes and exports the deliberation with the board', () => {
    const member = { id: 'm1', name: '小林', role: 'human' as const }
    const completed = completeRecording(createRecordingSession('Brainstorm', member), 'Test both interviews and behavior data.', member)
    const markdown = recordingToMarkdown(completed, {
      id: '23a683bd-a7ac-47a4-afc4-7cfb93ecf781',
      name: 'Launch board',
      nodes: [],
      edges: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    expect(completed.status).toBe('complete')
    expect(markdown).toContain('## Deliberation timeline')
    expect(markdown).toContain('Test both interviews and behavior data.')
    expect(markdown).toContain('Launch board')
  })

  it('exports contribution fields as portable CSV', () => {
    const session = appendEvent(createRecordingSession('CSV trace', { id: 'm1', name: '小林', role: 'human' }), {
      participantId: 'm1',
      participantName: '小林',
      participantRole: 'human',
      kind: 'decision',
      content: 'Ship the small, local version first.',
    })
    const csv = recordingToCsv(session)
    expect(csv).toContain('"participant_name"')
    expect(csv).toContain('"Ship the small, local version first."')
  })
})
