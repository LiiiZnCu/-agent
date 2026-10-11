// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import type { BoardActions, RecordingActions } from '../types'
import { registerWebMCP, TOOL_CATALOG } from './webmcp'

type CapturedTool = {
  name: string
  title?: string
  description: string
  inputSchema?: Record<string, unknown>
  execute: (input: Record<string, unknown>) => Promise<unknown> | unknown
}

describe('WebMCP registration', () => {
  it('registers the complete surface and exposes Artifact Spec directly', async () => {
    const tools: CapturedTool[] = []
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: { registerTool: (tool: CapturedTool) => tools.push(tool) },
    })
    const actions = {
      getSnapshot: vi.fn(() => ({ name: 'Test', nodes: [], edges: [], updatedAt: 'now' })),
    } as unknown as BoardActions
    const recording = { getRecording: vi.fn(() => null) } as unknown as RecordingActions

    const registration = registerWebMCP(actions, recording, vi.fn())

    expect(registration.supported).toBe(true)
    expect(registration.count).toBe(TOOL_CATALOG.length)
    expect(tools.map((tool) => tool.name)).toContain('canvas_create_artifact')
    expect(tools.map((tool) => tool.name)).toContain('canvas_create_mural')
    expect(tools.map((tool) => tool.name)).toContain('canvas_invite_agents')
    expect(tools.map((tool) => tool.name)).toContain('canvas_redeem_agent_invite')
    expect(tools.map((tool) => tool.name)).toContain('canvas_record_contribution')
    expect(tools.map((tool) => tool.name)).toContain('canvas_moderate_participant')
    expect(tools.map((tool) => tool.name)).toContain('canvas_set_element_layer')
    expect(tools.map((tool) => tool.name)).toContain('canvas_comment_element')
    expect(tools.map((tool) => tool.name)).toContain('canvas_watch_mural')
    expect(tools.map((tool) => tool.name)).toContain('canvas_set_focus')
    expect(tools.map((tool) => tool.name)).toContain('canvas_add_checkpoint')
    expect(tools.map((tool) => tool.name)).toContain('canvas_rename_mural')

    const artifactTool = tools.find((tool) => tool.name === 'canvas_create_artifact')!
    expect(artifactTool.title).toBe('创建可复用的结构化内容')
    expect(artifactTool.description).toContain('需要已加入讨论且未被静音的智能体')
    const properties = artifactTool.inputSchema?.properties as Record<string, unknown>
    const artifactSchema = properties.spec as { properties: Record<string, unknown> }
    expect((properties.agentToken as { description: string }).description).toBe('由 canvas_join_session 或 canvas_start_recording 返回的私密权限令牌。')
    expect(artifactSchema.properties).toHaveProperty('artifactType')
    expect(artifactSchema.properties).not.toHaveProperty('spec')

    const boardTool = tools.find((tool) => tool.name === 'canvas_get_board')!
    expect(boardTool.title).toBe('读取讨论白板')
    const output = await boardTool.execute({}) as { structuredContent: { board: { name: string } } }
    expect(output.structuredContent.board.name).toBe('Test')
    registration.cleanup()
  })

  it('lets an agent create a hosted mural and receive separate human access', async () => {
    const tools: CapturedTool[] = []
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: { registerTool: (tool: CapturedTool) => tools.push(tool) },
    })
    const board = { id: 'hosted-1', name: 'Launch review', nodes: [], edges: [], createdAt: 'now', updatedAt: 'now' }
    const actions = {
      getSnapshot: vi.fn(() => board),
      createHostedMural: vi.fn(async () => ({
        board, revision: 1, ownerToken: 'owner-secret', userToken: 'user-secret',
        ownerUrl: 'https://example.test/?mural=hosted-1#owner=owner-secret',
        userUrl: 'https://example.test/?mural=hosted-1#access=user-secret',
      })),
    } as unknown as BoardActions
    const session = {
      id: 'session-hosted', specVersion: '1.0', title: 'Launch review', status: 'recording', startedAt: 'now',
      boardId: 'hosted-1', moderatorId: 'gpt-host', participants: [{ id: 'gpt-host', name: 'GPT Host', role: 'agent', status: 'active' }], events: [],
    }
    const recording = {
      getRecording: vi.fn(() => null),
      startRecording: vi.fn(() => session),
    } as unknown as RecordingActions
    registerWebMCP(actions, recording, vi.fn())

    const created = await tools.find((tool) => tool.name === 'canvas_create_mural')!.execute({
      name: 'Launch review', creatorAgentId: 'gpt-host', creatorAgentName: 'GPT Host',
    }) as { structuredContent: { summary: string; muralId: string; ownerToken: string; userUrl: string; moderatorToken: string } }
    expect(created.structuredContent.summary).toBe('已创建托管白板，并分别提供所有者、用户和智能体访问方式')
    expect(created.structuredContent.muralId).toBe('hosted-1')
    expect(created.structuredContent.ownerToken).toBe('owner-secret')
    expect(created.structuredContent.userUrl).toContain('#access=')
    expect(created.structuredContent.moderatorToken).toBeTruthy()
  })

  it('requires mural identity and blocks a muted agent from write tools', async () => {
    const tools: CapturedTool[] = []
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: { registerTool: (tool: CapturedTool) => tools.push(tool) },
    })
    const addElement = vi.fn(() => ({ id: 'new', data: { title: 'Safe idea' } }))
    const actions = {
      getSnapshot: vi.fn(() => ({ id: 'mural-1', name: 'Test', nodes: [], edges: [], createdAt: 'now', updatedAt: 'now' })),
      addElement,
    } as unknown as BoardActions
    let session = {
      id: 'session-1', specVersion: '1.0', title: 'Test', startedAt: 'now', moderatorId: 'human', events: [],
      status: 'recording',
      boardId: 'mural-1',
      participants: [] as Array<{ id: string; name: string; role: string; status: string }>,
    }
    const recording = {
      getRecording: vi.fn(() => session),
      joinParticipant: vi.fn((participant) => {
        session = { ...session, participants: [...session.participants, { ...participant, status: 'active' }] }
        return session
      }),
    } as unknown as RecordingActions
    registerWebMCP(actions, recording, vi.fn())

    const joinTool = tools.find((tool) => tool.name === 'canvas_join_session')!
    const joined = await joinTool.execute({ muralId: 'mural-1', agentId: 'agent-risky', agentName: 'Risky' }) as { structuredContent: { agentToken: string } }
    session = { ...session, participants: session.participants.map((participant) => ({ ...participant, status: 'muted' })) }
    const addTool = tools.find((tool) => tool.name === 'canvas_add_element')!
    expect((addTool.inputSchema?.required as string[])).toEqual(expect.arrayContaining(['muralId', 'agentId', 'agentToken']))
    await expect(addTool.execute({ muralId: 'mural-1', agentId: 'agent-risky', agentToken: joined.structuredContent.agentToken, title: 'Unsafe idea' })).rejects.toThrow('已被讨论主持人静音')
    await expect(addTool.execute({ muralId: 'mural-1', agentId: 'agent-risky', agentToken: 'spoofed', title: 'Unsafe idea' })).rejects.toThrow('智能体权限无效')
    expect(addElement).not.toHaveBeenCalled()
  })

  it('recommends intervention only when a configured review trigger matches', async () => {
    const tools: CapturedTool[] = []
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: { registerTool: (tool: CapturedTool) => tools.push(tool) },
    })
    const oldTime = new Date(Date.now() - 30_000).toISOString()
    let session = {
      id: 'session', specVersion: '1.0', title: 'Review', status: 'recording', startedAt: oldTime,
      boardId: 'mural-1', moderatorId: 'agent-watcher',
      participants: [] as Array<{ id: string; name: string; role: 'agent'; status: 'active'; leaseExpiresAt?: string }>,
      events: [
        { id: 'created', createdAt: oldTime, participantId: 'agent-watcher', participantName: 'Watcher', participantRole: 'agent', kind: 'board_action', content: 'Created element', relatedElementIds: ['element-1'], metadata: { authored: true } },
        { id: 'comment', createdAt: oldTime, participantId: 'human', participantName: 'You', participantRole: 'human', kind: 'note', content: 'Please revise this', relatedElementIds: ['element-1'] },
      ],
    }
    const actions = {
      getSnapshot: vi.fn(() => ({ id: 'mural-1', name: 'Test', nodes: [{ id: 'element-1' }], edges: [], createdAt: oldTime, updatedAt: oldTime })),
    } as unknown as BoardActions
    const recording = {
      getRecording: vi.fn(() => session),
      watchParticipant: vi.fn(() => session),
      joinParticipant: vi.fn((participant) => {
        session = { ...session, participants: [{ ...participant, role: 'agent', status: 'active' }] }
        return session
      }),
    } as unknown as RecordingActions
    registerWebMCP(actions, recording, vi.fn())

    const joinTool = tools.find((tool) => tool.name === 'canvas_join_session')!
    const joined = await joinTool.execute({ muralId: 'mural-1', agentId: 'agent-watcher', agentName: 'Watcher' }) as { structuredContent: { agentToken: string } }
    const watchTool = tools.find((tool) => tool.name === 'canvas_watch_mural')!
    const output = await watchTool.execute({
      muralId: 'mural-1', agentId: 'agent-watcher', agentToken: joined.structuredContent.agentToken, afterEventId: 'created',
      triggers: ['authored_element_commented'], quietPeriodSeconds: 0, cooldownSeconds: 0,
    }) as { structuredContent: { shouldRespond: boolean; reviewReason: string; matchedChanges: unknown[] } }
    expect(output.structuredContent.shouldRespond).toBe(true)
    expect(output.structuredContent.reviewReason).toBe('trigger_matched')
    expect(output.structuredContent.matchedChanges).toHaveLength(1)
  })

  it('keeps a matching cursor pending until quiet time allows a response', async () => {
    const tools: CapturedTool[] = []
    Object.defineProperty(document, 'modelContext', { configurable: true, value: { registerTool: (tool: CapturedTool) => tools.push(tool) } })
    const now = new Date().toISOString()
    let session = {
      id: 'session-quiet', specVersion: '1.0', title: 'Quiet review', status: 'recording', startedAt: now,
      boardId: 'mural-1', moderatorId: 'human', participants: [] as Array<{ id: string; name: string; role: 'agent'; status: 'active' }>,
      events: [
        { id: 'cursor', createdAt: now, participantId: 'human', participantName: 'You', participantRole: 'human', kind: 'result', content: 'Ready' },
        { id: 'question', createdAt: now, participantId: 'human', participantName: 'You', participantRole: 'human', kind: 'question', content: 'Can someone review?' },
      ],
    }
    const actions = { getSnapshot: vi.fn(() => ({ id: 'mural-1', nodes: [], edges: [], updatedAt: now })) } as unknown as BoardActions
    const recording = {
      getRecording: vi.fn(() => session), watchParticipant: vi.fn(() => session),
      joinParticipant: vi.fn((participant) => {
        session = { ...session, participants: [{ ...participant, role: 'agent', status: 'active' }] }
        return session
      }),
    } as unknown as RecordingActions
    registerWebMCP(actions, recording, vi.fn())
    const joined = await tools.find((tool) => tool.name === 'canvas_join_session')!.execute({ muralId: 'mural-1', agentId: 'reviewer', agentName: 'Reviewer' }) as { structuredContent: { agentToken: string } }
    const output = await tools.find((tool) => tool.name === 'canvas_watch_mural')!.execute({
      muralId: 'mural-1', agentId: 'reviewer', agentToken: joined.structuredContent.agentToken,
      afterEventId: 'cursor', triggers: ['decision_needed'], quietPeriodSeconds: 60, cooldownSeconds: 0,
    }) as { structuredContent: { shouldRespond: boolean; cursor: string } }
    expect(output.structuredContent.shouldRespond).toBe(false)
    expect(output.structuredContent.cursor).toBe('cursor')
  })

  it('keeps a matching cursor pending while the agent is cooling down', async () => {
    const tools: CapturedTool[] = []
    Object.defineProperty(document, 'modelContext', { configurable: true, value: { registerTool: (tool: CapturedTool) => tools.push(tool) } })
    const now = new Date().toISOString()
    const oldTime = new Date(Date.now() - 30_000).toISOString()
    let session = {
      id: 'session-cooldown', specVersion: '1.0', title: 'Cooldown review', status: 'recording', startedAt: oldTime,
      boardId: 'mural-1', moderatorId: 'human', participants: [] as Array<{ id: string; name: string; role: 'agent'; status: 'active' }>,
      events: [
        { id: 'cursor', createdAt: oldTime, participantId: 'human', participantName: 'You', participantRole: 'human', kind: 'result', content: 'Ready' },
        { id: 'own-reply', createdAt: now, participantId: 'reviewer', participantName: 'Reviewer', participantRole: 'agent', kind: 'proposal', content: 'My first response' },
        { id: 'question', createdAt: now, participantId: 'human', participantName: 'You', participantRole: 'human', kind: 'question', content: 'Can you follow up?' },
      ],
    }
    const actions = { getSnapshot: vi.fn(() => ({ id: 'mural-1', nodes: [], edges: [], updatedAt: now })) } as unknown as BoardActions
    const recording = {
      getRecording: vi.fn(() => session), watchParticipant: vi.fn(() => session),
      joinParticipant: vi.fn((participant) => {
        session = { ...session, participants: [{ ...participant, role: 'agent', status: 'active' }] }
        return session
      }),
    } as unknown as RecordingActions
    registerWebMCP(actions, recording, vi.fn())
    const joined = await tools.find((tool) => tool.name === 'canvas_join_session')!.execute({ muralId: 'mural-1', agentId: 'reviewer', agentName: 'Reviewer' }) as { structuredContent: { agentToken: string } }
    const output = await tools.find((tool) => tool.name === 'canvas_watch_mural')!.execute({
      muralId: 'mural-1', agentId: 'reviewer', agentToken: joined.structuredContent.agentToken,
      afterEventId: 'cursor', triggers: ['decision_needed'], quietPeriodSeconds: 0, cooldownSeconds: 60,
    }) as { structuredContent: { shouldRespond: boolean; reviewReason: string; cursor: string } }
    expect(output.structuredContent.shouldRespond).toBe(false)
    expect(output.structuredContent.reviewReason).toBe('cooldown')
    expect(output.structuredContent.cursor).toBe('cursor')
  })

  it('keeps read-only tools silent while preserving local focus behavior', async () => {
    const tools: CapturedTool[] = []
    Object.defineProperty(document, 'modelContext', { configurable: true, value: { registerTool: (tool: CapturedTool) => tools.push(tool) } })
    const board = {
      id: 'mural-1', name: 'Test', nodes: [{ id: 'artifact-1', data: { title: 'Table' } }], edges: [], createdAt: 'now', updatedAt: 'now',
    }
    const artifact = {
      specVersion: '1.0', artifactType: 'table', title: 'Table', fields: [], records: [], presentation: { layout: 'table' },
    }
    const actions = {
      getSnapshot: vi.fn(() => board),
      getArtifactSpec: vi.fn(() => artifact),
      focusElements: vi.fn(),
    } as unknown as BoardActions
    const recording = { getRecording: vi.fn(() => null) } as unknown as RecordingActions
    const report = vi.fn()
    registerWebMCP(actions, recording, report)

    await tools.find((tool) => tool.name === 'canvas_get_board')!.execute({})
    await tools.find((tool) => tool.name === 'canvas_get_artifact_spec')!.execute({ id: 'artifact-1' })
    await tools.find((tool) => tool.name === 'canvas_focus_elements')!.execute({ ids: ['artifact-1'] })

    expect(actions.focusElements).toHaveBeenCalledWith(['artifact-1'])
    expect(report).not.toHaveBeenCalled()
  })

  it('records one canonical board action for a protected write', async () => {
    const tools: CapturedTool[] = []
    Object.defineProperty(document, 'modelContext', { configurable: true, value: { registerTool: (tool: CapturedTool) => tools.push(tool) } })
    const node = { id: 'element-1', data: { title: 'One idea' } }
    let session = {
      id: 'session-write', specVersion: '1.0', title: 'Write', status: 'recording', startedAt: 'now',
      boardId: 'mural-1', moderatorId: 'human', participants: [] as Array<{ id: string; name: string; role: 'agent'; status: 'active' }>, events: [],
    }
    const actions = {
      getSnapshot: vi.fn(() => ({ id: 'mural-1', nodes: [node], edges: [], updatedAt: 'now' })),
      addElement: vi.fn(() => node),
    } as unknown as BoardActions
    const recordContribution = vi.fn(() => ({ id: 'event-1', participantId: 'writer', kind: 'board_action' }))
    const recording = {
      getRecording: vi.fn(() => session), recordContribution,
      joinParticipant: vi.fn((participant) => {
        session = { ...session, participants: [{ ...participant, role: 'agent', status: 'active' }] }
        return session
      }),
    } as unknown as RecordingActions
    const report = vi.fn()
    registerWebMCP(actions, recording, report)
    const joined = await tools.find((tool) => tool.name === 'canvas_join_session')!.execute({ muralId: 'mural-1', agentId: 'writer', agentName: 'Writer' }) as { structuredContent: { agentToken: string } }

    const output = await tools.find((tool) => tool.name === 'canvas_add_element')!.execute({
      muralId: 'mural-1', agentId: 'writer', agentToken: joined.structuredContent.agentToken, title: 'One idea',
    }) as { structuredContent: { element: { id: string } } }

    expect(output.structuredContent.element.id).toBe('element-1')
    expect(recordContribution).toHaveBeenCalledTimes(1)
    expect(recordContribution).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'writer', kind: 'board_action', relatedElementIds: ['element-1'], metadata: { tool: 'canvas_add_element', authored: true },
    }))
    expect(report).not.toHaveBeenCalled()
  })

  it('uses edit focus to block a conflicting agent write', async () => {
    const tools: CapturedTool[] = []
    Object.defineProperty(document, 'modelContext', { configurable: true, value: { registerTool: (tool: CapturedTool) => tools.push(tool) } })
    const node = { id: 'element-1', data: { title: 'Shared idea' } }
    let session = {
      id: 'session-focus', specVersion: '1.0', title: 'Focus', status: 'recording', startedAt: 'now',
      boardId: 'mural-1', moderatorId: 'human', participants: [] as Array<{ id: string; name: string; role: 'agent'; status: 'active'; color?: 'coral' | 'blue' }>, events: [],
    }
    let claims: Array<{ participantId: string; participantName: string; state: 'editing'; intent: string; elementIds: string[]; claimedAt: string; leaseExpiresAt: string; releaseOnAction: 'manual' }> = []
    const actions = {
      getSnapshot: vi.fn(() => ({ id: 'mural-1', nodes: [node], edges: [], updatedAt: 'now' })),
      getAgentFocus: vi.fn(() => claims),
      setAgentFocus: vi.fn(async (participant, focus) => {
        claims = focus ? [{ ...focus, participantId: participant.id, participantName: participant.name }] : []
        return claims
      }),
      assertAgentWritable: vi.fn(async (participantId, ids) => {
        const conflict = claims.find((claim) => claim.participantId !== participantId && claim.elementIds.some((id) => ids.includes(id)))
        if (conflict) throw new Error(`${conflict.participantName} is editing this element.`)
      }),
      updateElement: vi.fn(() => node),
    } as unknown as BoardActions
    const recording = {
      getRecording: vi.fn(() => session),
      recordContribution: vi.fn(),
      joinParticipant: vi.fn((participant) => {
        session = { ...session, participants: [...session.participants, { ...participant, role: 'agent', status: 'active' }] }
        return session
      }),
    } as unknown as RecordingActions
    registerWebMCP(actions, recording, vi.fn())
    const join = tools.find((tool) => tool.name === 'canvas_join_session')!
    const first = await join.execute({ muralId: 'mural-1', agentId: 'one', agentName: 'Architect' }) as { structuredContent: { agentToken: string } }
    const second = await join.execute({ muralId: 'mural-1', agentId: 'two', agentName: 'Critic' }) as { structuredContent: { agentToken: string } }
    await tools.find((tool) => tool.name === 'canvas_set_focus')!.execute({
      muralId: 'mural-1', agentId: 'one', agentToken: first.structuredContent.agentToken,
      state: 'editing', elementIds: ['element-1'], intent: 'Rewrite copy', releaseOnAction: 'manual',
    })
    await expect(tools.find((tool) => tool.name === 'canvas_update_element')!.execute({
      muralId: 'mural-1', agentId: 'two', agentToken: second.structuredContent.agentToken, id: 'element-1', title: 'Collision',
    })).rejects.toThrow('Architect is editing')
    expect(actions.updateElement).not.toHaveBeenCalled()
  })

  it('allows only the moderator to create a replay checkpoint', async () => {
    const tools: CapturedTool[] = []
    Object.defineProperty(document, 'modelContext', { configurable: true, value: { registerTool: (tool: CapturedTool) => tools.push(tool) } })
    const board = { id: 'mural-1', name: 'Replay', nodes: [], edges: [], updatedAt: 'now' }
    let session = {
      id: 'session-checkpoint', specVersion: '1.0', title: 'Replay', status: 'recording', startedAt: 'now',
      boardId: 'mural-1', moderatorId: 'orchestrator', participants: [] as Array<{ id: string; name: string; role: 'agent'; status: 'active' }>, events: [],
    }
    const checkpoint = { id: 'checkpoint-1', kind: 'checkpoint', checkpoint: { label: 'Synthesis', board } }
    const actions = { getSnapshot: vi.fn(() => board), getAgentFocus: vi.fn(() => []) } as unknown as BoardActions
    const recording = {
      getRecording: vi.fn(() => session), createCheckpoint: vi.fn(() => checkpoint),
      joinParticipant: vi.fn((participant) => {
        session = { ...session, participants: [...session.participants, { ...participant, role: 'agent', status: 'active' }] }
        return session
      }),
    } as unknown as RecordingActions
    registerWebMCP(actions, recording, vi.fn())
    const joined = await tools.find((tool) => tool.name === 'canvas_join_session')!.execute({ muralId: 'mural-1', agentId: 'orchestrator', agentName: 'Orchestrator' }) as { structuredContent: { agentToken: string } }
    const output = await tools.find((tool) => tool.name === 'canvas_add_checkpoint')!.execute({
      muralId: 'mural-1', agentId: 'orchestrator', agentToken: joined.structuredContent.agentToken, label: 'Synthesis',
    }) as { structuredContent: { eventId: string } }
    expect(output.structuredContent.eventId).toBe('checkpoint-1')
    expect(recording.createCheckpoint).toHaveBeenCalledWith('Synthesis', board, expect.objectContaining({ id: 'orchestrator' }))
  })
})
