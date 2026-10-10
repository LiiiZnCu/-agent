import type { AgentSuggestion, ArtifactSpec, BoardActions, BoardEdge, BoardNode, BoardSnapshot, BrainstormSession, SuggestionReason } from '../types'
import { createId } from './board'
import { createIdeaMeta } from './brainstorm'
import { validateBrainstormAction } from './brainstorm-validation'
import { validateArtifactSpec } from './artifacts'

export function sessionSnapshot(session: BrainstormSession): Omit<BrainstormSession, 'suggestions'> {
  const { suggestions: _suggestions, ...snapshot } = session
  return structuredClone(snapshot)
}

// 保存内容身份而非时间阈值；选中状态与同步标记不属于讨论内容。
function content(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(content)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, content(item)]))
  return value
}
function stableNode(value: BoardNode) {
  const { selected: _selected, dragging: _dragging, measured: _measured, ...node } = value
  const { _syncVersion: _version, justCreated: _created, ...data } = node.data
  return { ...node, data }
}
function stableEdge(value: BoardEdge) {
  const { selected: _selected, ...edge } = value
  const { _syncVersion: _version, ...data } = edge.data ?? {}
  return { ...edge, data }
}
const same = (a: unknown, b: unknown) => JSON.stringify(content(a)) === JSON.stringify(content(b))
export function suggestionContext(board: BoardSnapshot, session: BrainstormSession): string {
  const { updatedAt: _updated, sync: _sync, ...snapshot } = board
  const { updatedAt: _sessionUpdated, aiPaused: _paused, pausedStages: _stages, ...discussion } = sessionSnapshot(session)
  return JSON.stringify(content({ board: { ...snapshot, nodes: board.nodes.map(stableNode), edges: board.edges.map(stableEdge) }, session: discussion }))
}
export function isStagePaused(session: BrainstormSession): boolean {
  return session.pausedStages ? session.pausedStages.includes(session.stage) : session.aiPaused
}
export function pauseStage(session: BrainstormSession, paused: boolean): BrainstormSession {
  const stages = session.pausedStages ?? (session.aiPaused ? [session.stage] : [])
  return { ...session, aiPaused: paused, pausedStages: [...stages.filter((stage) => stage !== session.stage), ...(paused ? [session.stage] : [])], suggestions: session.suggestions.map((item) => item.stage === session.stage ? { ...item, pausedForStage: paused } : item) }
}
export function visibleSuggestions(session: BrainstormSession): AgentSuggestion[] {
  if (isStagePaused(session)) return []
  const ignored = new Set(session.suggestions.filter((item) => item.status === 'ignored' && (item.stage ?? session.stage) === session.stage).flatMap((item) => item.ignoredActionTypes))
  return session.suggestions.filter((item) => ['pending', 'deferred'].includes(item.status) && (item.stage ?? session.stage) === session.stage && !item.actions.some((action) => ignored.has(action.type)))
}
export function ignoreSuggestion(session: BrainstormSession, id: string): BrainstormSession {
  if (!session.suggestions.some((item) => item.id === id)) throw new Error('建议不存在。')
  return { ...session, suggestions: session.suggestions.map((item) => item.id === id ? { ...item, stage: item.stage ?? session.stage, status: 'ignored', ignoredActionTypes: [...new Set(item.actions.map((action) => action.type))] } : item) }
}
export function receiveSuggestion(session: BrainstormSession, board: BoardSnapshot, response: unknown, trigger: SuggestionReason, selectedIdeaIds: string[]): BrainstormSession {
  if (!response || typeof response !== 'object' || Array.isArray(response)) throw new Error('AI 返回的建议无效。')
  const value = response as Record<string, unknown>
  if (Object.keys(value).length !== 2 || typeof value.message !== 'string' || !value.message.trim() || value.message.length > 100_000 || !Array.isArray(value.actions) || !value.actions.length) throw new Error('AI 返回的建议无效。')
  if (board.id !== session.boardId || selectedIdeaIds.some((id) => !board.nodes.some((node) => node.id === id && node.data.ideaMeta?.sessionId === session.id))) throw new Error('建议不属于当前白板。')
  const actions = value.actions.map((action) => validateBrainstormAction(action, board, session.id))
  const ignored = new Set(session.suggestions.filter((item) => item.status === 'ignored' && item.stage === session.stage).flatMap((item) => item.ignoredActionTypes))
  if (isStagePaused(session) || actions.some((action) => ignored.has(action.type))) return session
  if (visibleSuggestions(session).some((item) => item.status === 'pending')) throw new Error('请先处理当前建议。')
  return { ...session, suggestions: [...session.suggestions, { id: createId('suggestion'), trigger, message: value.message, actions, status: 'pending', ignoredActionTypes: [], pausedForStage: false, stage: session.stage, context: suggestionContext(board, session), selectedIdeaIds: [...selectedIdeaIds], boardAtRequest: structuredClone(board), createdAt: new Date().toISOString() }] }
}

