import type { BoardSnapshot, BrainstormSession } from '../types'
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
function uniqueRecords(value: unknown, check: (item: RecordValue) => boolean): value is RecordValue[] {
  if (!list(value, (item) => record(item) && id(item.id) && check(item))) return false
  return new Set(value.map((item) => (item as RecordValue).id)).size === value.length
}

function validIdeaMetadata(board: BoardSnapshot, session: RecordValue, memberIds: Set<unknown>): boolean {
  const nodeIds = new Set(board.nodes.map((node) => node.id))
  return board.nodes.every((node) => {
    const meta = node.data.ideaMeta
    return meta === undefined || (record(meta) && meta.sessionId === session.id && memberIds.has(meta.authorId)
      && ideaTypes.includes(String(meta.type)) && date(meta.createdAt) && list(meta.sourceIdeaIds, (source) => id(source) && nodeIds.has(source))
      && list(meta.versions, (version) => record(version) && memberIds.has(version.authorId) && date(version.createdAt)))
  })
}

// 前后端共用同一套结构检查，不为损坏数据补字段或猜测内容。
export function validateBrainstormPayload(value: unknown, expectedId?: string): StoredBrainstorm {
  const invalid = () => { throw new Error('讨论数据无效或不属于当前白板。') }
  if (!record(value) || !isSnapshot(value.board) || !record(value.session)) return invalid()
  const { board, session } = value
  if (!id(session.id) || (expectedId !== undefined && session.id !== expectedId) || session.boardId !== board.id
    || (board.brainstormSessionId !== undefined && board.brainstormSessionId !== session.id)
    || !text(session.topic, false) || !text(session.goal, false) || !text(session.background) || !text(session.constraints)
    || !stages.includes(String(session.stage)) || !optional(session.aiPaused, (paused) => typeof paused === 'boolean')
    || !date(session.createdAt) || !date(session.updatedAt)
    || !uniqueRecords(session.members, (member) => text(member.name, false) && ['facilitator', 'member'].includes(String(member.role)) && date(member.joinedAt))
    || !session.members.length) return invalid()
  const memberIds = new Set(session.members.map((member) => member.id))
  if (!memberIds.has(session.currentMemberId) || !validIdeaMetadata(board, session, memberIds)) return invalid()
  const nodeIds = new Set(board.nodes.map((node) => node.id))
  if (!uniqueRecords(session.proposals, (proposal) => text(proposal.title) && text(proposal.description) && text(proposal.integrationLogic)
    && memberIds.has(proposal.authorId) && list(proposal.sourceIdeaIds, (source) => id(source) && nodeIds.has(source))
    && strings(proposal.risks) && strings(proposal.openQuestions) && ['draft', 'accepted', 'rejected'].includes(String(proposal.status))
    && uniqueRecords(proposal.comments, (comment) => memberIds.has(comment.authorId) && ['support', 'oppose', 'supplement', 'risk', 'verify'].includes(String(comment.kind)) && text(comment.content) && date(comment.createdAt)))) return invalid()
  const proposalIds = new Set(session.proposals.map((proposal) => proposal.id))
  if (!uniqueRecords(session.suggestions, (suggestion) => ['manual', 'stage', 'board_change'].includes(String(suggestion.trigger))
    && text(suggestion.message) && ['pending', 'accepted', 'rejected', 'ignored'].includes(String(suggestion.status))
    && list(suggestion.actions, (action) => record(action) && actionTypes.includes(String(action.type)))
    && list(suggestion.ignoredActionTypes, (type) => actionTypes.includes(String(type)))
    && typeof suggestion.pausedForStage === 'boolean' && date(suggestion.createdAt)
    && optional(suggestion.boardBeforeAccept, (snapshot) => isSnapshot(snapshot) && snapshot.id === board.id && validIdeaMetadata(snapshot, session, memberIds)))) return invalid()
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
