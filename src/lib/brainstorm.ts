import type { AgentActionType, AgentSuggestion, BoardNode, BrainstormSession, BrainstormStage, IdeaMeta, IdeaType } from '../types'

export const IDEA_LABELS: Record<IdeaType, string> = { idea: '观点', question: '问题', risk: '风险', evidence: '补充信息', supplement: '补充信息', proposal: '候选方案' }

export function isOutcomeConfirmed(session: BrainstormSession): boolean {
  const selected = session.proposals.find((proposal) => proposal.id === session.decision?.finalProposalId && proposal.status === 'accepted')
  return Boolean(selected && session.outcome?.draft.trim() && session.decision?.confirmedAt && session.decision.confirmedBy && session.outcome.finalProposalId === selected.id)
}

export const BRAINSTORM_STAGES: Array<{ id: BrainstormStage; label: string }> = [
  { id: 'collecting', label: '想法收集' }, { id: 'organizing', label: '智能归类' },
  { id: 'expanding', label: '引导扩散' }, { id: 'integrating', label: '整合方案' },
  { id: 'optimizing', label: '协同优化' }, { id: 'deciding', label: '辅助决策' },
  { id: 'output', label: '成果输出' },
]

export function createBrainstormSession(input: { id: string; boardId: string; topic: string; goal: string; background?: string; constraints?: string; memberId: string; memberName: string; createdAt: string }): BrainstormSession {
  const topic = input.topic.trim()
  const goal = input.goal.trim()
  const memberName = input.memberName.trim()
  if (!topic || !goal || !memberName) throw new Error('主题、目标和成员昵称不能为空')
  return {
    id: input.id, boardId: input.boardId, topic, goal,
    background: input.background?.trim() ?? '', constraints: input.constraints?.trim() ?? '',
    stage: 'collecting', aiPaused: false, currentMemberId: input.memberId,
    members: [{ id: input.memberId, name: memberName, role: 'facilitator', joinedAt: input.createdAt }],
    suggestions: [], proposals: [], decision: null, outcome: null,
    createdAt: input.createdAt, updatedAt: input.createdAt,
  }
}

export function setBrainstormStage(session: BrainstormSession, stage: BrainstormStage, updatedAt: string): BrainstormSession {
  if (!BRAINSTORM_STAGES.some((item) => item.id === stage)) throw new Error('未知讨论阶段')
  const pausedStages = session.pausedStages ?? (session.aiPaused ? [session.stage] : [])
  return { ...session, stage, updatedAt, pausedStages, aiPaused: pausedStages.includes(stage) }
}

export function createIdeaMeta(input: { sessionId: string; authorId: string; type: IdeaType; sourceIdeaIds?: string[]; createdAt: string }): IdeaMeta {
  return { sessionId: input.sessionId, authorId: input.authorId, type: input.type, createdAt: input.createdAt, sourceIdeaIds: [...(input.sourceIdeaIds ?? [])], versions: [] }
}

export function updateIdeaMeta(meta: IdeaMeta, authorId: string, createdAt: string): IdeaMeta {
  return { ...meta, versions: [...meta.versions, { authorId, createdAt }] }
}

export function removeDiscussionReferences(session: BrainstormSession | null, nodes: BoardNode[], deletedIds: Set<string>) {
  const remainingNodes = nodes.filter((node) => !deletedIds.has(node.id)).map((node) => {
    const meta = node.data.ideaMeta
    if (!meta || !meta.sourceIdeaIds.some((id) => deletedIds.has(id))) return node
    const nextMeta = { ...meta, sourceIdeaIds: meta.sourceIdeaIds.filter((id) => !deletedIds.has(id)) }
    return { ...node, data: { ...node.data, ideaMeta: updateIdeaMeta(nextMeta, session?.currentMemberId ?? meta.authorId, new Date().toISOString()) } }
  })
  const nextSession = session ? {
    ...session,
    proposals: session.proposals.filter((proposal) => !deletedIds.has(proposal.id)).map((proposal) => ({ ...proposal, sourceIdeaIds: proposal.sourceIdeaIds.filter((id) => !deletedIds.has(id)) })),
    decision: session.decision ? {
      ...session.decision, scores: session.decision.scores.filter((score) => !deletedIds.has(score.proposalId)), votes: session.decision.votes.filter((vote) => !deletedIds.has(vote.proposalId)),
      finalProposalId: session.decision.finalProposalId && deletedIds.has(session.decision.finalProposalId) ? undefined : session.decision.finalProposalId,
      confirmedAt: undefined, confirmedBy: undefined,
    } : null,
    outcome: session.outcome ? { ...session.outcome, finalProposalId: session.outcome.finalProposalId && deletedIds.has(session.outcome.finalProposalId) ? undefined : session.outcome.finalProposalId } : null,
  } : null
  return { session: nextSession, nodes: remainingNodes }
}

export function setSuggestionStatus(session: BrainstormSession, suggestionId: string, status: AgentSuggestion['status'], options: { ignoredActionTypes?: AgentActionType[]; pausedForStage?: boolean; boardBeforeAccept?: AgentSuggestion['boardBeforeAccept'] } = {}): BrainstormSession {
  if (!session.suggestions.some((item) => item.id === suggestionId)) throw new Error('建议不存在')
  return {
    ...session,
    suggestions: session.suggestions.map((item) => item.id === suggestionId ? {
      ...item, status,
      ignoredActionTypes: options.ignoredActionTypes ? [...options.ignoredActionTypes] : item.ignoredActionTypes,
      pausedForStage: options.pausedForStage ?? item.pausedForStage,
      boardBeforeAccept: options.boardBeforeAccept ? structuredClone(options.boardBeforeAccept) : item.boardBeforeAccept,
    } : item),
  }
}
