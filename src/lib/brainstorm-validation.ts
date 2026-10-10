import type { AgentSuggestion, BoardSnapshot, BrainstormSession } from '../types'
import { isSnapshot } from './board-validation'
export type StoredBrainstorm = { board: BoardSnapshot; session: BrainstormSession }

type RecordValue = Record<string, unknown>
const stages = ['collecting', 'organizing', 'expanding', 'integrating', 'optimizing', 'deciding', 'output']
const ideaTypes = ['idea', 'question', 'risk', 'evidence', 'supplement', 'proposal']
const actionTypes = ['create_cluster', 'connect_ideas', 'ask_question', 'suggest_merge', 'create_matrix', 'create_summary']
function record(value: unknown): value is RecordValue { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function text(value: unknown, empty = true): value is string { return typeof value === 'string' && value.length <= 100_000 && (empty || Boolean(value.trim())) }
function id(value: unknown): value is string { return text(value, false) && value.length <= 200 }
function date(value: unknown): value is string { return text(value, false) && value.length <= 64 && Number.isFinite(Date.parse(value)) }
function list(value: unknown, check: (item: unknown) => boolean): value is unknown[] { return Array.isArray(value) && value.length <= 10_000 && value.every((item) => check(item)) }
function strings(value: unknown): boolean { return list(value, text) }
function optional(value: unknown, check: (item: unknown) => boolean): boolean { return value === undefined || check(value) }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function enumeration(value: unknown, values: string[]): value is string { return typeof value === 'string' && values.includes(value) }
function uniqueRecords(value: unknown, check: (item: RecordValue) => boolean): value is RecordValue[] {
  if (!list(value, (item) => record(item) && id(item.id) && check(item))) return false
  return new Set(value.map((item) => (item as RecordValue).id)).size === value.length
}

function validIdeaMetadata(board: BoardSnapshot, session: RecordValue, memberIds: Set<unknown>): boolean {
  const nodeIds = new Set(board.nodes.map((node) => node.id))
  return board.nodes.every((node) => {
    const meta = node.data.ideaMeta
    return meta === undefined || (record(meta) && meta.sessionId === session.id && memberIds.has(meta.authorId)
      && enumeration(meta.type, ideaTypes) && date(meta.createdAt) && list(meta.sourceIdeaIds, (source) => id(source) && nodeIds.has(source))
      && list(meta.versions, (version) => record(version) && memberIds.has(version.authorId) && date(version.createdAt)))
  })
}

// 动作只接受固定字段和当前讨论的真实观点引用，供保存及后续建议入口共用。
export function validateBrainstormAction(value: unknown, board: BoardSnapshot, sessionId: string): AgentSuggestion['actions'][number] {
  const invalid = () => { throw new Error('建议动作结构或观点引用无效。') }
  if (!record(value) || !enumeration(value.type, actionTypes)) return invalid()
  const type = value.type
  const references = (ids: unknown, minimum: number) => list(ids, (item) => id(item) && board.nodes.some((node) => node.id === item && node.data.ideaMeta?.sessionId === sessionId))
    && ids.length >= minimum && new Set(ids).size === ids.length
  const fields: Record<string, string[]> = {
    create_cluster: ['type', 'label', 'ideaIds'], connect_ideas: ['type', 'fromId', 'toId', 'label'], ask_question: ['type', 'question'],
    suggest_merge: ['type', 'ideaIds', 'title', 'content', 'logic', 'risks', 'openQuestions'], create_matrix: ['type', 'title', 'criteria'], create_summary: ['type', 'summary'],
  }
  if (Object.keys(value).length !== fields[type].length || Object.keys(value).some((key) => !fields[type].includes(key))) return invalid()
  let valid = false
  switch (value.type) {
    case 'create_cluster': valid = text(value.label, false) && references(value.ideaIds, 1); break
    case 'connect_ideas': valid = text(value.label, false) && value.fromId !== value.toId && references([value.fromId, value.toId], 2); break
    case 'ask_question': valid = text(value.question, false); break
    case 'suggest_merge': valid = references(value.ideaIds, 2) && text(value.title, false) && text(value.content, false) && text(value.logic, false) && strings(value.risks) && strings(value.openQuestions); break
    case 'create_matrix': valid = text(value.title, false) && list(value.criteria, (criterion) => text(criterion, false)) && value.criteria.length > 0; break
    case 'create_summary': valid = text(value.summary, false); break
  }
  if (!valid) return invalid()
  return structuredClone(value) as AgentSuggestion['actions'][number]
}

function validActions(value: unknown, board: BoardSnapshot, sessionId: string): boolean {
  return list(value, (action) => {
    try { validateBrainstormAction(action, board, sessionId); return true } catch { return false }
  }) && value.length > 0
}

// 前后端共用同一套结构检查，不为损坏数据补字段或猜测内容。
export function validateBrainstormPayload(value: unknown, expectedId?: string): StoredBrainstorm {
  const invalid = () => { throw new Error('讨论数据无效或不属于当前白板。') }
  if (!record(value) || !isSnapshot(value.board) || !record(value.session)) return invalid()
  const { board, session } = value
  if (!id(session.id) || (expectedId !== undefined && session.id !== expectedId) || session.boardId !== board.id
    || (board.brainstormSessionId !== undefined && board.brainstormSessionId !== session.id)
    || !text(session.topic, false) || !text(session.goal, false) || !text(session.background) || !text(session.constraints)
    || !enumeration(session.stage, stages) || typeof session.aiPaused !== 'boolean'
    || !optional(session.pausedStages, (value) => list(value, (stage) => enumeration(stage, stages)) && new Set(value).size === value.length)
    || !date(session.createdAt) || !date(session.updatedAt)
    || !uniqueRecords(session.members, (member) => text(member.name, false) && enumeration(member.role, ['facilitator', 'member']) && date(member.joinedAt))
    || !session.members.length) return invalid()
  const memberIds = new Set(session.members.map((member) => member.id))
  if (!memberIds.has(session.currentMemberId) || !validIdeaMetadata(board, session, memberIds)) return invalid()
  const nodeIds = new Set(board.nodes.map((node) => node.id))
  if (!uniqueRecords(session.proposals, (proposal) => text(proposal.title) && text(proposal.description) && text(proposal.integrationLogic)
    && memberIds.has(proposal.authorId) && list(proposal.sourceIdeaIds, (source) => id(source) && nodeIds.has(source))
    && strings(proposal.risks) && strings(proposal.openQuestions) && enumeration(proposal.status, ['draft', 'accepted', 'rejected'])
    && uniqueRecords(proposal.comments, (comment) => memberIds.has(comment.authorId) && enumeration(comment.kind, ['support', 'oppose', 'supplement', 'risk', 'verify']) && text(comment.content) && date(comment.createdAt)))) return invalid()
  const proposalIds = new Set(session.proposals.map((proposal) => proposal.id))
  const validSessionSnapshot = (snapshot: unknown, snapshotBoard: unknown) => {
    if (!record(snapshot) || 'suggestions' in snapshot || snapshot.id !== session.id || snapshot.boardId !== board.id || !isSnapshot(snapshotBoard)) return false
    try { validateBrainstormPayload({ board: snapshotBoard, session: { ...snapshot, suggestions: [] } }, session.id as string); return true } catch { return false }
  }
  const completeSuggestion = (suggestion: RecordValue) => {
    if (!['similar_ideas', 'quiet_period', 'complementary_ideas'].includes(suggestion.trigger as string)) return true
    const requestBoard = suggestion.boardAtRequest
    if (!enumeration(suggestion.stage, stages) || typeof suggestion.context !== 'string' || !isSnapshot(requestBoard)
      || !list(suggestion.selectedIdeaIds, (source) => id(source) && requestBoard.nodes.some((node) => node.id === source && node.data.ideaMeta?.sessionId === session.id))) return false
    if (['accepted', 'undone'].includes(suggestion.status as string) && (!suggestion.boardBeforeAccept || !suggestion.boardAfterAccept || !suggestion.sessionBeforeAccept || !suggestion.sessionAfterAccept)) return false
    try {
      const context: unknown = JSON.parse(suggestion.context)
      if (!record(context) || !record(context.board) || context.board.id !== board.id || !record(context.session) || context.session.id !== session.id || context.session.boardId !== board.id) return false
      validateBrainstormPayload({ board: { ...context.board, updatedAt: suggestion.createdAt }, session: { ...context.session, updatedAt: suggestion.createdAt, aiPaused: false, suggestions: [] } }, session.id as string)
      return true
    } catch { return false }
  }
  if (!uniqueRecords(session.suggestions, (suggestion) => enumeration(suggestion.trigger, ['manual', 'stage', 'board_change', 'similar_ideas', 'quiet_period', 'complementary_ideas'])
    && completeSuggestion(suggestion)
    && text(suggestion.message) && enumeration(suggestion.status, ['pending', 'accepted', 'rejected', 'ignored', 'deferred', 'undone'])
    && optional(suggestion.stage, (stage) => enumeration(stage, stages))
    && optional(suggestion.context, (context) => typeof context === 'string' && context.length > 0 && context.length <= 3_000_000)
    && optional(suggestion.selectedIdeaIds, (ids) => list(ids, id) && new Set(ids).size === ids.length)
    && optional(suggestion.boardAtRequest, (snapshot) => isSnapshot(snapshot) && snapshot.id === board.id && validIdeaMetadata(snapshot, session, memberIds))
    && optional(suggestion.boardBeforeAccept, (snapshot) => isSnapshot(snapshot) && snapshot.id === board.id && validIdeaMetadata(snapshot, session, memberIds))
    && optional(suggestion.boardAfterAccept, (snapshot) => isSnapshot(snapshot) && snapshot.id === board.id)
    && optional(suggestion.sessionBeforeAccept, (snapshot) => validSessionSnapshot(snapshot, suggestion.boardBeforeAccept))
    && optional(suggestion.sessionAfterAccept, (snapshot) => validSessionSnapshot(snapshot, suggestion.boardAfterAccept))
    && validActions(suggestion.actions, (suggestion.boardBeforeAccept as BoardSnapshot | undefined) ?? (suggestion.boardAtRequest as BoardSnapshot | undefined) ?? board, session.id as string)
    && list(suggestion.ignoredActionTypes, (type) => enumeration(type, actionTypes))
    && typeof suggestion.pausedForStage === 'boolean' && date(suggestion.createdAt)
  )) return invalid()
  const decision = session.decision
  if (decision !== null) {
    if (!record(decision) || !uniqueRecords(decision.criteria, (criterion) => text(criterion.name) && finite(criterion.weight) && criterion.weight >= 0)) return invalid()
    const criterionIds = new Set(decision.criteria.map((criterion) => criterion.id))
    if (!list(decision.scores, (score) => record(score) && proposalIds.has(score.proposalId) && criterionIds.has(score.criterionId) && memberIds.has(score.memberId) && finite(score.score) && text(score.reason))
      || !list(decision.votes, (vote) => record(vote) && proposalIds.has(vote.proposalId) && memberIds.has(vote.memberId))
      || !optional(decision.finalProposalId, (proposal) => proposalIds.has(proposal)) || !optional(decision.confirmedBy, (member) => memberIds.has(member))
      || !optional(decision.confirmedAt, date)) return invalid()
  }
  const outcome = session.outcome
  if (outcome !== null && (!record(outcome) || !text(outcome.draft) || !date(outcome.updatedAt)
    || !optional(outcome.finalProposalId, (proposal) => proposalIds.has(proposal))
    || !list(outcome.actions, (action) => record(action) && text(action.title) && optional(action.ownerId, (member) => memberIds.has(member)) && optional(action.dueAt, text)))) return invalid()
  return { board: structuredClone(board), session: structuredClone(session) as BrainstormSession }
}

export function deserializeBrainstorm(value: string): StoredBrainstorm {
  return validateBrainstormPayload(JSON.parse(value) as unknown)
}
