import { describe, expect, it } from 'vitest'
import type { AgentSuggestion, BoardActions, BoardSnapshot } from '../types'
import { createBrainstormSession, createIdeaMeta, setBrainstormStage } from './brainstorm'
import { createBoardNode, createBoardEdge } from './board'
import * as agent from './brainstorm-actions'
import { validateBrainstormPayload } from './brainstorm-validation'

const time = '2026-10-10T00:00:00.000Z'
function fixture() {
  const session = createBrainstormSession({ id: 's', boardId: 'b', topic: '社区', goal: '行动', memberId: 'm', memberName: '林', createdAt: time })
  const board: BoardSnapshot = { id: 'b', name: '社区', brainstormSessionId: 's', createdAt: time, updatedAt: time, edges: [], nodes: ['a', 'b'].map((id) => ({ ...createBoardNode({ title: id }), id, data: { ...createBoardNode({ title: id }).data, ideaMeta: createIdeaMeta({ sessionId: 's', authorId: 'm', type: 'idea', createdAt: time }) } })) }
  return { board, session }
}
const actions = [
  { type: 'create_cluster', label: '分类', ideaIds: ['a', 'b'] },
  { type: 'connect_ideas', fromId: 'a', toId: 'b', label: '互补' },
  { type: 'ask_question', question: '谁负责？' },
  { type: 'suggest_merge', ideaIds: ['a', 'b'], title: '组合', content: '组合内容', logic: '组合理由', risks: ['风险'], openQuestions: ['待确认'] },
  { type: 'create_matrix', title: '比较', criteria: ['成本'] },
  { type: 'create_summary', summary: '草稿内容' },
] as AgentSuggestion['actions']

// 使用真实节点构造器，在测试边界提供动作实现，不引入生产假内容。
function layer(board: BoardSnapshot) {
  const calls: string[] = []
  const api = {
    getSnapshot: () => structuredClone(board),
    addElement: (input: Parameters<BoardActions['addElement']>[0]) => { calls.push('add'); const node = createBoardNode(input); board.nodes.push(node); return node },
    updateElement: (id: string, patch: Partial<BoardSnapshot['nodes'][number]['data']>) => { calls.push('update'); const node = board.nodes.find((item) => item.id === id)!; node.data = { ...node.data, ...patch }; return node },
    createCluster: (label: string, ids: string[]) => { calls.push('cluster'); const node = createBoardNode({ title: label, kind: 'frame' }); board.nodes.push(node); board.nodes.forEach((item) => { if (ids.includes(item.id)) item.data.cluster = label }); return node },
    connectElements: (a: string, b: string, label: string) => { calls.push('connect'); const edge = createBoardEdge(a, b, label); board.edges.push(edge); return edge },
    createArtifact: (spec: Parameters<BoardActions['createArtifact']>[0]) => { calls.push('artifact'); const node = createBoardNode({ title: spec.title, kind: 'artifact' }); node.data.artifact = spec; board.nodes.push(node); return node },
  } as BoardActions
  return { api, calls }
}

