// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BoardSnapshot, BrainstormSession } from '../types'
import * as storage from './brainstorm-storage'
import { loadBoardById } from './storage'

export const sessionFixture: BrainstormSession = {
  id: 'discussion-a', boardId: '84571348-85fd-4d40-8b9e-fac16fac2ecf', topic: '测试主题', goal: '测试目标', background: '', constraints: '',
  stage: 'output', aiPaused: true, currentMemberId: 'member-a',
  members: [{ id: 'member-a', name: '测试成员', role: 'facilitator', joinedAt: '2026-10-10T10:00:00.000Z' }],
  suggestions: [], proposals: [{ id: 'proposal-a', title: '测试方案', description: '', sourceIdeaIds: ['idea-a'], authorId: 'member-a', integrationLogic: '', risks: ['测试风险'], openQuestions: [], status: 'accepted', comments: [{ id: 'comment-a', authorId: 'member-a', kind: 'support', content: '测试意见', createdAt: '2026-10-10T10:00:00.000Z' }] }],
  decision: { criteria: [{ id: 'criterion-a', name: '测试标准', weight: 1 }], scores: [{ proposalId: 'proposal-a', criterionId: 'criterion-a', memberId: 'member-a', score: 4, reason: '测试理由' }], votes: [{ proposalId: 'proposal-a', memberId: 'member-a' }], finalProposalId: 'proposal-a', confirmedBy: 'member-a', confirmedAt: '2026-10-10T10:00:00.000Z' },
  outcome: { draft: '测试成果', finalProposalId: 'proposal-a', actions: [{ title: '测试行动', ownerId: 'member-a', dueAt: '2026-10-20' }], updatedAt: '2026-10-10T10:00:00.000Z' },
  createdAt: '2026-10-10T10:00:00.000Z', updatedAt: '2026-10-10T10:00:00.000Z',
}
export const boardFixture: BoardSnapshot = {
  id: sessionFixture.boardId, name: '测试白板', createdAt: sessionFixture.createdAt, updatedAt: sessionFixture.updatedAt,
  nodes: ['idea-a', 'proposal-a'].map((id) => ({ id, type: 'boardElement', position: { x: 0, y: 0 }, data: { title: '', body: '', kind: 'idea', color: 'paper', votes: 0, ideaMeta: { sessionId: sessionFixture.id, authorId: 'member-a', type: id === 'idea-a' ? 'evidence' : 'proposal', sourceIdeaIds: [], createdAt: sessionFixture.createdAt, versions: [{ authorId: 'member-a', createdAt: sessionFixture.createdAt }] } } })), edges: [],
}

describe('讨论持久化', () => {
  beforeEach(() => localStorage.clear())
  it('将完整讨论和白板一起保存，重新打开可恢复全部字段', () => {
    storage.saveBrainstormBoard(boardFixture, sessionFixture)
    const board = loadBoardById(boardFixture.id)!
    expect(storage.loadBrainstorm(board)).toEqual(sessionFixture)
    expect(board.nodes[0].data.ideaMeta?.type).toBe('evidence')
    expect(board.nodes[0].data.ideaMeta?.versions).toHaveLength(1)
    expect(JSON.parse(localStorage.getItem(`canvas-relay-board-v2:${board.id}`)!).brainstormSessionId).toBe('discussion-a')
  })
  it('没有讨论的白板恢复为空，不使用另一个白板的讨论', () => {
    storage.saveBrainstormBoard(boardFixture, sessionFixture)
    const other = { ...boardFixture, id: '24aacdaa-53ec-4d20-b0ea-835dbb7c5f6c', nodes: [] }
    storage.saveBrainstormBoard(other, null)
    expect(storage.loadBrainstorm(loadBoardById(other.id)!)).toBeNull()
    expect(storage.loadBrainstorm(loadBoardById(boardFixture.id)!)).toEqual(sessionFixture)
  })
  it('保留旧补充类型、建议确认前快照和编辑中的空文本', () => {
    const board = structuredClone(boardFixture)
    board.nodes[0].data.ideaMeta!.type = 'supplement'
    const session: BrainstormSession = { ...structuredClone(sessionFixture), proposals: [{ ...sessionFixture.proposals[0], risks: [''] }], suggestions: [{ id: 'suggestion-a', trigger: 'manual', message: '测试建议', actions: [{ type: 'create_summary', title: '测试标题', draft: '测试草稿' }], status: 'accepted', ignoredActionTypes: ['ask_question'], pausedForStage: true, boardBeforeAccept: board, createdAt: sessionFixture.createdAt }] }
    storage.saveBrainstormBoard(board, session)
    expect(storage.loadBrainstorm(loadBoardById(board.id)!)).toEqual(session)
  })
  it.each([
    { ...sessionFixture, stage: 'invalid' },
    { ...sessionFixture, goal: undefined },
    { ...sessionFixture, aiPaused: 'yes' },
    { ...sessionFixture, boardId: 'another-board' },
    { ...sessionFixture, members: [{}] },
    { ...sessionFixture, currentMemberId: 'missing-member' },
    { ...sessionFixture, proposals: [{ ...sessionFixture.proposals[0], status: 'invalid' }] },
    { ...sessionFixture, outcome: { ...sessionFixture.outcome, actions: [{}] } },
    { ...sessionFixture, suggestions: [{ id: 'suggestion-a', trigger: 'manual', message: '', actions: [{ type: 'invalid' }], status: 'pending', ignoredActionTypes: [], pausedForStage: false, createdAt: sessionFixture.createdAt }] },
  ])('严格拒绝缺失字段、错误类型和跨白板讨论 %#', (session) => {
    expect(() => storage.validateBrainstormPayload({ session, board: boardFixture })).toThrow()
  })
  it('拒绝不匹配的讨论 ID 和非法观点元数据', () => {
    expect(() => storage.validateBrainstormPayload({ session: sessionFixture, board: boardFixture }, 'other-id')).toThrow()
    const board = structuredClone(boardFixture)
    board.nodes[0].data.ideaMeta!.type = 'invalid' as never
    expect(() => storage.validateBrainstormPayload({ session: sessionFixture, board })).toThrow()
  })
  it('不补全损坏的本地讨论，也不吞掉本地写入失败', () => {
    expect(() => storage.loadBrainstorm({ ...boardFixture, brainstormSessionId: 'discussion-a', brainstormSession: { id: 'discussion-a' } } as BoardSnapshot)).toThrow()
    expect(() => storage.deserializeBrainstorm('{broken')).toThrow()
    const failure = vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => { throw new Error('storage full') })
    try { expect(() => storage.saveBrainstormBoard(boardFixture, sessionFixture)).toThrow('storage full') } finally { failure.mockRestore() }
  })
})