function matrixSpec(action: AgentSuggestion['actions'][number]): ArtifactSpec {
  return { specVersion: '1.0', artifactType: 'matrix', title: action.title as string, fields: (action.criteria as string[]).map((label, index) => ({ key: `criterion_${index}`, label, type: 'text' })), records: [], presentation: { layout: 'table' } }
}

export function acceptSuggestion(session: BrainstormSession, id: string, layer: BoardActions): BrainstormSession {
  const suggestion = session.suggestions.find((item) => item.id === id)
  const before = layer.getSnapshot()
  if (!suggestion || suggestion.status !== 'pending' || !visibleSuggestions(session).some((item) => item.id === id)) throw new Error('建议当前不能接受。')
  if (before.id !== session.boardId || suggestion.stage !== session.stage || suggestion.context !== suggestionContext(before, session)) throw new Error('讨论已变化，请重新请求建议。')
  // 全部动作在执行前验证，避免先执行有效动作再发现后面的错误。
  const actions = suggestion.actions.map((action) => validateBrainstormAction(action, before, session.id))
  actions.filter((action) => action.type === 'create_matrix').forEach((action) => validateArtifactSpec(matrixSpec(action)))
  const next = structuredClone(session)
  const createdAt = new Date().toISOString()
  const contextualIds = suggestion.selectedIdeaIds?.length ? suggestion.selectedIdeaIds : before.nodes.filter((node) => node.data.ideaMeta?.sessionId === session.id).map((node) => node.id)
  const markSource = (id: string, type: 'question' | 'proposal' | 'evidence', ids: string[]) => layer.updateElement(id, { ideaMeta: createIdeaMeta({ sessionId: session.id, authorId: session.currentMemberId, type, sourceIdeaIds: ids, createdAt }) }, 'agent')
  for (const action of actions) {
    switch (action.type) {
      case 'create_cluster': {
        const ids = action.ideaIds as string[]
        const origins = ids.map((id) => {
          const idea = before.nodes.find((node) => node.id === id)!
          const author = session.members.find((member) => member.id === idea.data.ideaMeta!.authorId)!
          return `${idea.data.title}（观点 ID：${id}，作者：${author.name}，成员 ID：${author.id}）`
        })
        const frame = layer.createCluster(action.label as string, ids, 'none', 'agent')
        layer.updateElement(frame.id, { body: origins.join('\n'), ideaMeta: createIdeaMeta({ sessionId: session.id, authorId: session.currentMemberId, type: 'evidence', sourceIdeaIds: ids, createdAt }) }, 'agent')
        break
      }
      case 'connect_ideas': layer.connectElements(action.fromId as string, action.toId as string, action.label as string, 'agent'); break
      case 'ask_question': {
        const node = layer.addElement({ title: action.question as string, kind: 'question', ideaType: 'question' }, 'agent')
        markSource(node.id, 'question', contextualIds); break
      }
      case 'suggest_merge': {
        const node = layer.addElement({ title: action.title as string, body: action.content as string, ideaType: 'proposal' }, 'agent')
        markSource(node.id, 'proposal', action.ideaIds as string[])
        next.proposals.push({ id: node.id, title: action.title as string, description: action.content as string, sourceIdeaIds: [...action.ideaIds as string[]], authorId: session.currentMemberId, integrationLogic: action.logic as string, risks: [...action.risks as string[]], openQuestions: [...action.openQuestions as string[]], status: 'draft', comments: [] }); break
      }
      case 'create_matrix': {
        const node = layer.createArtifact(matrixSpec(action), undefined, undefined, 'agent')
        markSource(node.id, 'evidence', contextualIds); break
      }
      case 'create_summary': next.outcome = next.outcome ? { ...next.outcome, draft: action.summary as string, updatedAt: createdAt } : { draft: action.summary as string, actions: [], updatedAt: createdAt }; break
    }
  }
  next.updatedAt = createdAt
  return { ...next, suggestions: next.suggestions.map((item) => item.id === id ? { ...item, status: 'accepted', boardBeforeAccept: before, sessionBeforeAccept: sessionSnapshot(session), boardAfterAccept: layer.getSnapshot(), sessionAfterAccept: sessionSnapshot(next) } : item) }
}

