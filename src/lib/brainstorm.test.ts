import { describe, expect, it } from 'vitest'
import { INITIAL_SNAPSHOT } from '../data'
import { createBrainstormSession, createIdeaMeta, removeDiscussionReferences, setBrainstormStage, setSuggestionStatus, updateIdeaMeta } from './brainstorm'
import { createBoardNode } from './board'

describe('空白讨论', () => {
  it('首次白板没有演示内容', () => {
    expect(INITIAL_SNAPSHOT.nodes).toEqual([])
    expect(INITIAL_SNAPSHOT.edges).toEqual([])
  })

  it('接受任意主题并建立只有主持人的空讨论', () => {
    const session = createBrainstormSession({ id: 's1', boardId: 'b1', topic: '社区花园', goal: '确定第一步', background: '居民共同维护', constraints: '预算有限', memberId: 'm1', memberName: '小林', createdAt: '2026-10-10T00:00:00.000Z' })
    expect(session).toMatchObject({ id: 's1', boardId: 'b1', topic: '社区花园', goal: '确定第一步', background: '居民共同维护', constraints: '预算有限', stage: 'collecting', currentMemberId: 'm1' })
    expect(session.members).toEqual([{ id: 'm1', name: '小林', role: 'facilitator', joinedAt: '2026-10-10T00:00:00.000Z' }])
    expect(session.suggestions).toEqual([])
    expect(session.proposals).toEqual([])
    expect(JSON.parse(JSON.stringify(session))).toEqual(session)
  })

  it('阶段可直接跳转和返回，不改变原讨论', () => {
    const session = createBrainstormSession({ id: 's1', boardId: 'b1', topic: '主题', goal: '目标', memberId: 'm1', memberName: '小林', createdAt: '2026-10-10T00:00:00.000Z' })
    const output = setBrainstormStage(session, 'output', '2026-10-10T01:00:00.000Z')
    expect(output.stage).toBe('output')
    expect(session.stage).toBe('collecting')
    expect(setBrainstormStage(output, 'organizing', '2026-10-10T02:00:00.000Z').stage).toBe('organizing')
    expect(() => setBrainstormStage(session, 'unknown' as never, '2026-10-10T01:00:00.000Z')).toThrow()
  })

  it('观点元数据保留来源和版本记录', () => {
    const idea = createIdeaMeta({ sessionId: 's1', authorId: 'm1', type: 'risk', sourceIdeaIds: ['i0'], createdAt: '2026-10-10T00:00:00.000Z' })
    const revised = updateIdeaMeta(idea, 'm2', '2026-10-10T01:00:00.000Z')
    expect(revised).toMatchObject({ sessionId: 's1', authorId: 'm1', type: 'risk', sourceIdeaIds: ['i0'], versions: [{ authorId: 'm2', createdAt: '2026-10-10T01:00:00.000Z' }] })
    expect(idea.versions).toEqual([])
  })

  it('删除观点同时清理方案和全部卡片来源，删除最终方案清空成果选择', () => {
    const session = createBrainstormSession({ id: 's1', boardId: 'b1', topic: '主题', goal: '目标', memberId: 'm1', memberName: '小林', createdAt: '2026-10-10T00:00:00.000Z' })
    const source = { ...createBoardNode({ title: '原观点' }), id: 'source' }
    const card = { ...createBoardNode({ title: '方案' }), id: 'proposal', data: { ...createBoardNode({ title: '方案' }).data, ideaMeta: createIdeaMeta({ sessionId: 's1', authorId: 'm1', type: 'proposal', sourceIdeaIds: ['source', 'other'], createdAt: session.createdAt }) } }
    const proposal = { id: 'proposal', title: '方案', description: '', sourceIdeaIds: ['source', 'other'], authorId: 'm1', integrationLogic: '', risks: [], openQuestions: [], status: 'accepted' as const, comments: [] }
    const discussion = { ...session, proposals: [proposal], decision: { criteria: [], scores: [], votes: [], finalProposalId: 'proposal', confirmedBy: 'm1', confirmedAt: session.createdAt }, outcome: { draft: '草稿', finalProposalId: 'proposal', actions: [], updatedAt: session.createdAt } }
    const removedSource = removeDiscussionReferences(discussion, [source, card], new Set(['source']))
    expect(removedSource.session!.proposals[0].sourceIdeaIds).toEqual(['other'])
    expect(removedSource.nodes[0].data.ideaMeta!.sourceIdeaIds).toEqual(['other'])
    expect(discussion.proposals[0].sourceIdeaIds).toEqual(['source', 'other'])
    const removedProposal = removeDiscussionReferences(discussion, [source, card], new Set(['proposal']))
    expect(removedProposal.session!.proposals).toEqual([])
    expect(removedProposal.session!.outcome!.finalProposalId).toBeUndefined()
    expect(removedProposal.session!.decision!.finalProposalId).toBeUndefined()
  })

  it('建议可忽略、暂停或接受，并保留撤销快照', () => {
    const session = createBrainstormSession({ id: 's1', boardId: 'b1', topic: '主题', goal: '目标', memberId: 'm1', memberName: '小林', createdAt: '2026-10-10T00:00:00.000Z' })
    const suggestion = { id: 'a1', trigger: 'manual' as const, message: '归类', actions: [], status: 'pending' as const, ignoredActionTypes: [], pausedForStage: false, createdAt: '2026-10-10T00:00:00.000Z' }
    const withSuggestion = { ...session, suggestions: [suggestion] }
    const ignored = setSuggestionStatus(withSuggestion, 'a1', 'ignored', { ignoredActionTypes: ['create_cluster'], pausedForStage: true })
    expect(ignored.suggestions[0]).toMatchObject({ status: 'ignored', ignoredActionTypes: ['create_cluster'], pausedForStage: true })
    const accepted = setSuggestionStatus(withSuggestion, 'a1', 'accepted', { boardBeforeAccept: INITIAL_SNAPSHOT })
    expect(accepted.suggestions[0].boardBeforeAccept).toEqual(INITIAL_SNAPSHOT)
    expect(withSuggestion.suggestions[0].status).toBe('pending')
    expect(() => setSuggestionStatus(session, 'missing', 'accepted')).toThrow()
  })
})
