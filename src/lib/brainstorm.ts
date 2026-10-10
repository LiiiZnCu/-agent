import type { AgentActionType, AgentSuggestion, BrainstormSession, BrainstormStage, IdeaMeta, IdeaType } from '../types'

export const IDEA_LABELS: Record<IdeaType, string> = { idea: '观点', question: '问题', risk: '风险', evidence: '补充信息', supplement: '补充信息', proposal: '候选方案' }

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
    stage: 'collecting', currentMemberId: input.memberId,
    members: [{ id: input.memberId, name: memberName, role: 'facilitator', joinedAt: input.createdAt }],
    suggestions: [], proposals: [], decision: null, outcome: null,
    createdAt: input.createdAt, updatedAt: input.createdAt,
  }
}

export function setBrainstormStage(session: BrainstormSession, stage: BrainstormStage, updatedAt: string): BrainstormSession {
  if (!BRAINSTORM_STAGES.some((item) => item.id === stage)) throw new Error('未知讨论阶段')
  return { ...session, stage, updatedAt }
}

export function createIdeaMeta(input: { sessionId: string; authorId: string; type: IdeaType; sourceIdeaIds?: string[]; createdAt: string }): IdeaMeta {
  return { sessionId: input.sessionId, authorId: input.authorId, type: input.type, createdAt: input.createdAt, sourceIdeaIds: [...(input.sourceIdeaIds ?? [])], versions: [] }
}

export function updateIdeaMeta(meta: IdeaMeta, authorId: string, createdAt: string): IdeaMeta {
  return { ...meta, versions: [...meta.versions, { authorId, createdAt }] }
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
