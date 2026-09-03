import { describe, expect, it } from 'vitest'
import { appendEvent, completeRecording, createRecordingSession, recordingToCsv, recordingToMarkdown } from './recording'

describe('multi-agent recording', () => {
  it('tracks participants, replies, and decisions in order', () => {
    let session = createRecordingSession('Launch brainstorm')
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
    const completed = completeRecording(createRecordingSession(), 'Test both interviews and behavior data.')
    const markdown = recordingToMarkdown(completed, {
      name: 'Launch board', nodes: [], edges: [], updatedAt: new Date().toISOString(),
    })
    expect(completed.status).toBe('complete')
    expect(markdown).toContain('## Deliberation timeline')
    expect(markdown).toContain('Test both interviews and behavior data.')
    expect(markdown).toContain('Launch board')
  })

  it('exports contribution fields as portable CSV', () => {
    const session = appendEvent(createRecordingSession('CSV trace'), {
      participantId: 'human-facilitator',
      participantName: 'You',
      participantRole: 'human',
      kind: 'decision',
      content: 'Ship the small, local version first.',
    })
    const csv = recordingToCsv(session)
    expect(csv).toContain('"participant_name"')
    expect(csv).toContain('"Ship the small, local version first."')
  })
})
