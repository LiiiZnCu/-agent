import type { AgentSuggestion, BoardSnapshot, BrainstormSession } from '../src/types'
import { validateBrainstormAction } from '../src/lib/brainstorm-validation'

export type AgentResponse = Pick<AgentSuggestion, 'message' | 'actions'>
export type SuggestionRequest = { purpose: string; ideaIds?: string[] }

export class AgentValidationError extends Error {}

export function validateSuggestionRequest(value: unknown, board: BoardSnapshot, session: BrainstormSession): SuggestionRequest {
  const invalid = () => { throw new AgentValidationError('建议请求必须包含非空操作目的，选中观点必须属于当前讨论。') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  const request = value as Record<string, unknown>
  if (Object.keys(request).some((key) => key !== 'purpose' && key !== 'ideaIds')
    || typeof request.purpose !== 'string' || !request.purpose.trim() || request.purpose.length > 100_000
    || board.id !== session.boardId || (board.brainstormSessionId !== undefined && board.brainstormSessionId !== session.id)) return invalid()
  if ('ideaIds' in request) {
    if (!Array.isArray(request.ideaIds) || !request.ideaIds.length || request.ideaIds.length > 10_000
      || new Set(request.ideaIds).size !== request.ideaIds.length
      || !request.ideaIds.every((id) => typeof id === 'string' && id.length <= 200 && board.nodes.some((node) => node.id === id && node.data.ideaMeta?.sessionId === session.id))) return invalid()
    return { purpose: request.purpose, ideaIds: [...request.ideaIds] }
  }
  return { purpose: request.purpose }
}

export function validateAgentResponse(value: unknown, board: BoardSnapshot, session: BrainstormSession): AgentResponse {
  if (board.id !== session.boardId || (board.brainstormSessionId !== undefined && board.brainstormSessionId !== session.id)) throw new AgentValidationError('建议上下文不属于当前讨论。')
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new AgentValidationError('模型必须返回包含 message 和 actions 的 JSON 对象。')
  const response = value as Record<string, unknown>
  if (Object.keys(response).length !== 2 || typeof response.message !== 'string' || !response.message.trim() || response.message.length > 100_000
    || !Array.isArray(response.actions) || !response.actions.length || response.actions.length > 10_000) throw new AgentValidationError('模型必须返回非空 message 和 actions，且不能包含其他字段。')
  const actions = response.actions.map((action) => {
    try { return validateBrainstormAction(action, board, session.id) }
    catch { throw new AgentValidationError('建议动作结构或观点引用无效。') }
  })
  return { message: response.message, actions }
}