// 对明确的接受前后差异做反向操作；被后续修改覆盖的内容直接拒绝撤销。
function restoreRecords<T extends { id: string }>(before: T[], after: T[], current: T[], normalize: (item: T) => unknown = (item) => item): T[] {
  const find = (items: T[], id: string) => { const item = items.find((item) => item.id === id); return item ? normalize(item) : undefined }
  const changed = new Set([...before, ...after].map((item) => item.id).filter((id) => !same(find(before, id), find(after, id))))
  for (const id of changed) if (!same(find(current, id), find(after, id))) throw new Error('AI 涉及的内容后来有修改，不能撤销。')
  const restored = current.flatMap((item) => changed.has(item.id) ? before.filter((previous) => previous.id === item.id) : [item])
  return [...restored, ...before.filter((item) => changed.has(item.id) && !current.some((node) => node.id === item.id))]
}
export function undoSuggestion(session: BrainstormSession, board: BoardSnapshot, id: string): { board: BoardSnapshot; session: BrainstormSession } {
  const item = session.suggestions.find((suggestion) => suggestion.id === id)
  if (!item || item.status !== 'accepted' || !item.boardBeforeAccept || !item.boardAfterAccept || !item.sessionBeforeAccept || !item.sessionAfterAccept || board.id !== session.boardId || item.boardBeforeAccept.id !== board.id) throw new Error('没有当前白板的完整接受快照，不能撤销。')
  const before = item.sessionBeforeAccept; const after = item.sessionAfterAccept
  const nextBoard = { ...board, nodes: restoreRecords(item.boardBeforeAccept.nodes, item.boardAfterAccept.nodes, board.nodes, stableNode), edges: restoreRecords(item.boardBeforeAccept.edges, item.boardAfterAccept.edges, board.edges, stableEdge) }
  const next = { ...session, proposals: restoreRecords(before.proposals, after.proposals, session.proposals) }
  for (const key of ['decision', 'outcome'] as const) {
    if (!same(before[key], after[key])) {
      if (!same(session[key], after[key])) throw new Error('AI 涉及的讨论内容后来有修改，不能撤销。')
      Object.assign(next, { [key]: structuredClone(before[key]) })
    }
  }
  next.suggestions = session.suggestions.map((suggestion) => suggestion.id === id ? { ...suggestion, status: 'undone' } : suggestion)
  next.updatedAt = new Date().toISOString()
  return { board: nextBoard, session: next }
}