describe('AI 建议确认', () => {
  it('真实回复只进入待确认列表，不改画布或阶段', () => {
    const { board, session } = fixture(); const before = structuredClone(board)
    const next = agent.receiveSuggestion(session, board, { message: '可以分类', actions: [actions[0]] }, 'similar_ideas', ['a', 'b'])
    expect(board).toEqual(before)
    expect(next.stage).toBe('collecting')
    expect(next.suggestions[0]).toMatchObject({ status: 'pending', trigger: 'similar_ideas', selectedIdeaIds: ['a', 'b'] })
  })
  it.each(actions)('接受 $type 仅通过允许动作执行，并保留来源和完整快照', (action) => {
    const { board, session } = fixture(); const before = structuredClone(board); const { api, calls } = layer(board)
    const pending = agent.receiveSuggestion(session, board, { message: '真实回复', actions: [action] }, 'complementary_ideas', ['a', 'b'])
    const accepted = agent.acceptSuggestion(pending, pending.suggestions[0].id, api)
    expect(accepted.stage).toBe('collecting'); expect(accepted.decision?.finalProposalId).toBeUndefined()
    expect(board.nodes.filter((node) => ['a', 'b'].includes(node.id))).toHaveLength(2)
    expect(accepted.suggestions[0].boardBeforeAccept).toEqual(before)
    expect(accepted.suggestions[0].sessionBeforeAccept?.topic).toBe('社区')
    expect(accepted.suggestions[0].status).toBe('accepted')
    if (action.type === 'create_cluster') expect(calls).toEqual(['cluster'])
    if (action.type === 'connect_ideas') { expect(calls).toEqual(['connect']); expect(board.edges[0]).toMatchObject({ source: 'a', target: 'b', label: '互补' }) }
    if (action.type === 'ask_question') expect(board.nodes[2].data).toMatchObject({ kind: 'question', title: '谁负责？', ideaMeta: { sourceIdeaIds: ['a', 'b'] } })
    if (action.type === 'suggest_merge') expect(accepted.proposals[0]).toMatchObject({ status: 'draft', sourceIdeaIds: ['a', 'b'], integrationLogic: '组合理由', risks: ['风险'], openQuestions: ['待确认'] })
    if (action.type === 'create_matrix') { expect(board.nodes[2].data.artifact?.records).toEqual([]); expect(board.nodes[2].data.artifact?.fields[0].label).toBe('成本') }
    if (action.type === 'create_summary') expect(accepted.outcome).toMatchObject({ draft: '草稿内容', actions: [] })
    expect(() => validateBrainstormPayload({ board, session: accepted })).not.toThrow()
  })
  it('预先校验全部动作，禁止部分执行及过期或跨板确认', () => {
    const { board, session } = fixture(); const { api, calls } = layer(board)
    const pending = agent.receiveSuggestion(session, board, { message: '回复', actions: [actions[0], actions[1]] }, 'similar_ideas', ['a', 'b'])
    board.nodes[0].data.body = '刚修改'
    expect(() => agent.acceptSuggestion(pending, pending.suggestions[0].id, api)).toThrow('已变化')
    expect(calls).toEqual([])
    board.id = 'other'
    expect(() => agent.acceptSuggestion(pending, pending.suggestions[0].id, api)).toThrow()
  })
  it('忽略动作类型后，同阶段包含该动作的新建议不再显示，下一阶段可显示', () => {
    const { board, session } = fixture()
    const pending = agent.receiveSuggestion(session, board, { message: '分类', actions: [actions[0]] }, 'similar_ideas', ['a', 'b'])
    const ignored = agent.ignoreSuggestion(pending, pending.suggestions[0].id)
    const repeated = agent.receiveSuggestion(ignored, board, { message: '再次分类', actions: [actions[0], actions[2]] }, 'similar_ideas', ['a', 'b'])
    expect(agent.visibleSuggestions(repeated)).toEqual([])
    const nextStage = agent.receiveSuggestion({ ...ignored, stage: 'organizing' }, board, { message: '分类', actions: [actions[0]] }, 'similar_ideas', ['a', 'b'])
    expect(agent.visibleSuggestions(nextStage)).toHaveLength(1)
    expect(() => validateBrainstormPayload({ board, session: repeated })).not.toThrow()
  })
  it('暂停只影响当前阶段，稍后处理仍可重新打开', () => {
    const { board, session } = fixture()
    const pending = agent.receiveSuggestion(session, board, { message: '回复', actions: [actions[2]] }, 'quiet_period', [])
    const paused = agent.pauseStage(pending, true)
    expect(agent.isStagePaused(paused)).toBe(true)
    expect(agent.isStagePaused({ ...paused, stage: 'organizing' })).toBe(false)
    const changed = setBrainstormStage(paused, 'organizing', time)
    expect(changed.aiPaused).toBe(false)
    expect(setBrainstormStage(changed, 'collecting', time).aiPaused).toBe(true)
    expect(agent.visibleSuggestions(paused)).toEqual([])
    expect(() => validateBrainstormPayload({ board, session: paused })).not.toThrow()
    expect(agent.visibleSuggestions({ ...pending, suggestions: [{ ...pending.suggestions[0], status: 'deferred' }] })[0].status).toBe('deferred')
  })
  it('撤销恢复接受前内容，保留后来无关观点及其历史；重叠修改明确拒绝', () => {
    const { board, session } = fixture(); const { api } = layer(board)
    const pending = agent.receiveSuggestion(session, board, { message: '回复', actions: [actions[0], actions[3], actions[5]] }, 'complementary_ideas', ['a', 'b'])
    const accepted = agent.acceptSuggestion(pending, pending.suggestions[0].id, api)
    const independent = createBoardNode({ title: '后续人工观点' }); board.nodes.push(independent)
    const restored = agent.undoSuggestion(accepted, board, accepted.suggestions[0].id)
    expect(restored.board.nodes.map((node) => node.id)).toEqual(['a', 'b', independent.id])
    expect(restored.board.nodes[0].data.cluster).toBeUndefined()
    expect(restored.session.proposals).toEqual([]); expect(restored.session.outcome).toBeNull()
    expect(restored.session.suggestions[0].status).toBe('undone')
    board.nodes.find((node) => node.data.kind === 'frame')!.data.title = '后改分类'
    expect(() => agent.undoSuggestion(accepted, board, accepted.suggestions[0].id)).toThrow('修改')
  })
  it('持久化严格拒绝坏暂停阶段、坏上下文与坏接受快照', () => {
    const { board, session } = fixture()
    const pending = agent.receiveSuggestion(session, board, { message: '回复', actions: [actions[2]] }, 'quiet_period', [])
    expect(() => validateBrainstormPayload({ board, session: { ...pending, pausedStages: ['bad'] } })).toThrow()
    expect(() => validateBrainstormPayload({ board, session: { ...pending, suggestions: [{ ...pending.suggestions[0], context: 3 }] } })).toThrow()
    expect(() => validateBrainstormPayload({ board, session: { ...pending, suggestions: [{ ...pending.suggestions[0], sessionBeforeAccept: { id: 'other' } }] } })).toThrow()
  })
  it('来源删除后的待确认建议仍可保存，但不能再执行', () => {
    const { board, session } = fixture(); const { api } = layer(board)
    const pending = agent.receiveSuggestion(session, board, { message: '回复', actions: [actions[0]] }, 'similar_ideas', ['a', 'b'])
    board.nodes = board.nodes.filter((node) => node.id !== 'a')
    expect(() => validateBrainstormPayload({ board, session: pending })).not.toThrow()
    expect(() => agent.acceptSuggestion(pending, pending.suggestions[0].id, api)).toThrow('已变化')
  })
  it('矩阵超出白板允许范围时，在整组动作开始前拒绝', () => {
    const { board, session } = fixture(); const { api, calls } = layer(board)
    const pending = agent.receiveSuggestion(session, board, { message: '回复', actions: [actions[0], { type: 'create_matrix', title: '矩阵', criteria: Array.from({ length: 13 }, (_, i) => `标准${i}`) }] }, 'similar_ideas', ['a', 'b'])
    expect(() => agent.acceptSuggestion(pending, pending.suggestions[0].id, api)).toThrow()
    expect(calls).toEqual([])
  })
  it('新建议的保存字段必须完整，快照中选择的观点必须真实存在', () => {
    const { board, session } = fixture(); const { api } = layer(board)
    const pending = agent.receiveSuggestion(session, board, { message: '回复', actions: [actions[2]] }, 'quiet_period', ['a'])
    const corrupt = (patch: Record<string, unknown>) => ({ board, session: { ...pending, suggestions: [{ ...pending.suggestions[0], ...patch }] } })
    expect(() => validateBrainstormPayload(corrupt({ stage: undefined }))).toThrow()
    expect(() => validateBrainstormPayload(corrupt({ selectedIdeaIds: ['missing'] }))).toThrow()
    expect(() => validateBrainstormPayload(corrupt({ boardAtRequest: { ...board, id: 'other' } }))).toThrow()
    const accepted = agent.acceptSuggestion(pending, pending.suggestions[0].id, api)
    expect(() => validateBrainstormPayload({ board, session: { ...accepted, suggestions: [{ ...accepted.suggestions[0], sessionAfterAccept: undefined }] } })).toThrow()
  })
  it('用户表格里碰巧与画布字段同名的数据变化仍会让建议过期', () => {
    const { board, session } = fixture(); const { api } = layer(board)
    const table = createBoardNode({ title: '数据', kind: 'artifact' })
    table.data.artifact = { specVersion: '1.0', artifactType: 'table', title: '数据', fields: [{ key: 'position', label: '位置', type: 'text' }, { key: 'data', label: '数据', type: 'text' }, { key: 'selected', label: '选择', type: 'text' }], records: [{ position: '位置', data: '数据', selected: '之前' }], presentation: { layout: 'table' } }
    board.nodes.push(table)
    const pending = agent.receiveSuggestion(session, board, { message: '回复', actions: [actions[2]] }, 'quiet_period', [])
    table.data.artifact.records[0].selected = '之后'
    expect(() => agent.acceptSuggestion(pending, pending.suggestions[0].id, api)).toThrow('已变化')
  })
})
